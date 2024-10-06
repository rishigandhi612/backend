const express = require('express');
const router = express.Router();
const User = require('../models/user.models');

// Registration route
router.post('/register', async (req, res) => {
  try {
    const { emailid, password } = req.body;

    // Check if the user already exists
    let user = await User.findOne({ emailid });
    if (user) {
      return res.status(400).json({ message: 'User already exists' });
    }

    // Create a new user
    user = new User({
      emailid,
      password // This will be hashed automatically by the pre-save hook
    });

    // Save the user to the database
    await user.save();
    res.status(201).json({ message: 'User registered successfully' });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});


module.exports = router;
