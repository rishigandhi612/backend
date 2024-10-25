const product = require("../models/product.models");
const mongoose = require("mongoose");

const getAllproducts = async (req, res, next) => {
    try {
      let response = await product.find();
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
  const getproductbyId = async (req, res, next) => {
    const id = req.params.id;
    // console.log(req.params.id);  // Debugging

    // Validate the ObjectId format
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid product ID",
      });
    }
  
    try {
      let response = await product.findById(id);
      if (!response) {
        return res.status(404).json({
          success: false,
          message: "Product not found",
        });
      }
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
  const createproduct = async (req, res, next) => {
    let productData = req.body;
  
    try {
      let response = await product.create(productData);
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
  const updateproduct = async (req, res, next) => {
    let newproductData = req.body;
    let pid = req.params.id;
    try {
      let response = await product.findByIdAndUpdate(pid, newproductData);
      res.json({
        success: true,
        data: response,
        newproductData,
      });
    } catch (error) {
      res.json({
        success: false,
        error: error,
      });
    }
  };
  const deleteproduct = async (req, res, next) => {
    let pid = req.params.id;
  
    try {
      let response = await product.findByIdAndDelete(pid);
      res.json({
        success: true,
        data: response,
        message: "product Deleted whose id was " + pid,
      });
    } catch (error) {
      res.json({
        success: false,
        error: error,
      });
    }
  };

  module.exports = {
    getAllproducts,
    getproductbyId,
    createproduct,
    updateproduct,
    deleteproduct,
  };
  