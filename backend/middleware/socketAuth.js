const jwt  = require('jsonwebtoken')
const User = require('../models/User')
const { JWT_SECRET } = require('../config/env')

/**
 * Socket.io authentication middleware.
 *
 * Previously `socket.on('join', userId => socket.join(userId))` accepted ANY
 * userId from the client, so anyone could subscribe to another user's room and
 * receive their targeted notifications/bonus events. The client must now present
 * a valid JWT at handshake; the room name is derived from the VERIFIED token,
 * never from client-supplied input.
 */
const socketAuth = async (socket, next) => {
  try {
    const token =
      socket.handshake.auth?.token ||
      socket.handshake.headers?.authorization?.replace(/^Bearer\s+/i, '') ||
      socket.handshake.query?.token

    if (!token) {
      return next(new Error('Authentication error: no token provided'))
    }

    const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] })

    const user = await User.findById(decoded.id).select('-password')
    if (!user) {
      return next(new Error('Authentication error: user not found'))
    }

    // Attach the verified identity to the socket.
    socket.user = {
      _id:      user._id,
      username: user.username,
      isAdmin:  user.isAdmin
    }

    next()
  } catch (err) {
    next(new Error('Authentication error: invalid or expired token'))
  }
}

module.exports = { socketAuth }
