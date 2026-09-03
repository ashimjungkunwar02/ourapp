import { createContext, useContext, useState, useEffect } from 'react'
import axios from 'axios'

// Set base URL
axios.defaults.baseURL = 'http://localhost:5000/api'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user,    setUser]    = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const token =
      localStorage.getItem('ls_token') ||
      sessionStorage.getItem('ls_token')

    if (token) {
      axios.defaults.headers.common['Authorization'] = `Bearer ${token}`
      fetchProfile()
    } else {
      setLoading(false)
    }
  }, [])

  const fetchProfile = async () => {
    try {
      const res = await axios.get('/auth/profile')
      setUser(res.data)
    } catch {
      logout()
    } finally {
      setLoading(false)
    }
  }

  const login = async (username, password, remember = false) => {
    const res = await axios.post('/auth/login', { username, password })
    const { token, user: u } = res.data
    setUser(u)
    axios.defaults.headers.common['Authorization'] = `Bearer ${token}`
    if (remember) {
      localStorage.setItem('ls_token', token)
    } else {
      sessionStorage.setItem('ls_token', token)
    }
    return u
  }

  const logout = () => {
    setUser(null)
    localStorage.removeItem('ls_token')
    sessionStorage.removeItem('ls_token')
    delete axios.defaults.headers.common['Authorization']
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