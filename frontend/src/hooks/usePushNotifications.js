import { useState, useEffect } from 'react'

export function usePushNotifications() {
  const [permission,  setPermission]  = useState(
    typeof Notification !== 'undefined'
      ? Notification.permission
      : 'default'
  )
  const [subscribed, setSubscribed] = useState(false)

  useEffect(() => {
    checkSubscription()
  }, [])

  const checkSubscription = async () => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return
    try {
      const reg = await navigator.serviceWorker.ready
      const sub = await reg.pushManager.getSubscription()
      setSubscribed(!!sub)
    } catch {}
  }

  const requestPermission = async () => {
    if (!('Notification' in window)) return false
    try {
      const result = await Notification.requestPermission()
      setPermission(result)
      return result === 'granted'
    } catch {
      return false
    }
  }

  const scheduleCoinNotification = (secondsLeft) => {
    if (!('serviceWorker' in navigator)) return
    navigator.serviceWorker.ready.then(reg => {
      setTimeout(() => {
        reg.showNotification('LISA SWEEPS 🪙', {
          body:    'Your free hourly coin is ready to claim!',
          icon:    '/icons/icon-192.png',
          badge:   '/icons/icon-192.png',
          vibrate: [100, 50, 100],
          tag:     'coin-ready'
        })
      }, secondsLeft * 1000)
    }).catch(() => {})
  }

  return {
    permission,
    subscribed,
    requestPermission,
    scheduleCoinNotification
  }
}