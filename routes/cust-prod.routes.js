const express = require("express");
const router = express.Router();

//customers

//controllers

const {
    getAllCustomerProducts,
    getCustomerProductsbyId,
    createCustomerProducts,
    updateCustomerProducts,
    deleteCustomerProducts,
} = require("../controllers/cust-prod.controller");
// Get All customers
router.get("/", getAllCustomerProducts);

//Get customer By Id
router.get("/:id", getCustomerProductsbyId);

//Create a customer
router.post("/", createCustomerProducts);

// Update a customer

router.put("/:id", updateCustomerProducts);

// Delete a customer

router.delete("/:id", deleteCustomerProducts);

module.exports = router;
