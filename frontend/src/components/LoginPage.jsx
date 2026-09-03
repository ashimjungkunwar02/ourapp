import { useState }                from 'react'
import { motion }                  from 'framer-motion'
import { Eye, EyeOff, LogIn }      from 'lucide-react'
import { useAuth }                 from '../context/AuthContext'

export default function LoginPage({ onLogin }) {
  const { login }               = useAuth()
  const [form, setForm]         = useState({
    username: '', password: '', remember: false
  })
  const [showPass, setShowPass] = useState(false)
  const [error,    setError]    = useState('')
  const [loading,  setLoading]  = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const user = await login(form.username, form.password, form.remember)
      onLogin?.(user)
    } catch (err) {
      setError(err.response?.data?.message || 'Invalid credentials')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a] flex items-center
                    justify-center p-4">
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-0 left-1/4 w-96 h-96
                        bg-green-500/5 rounded-full blur-3xl" />
        <div className="absolute bottom-0 right-1/4 w-96 h-96
                        bg-green-500/5 rounded-full blur-3xl" />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md relative z-10"
      >
        <div className="bg-[#111] border border-gray-800 rounded-2xl
                        p-8 shadow-2xl">
          <div className="text-center mb-8">
            <div className="flex items-center justify-center gap-2 mb-2">
              <span className="text-white font-black text-3xl">LISA</span>
              <span className="text-green-400 font-black text-3xl">
                SWEEPS
              </span>
            </div>
            <p className="text-gray-500 text-sm tracking-widest uppercase">
              A World of Winners
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="text-gray-400 text-sm mb-2 block">
                Username
              </label>
              <input
                type="text"
                value={form.username}
                onChange={e => setForm({ ...form, username: e.target.value })}
                placeholder="Enter username"
                required
                className="w-full bg-[#1a1a1a] border border-gray-700
                           rounded-xl px-4 py-3 text-white
                           placeholder-gray-600 outline-none
                           focus:border-green-500 transition-all"
              />
            </div>

            <div>
              <label className="text-gray-400 text-sm mb-2 block">
                Password
              </label>
              <div className="relative">
                <input
                  type={showPass ? 'text' : 'password'}
                  value={form.password}
                  onChange={e =>
                    setForm({ ...form, password: e.target.value })
                  }
                  placeholder="Enter password"
                  required
                  className="w-full bg-[#1a1a1a] border border-gray-700
                             rounded-xl px-4 py-3 text-white
                             placeholder-gray-600 outline-none pr-12
                             focus:border-green-500 transition-all"
                />
                <button
                  type="button"
                  onClick={() => setShowPass(!showPass)}
                  className="absolute right-4 top-1/2 -translate-y-1/2
                             text-gray-500 hover:text-gray-300"
                >
                  {showPass ? <EyeOff size={18}/> : <Eye size={18}/>}
                </button>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setForm({ ...form, remember: !form.remember })}
                className={`w-5 h-5 rounded border-2 flex items-center
                            justify-center transition-all
                            ${form.remember
                              ? 'bg-green-500 border-green-500'
                              : 'border-gray-600'}`}
              >
                {form.remember && (
                  <svg className="w-3 h-3 text-black" fill="none"
                       viewBox="0 0 24 24" stroke="currentColor"
                       strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round"
                          d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </button>
              <span className="text-gray-400 text-sm">Remember me</span>
            </div>

            {error && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="bg-red-500/10 border border-red-500/30
                           rounded-xl px-4 py-3 text-red-400
                           text-sm text-center"
              >
                {error}
              </motion.div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-green-500 hover:bg-green-400
                         disabled:bg-green-800 text-black font-bold
                         py-3.5 rounded-xl flex items-center
                         justify-center gap-2 transition-all
                         shadow-lg shadow-green-500/20 active:scale-95"
            >
              {loading ? (
                <div className="w-5 h-5 border-2 border-black/30
                                border-t-black rounded-full animate-spin" />
              ) : (
                <><LogIn size={18} /> Login</>
              )}
            </button>
          </form>
        </div>
      </motion.div>
    </div>
  )
}