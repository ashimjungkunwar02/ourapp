import { Navigate, Outlet } from 'react-router-dom'
import { useAuth }          from '../context/AuthContext'

export default function AdminRoute() {
  const { user, loading } = useAuth()

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-green-500/30 border-t-green-500
                        rounded-full animate-spin" />
      </div>
    )
  }

  // Not logged in → go to login
  if (!user) {
    return <Navigate to="/login" replace />
  }

  // Not admin → go to player home
  if (!user.isAdmin) {
    return <Navigate to="/" replace />
  }

  // Is admin — render admin routes
  return <Outlet />
}