const CustomerProduct = require("../models/cust-prod.models");
const Product = require("../models/product.models");
const Customer = require("../models/customer.models");

const getAllCustomerProducts = async (req, res, next) => {
  try {
    let response = await CustomerProduct.find()
      .populate("customer")
      .populate("product")
      .exec();
    res.json({
      success: true,
      data: response,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};

const getCustomerProductsbyId = async (req, res, next) => {
  const id = req.params.id;
  try {
    let response = await CustomerProduct.findById(id)
      .populate("customer")
      .populate("product")
      .exec();
    if (!response) {
      return res.status(404).json({
        success: false,
        message: "CustomerProduct not found",
      });
    }
    res.json({
      success: true,
      data: response,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};

const createCustomerProducts = async (req, res, next) => {
  const { customer, product, quantity } = req.body;

  // Validate numeric quantity
  if (isNaN(quantity) || parseInt(quantity) <= 0) {
    return res.status(400).json({
      success: false,
      message: "Quantity must be a positive number",
    });
  }

  try {
    // Validate Customer 
    let CustomerInfo = await Customer.findById(customer);
    if (!CustomerInfo) {
      return res.status(404).json({
        success: false,
        message: "Customer not found in database",
      });
    }

    // Fetch product info 
    let ProductInfo = await Product.findById(product);
    if (!ProductInfo) {
      return res.status(404).json({
        success: false,
        message: "Product not found in database",
      });
    }

    const requestedQuantity = parseInt(quantity);
    if (requestedQuantity > ProductInfo.quantity) {
      return res.status(400).json({
        success: false,
        message: "Insufficient quantity",
      });
    }

    // Create customer product entry
    let response = await CustomerProduct.create({ customer, product, quantity: requestedQuantity });

    // Update Inventory
    let newQuantity = ProductInfo.quantity - requestedQuantity;
    await Product.findByIdAndUpdate(product, { quantity: newQuantity });

    // Respond with success
    return res.status(201).json({
      success: true,
      data: response,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};

const updateCustomerProducts = async (req, res, next) => {
  const newcustomerData = req.body;
  const pid = req.params.id;
  try {
    let response = await CustomerProduct.findByIdAndUpdate(pid, newcustomerData, { new: true });
    if (!response) {
      return res.status(404).json({
        success: false,
        message: "CustomerProduct not found",
      });
    }
    res.json({
      success: true,
      data: response,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};

const deleteCustomerProducts = async (req, res, next) => {
  const pid = req.params.id;

  try {
    let response = await CustomerProduct.findByIdAndDelete(pid);
    if (!response) {
      return res.status(404).json({
        success: false,
        message: "CustomerProduct not found",
      });
    }
    res.json({
      success: true,
      data: response,
      message: "CustomerProduct deleted whose id was " + pid,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};

// Export functions
module.exports = {
  getAllCustomerProducts,
  getCustomerProductsbyId,
  createCustomerProducts,
  updateCustomerProducts,
  deleteCustomerProducts,
};
