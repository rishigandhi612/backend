const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const User = require('../models/user.models');

const loginUser = async (req, res) => {
   
  const { emailid, password } = req.body;
  
  try {
    const user = await User.findOne({ emailid });
    if (!user) {
      return res.status(400).json({ message: 'Invalid email or password' });
    }
      // Test with a fresh hash to verify bcrypt is working
    const testHash = await bcrypt.hash(password, 10);
    const testCompare = await bcrypt.compare(password, testHash);

    // Now test the actual comparison
    const isMatch = await bcrypt.compare(password, user.password);
       
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
