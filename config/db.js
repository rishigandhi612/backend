const mongoose = require("mongoose");

const connectDB = async () => {
  try {
    await mongoose.connect(
      "mongodb+srv://admin:admin123@learning.okjt39f.mongodb.net/htbackend"
    );
    console.log("Database connected");
  } catch (error) {
    console.log("Connection error" + error);
  }
};

module.exports = connectDB;
