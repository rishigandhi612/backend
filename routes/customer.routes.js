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

module.exports = router;
