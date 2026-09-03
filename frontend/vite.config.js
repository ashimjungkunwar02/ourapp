/* global process */
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The API port. Override with BACKEND_PORT if the backend runs elsewhere.
const BACKEND = `http://127.0.0.1:${process.env.BACKEND_PORT || 5000}`

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Bind to all interfaces so the app is reachable through a proxy/preview
    // host, not just from localhost inside the container.
    host: '0.0.0.0',
    port: Number(process.env.PORT) || 5173,
    // The preview host is not known ahead of time, so don't reject unknown
    // Host headers.
    allowedHosts: true,
    // Proxy API + websocket traffic to the backend.
    //
    // This is why the frontend can use the RELATIVE base URL `/api`: the browser
    // only ever talks to its own origin, and Vite forwards to the backend. That
    // removes CORS from local development entirely and means the same relative
    // URL works in production behind any reverse proxy (nginx, Caddy, a PaaS
    // router) that sends /api to the Node process.
    proxy: {
      '/api': {
        target: BACKEND,
        changeOrigin: true
      },
      '/socket.io': {
        target: BACKEND,
        changeOrigin: true,
        ws: true
      }
    }
  },
  build: {
    // socket.io-client and framer-motion are large; keep the warning threshold
    // honest rather than silencing it.
    chunkSizeWarningLimit: 700
  }
})
