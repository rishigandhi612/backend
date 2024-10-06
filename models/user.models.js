const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const userSchema = new mongoose.Schema({
  emailid: {
    type: String,
    required: true,
    unique: true // Ensures the email is unique
  },
  password: {
    type: String,
    required: true
  }
}, 
{
  timestamps: true
});

// Pre-save hook to hash the password before saving
userSchema.pre('save', async function (next) {
  // Only hash the password if it's new or has been modified
  if (!this.isModified('password')) return next();
  
  try {
    // Generate salt and hash password
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (err) {
    next(err);
  }
});

// Method to compare passwords
userSchema.methods.verifyPassword = async function (password) {
  return bcrypt.compare(password, this.password);
};

module.exports = mongoose.model("User", userSchema);
