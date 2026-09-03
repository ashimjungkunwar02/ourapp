import React    from 'react'
import ReactDOM from 'react-dom/client'
import { AuthProvider }    from './context/AuthContext'
import AppRouter           from './router'
import { registerServiceWorker } from './utils/swRegister'
import './index.css'

// ── PWA: register the service worker ────────────────────────────────────────
// public/sw.js existed but was never registered, so offline support, the
// install prompt and web push were all inert. Gated to production builds by
// default (see utils/swRegister.js) to avoid caching over Vite HMR in dev.
registerServiceWorker()

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AuthProvider>
      <AppRouter />
    </AuthProvider>
  </React.StrictMode>
)
