const express = require("express");
const router = express.Router();

// Import the POD controller functions
const {
  upload,
  uploadPOD,
  getPOD,
  deletePOD,
  updateDeliveryStatus,
  getInvoicesByDeliveryStatus,
} = require("../controllers/pod.controller"); // Adjust path as needed

// Import your existing customer product controller
const {
  getAllCustomerProducts,
  getCustomerProductsbyId,
  createCustomerProducts,
  updateCustomerProducts,
  deleteCustomerProducts,
  resetCounter,
  getAvailableRollIds,
} = require("../controllers/cust-prod.controller"); // Adjust path as needed

// Existing routes
router.get("/", getAllCustomerProducts);
router.get("/:id", getCustomerProductsbyId);
router.post("/", createCustomerProducts);
router.put("/:id", updateCustomerProducts);
router.delete("/:id", deleteCustomerProducts);
router.post("/reset-counter", resetCounter);
router.get("/available-rolls/:productId", getAvailableRollIds);

// POD related routes
router.post("/:id/pod", upload.single("podFile"), uploadPOD);
router.get("/:id/pod", getPOD);
router.delete("/:id/pod", deletePOD);

// Delivery status routes
router.put("/:id/delivery-status", updateDeliveryStatus);
router.get("/delivery-status/:status", getInvoicesByDeliveryStatus);

module.exports = router;
