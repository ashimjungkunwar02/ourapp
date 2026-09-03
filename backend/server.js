const express    = require('express')
const mongoose   = require('mongoose')
const cors       = require('cors')
const http       = require('http')
const { Server } = require('socket.io')

require('dotenv').config()

// ── Route imports ─────────────────────────────────────────
const authRoutes     = require('./routes/auth')
const gameRoutes     = require('./routes/game')
const adminRoutes    = require('./routes/admin')
const referralRoutes = require('./routes/referral')

// ── App setup ─────────────────────────────────────────────
const app    = express()
const server = http.createServer(app)
const io     = new Server(server, {
  cors: {
    origin:      process.env.CLIENT_URL || 'http://localhost:5173',
    credentials: true
  }
})

// ── Middleware ────────────────────────────────────────────
app.use(cors({
  origin:      process.env.CLIENT_URL || 'http://localhost:5173',
  credentials: true
}))
app.use(express.json())

// ── Make io available in all routes ──────────────────────
app.use((req, res, next) => {
  req.io = io
  next()
})

// ── Routes ────────────────────────────────────────────────
app.use('/api/auth',     authRoutes)
app.use('/api/game',     gameRoutes)
app.use('/api/admin',    adminRoutes)
app.use('/api/referral', referralRoutes)

// ── Test route ────────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({ message: 'Lisa Sweeps API is running!' })
})

// ── Socket.io ─────────────────────────────────────────────
const onlineUsers = new Map()

io.on('connection', (socket) => {
  console.log('User connected:', socket.id)

  socket.on('join', (userId) => {
    socket.join(userId)
    onlineUsers.set(socket.id, userId)
    console.log('User joined room:', userId)
  })

  socket.on('disconnect', () => {
    onlineUsers.delete(socket.id)
    console.log('User disconnected:', socket.id)
  })
})

// ── Online count endpoint ─────────────────────────────────
app.get('/api/online-count', (req, res) => {
  res.json({ count: onlineUsers.size })
})

// ── Database + Server start ───────────────────────────────
const PORT        = process.env.PORT || 5000
const MONGODB_URI = process.env.MONGODB_URI

if (!MONGODB_URI) {
  console.error('❌ MONGODB_URI is missing from .env file!')
  process.exit(1)
}

mongoose
  .connect(MONGODB_URI)
  .then(() => {
    console.log('✅ MongoDB connected successfully')
    server.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`)
      console.log(`🌐 API available at http://localhost:${PORT}`)
    })
  })
  .catch((err) => {
    console.error('❌ MongoDB connection failed:', err.message)
    process.exit(1)
  })