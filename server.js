require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const path = require('path');
const connectDB = require('./database/connection');
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const securityMiddleware = require('./middleware/security');
const compression = require('compression');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Connect to MongoDB
connectDB();

// Middleware
securityMiddleware(app);
app.use(cors());
app.use(compression());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// Catch-all handler for SPA routing - FIXED
app.get('/*', (req, res) => {
  if (req.path.startsWith('/api/')) {
    res.status(404).json({ message: 'API endpoint not found' });
  } else {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  }
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ 
    message: process.env.NODE_ENV === 'production' 
      ? 'Internal server error' 
      : err.message 
  });
});

// WebRTC ICE servers configuration
const iceServers = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    {
      urls: 'turn:openrelay.metered.ca:443',
      username: process.env.TURN_USER || 'openrelayproject',
      credential: process.env.TURN_PASS || 'openrelayproject'
    }
  ]
};

// Socket.IO connection handling
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  // Register socket with user
  socket.on('register-socket', async (data) => {
    try {
      const { userId } = data;
      const User = require('./models/User');
      
      await User.findByIdAndUpdate(userId, {
        socketId: socket.id,
        online: true,
        lastSeen: new Date()
      });
      
      socket.userId = userId;
      console.log(`User ${userId} registered with socket ${socket.id}`);
      
      // Broadcast user online status
      socket.broadcast.emit('user-online', { userId, socketId: socket.id });
    } catch (error) {
      console.error('Error registering socket:', error);
    }
  });

  // Get call list (previous call users who are online)
  socket.on('get-call-list', async (data) => {
    try {
      const { userId } = data;
      const CallHistory = require('./models/CallHistory');
      const User = require('./models/User');
      
      // Get users who had calls with current user
      const callHistories = await CallHistory.find({
        $or: [{ user1: userId }, { user2: userId }]
      }).populate('user1 user2', 'username online socketId lastSeen')
        .sort({ lastCalled: -1 });
      
      const contacts = [];
      const userIds = new Set();
      
      callHistories.forEach(call => {
        const otherUser = call.user1._id.toString() === userId ? call.user2 : call.user1;
        if (!userIds.has(otherUser._id.toString())) {
          contacts.push({
            _id: otherUser._id,
            username: otherUser.username,
            online: otherUser.online,
            socketId: otherUser.socketId,
            lastCalled: call.lastCalled,
            lastSeen: otherUser.lastSeen
          });
          userIds.add(otherUser._id.toString());
        }
      });
      
      // Sort contacts: online users first, then by last called
      contacts.sort((a, b) => {
        if (a.online && !b.online) return -1;
        if (!a.online && b.online) return 1;
        return new Date(b.lastCalled) - new Date(a.lastCalled);
      });
      
      socket.emit('call-list', contacts);
    } catch (error) {
      console.error('Error getting call list:', error);
      socket.emit('call-list', []);
    }
  });

  // Search users
  socket.on('search-users', async (data) => {
    try {
      const { query } = data;
      const User = require('./models/User');
      
      if (!query || query.trim().length < 2) {
        socket.emit('search-results', { users: [] });
        return;
      }
      
      const users = await User.find({
        username: { 
          $regex: query.trim(), 
          $options: 'i' 
        },
        _id: { $ne: socket.userId } // Exclude current user
      })
      .select('username online lastSeen')
      .limit(20)
      .sort({ online: -1, username: 1 }); // Online users first, then alphabetical
      
      socket.emit('search-results', { 
        users: users.map(user => ({
          _id: user._id,
          username: user.username,
          online: user.online,
          lastSeen: user.lastSeen
        }))
      });
    } catch (error) {
      console.error('Error searching users:', error);
      socket.emit('search-results', { users: [] });
    }
  });

  // Initiate call - works with any user (from search or history)
  socket.on('call-user', async (data) => {
    try {
      const { callerId, callerName, calleeId, calleeUsername } = data;
      const User = require('./models/User');
      const CallHistory = require('./models/CallHistory');
      
      // Find callee by ID or username
      let callee;
      if (calleeId) {
        callee = await User.findById(calleeId);
      } else if (calleeUsername) {
        callee = await User.findOne({ username: calleeUsername.toLowerCase() });
      }
      
      if (!callee || !callee.online || !callee.socketId) {
        socket.emit('call-failed', { message: 'User is offline' });
        return;
      }
      
      // Save call history
      await CallHistory.findOneAndUpdate(
        {
          $or: [
            { user1: callerId, user2: callee._id },
            { user1: callee._id, user2: callerId }
          ]
        },
        {
          user1: callerId,
          user2: callee._id,
          lastCalled: new Date()
        },
        { upsert: true, new: true }
      );
      
      // Send call request to callee
      io.to(callee.socketId).emit('incoming-call', {
        callerId,
        callerName,
        callerSocketId: socket.id,
        iceServers
      });
      
      socket.emit('call-initiated', { 
        calleeId: callee._id, 
        calleeName: callee.username 
      });
    } catch (error) {
      console.error('Error initiating call:', error);
      socket.emit('call-failed', { message: 'Failed to initiate call' });
    }
  });

  // Accept call
  socket.on('accept-call', (data) => {
    const { callerSocketId, calleeId, calleeName } = data;
    io.to(callerSocketId).emit('call-accepted', {
      calleeId,
      calleeName,
      calleeSocketId: socket.id,
      iceServers
    });
  });

  // Decline call
  socket.on('decline-call', (data) => {
    const { callerSocketId } = data;
    io.to(callerSocketId).emit('call-declined');
  });

  // WebRTC signaling
  socket.on('offer', (data) => {
    socket.to(data.target).emit('offer', {
      offer: data.offer,
      sender: socket.id
    });
  });

  socket.on('answer', (data) => {
    socket.to(data.target).emit('answer', {
      answer: data.answer,
      sender: socket.id
    });
  });

  socket.on('ice-candidate', (data) => {
    socket.to(data.target).emit('ice-candidate', {
      candidate: data.candidate,
      sender: socket.id
    });
  });

  // End call
  socket.on('end-call', (data) => {
    if (data.target) {
      socket.to(data.target).emit('call-ended');
    }
  });

  // Handle call end with duration tracking
  socket.on('call-ended-with-duration', async (data) => {
    try {
      const { callerId, calleeId, duration } = data;
      const CallHistory = require('./models/CallHistory');
      
      await CallHistory.findOneAndUpdate(
        {
          $or: [
            { user1: callerId, user2: calleeId },
            { user1: calleeId, user2: callerId }
          ]
        },
        {
          duration: duration,
          status: 'completed',
          lastCalled: new Date()
        }
      );
      
      console.log(`Call ended between ${callerId} and ${calleeId}, duration: ${duration}s`);
    } catch (error) {
      console.error('Error updating call duration:', error);
    }
  });

  // Handle disconnect
  socket.on('disconnect', async () => {
    try {
      if (socket.userId) {
        const User = require('./models/User');
        await User.findByIdAndUpdate(socket.userId, {
          online: false,
          socketId: null,
          lastSeen: new Date()
        });
        
        // Broadcast user offline status
        socket.broadcast.emit('user-offline', { userId: socket.userId });
        console.log(`User ${socket.userId} disconnected`);
      }
    } catch (error) {
      console.error('Error handling disconnect:', error);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`AudioCallPro server running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`Health check available at: http://localhost:${PORT}/api/health`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  server.close(() => {
    console.log('Process terminated');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully');
  server.close(() => {
    console.log('Process terminated');
    process.exit(0);
  });
});
