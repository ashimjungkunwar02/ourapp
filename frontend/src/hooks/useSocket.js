import { useEffect, useRef } from 'react'
import { supabase, isSupabaseConfigured } from '../services/supabase'

// ══════════════════════════════════════════════════════════════════════════
// Realtime live events (replaces the old Socket.io client).
//
// Same call signature — `useSocket({ onRain, onBonus })` — so nothing else in
// the app changed. Supabase Realtime streams INSERTs on the `live_events`
// table over websockets; the Postgres functions write those rows whenever an
// admin makes it rain or launches a bonus.
//
// RLS: reads are allowed for authenticated users, so the channel is only
// subscribed once a session exists. It re-subscribes automatically if the
// session changes.
// ══════════════════════════════════════════════════════════════════════════

export const useSocket = ({ onRain, onBonus }) => {
  // Handlers are captured in refs so re-rendering the parent does not tear
  // down and rebuild the websocket on every render.
  const onRainRef  = useRef(onRain)
  const onBonusRef = useRef(onBonus)
  useEffect(() => { onRainRef.current  = onRain },  [onRain])
  useEffect(() => { onBonusRef.current = onBonus }, [onBonus])

  useEffect(() => {
    if (!supabase || !isSupabaseConfigured) return

    let cancelled = false
    let channel   = null
    const seen    = new Set() // de-dupe: Realtime can deliver twice on reconnect

    const handle = (row) => {
      if (!row) return
      if (row.id != null) {
        if (seen.has(row.id)) return
        seen.add(row.id)
        // Keep the de-dupe set from growing unbounded on a long-lived tab.
        if (seen.size > 500) seen.clear()
      }

      const payload = row.payload ?? {}

      switch (row.event) {
        case 'make_it_rain':
          // Shape matches what the CoinRain component already expects.
          onRainRef.current?.({
            amount:    payload.amount    ?? 0,
            adminName: payload.adminName ?? 'Admin',
            event:     'make_it_rain'
          })
          break

        case 'bonus_launched':
          onBonusRef.current?.({
            type:       payload.type,
            percentage: payload.percentage,
            validHours: payload.validHours,
            message:    payload.message,
            endsAt:     payload.endsAt,
            event:      'bonus_launched'
          })
          break

        default:
          break
      }
    }

    const connect = () => {
      if (cancelled) return

      channel = supabase
        .channel('live-events', { config: { broadcast: { self: false } } })
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'live_events' },
          (payload) => handle(payload.new)
        )
        .subscribe((status) => {
          // Surface channel problems in dev without breaking production UX.
          if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            console.warn('[realtime] live_events channel:', status)
          }
        })
    }

    // Only subscribe once there is a session — anon has no read access, so the
    // channel would just error.
    supabase.auth.getSession().then(({ data }) => {
      if (!cancelled && data.session) connect()
    }).catch(() => { /* no session yet */ })

    // Re-subscribe when the user signs in/out.
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (cancelled) return
      if (session) {
        if (!channel) connect()
      } else if (channel) {
        supabase.removeChannel(channel)
        channel = null
        seen.clear()
      }
    })

    return () => {
      cancelled = true
      if (channel) {
        supabase.removeChannel(channel)
        channel = null
      }
      sub.subscription.unsubscribe()
    }
  }, [])
}

export default useSocket
