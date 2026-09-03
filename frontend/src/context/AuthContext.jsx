import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { authAPI, getToken, setToken, clearToken } from '../services/api'
import { captureReferralCode, clearPendingReferralCode } from '../utils/referralCapture'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user,    setUser]    = useState(null)
  // Seed from storage so the "no session" path doesn't need a synchronous
  // setLoading(false) inside the effect (which cascades an extra render).
  const [loading, setLoading] = useState(() => Boolean(getToken()))

  // Capture a referral code before anything else, including on the login page.
  useEffect(() => {
    captureReferralCode()
  }, [])

  const logout = useCallback(() => {
    setUser(null)
    clearToken()
    clearPendingReferralCode()
  }, [])

  const fetchProfile = useCallback(async () => {
    try {
      const res = await authAPI.profile()
      setUser(res.data)
      return res.data
    } catch {
      logout()
      return null
    }
  }, [logout])

  // Restore a persisted session on boot.
  useEffect(() => {
    const token = getToken()
    if (!token) return // `loading` was already initialised to false

    // No global axios header is set here any more — services/api.js attaches the
    // Authorization header per-request via its interceptor, so the token can
    // change (login/logout) without mutating shared axios state.
    let cancelled = false

    authAPI.profile()
      .then(res => { if (!cancelled) setUser(res.data) })
      .catch(() => { if (!cancelled) logout() })
      .finally(() => { if (!cancelled) setLoading(false) })

    return () => { cancelled = true }
  }, [logout])

  /**
   * @returns the user object on success, so callers can branch on isAdmin.
   * @throws the axios error on failure (the login form reads
   *         err.response.data.message).
   */
  const login = async (username, password, remember = false) => {
    const res = await authAPI.login(username, password)
    const { token, user: u } = res.data

    setToken(token, remember)
    setUser(u)

    // Refetch the full profile so we also have `referredBy`, which the login
    // response omits and the referral flow needs.
    try {
      const profile = await authAPI.profile()
      setUser(profile)
      return profile
    } catch {
      return u
    }
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, fetchProfile }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider')
  }
  return context
}

export default AuthContext
