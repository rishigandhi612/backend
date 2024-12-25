require('dotenv').config(); // Load environment variables from .env file
const express = require("express");
const app = express();
const bodyParser = require("body-parser");
const connectDatabase = require("./config/db");
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const mongoSanitize = require('express-mongo-sanitize');
const cors = require("cors");

// Use the CORS middleware with dynamic origins
const allowedOrigins = process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : [];

app.use(cors({
  origin: allowedOrigins,  // Use allowed origins from the .env file
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true  // Allow credentials (cookies, Authorization header, etc.)
}));

// For any OPTIONS request (pre-flight)
app.options('*', cors());  // Handles preflight requests globally

// Import CheckAuth middleware for JWT verification
const CheckAuth = require('./middleware/auth.middleware');

app.use(helmet());

const limiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  limit: 200, // Limit each IP to 200 requests per window (here, per 1 minute)
  standardHeaders: 'draft-7', // draft-6: `RateLimit-*` headers; draft-7: combined `RateLimit` header
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
})
// Apply the rate limiting middleware to all requests.
app.use(limiter);

// Parse application/x-www-form-urlencoded
app.use(bodyParser.urlencoded({ extended: false }));

// Parse application/json
app.use(bodyParser.json());

// To remove data using these defaults:
app.use(mongoSanitize());

// Or, to replace these prohibited characters with '_', use:
app.use(
  mongoSanitize({
    replaceWith: '_',
  }),
);

app.get('/', (req, res) => {
  res.send('server is running');
});

// Routes
const customerRoutes = require('./routes/customer.routes');
app.use('/customer', CheckAuth, customerRoutes);

const productRoutes = require('./routes/product.routes');
app.use('/product', CheckAuth, productRoutes);

const customerProductRoutes = require('./routes/cust-prod.routes');
app.use('/custprod', CheckAuth, customerProductRoutes);

const registerRoutes = require('./routes/user.routes');
app.use('/user', CheckAuth, registerRoutes);

const loginRoutes = require('./routes/login.routes');
app.use('/auth', loginRoutes);

const dashboardRoutes = require('./routes/dashboard.routes');
app.use('/dashboard', CheckAuth, dashboardRoutes);

// Connect to database
connectDatabase();

// Start the server with dynamic port from the .env file
const port = process.env.PORT || 3001; // Default to 3001 if not defined in .env
app.listen(port, () => console.log(`Server is running on port ${port}`));
