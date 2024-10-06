const express = require("express");
const app = express();
const bodyParser = require("body-parser");
const connectDatabase = require("./config/db");
const helmet = require('helmet')
const rateLimit = require('express-rate-limit')
const mongoSanitize = require('express-mongo-sanitize');

app.use(helmet());

const limiter = rateLimit({
	windowMs: 1 * 60 * 1000, // 15 minutes
	limit: 200, // Limit each IP to 100 requests per `window` (here, per 15 minutes).
	standardHeaders: 'draft-7', // draft-6: `RateLimit-*` headers; draft-7: combined `RateLimit` header
	legacyHeaders: false, // Disable the `X-RateLimit-*` headers.
	// store: ... , // Redis, Memcached, etc. See below.
})
// Apply the rate limiting middleware to all requests.
app.use(limiter)
// parse application/x-www-form-urlencoded
app.use(bodyParser.urlencoded({ extended: false }));

// parse application/json
app.use(bodyParser.json());

// To remove data using these defaults:
app.use(mongoSanitize());

// Or, to replace these prohibited characters with _, use:
app.use(
  mongoSanitize({
    replaceWith: '_',
  }),
);
app.get ('/',(req,res)=>{
    res.send('server is running')
})


//router
const customerRoutes = require('./routes/customer.routes')
app.use('/customer',customerRoutes)
const ProductRoutes = require('./routes/product.routes')
app.use('/product',ProductRoutes)
const CustomerProductRoutes = require('./routes/cust-prod.routes')
app.use('/custprod',CustomerProductRoutes)
const RegisterRoutes = require('./routes/user.routes');
app.use('/auth',RegisterRoutes)

//call function connect database
connectDatabase();


app.listen(3001,()=> console.log('server is running on port 3001'))