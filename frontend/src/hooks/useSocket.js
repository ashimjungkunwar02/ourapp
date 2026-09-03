import { useEffect, useRef } from 'react'

const SOCKET_URL = 'http://localhost:5000'

export function useSocket({ onRain, onBonus } = {}) {
  const socketRef = useRef(null)

  useEffect(() => {
    // Dynamically import socket.io-client
    import('socket.io-client').then(({ io }) => {
      socketRef.current = io(SOCKET_URL, {
        transports: ['websocket', 'polling']
      })

      const socket = socketRef.current

      socket.on('connect', () => {
        console.log('Socket connected')
      })

      socket.on('rain_event', (data) => {
        onRain?.(data)
      })

      socket.on('bonus_notification', (data) => {
        onBonus?.(data)
      })

      socket.on('disconnect', () => {
        console.log('Socket disconnected')
      })
    }).catch(err => {
      console.log('Socket not available:', err.message)
    })

    return () => {
      if (socketRef.current) {
        socketRef.current.disconnect()
      }
    }
  }, [])

  return socketRef.current
}