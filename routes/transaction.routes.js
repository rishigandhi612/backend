const express = require("express");
const router = express.Router();
const transactionController = require("../controllers/transaction.controller");

// Create a new transaction
router.post("/", transactionController.createTransaction);

// Get all transactions with filters
router.get("/", transactionController.getTransactions);

// Get transaction summary/statistics
router.get("/summary", transactionController.getTransactionSummary);

// Get single transaction by ID
router.get("/:id", transactionController.getTransactionById);

// Update transaction
router.put("/:id", transactionController.updateTransaction);

// Delete transaction
router.delete("/:id", transactionController.deleteTransaction);

// Get invoice payment history
router.get(
  "/invoice/:invoiceNumber",
  transactionController.getInvoicePaymentHistory
);

module.exports = router;
