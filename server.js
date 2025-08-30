require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const path = require('path');
const connectDB = require('./database/connection');
const authRoutes = require('./routes/auth');
const { authenticateSocket } = require('./middleware/auth');

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
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Routes
app.use('/api/auth', authRoutes);

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

  // Initiate call
  socket.on('call-user', async (data) => {
    try {
      const { callerId, callerName, calleeId } = data;
      const User = require('./models/User');
      const CallHistory = require('./models/CallHistory');
      
      const callee = await User.findById(calleeId);
      if (!callee || !callee.online || !callee.socketId) {
        socket.emit('call-failed', { message: 'User is offline' });
        return;
      }
      
      // Save call history
      await CallHistory.findOneAndUpdate(
        {
          $or: [
            { user1: callerId, user2: calleeId },
            { user1: calleeId, user2: callerId }
          ]
        },
        {
          user1: callerId,
          user2: calleeId,
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
      
      socket.emit('call-initiated', { calleeId, calleeName: callee.username });
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
  
  // Handle call end with duration tracking
  socket.on('call-ended-with-duration', async (data) => {
    try {
      const { callerId, calleeId, duration } = data;
      
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
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`AudioCallPro server running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
});