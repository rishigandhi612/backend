const express = require("express");
const router = express.Router();

//customers

//controllers

const {
  getAllcustomers,
  getcustomerbyId,
  createcustomer,
  updatecustomer,
  deletecustomer,
} = require("../controllers/customer.controller");
const { recordCreditNote } = require("../controllers/accounting.controller");
// /Users/rishi/Desktop/HUB/backend/controllers/accounting.controller.js
// Get All customers
router.get("/", getAllcustomers);

//Get customer By Id
router.get("/:id", getcustomerbyId);

//Create a customer
router.post("/", createcustomer);

// Update a customer

router.put("/:id", updatecustomer);

// Delete a customer

router.delete("/:id", deletecustomer);

router.post("/creditNote", recordCreditNote);

module.exports = router;
