// routes/transporter.js
const express = require('express');
const router = express.Router();
const transporterController = require('../controllers/transporter.controller');

// Search route (should be before /:id route to avoid conflicts)
router.get('/search', transporterController.searchTransporters);

// CRUD routes
router.post('/', transporterController.createTransporter);
router.get('/', transporterController.getAllTransporters); // Kept for backward compatibility
router.get('/:id', transporterController.getTransporterById);
router.put('/:id', transporterController.updateTransporter);
router.delete('/:id', transporterController.deleteTransporter);

// Status toggle route (optional - if you want a dedicated endpoint)
router.patch('/:id/status', async (req, res) => {
  try {
    const { isActive } = req.body;
    const updatedTransporter = await transporterController.updateTransporter({
      params: { id: req.params.id },
      body: { isActive }
    });
    
    res.status(200).json({
      success: true,
      message: `Transporter ${isActive ? 'activated' : 'deactivated'} successfully`,
      data: updatedTransporter
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

module.exports = router;