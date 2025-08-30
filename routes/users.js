const express = require('express');
const User = require('../models/User');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// Search users
router.get('/search', authenticateToken, async (req, res) => {
  try {
    const { q } = req.query;
    const currentUserId = req.user._id;

    if (!q || q.trim().length < 2) {
      return res.status(400).json({ 
        message: 'Search query must be at least 2 characters long' 
      });
    }

    const searchQuery = q.trim();
    
    // Search for users by username (case-insensitive, partial match)
    const users = await User.find({
      username: { 
        $regex: searchQuery, 
        $options: 'i' 
      },
      _id: { $ne: currentUserId } // Exclude current user
    })
    .select('username online lastSeen')
    .limit(20)
    .sort({ online: -1, username: 1 }); // Online users first, then alphabetical

    res.json({
      users: users.map(user => ({
        _id: user._id,
        username: user.username,
        online: user.online,
        lastSeen: user.lastSeen
      }))
    });
  } catch (error) {
    console.error('User search error:', error);
    res.status(500).json({ message: 'Server error during search' });
  }
});

// Get user profile
router.get('/profile', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('-password');
    res.json({ user });
  } catch (error) {
    console.error('Profile fetch error:', error);
    res.status(500).json({ message: 'Server error fetching profile' });
  }
});

module.exports = router;