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

  // ── 404 ───────────────────────────────────────────────────
  {
    path: '*',
    element: <NotFoundPage />
  }
])

export default function AppRouter() {
  return <RouterProvider router={router} />
}