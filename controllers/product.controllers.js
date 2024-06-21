const product = require("../models/product.models");

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
    try {
      let response = await product.findById(id);
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
  