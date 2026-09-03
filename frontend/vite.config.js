/* global process */
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
//
// There is NO dev proxy any more. The frontend talks directly to Supabase over
// HTTPS from the browser, so there is no local backend to forward to and no
// CORS to work around (Supabase sends permissive CORS headers for the anon key).
//
// The old `server.proxy` block for /api and /socket.io is gone on purpose:
// keeping it would silently swallow requests to a backend that no longer runs.
export default defineConfig({
  plugins: [react()],
  server: {
    // Bind to all interfaces so the app is reachable through a proxy/preview
    // host, not just from localhost inside the container.
    host: '0.0.0.0',
    port: Number(process.env.PORT) || 5173,
    // The preview host is not known ahead of time, so don't reject unknown
    // Host headers.
    allowedHosts: true
  },
  preview: {
    host: '0.0.0.0',
    port: Number(process.env.PORT) || 4173,
    allowedHosts: true
  },
  build: {
    // framer-motion + the Supabase client are large; keep the warning threshold
    // honest rather than silencing it.
    chunkSizeWarningLimit: 700,
    // Cloudflare Pages serves immutable, content-hashed assets, so drop the
    // sourcemap cost from the public bundle. Flip to true when debugging prod.
    sourcemap: false
  }
})
