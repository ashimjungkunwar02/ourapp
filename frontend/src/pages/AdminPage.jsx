import { useEffect }       from 'react'
import { useNavigate }     from 'react-router-dom'
import { useAuth }         from '../context/AuthContext'
import AdminDashboard      from '../components/AdminPanel/AdminDashboard'

export default function AdminPage() {
  const { user, loading } = useAuth()
  const navigate          = useNavigate()

  useEffect(() => {
    if (!loading && (!user || !user.isAdmin)) {
      navigate('/login', { replace: true })
    }
  }, [user, loading])

  if (loading) return (
    <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-green-500/30 border-t-green-500
                      rounded-full animate-spin" />
    </div>
  )

  if (!user?.isAdmin) return null

  return <AdminDashboard />
}