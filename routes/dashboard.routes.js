// routes/dashboard.routes.js
const express = require('express');
const router = express.Router();
const Customer = require('../models/customer.models'); // Adjust based on your model structure
const Product = require('../models/product.models'); // Adjust based on your model structure
const CustProd = require('../models/cust-prod.models'); // Adjust based on your model structure
const User = require('../models/user.models'); // Adjust based on your model structure
const prisma = require('../config/prisma')

// Route to get dashboard statistics
router.get('/stats', async (req, res) => {
    try {
        const [customerCount, productCount, custProdCount, userCount, inventoryCount] = await Promise.all([
            Customer.countDocuments(),
            Product.countDocuments(),
            CustProd.countDocuments(),
            User.countDocuments(),
            prisma.inventory.count(), // Prisma query for PostgreSQL
        ]);
        const [availableInventory, damagedInventory, reservedInventory] = await Promise.all([
    prisma.inventory.count({ where: { status: 'available' } }),
    prisma.inventory.count({ where: { status: 'damaged' } }),
    prisma.inventory.count({ where: { status: 'reserved' } }),
]);


       res.json({
    totalCustomers: customerCount,
    totalProducts: productCount,
    totalCustProd: custProdCount,
    totalUsers: userCount,
    totalInventory: inventoryCount,
    availableInventory,
    damagedInventory,
    reservedInventory,
});

    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Error fetching dashboard stats' });
    }
});

module.exports = router;
