// express.js - Your Express app setup

require('dotenv').config();  // Load environment variables from .env file
const express = require("express");
const app = express();
const bodyParser = require("body-parser");
const connectDatabase = require("../config/db");
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const mongoSanitize = require('express-mongo-sanitize');
const cors = require("cors");

// Use the CORS middleware
app.use(cors());

// Import CheckAuth middleware for JWT verification
const CheckAuth = require('../middleware/auth.middleware');

// Use Helmet for security
app.use(helmet());

// Rate limiting to avoid abuse
const limiter = rateLimit({
  windowMs: 1 * 60 * 1000,  // 1 minute window
  limit: 200,               // Limit each IP to 200 requests per minute
  standardHeaders: 'draft-7',
  legacyHeaders: false,
});
app.use(limiter);

// Middleware to parse the request body
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

// Sanitize incoming data to prevent NoSQL injections
app.use(mongoSanitize());

// Basic route to check server status
app.get('/', (req, res) => {
  res.send('Server is running');
});
app.get('/test', (req, res) => {
  res.json({ message: "Vercel is working!" });
});

// Routes (define your API endpoints)
const customerRoutes = require('../routes/customer.routes');
app.use('/customer', CheckAuth, customerRoutes);

const productRoutes = require('../routes/product.routes');
app.use('/product', CheckAuth, productRoutes);

const customerProductRoutes = require('../routes/cust-prod.routes');
app.use('/custprod', CheckAuth, customerProductRoutes);

const registerRoutes = require('../routes/user.routes');
app.use('/user', CheckAuth, registerRoutes);

const loginRoutes = require('../routes/login.routes');
app.use('/auth', loginRoutes);  // No CheckAuth middleware for login route

const dashboardRoutes = require('../routes/dashboard.routes');
app.use('/dashboard', CheckAuth, dashboardRoutes);

// Call the function to connect to MongoDB
connectDatabase();

// Export the app for Vercel to use (no app.listen() needed)
module.exports = app;
