// routes/inventory.routes.js
const express = require('express');
const router = express.Router();
const inventoryController = require('../controllers/inventory.controller');

// Get all inventory items
router.get('/', inventoryController.getAllInventory);

// Get inventory by ID
router.get('/:id', inventoryController.getInventoryById);

// Create new inventory
router.post('/', inventoryController.createInventory);

// Update inventory
router.put('/:id', inventoryController.updateInventory);

// Delete inventory
router.delete('/:id', inventoryController.deleteInventory);

// Get inventory by product ID
router.get('/product/:productId', inventoryController.getInventoryByProductId);

// Get inventory by status
router.get('/status/:status', inventoryController.getInventoryByStatus);

module.exports = router;