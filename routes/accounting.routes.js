/**
 * Accounting Routes — mount at /api/accounting
 */

const express = require("express");
const router = express.Router();
const {
  recordReceipt,
  recordOpeningBalance,
  applyOnAccount,
  recordCreditNote,
  getInvoiceNotes,
  getBills,
  getOnAccount,
  getVouchers,
  fetchReceipt,
  editReceipt,
  removeReceipt,
} = require("../controllers/accounting.controller");

// Payments
router.get("/receipts/:voucherId", fetchReceipt);
router.put("/receipts/:voucherId", editReceipt);
router.delete("/receipts/:voucherId", removeReceipt);
router.post("/receipts", recordReceipt);

// Opening balances
router.post("/opening-balances", recordOpeningBalance);

// On-account
router.post("/on-account/apply", applyOnAccount);
router.get("/customers/:customerId/on-account", getOnAccount);

// Queries
router.get("/customers/:customerId/invoice-notes", getInvoiceNotes);
router.get("/customers/:customerId/bills", getBills);
router.get("/customers/:customerId/vouchers", getVouchers);

// Credit Notes
router.post("/creditNote", recordCreditNote);
module.exports = router;
