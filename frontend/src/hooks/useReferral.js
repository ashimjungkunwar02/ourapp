import { useEffect, useState } from 'react'
import { referralAPI }         from '../services/api'
import { useAuth }             from '../context/AuthContext'
import {
  readPendingReferralCode,
  clearPendingReferralCode
}                              from '../utils/referralCapture'

/**
 * Consumes a `?ref=` code captured by AuthContext and applies it to the
 * now-authenticated user.
 *
 * Previously the referral link was generated and shared, but nothing ever read
 * `window.location.search` — so a friend who clicked through and logged in never
 * got credited, and neither did the referrer.
 *
 * Returns { pending, result } so the UI can show a confirmation toast.
 */
export function useReferral() {
  const { user, fetchProfile } = useAuth()
  const [pending, setPending] = useState(false)
  const [result,  setResult]  = useState(null)

  useEffect(() => {
    if (!user || user.isAdmin) return

    // Already attributed — nothing to do, and drop any stale parked code.
    if (user.referredBy) {
      clearPendingReferralCode()
      return
    }

    const code = readPendingReferralCode()
    if (!code) return

    let cancelled = false

    ;(async () => {
      // Set inside the async work rather than synchronously in the effect body:
      // a synchronous setState here causes a cascading render.
      setPending(true)
      try {
        const res = await referralAPI.applyCode(code)

        if (cancelled) return
        clearPendingReferralCode()
        setResult({
          ok:    true,
          coins: res.data?.coinsAdded ?? 0
        })
        // Pull the fresh balance/referredBy into AuthContext.
        await fetchProfile()
      } catch (err) {
        if (cancelled) return

        const message = err.response?.data?.message || 'Could not apply referral code'
        const status  = err.response?.status

        // Permanent failures: retrying on every render is pointless and would
        // spam the API. Forget the code.
        const permanent =
          status === 400 || status === 404 ||
          /already used|own referral|invalid/i.test(message)

        if (permanent) clearPendingReferralCode()

        setResult({ ok: false, message, permanent })
      } finally {
        if (!cancelled) setPending(false)
      }
    })()

    return () => { cancelled = true }
    // `user.referredBy` is the meaningful trigger, not the whole user object:
    // depending on `user` would re-run the effect every time fetchProfile()
    // resolves, and the guard above already bails once referredBy is set.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.isAdmin, user?.referredBy, user?._id, fetchProfile])

  const dismiss = () => setResult(null)

  return { pending, result, dismiss }
}
