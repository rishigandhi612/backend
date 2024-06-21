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
    res.json({
      success: false,
      error: error,
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
    res.json({
      success: true,
      data: response,
    });
  } catch (error) {
    res.json({
      success: false,
      error: error,
    });
  }
};
const createCustomerProducts = async (req, res, next) => {
  let CustomerProductData = req.body;

  try {
    // Validate Customer 
    let CustomerInfo = await Customer.findById(req.body.customer);
    // console.log('abc',ProductInfo)
    if (!CustomerInfo) {
      return res.json({
        success: false,
        message: "Customer not found in database",
      });
    }
    // Fetch product info 
    let ProductInfo = await Product.findById(req.body.product);
    // console.log('abc',ProductInfo)
    if (!ProductInfo) {
      return res.json({
        success: false,
        message: "Product not found in database",
      });
    }

    console.log('Order qty',req.body.quantity)
    console.log('Product qty',ProductInfo.quantity)

    if (parseInt(req.body.quantity) > parseInt(ProductInfo.quantity)) {
      return res.json({
        success: false,
        message: "Insufficient quantity",
      });
    }
    // Create customer product entry
    let response = await CustomerProduct.create(CustomerProductData);

    // Update Inventory
    let newquantity = {quantity: parseInt(ProductInfo.quantity) - parseInt(req.body.quantity) };
    let productupdate = await Product.findByIdAndUpdate(
      req.body.product,
      newquantity
    );
    // Respond with success
    return res.json({
      success: true,
      data: response,
    });
  } catch (error) {
    // Catch any errors
    return res.json({
      success: false,
      error: error.message,
    });
  }
};

const updateCustomerProducts = async (req, res, next) => {
  let newcustomerData = req.body;
  let pid = req.params.id;
  try {
    let response = await CustomerProduct.findByIdAndUpdate(
      pid,
      newcustomerData
    );
    res.json({
      success: true,
      data: response,
      newcustomerData,
    });
  } catch (error) {
    res.json({
      success: false,
      error: error,
    });
  }
};
const deleteCustomerProducts = async (req, res, next) => {
  let pid = req.params.id;

  try {
    let response = await CustomerProduct.findByIdAndDelete(pid);
    res.json({
      success: true,
      data: response,
      message: "customer Deleted whose id was " + pid,
    });
  } catch (error) {
    res.json({
      success: false,
      error: error,
    });
  }
};

module.exports = {
  getAllCustomerProducts,
  getCustomerProductsbyId,
  createCustomerProducts,
  updateCustomerProducts,
  deleteCustomerProducts,
};
