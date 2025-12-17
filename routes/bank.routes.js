const express = require("express");
const router = express.Router();

const {
  getAllBanks,
  getBankById,
  createBank,
  updateBank,
  deleteBank,
} = require("../controllers/bank.controller");
// Get All Banks
router.get("/", getAllBanks);

//Get Bank By Id
router.get("/:id", getBankById);

//Create a Bank
router.post("/", createBank);

// Update a Bank
router.put("/:id", updateBank);

// Delete a Bank
router.delete("/:id", deleteBank);

module.exports = router;
