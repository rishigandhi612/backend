// api/express.js
const express = require("express");
const app = express();

// Add middleware or other configurations here

// Example route
app.get("/", (req, res) => {
  res.send("Hello from Express on Vercel!");
});

// Export the app for Vercel to handle
module.exports = app;
