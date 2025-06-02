const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const User = require('../models/user.models');

const loginUser = async (req, res) => {
  console.log('Login request received:', req.body);
  
  const { emailid, password } = req.body;
  
  // Debug the incoming password
  console.log('Incoming password details:');
  console.log('- Password:', password);
  console.log('- Password length:', password.length);
  console.log('- Password type:', typeof password);
  console.log('- Password bytes:', Array.from(Buffer.from(password, 'utf8')));
  
  try {
    const user = await User.findOne({ emailid });
    if (!user) {
      return res.status(400).json({ message: 'Invalid email or password' });
    }
    
    console.log('User found:', user);
    console.log('Stored hash:', user.password);
    
    // Test with a fresh hash to verify bcrypt is working
    const testHash = await bcrypt.hash(password, 10);
    const testCompare = await bcrypt.compare(password, testHash);
    console.log('Test hash generation and compare:', testCompare); // Should be true
    
    // Now test the actual comparison
    const isMatch = await bcrypt.compare(password, user.password);
    console.log('Password match status:', isMatch);
    
    // Additional debug - try manually with the exact string
    const manualTest = await bcrypt.compare('Rishi@12345', user.password);
    console.log('Manual test with hardcoded password:', manualTest);
    
    if (!isMatch) {
      return res.status(400).json({ message: 'Invalid email or password' });
    }

    // Generate JWT token
    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '1h' });
    const refreshToken = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '7d' });

    res.json({ user, token , refreshToken });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
};

module.exports = { loginUser };
