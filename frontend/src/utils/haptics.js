export const haptics = {
  light() {
    try {
      if ('vibrate' in navigator) navigator.vibrate(10)
    } catch {}
  },

  medium() {
    try {
      if ('vibrate' in navigator) navigator.vibrate(30)
    } catch {}
  },

  heavy() {
    try {
      if ('vibrate' in navigator) navigator.vibrate([50, 30, 50])
    } catch {}
  },

  win() {
    try {
      if ('vibrate' in navigator)
        navigator.vibrate([100, 50, 100, 50, 200])
    } catch {}
  },

  bigWin() {
    try {
      if ('vibrate' in navigator)
        navigator.vibrate([200, 100, 200, 100, 200, 100, 400])
    } catch {}
  },

  rain() {
    try {
      if ('vibrate' in navigator)
        navigator.vibrate([50, 30, 50, 30, 50, 30, 100])
    } catch {}
  },

  tick() {
    try {
      if ('vibrate' in navigator) navigator.vibrate(5)
    } catch {}
  }
}