const User = require("../models/user.models");
const bcrypt = require("bcryptjs");
const mongoose = require("mongoose");

// Utility function to validate ObjectId
const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(id);

// Register a new user
const registerUser = async (req, res) => {
  try {
    const { emailid, password } = req.body;
 
    // Check if the user already exists
    let user = await User.findOne({ emailid });
    if (user) {
      return res.json({
        success: false,
        message: "User already exists",
      });
    }

    // Hash the password before saving
    const hashedPassword = await bcrypt.hash(password, 10);
   
    // Test the hash immediately after creation
    const immediateTest = await bcrypt.compare(password, hashedPassword);
    // Create a new user
    user = new User({ emailid, password: hashedPassword });
    await user.save();
    
    res.json({
      success: true,
      message: "User registered successfully",
      data: user,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// Get all users
const getAllUsers = async (req, res) => {
  try {
    const users = await User.find();
    res.json({
      success: true,
      data: users, // Returning the list of all users as the data
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// Get a user by ID
const getUserById = async (req, res) => {
  try {
    const userId = req.params.id;

    // Validate ObjectId
    if (!isValidObjectId(userId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid user ID",
      });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    res.json({
      success: true,
      data: user, // Returning the user object as the data
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// Update a user by ID (with password hashing)
const updateUserById = async (req, res) => {
  try {
    let { emailid, password } = req.body;
    const userId = req.params.id;

    // Validate ObjectId
    if (!isValidObjectId(userId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid user ID",
      });
    }

    // Hash the password if it's provided - FIXED: Use single-step method
    if (password) {
      password = await bcrypt.hash(password, 10);
    }

    const user = await User.findByIdAndUpdate(
      userId,
      { emailid, password },
      { new: true } // Return the updated document
    );

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    res.json({
      success: true,
      message: "User updated successfully",
      data: user, // Returning the updated user object as the data
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// Delete a user by ID
const deleteUserById = async (req, res) => {
  try {
    const userId = req.params.id;

    // Validate ObjectId
    if (!isValidObjectId(userId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid user ID",
      });
    }

    const user = await User.findByIdAndDelete(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    res.json({
      success: true,
      message: "User deleted successfully", // Message as part of data
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

module.exports = {
  registerUser,
  getAllUsers,
  getUserById,
  updateUserById,
  deleteUserById,
};