const User = require("../models/user.models");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");


// User Login
const loginUser = async (req, res) => {
    const { emailid, password } = req.body;
  
    try {
      const user = await User.findOne({ emailid });
      if (!user) {
        return res.status(401).json({ message: "Invalid email" });
      }
  
      const isMatch = await bcrypt.compare(password, user.password);
      if (!isMatch) {
        return res.status(401).json({ message: "Invalid password." });
      }
  
      // Generate a JWT token
      const token = jwt.sign(
        { id: user._id, emailid: user.emailid },
        process.env.JWT_SECRET
      );
  
      res.status(200).json({ token });
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Server error." });
    }
  };

  module.exports = {
    loginUser
};
  