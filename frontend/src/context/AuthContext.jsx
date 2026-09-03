import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { authAPI } from '../services/api'
import { supabase, isSupabaseConfigured } from '../services/supabase'
import { captureReferralCode, clearPendingReferralCode } from '../utils/referralCapture'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user,    setUser]    = useState(null)
  // Start "loading" only when there is a configured client whose session we
  // still have to read; otherwise the app would hang on a spinner forever.
  const [loading, setLoading] = useState(() => isSupabaseConfigured)

  const loadProfile = useCallback(async () => {
    try {
      const res = await authAPI.profile()
      setUser(res.data)
      return res.data
    } catch {
      setUser(null)
      return null
    } finally {
      setLoading(false)
    }
  }, [])

  // Capture a referral code before anything else, including on the login page.
  useEffect(() => {
    captureReferralCode()
  }, [])

  useEffect(() => {
    // `loading` is initialised from isSupabaseConfigured, so when there is no
    // client it is ALREADY false. Returning without touching state avoids a
    // synchronous setState in the effect body (cascading render).
    if (!supabase) return

    let cancelled = false

    // Read the persisted session once on boot. Do NOT call getSession() from
    // inside onAuthStateChange — that is a documented Supabase deadlock.
    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return
      if (data.session) loadProfile()
      else              setLoading(false)
    }).catch(() => { if (!cancelled) setLoading(false) })

    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (cancelled) return

      if (event === 'SIGNED_OUT') {
        setUser(null)
        setLoading(false)
        return
      }
      if (session?.user) {
        // Re-read the profile so coins/streak/isAdmin stay current after a
        // token refresh or a sign-in from another tab.
        loadProfile()
      } else {
        setUser(null)
        setLoading(false)
      }
    })

    return () => {
      cancelled = true
      sub.subscription.unsubscribe()
    }
  }, [loadProfile])

  const logout = useCallback(async () => {
    clearPendingReferralCode()
    setUser(null)
    try {
      await authAPI.logout()
    } catch {
      // Even if the server call fails, the local session is cleared below by
      // Supabase's SIGNED_OUT event; don't strand the user.
    }
  }, [])

  /**
   * @returns the profile object so callers can branch on isAdmin.
   * @throws ApiError with `.response.data.message` on failure.
   */
  const login = useCallback(async (username, password, remember = false) => {
    const res  = await authAPI.login(username, password, remember)
    const user = res.data.user
    setUser(user)
    return user
  }, [])

  const fetchProfile = useCallback(() => loadProfile(), [loadProfile])

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        login,
        logout,
        fetchProfile,
        // Lets the UI show a clear setup message instead of a login form that
        // can never succeed when the env vars are missing.
        configured: isSupabaseConfigured
      }}
    >
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
