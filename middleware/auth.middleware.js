require('dotenv').config(); // Load environment variables from .env file
const jwt = require('jsonwebtoken');

// Middleware to verify JWT
const CheckAuth = (req, res, next) => {
  console.log('Middleware Called');

  // Extract token from the Authorization header
  const token = req.header('Authorization')?.split(' ')[1];

  if (!token) {
    return res.status(401).json({ message: 'Access denied. No token provided.' });
  }

  try {
    // Verify the token using the secret from environment variables
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded; // Attach user data to the request object
    next(); // Proceed to the next middleware or route handler
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ message: 'Token has expired.' });
    } else if (err.name === 'JsonWebTokenError') {
      return res.status(400).json({ message: 'Invalid token.' });
    }
    return res.status(400).json({ message: 'Authentication error.' });
  }
};

module.exports = CheckAuth;
