import axios from 'axios'

// ─── Base Instance ────────────────────────────────────────────────────────────
const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:5000/api',
  timeout: 15000,
  headers: {
    'Content-Type': 'application/json'
  }
})

// ─── Request Interceptor — attach token automatically ────────────────────────
api.interceptors.request.use(
  (config) => {
    const token =
      localStorage.getItem('ls_token') ||
      sessionStorage.getItem('ls_token')
    if (token) {
      config.headers.Authorization = `Bearer ${token}`
    }
    return config
  },
  (error) => Promise.reject(error)
)

// ─── Response Interceptor — handle global errors ─────────────────────────────
api.interceptors.response.use(
  (response) => response,
  (error) => {
    // Token expired or invalid
    if (error.response?.status === 401) {
      localStorage.removeItem('ls_token')
      sessionStorage.removeItem('ls_token')
      window.location.href = '/login'
    }
    // Server down
    if (!error.response) {
      console.error('Network error — server may be down')
    }
    return Promise.reject(error)
  }
)

// ─── AUTH ─────────────────────────────────────────────────────────────────────
export const authAPI = {
  login: (username, password) =>
    api.post('/auth/login', { username, password }),

  profile: () =>
    api.get('/auth/profile'),

  logout: () =>
    api.post('/auth/logout')
}

// ─── GAME ─────────────────────────────────────────────────────────────────────
export const gameAPI = {
  spin: () =>
    api.post('/game/spin'),

  coinStatus: () =>
    api.get('/game/coin-status'),

  claimCoin: () =>
    api.post('/game/claim-coin'),

  getNotifications: () =>
    api.get('/game/notifications'),

  markNotificationRead: (id) =>
    api.post(`/game/notifications/${id}/read`)
}

// ─── ADMIN ────────────────────────────────────────────────────────────────────
export const adminAPI = {
  getStats: () =>
    api.get('/admin/stats'),

  getMetrics: (range = '7d') =>
    api.get(`/admin/metrics?range=${range}`),

  getUsers: () =>
    api.get('/admin/users'),

  createUser: (username, password) =>
    api.post('/admin/users/create', { username, password }),

  adjustPoints: (userId, amount, type) =>
    api.post(`/admin/users/${userId}/points`, { amount, type }),

  resetPassword: (userId, password) =>
    api.post(`/admin/users/${userId}/reset-password`, { password }),

  launchBonus: (type, percentage, validHours, message) =>
    api.post('/admin/bonus/launch', { type, percentage, validHours, message }),

  makeItRain: (amount) =>
    api.post('/admin/rain', { amount }),

  getActivities: () =>
    api.get('/admin/activities')
}

// ─── REFERRAL ─────────────────────────────────────────────────────────────────
export const referralAPI = {
  getStats: () =>
    api.get('/referral/stats'),

  applyCode: (code) =>
    api.post('/referral/apply', { code })
}

// ─── PUSH ─────────────────────────────────────────────────────────────────────
export const pushAPI = {
  subscribe: (subscription) =>
    api.post('/push/subscribe', { subscription }),

  unsubscribe: () =>
    api.post('/push/unsubscribe')
}

export default api