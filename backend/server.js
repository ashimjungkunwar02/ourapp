// Load and validate environment FIRST. This module runs dotenv and exits the
// process if JWT_SECRET or MONGODB_URI is missing — there are no fallback
// secrets anywhere in this codebase.
const {
  PORT,
  CLIENT_URL,
  MONGODB_URI,
  isProd
} = require('./config/env')

const express    = require('express')
const mongoose   = require('mongoose')
const cors       = require('cors')
const http       = require('http')
const helmet     = require('helmet')
const { Server } = require('socket.io')

const { socketAuth } = require('./middleware/socketAuth')
const {
  loginLimiter,
  authLimiter,
  gameLimiter,
  apiLimiter
} = require('./middleware/rateLimiters')

// ── Route imports ─────────────────────────────────────────
const authRoutes     = require('./routes/auth')
const gameRoutes     = require('./routes/game')
const adminRoutes    = require('./routes/admin')
const referralRoutes = require('./routes/referral')
// push.js exports { router, sendPushToUser, sendPushToAll }, not a bare router.
const { router: pushRoutes } = require('./routes/push')

// ── App setup ─────────────────────────────────────────────
const app    = express()
const server = http.createServer(app)
const io     = new Server(server, {
  cors: {
    origin:      CLIENT_URL,
    credentials: true
  }
})

// Behind a reverse proxy (or the Arena preview host) the real client IP arrives
// in X-Forwarded-For. Without this every rate limiter sees one shared IP.
if (isProd) {
  app.set('trust proxy', 1)
}

// ── Middleware ────────────────────────────────────────────
// Security headers. crossOriginResourcePolicy is relaxed because this API is
// consumed from a different origin than the one serving it.
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' }
}))

app.use(cors({
  origin:      CLIENT_URL,
  credentials: true
}))
app.use(express.json({ limit: '100kb' }))

// ── Make io available in all routes ──────────────────────
app.use((req, res, next) => {
  req.io = io
  next()
})

// ── Routes ────────────────────────────────────────────────
// ORDER MATTERS: a limiter must be mounted BEFORE the router it protects,
// otherwise the router responds first and the limiter never executes.

// Catch-all budget for every /api request.
app.use('/api', apiLimiter)

// Brute-force protection specifically on the credential-checking endpoint.
//
// Split across three app.use() calls on purpose. Each limiter overwrites the
// RateLimit response header as the request passes through it, so mounting
// loginLimiter LAST (but still before the router) means /api/auth/login
// advertises its own stricter budget (limit=50) instead of inheriting the
// looser one from authLimiter. Enforcement was already correct either way —
// this just stops the header from misleading clients that do backoff.
app.use('/api/auth',       authLimiter)
app.use('/api/auth/login', loginLimiter)
app.use('/api/auth',       authRoutes)

app.use('/api/game',     gameLimiter, gameRoutes)
app.use('/api/referral', gameLimiter, referralRoutes)

// Admin mutations that move coins for the whole user base get their own budget.
// Applied per-route inside routes/admin.js so read endpoints stay unrestricted.
app.use('/api/admin', adminRoutes)

app.use('/api/push',  pushRoutes)

// ── Test route ────────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({ message: 'Lisa Sweeps API is running!' })
})

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    db: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    uptime: process.uptime()
  })
})

// ── Socket.io ─────────────────────────────────────────────
const onlineUsers = new Map() // socket.id -> userId

// Authenticate EVERY socket before it can send or receive anything.
io.use(socketAuth)

io.on('connection', (socket) => {
  // socket.user is set by socketAuth from the VERIFIED JWT — never trust a
  // client-supplied userId.
  const userId = String(socket.user._id)

  console.log(`User connected: ${socket.user.username} (${socket.id})`)

  // Join the room derived from the token, immediately on connect.
  socket.join(userId)
  onlineUsers.set(socket.id, userId)

  socket.emit('authenticated', {
    userId,
    username: socket.user.username
  })

  // Kept for client compatibility, but deliberately IGNORES any client-supplied
  // userId — that parameter was the whole vulnerability. Joining is idempotent,
  // so a client that emits 'join' on connect simply re-joins its verified room.
  socket.on('join', (ignoredClientId) => {
    if (ignoredClientId && String(ignoredClientId) !== userId) {
      console.warn(
        `Socket ${socket.id} tried to join room "${ignoredClientId}" ` +
        `but is authenticated as "${userId}" — using the verified id.`
      )
    }
    socket.join(userId)
  })

  // A user may connect from several tabs/devices. Each socket joins its own
  // verified room; there is no client-controlled room name.
  socket.on('disconnect', () => {
    onlineUsers.delete(socket.id)
    console.log(`User disconnected: ${socket.user.username} (${socket.id})`)
  })
})

// ── Online count endpoint ─────────────────────────────────
app.get('/api/online-count', (req, res) => {
  // Count distinct users, not sockets, so multi-tab users aren't double-counted.
  res.json({ count: new Set(onlineUsers.values()).size })
})

// ── 404 + error handling ──────────────────────────────────
app.use('/api', (req, res) => {
  res.status(404).json({ message: 'Endpoint not found' })
})

app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  console.error('Unhandled error:', err.message)
  res.status(500).json({ message: 'Internal server error' })
})

// ── Database + Server start ───────────────────────────────
mongoose
  .connect(MONGODB_URI)
  .then(() => {
    console.log('\u2705 MongoDB connected successfully')
    server.listen(PORT, '0.0.0.0', () => {
      console.log(`\uD83D\uDE80 Server running on port ${PORT}`)
      console.log(`\uD83C\uDF10 API available at http://localhost:${PORT}`)
    })
  })
  .catch((err) => {
    console.error('\u274C MongoDB connection failed:', err.message)
    process.exit(1)
  })

module.exports = { app, server, io }
