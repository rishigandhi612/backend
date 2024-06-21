const customer = require("../models/customer.models");

const getAllcustomers = async (req, res, next) => {
    try {
      let response = await customer.find();
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
  const getcustomerbyId = async (req, res, next) => {
    const id = req.params.id;
    try {
      let response = await customer.findById(id);
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
  const createcustomer = async (req, res, next) => {
    let customerData = req.body;
  
    try {
      let response = await customer.create(customerData);
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
  const updatecustomer = async (req, res, next) => {
    let newcustomerData = req.body;
    let pid = req.params.id;
    try {
      let response = await customer.findByIdAndUpdate(pid, newcustomerData);
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
  const deletecustomer = async (req, res, next) => {
    let pid = req.params.id;
  
    try {
      let response = await customer.findByIdAndDelete(pid);
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
    getAllcustomers,
    getcustomerbyId,
    createcustomer,
    updatecustomer,
    deletecustomer,
  };
  