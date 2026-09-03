import { Navigate, Outlet } from 'react-router-dom'
import { useAuth }          from '../context/AuthContext'

export default function ProtectedRoute() {
  const { user, loading } = useAuth()

  // Show spinner while checking auth
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

  // Admin trying to access player routes → go to admin
  if (user.isAdmin) {
    return <Navigate to="/admin" replace />
  }

  // All good — render the child route
  return <Outlet />
}