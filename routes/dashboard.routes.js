// routes/dashboard.routes.js
const express = require('express');
const router = express.Router();
const Customer = require('../models/customer.models'); // Adjust based on your model structure
const Product = require('../models/product.models'); // Adjust based on your model structure
const CustProd = require('../models/cust-prod.models'); // Adjust based on your model structure
const User = require('../models/user.models'); // Adjust based on your model structure

// Route to get dashboard statistics
router.get('/stats', async (req, res) => {
    try {
        const customerCount = await Customer.countDocuments();
        const productCount = await Product.countDocuments();
        const custProdCount = await CustProd.countDocuments();
        const userCount = await User.countDocuments();

        res.json({
            totalCustomers: customerCount,
            totalProducts: productCount,
            totalInvoices: custProdCount,
            totalUsers: userCount,
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Error fetching dashboard stats' });
    }
});

module.exports = router;
