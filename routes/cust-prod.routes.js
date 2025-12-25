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
  getMonthlyInvoiceTotals,
} = require("../controllers/cust-prod.controller");
const {
  createOpeningOutstanding,
  getCustomerPendingInvoices,
  getInvoicePayments,
  updateOpeningOutstanding,
  deleteOpeningOutstanding,
  getAllOpeningOutstanding,
} = require("../controllers/invoice-opening-outstanding.controller");
const {
  getCustomerInvoicesByFinancialYear,
} = require("../controllers/ledger.controller");

// Existing routes
router.get("/", getAllCustomerProducts);

// Static routes and utility endpoints
router.get("/monthly-totals", getMonthlyInvoiceTotals);
router.post("/reset-counter", resetCounter);
router.get("/available-rolls/:productId", getAvailableRollIds);

// Opening-outstanding and related customer/invoice routes (specific)
router.post("/opening-outstanding", createOpeningOutstanding);
router.get("/opening-outstanding", getAllOpeningOutstanding);
router.put("/opening-outstanding/:id", updateOpeningOutstanding);
router.delete("/opening-outstanding/:id", deleteOpeningOutstanding);
router.get(
  "/customer/:customerId/pending-invoices",
  getCustomerPendingInvoices
);
router.get("/invoice/:invoiceId/payments", getInvoicePayments);

// Delivery status routes
router.put("/:id/delivery-status", updateDeliveryStatus);
router.get("/delivery-status/:status", getInvoicesByDeliveryStatus);

// POD related routes
router.post("/:id/pod", upload.single("podFile"), uploadPOD);
router.get("/:id/pod", getPOD);
router.delete("/:id/pod", deletePOD);

// Invoice-related routes
router.get("/:customerId/invoices", getCustomerInvoicesByFinancialYear);

// Parameterized routes (generic) - keep at bottom so they don't shadow others
router.get("/:id", getCustomerProductsbyId);
router.post("/", createCustomerProducts);
router.put("/:id", updateCustomerProducts);
router.delete("/:id", deleteCustomerProducts);

module.exports = router;
