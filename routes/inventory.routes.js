// routes/inventory.routes.js
const express = require('express');
const router = express.Router();
const {
  getAllInventory,
  getInventoryById,
  createInventory,
  updateInventory,
  deleteInventory,
  getInventoryByProductId,
  getAvailableInventoryByProductId,
  getInventoryByStatus,
  getSoldInventory,
  getInventoryByInvoice,
  bulkUpdateInventoryStatus
} = require('../controllers/inventory.controller');

// Base inventory routes
router.get('/', getAllInventory); // GET /api/inventory?productId=xxx will work
router.post('/', createInventory);
router.put('/bulk-update-status', bulkUpdateInventoryStatus);

// Specific product inventory routes
router.get('/product/:productId', getInventoryByProductId); // GET /api/inventory/product/:productId
router.get('/product/:productId/available', getAvailableInventoryByProductId); // GET /api/inventory/product/:productId/available

// Status-based routes
router.get('/status/:status', getInventoryByStatus);
router.get('/sold', getSoldInventory);

// Invoice-based routes
router.get('/invoice/:invoiceNumber', getInventoryByInvoice);

// Individual inventory item routes
router.get('/:id', getInventoryById);
router.put('/:id', updateInventory);
router.delete('/:id', deleteInventory);

module.exports = router;