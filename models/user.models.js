const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const userSchema = new mongoose.Schema({
  emailid: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,  // Ensures the email is stored in lowercase
    match: [/^\S+@\S+\.\S+$/, 'Please use a valid email address.'],
    index: true // Adds an index for better performance
  },
  password: {
    type: String,
    required: true
  }
}, 
{
  timestamps: true
});

// REMOVED: Pre-save hook that was causing double hashing
// Since you're hashing in the controller, this was redundant

// Normalize email before saving
userSchema.pre('save', function (next) {
  if (this.isModified('emailid')) {
    this.emailid = this.emailid.toLowerCase();
  }
  next();
});

// Method to compare passwords
userSchema.methods.verifyPassword = async function (password) {
  return bcrypt.compare(password, this.password);
};

module.exports = mongoose.model("User", userSchema);