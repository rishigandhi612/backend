const express = require('express');
const router = express.Router();

const {
   
    loginUser // Import loginUser
  
  } = require('../controllers/login.controller');
  
  // Login route
router.post('/login', loginUser); // New login route

module.exports = router;
