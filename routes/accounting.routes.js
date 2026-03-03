/**
 * Accounting Routes — mount at /api/accounting
 */

const express = require("express");
const router = express.Router();
const {
  recordReceipt,
  recordOpeningBalance,
  applyOnAccount,
  getBills,
  getOnAccount,
  getVouchers,
  fetchReceipt,
  editReceipt,
} = require("../controllers/accounting.controller");

// Payments
router.get("/receipts/:voucherId", fetchReceipt);
router.put("/receipts/:voucherId", editReceipt);
router.post("/receipts", recordReceipt);

// Opening balances
router.post("/opening-balances", recordOpeningBalance);

// On-account
router.post("/on-account/apply", applyOnAccount);
router.get("/customers/:customerId/on-account", getOnAccount);

// Queries
router.get("/customers/:customerId/bills", getBills);
router.get("/customers/:customerId/vouchers", getVouchers);

module.exports = router;
