const mongoose = require("mongoose");

const connectDB = async () => {
  try {
    const mongoURI = process.env.MONGODB_URI; // Get MongoDB URI from the environment variable
    if (!mongoURI) {
      throw new Error("MongoDB URI not found in environment variables.");
    }
    await mongoose.connect(mongoURI);
    console.log("Database connected");
  } catch (error) {
    console.error("Connection error: " + error);
  }
};

module.exports = connectDB;
