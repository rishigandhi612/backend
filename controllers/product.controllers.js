const product = require("../models/product.models");
const mongoose = require("mongoose");

// Helper: Validate inventory fields if they exist
const validateInventoryFields = (data) => {
  const errors = [];

  if (data.width && typeof data.width !== 'number') {
    errors.push("Width should be a number");
  }
  if (data.netWeight && typeof data.netWeight !== 'number') {
    errors.push("Net weight should be a number");
  }
  if (data.grossWeight && typeof data.grossWeight !== 'number') {
    errors.push("Gross weight should be a number");
  }
  if (data.micron && typeof data.micron !== 'number') {
    errors.push("Micron should be a number");
  }
  if (data.mtr && typeof data.mtr !== 'number') {
    errors.push("Meter should be a number");
  }
  if (data.type && !["film", "non-film"].includes(data.type)) {
    errors.push("Type must be 'film' or 'non-film'");
  }
  if (data.status && !["available", "damaged", "reserved"].includes(data.status)) {
    errors.push("Status must be 'available', 'damaged', or 'reserved'");
  }

  return errors;
};

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

  const validationErrors = validateInventoryFields(productData);
  if (validationErrors.length > 0) {
    return res.status(400).json({ success: false, message: validationErrors.join(", ") });
  }

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
  const newproductData = req.body;
  const pid = req.params.id;

  const validationErrors = validateInventoryFields(newproductData);
  if (validationErrors.length > 0) {
    return res.status(400).json({ success: false, message: validationErrors.join(", ") });
  }

  try {
    const response = await product.findByIdAndUpdate(pid, newproductData, { new: true });
    if (!response) {
      return res.status(404).json({ success: false, message: "Product not found" });
    }
    res.json({ success: true, data: response });
  } catch (error) {
    res.json({ success: false, error });
  }
};

const deleteproduct = async (req, res, next) => {
  const pid = req.params.id;

  try {
    const response = await product.findByIdAndDelete(pid);
    if (!response) {
      return res.status(404).json({ success: false, message: "Product not found" });
    }
    res.json({ success: true, message: `Product deleted with id: ${pid}` });
  } catch (error) {
    res.json({ success: false, error });
  }
};

module.exports = {
  getAllproducts,
  getproductbyId,
  createproduct,
  updateproduct,
  deleteproduct,
};
