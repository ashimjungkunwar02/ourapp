import axios from 'axios'

const TOKEN_KEY = 'ls_token'

// ─── Base URL ───────────────────────────────────────────────────────────────
// Set VITE_API_URL in frontend/.env. It must include the `/api` prefix.
//
// The .env in this repo previously held `http://localhost:5000` with no prefix,
// so every call resolved to e.g. `http://localhost:5000/auth/login` and 404'd.
// Normalise here and warn loudly rather than failing silently at request time.
const rawBaseURL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api'

const resolveBaseURL = (value) => {
  const trimmed = value.replace(/\/+$/, '')
  if (!trimmed.endsWith('/api')) {
    console.warn(
      `[api] VITE_API_URL ("${value}") is missing the /api prefix — appending it. ` +
      `Set VITE_API_URL="${trimmed}/api" in frontend/.env to silence this.`
    )
    return `${trimmed}/api`
  }
  return trimmed
}

const api = axios.create({
  baseURL: resolveBaseURL(rawBaseURL),
  timeout: 15000,
  headers: { 'Content-Type': 'application/json' }
})

// ─── Token helpers ──────────────────────────────────────────────────────────
// Single place that knows where the token lives, so "remember me" (localStorage)
// and session logins (sessionStorage) can't drift apart.
export const getToken = () =>
  localStorage.getItem(TOKEN_KEY) || sessionStorage.getItem(TOKEN_KEY) || null

export const setToken = (token, remember = false) => {
  clearToken()
  if (remember) localStorage.setItem(TOKEN_KEY, token)
  else          sessionStorage.setItem(TOKEN_KEY, token)
}

export const clearToken = () => {
  localStorage.removeItem(TOKEN_KEY)
  sessionStorage.removeItem(TOKEN_KEY)
}

// ─── Request Interceptor — attach token automatically ────────────────────────
// This is the ONLY place the Authorization header is set. Nothing in the app
// should touch axios.defaults.headers any more.
api.interceptors.request.use(
  (config) => {
    const token = getToken()
    if (token) config.headers.Authorization = `Bearer ${token}`
    return config
  },
  (error) => Promise.reject(error)
)

// ─── Response Interceptor — handle global errors ─────────────────────────────
api.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error.response?.status
    const url    = error.config?.url || ''

    if (status === 401) {
      // A 401 from the login endpoint means "wrong credentials" — the normal
      // error the login form displays. Redirecting there would reload the page
      // mid-submit and discard the error message.
      const isLoginAttempt = url.includes('/auth/login')

      if (!isLoginAttempt) {
        // Token expired or revoked: clear it and send the user to /login.
        clearToken()
        if (!window.location.pathname.startsWith('/login')) {
          // Preserve where they were so they can be sent back after login.
          const next = encodeURIComponent(
            window.location.pathname + window.location.search
          )
          window.location.href = `/login?next=${next}`
        }
      }
    }

    if (!error.response) {
      console.error('[api] Network error — server may be down')
    }

    return Promise.reject(error)
  }
)

// ─── AUTH ────────────────────────────────────────────────────────────────────
export const authAPI = {
  login:   (username, password) => api.post('/auth/login', { username, password }),
  profile: ()                   => api.get('/auth/profile'),
  logout:  ()                   => api.post('/auth/logout')
}

// ─── GAME ────────────────────────────────────────────────────────────────────
export const gameAPI = {
  spin:          ()      => api.post('/game/spin'),
  coinStatus:    ()      => api.get('/game/coin-status'),
  claimCoin:     ()      => api.post('/game/claim-coin'),
  getNotifications: ()   => api.get('/game/notifications'),
  markNotificationRead: (id) => api.post(`/game/notifications/${id}/read`)
}

// ─── ADMIN ───────────────────────────────────────────────────────────────────
export const adminAPI = {
  getStats:    () => api.get('/admin/stats'),
  getMetrics:  (range = '7d') => api.get('/admin/metrics', { params: { range } }),
  getUsers:    () => api.get('/admin/users'),
  getActivities: (limit) => api.get('/admin/activities', { params: { limit } }),

  createUser:    (username, password) =>
    api.post('/admin/users/create', { username, password }),

  adjustPoints:  (userId, amount, type) =>
    api.post(`/admin/users/${userId}/points`, { amount, type }),

  resetPassword: (userId, password) =>
    api.post(`/admin/users/${userId}/reset-password`, { password }),

  launchBonus:   ({ type, percentage, validHours, message }) =>
    api.post('/admin/bonus/launch', { type, percentage, validHours, message }),

  makeItRain:    (amount) => api.post('/admin/rain', { amount })
}

// ─── REFERRAL ────────────────────────────────────────────────────────────────
export const referralAPI = {
  getStats:  ()     => api.get('/referral/stats'),
  applyCode: (code) => api.post('/referral/apply', { code })
}

// ─── PUSH ────────────────────────────────────────────────────────────────────
export const pushAPI = {
  status:       ()             => api.get('/push/status'),
  vapidKey:     ()             => api.get('/push/vapid-public-key'),
  subscribe:    (subscription) => api.post('/push/subscribe', { subscription }),
  unsubscribe:  ()             => api.post('/push/unsubscribe')
}

export default api
