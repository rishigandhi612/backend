const express = require("express");
const router = express.Router();

const {
  getAllBanks,
  getBankById,
  createBank,
  updateBank,
  deleteBank,
  getTransactionsByBank,
  getBankTotals,
  getBankSummary,
} = require("../controllers/bank.controller");
// Get All Banks
router.get("/", getAllBanks);

// Bank specific endpoints
router.get("/:id/transactions", getTransactionsByBank);
router.get("/:id/totals", getBankTotals);
router.get("/:id/summary", getBankSummary);

//Get Bank By Id
router.get("/:id", getBankById);

//Create a Bank
router.post("/", createBank);

// Update a Bank
router.put("/:id", updateBank);

// Delete a Bank
router.delete("/:id", deleteBank);

module.exports = router;
