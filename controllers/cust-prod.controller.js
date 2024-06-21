const CustomerProduct = require("../models/cust-prod.models");
const Product =require("../models/product.models")

const getAllCustomerProducts = async (req, res, next) => {
    try {
      let response = await CustomerProduct.find().populate('customer').populate('product').exec();
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
      let response = await CustomerProduct.findById(id).populate('customer').populate('product').exec();
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
      // Fetch all products
      let allproducts = await Product.find();
  
      // Find the product to update based on productId
      let productToUpdate = allproducts.find(product => product._id.toString() === CustomerProductData.productId);
     
      if (!productToUpdate) {
        return res.json({
          success: false,
          error: 'Product not found in database',
        });
      }
  
      // Check if available quantity is sufficient
      if (productToUpdate.qty >= CustomerProductData.quantity) {
        // Update product quantity
        productToUpdate.qty -= CustomerProductData.quantity;
        console.log(productToUpdate.qty)
        // Save the updated product quantity back to the database
        await productToUpdate.save();
  
        // Create customer product entry
        let response = await CustomerProduct.create(CustomerProductData);
  
        // Respond with success
        return res.json({
          success: true,
          data: response,
        });
      } else {
        // Insufficient quantity response
        return res.json({
          success: false,
          error: 'Insufficient quantity available',
        });
      }
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
      let response = await CustomerProduct.findByIdAndUpdate(pid, newcustomerData);
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
  