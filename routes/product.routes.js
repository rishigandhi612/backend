const express = require("express");
const router = express.Router();

//products

//controllers

const {
    getAllproducts,
    getproductbyId,
    createproduct,
    updateproduct,
    deleteproduct,
} = require("../controllers/product.controllers");
// Get All products
router.get("/", getAllproducts);

//Get product By Id
router.get("/:id", getproductbyId);

//Create a product
router.post("/", createproduct);

// Update a product

router.put("/:id", updateproduct);

// Delete a product

router.delete("/:id", deleteproduct);

module.exports = router;
