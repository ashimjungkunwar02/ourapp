import { useEffect, useRef } from 'react'
import { getToken } from '../services/api'

// ─── Socket URL ──────────────────────────────────────────────────────────────
// Was hardcoded to 'http://localhost:5000', which broke every deployed build.
// Falls back to the current page origin so a same-origin deploy needs no config.
const SOCKET_URL =
  import.meta.env.VITE_SOCKET_URL ||
  (typeof window !== 'undefined' ? window.location.origin : undefined)

/**
 * Realtime connection to the API.
 *
 * AUTH: the token is sent in the handshake. The server verifies it and joins the
 * socket to a room derived from the VERIFIED identity, so a client can never
 * subscribe to another user's room by passing a different userId.
 *
 * The 'join' event is still emitted for compatibility, but the server ignores
 * any client-supplied payload and uses the authenticated id.
 */
export function useSocket({ onRain, onBonus, onAuthenticated } = {}) {
  const socketRef = useRef(null)

  // Keep the latest callbacks without re-creating the socket on every render.
  // With a `[]` dependency array the effect captured the first-render closures
  // forever, so handlers saw stale state.
  const handlersRef = useRef({ onRain, onBonus, onAuthenticated })
  useEffect(() => {
    handlersRef.current = { onRain, onBonus, onAuthenticated }
  }, [onRain, onBonus, onAuthenticated])

  const token = getToken()

  useEffect(() => {
    // No token == not logged in; don't open a socket that will only be rejected.
    if (!token) return

    let cancelled = false
    let socket    = null

    import('socket.io-client')
      .then(({ io }) => {
        if (cancelled) return

        socket = io(SOCKET_URL, {
          transports: ['websocket', 'polling'],
          auth: { token },
          reconnection: true,
          reconnectionAttempts: Infinity,
          reconnectionDelay: 1000,
          reconnectionDelayMax: 10000
        })
        socketRef.current = socket

        socket.on('connect', () => {
          // Emitted for parity with the original client contract. The server
          // derives the room from the verified JWT, not from this payload.
          socket.emit('join')
        })

        socket.on('authenticated', (data) => {
          handlersRef.current.onAuthenticated?.(data)
        })

        socket.on('rain_event', (data) => {
          handlersRef.current.onRain?.(data)
        })

        socket.on('bonus_notification', (data) => {
          handlersRef.current.onBonus?.(data)
        })

        socket.on('connect_error', (err) => {
          // The server rejects unauthenticated handshakes with this message.
          if (/authentication/i.test(err?.message || '')) {
            console.warn('[socket] rejected — token invalid or expired')
          } else {
            console.warn('[socket] connect_error:', err?.message)
          }
        })

        socket.on('disconnect', (reason) => {
          console.log('[socket] disconnected:', reason)
        })
      })
      .catch(err => {
        console.log('[socket] client unavailable:', err.message)
      })

    return () => {
      cancelled = true
      if (socket) {
        socket.removeAllListeners()
        socket.disconnect()
      }
      socketRef.current = null
    }
    // Reconnect when the token changes (login/logout), not on every render.
  }, [token])

  return socketRef
}
