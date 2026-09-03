import { useState } from 'react'
import { createBrowserRouter, RouterProvider } from 'react-router-dom'

// Layouts
import MainLayout    from '../layouts/MainLayout'

// Route Guards
import ProtectedRoute from './ProtectedRoute'
import AdminRoute     from './AdminRoute'

// Pages
import LoginPage    from '../pages/LoginPage'
import HomePage     from '../pages/HomePage'
import ReferralPage from '../pages/ReferralPage'
import ContactPage  from '../pages/ContactPage'
import AdminPage    from '../pages/AdminPage'
import NotFoundPage from '../pages/NotFoundPage'

// Branded intro. Previously rendered by App.jsx; kept alive here so the router
// migration didn't silently drop it and orphan the component.
import SplashScreen from '../components/SplashScreen'

// Setup guard: shown when VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are absent.
import SetupErrorPage from '../pages/SetupErrorPage'
import { isSupabaseConfigured } from '../services/supabase'

// SplashScreen owns its own 3s timer and calls onFinish when it elapses.
const SPLASH_KEY = 'ls_splash_seen'

const router = createBrowserRouter([
  // ── Public Routes ──────────────────────────────────────────
  {
    path: '/login',
    element: <LoginPage />
  },
  {
    path: '/contact',
    element: <ContactPage />
  },

  // ── Protected Player Routes ────────────────────────────────
  {
    element: <ProtectedRoute />,
    children: [
      {
        element: <MainLayout />,
        children: [
          {
            path: '/',
            element: <HomePage />
          },
          {
            path: '/referral',
            element: <ReferralPage />
          },
          {
            path: '/contact',
            element: <ContactPage />
          }
        ]
      }
    ]
  },

  // ── Admin Routes ───────────────────────────────────────────
  {
    element: <AdminRoute />,
    children: [
      {
        path: '/admin',
        element: <AdminPage />
      }
    ]
  },

  // ── 404 ────────────────────────────────────────────────────
  {
    path: '*',
    element: <NotFoundPage />
  }
])

export default function AppRouter() {
  // Show the intro once per browser session rather than on every full page
  // load. App.jsx re-ran its 3s splash on every mount, so a refresh or a
  // direct link to /referral always cost the user three seconds.
  const [showSplash, setShowSplash] = useState(() => {
    try {
      return sessionStorage.getItem(SPLASH_KEY) !== 'true'
    } catch {
      return false
    }
  })

  const finishSplash = () => {
    try { sessionStorage.setItem(SPLASH_KEY, 'true') } catch { /* private mode */ }
    setShowSplash(false)
  }

  // No Supabase credentials -> nothing in the app can work. Show the setup
  // guide instead of a login form that fails with an opaque 503.
  if (!isSupabaseConfigured) {
    return <SetupErrorPage />
  }

  return (
    <>
      {showSplash && <SplashScreen onFinish={finishSplash} />}
      <RouterProvider router={router} />
    </>
  )
}
