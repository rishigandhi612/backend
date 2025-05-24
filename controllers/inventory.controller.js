// controllers/inventory.controller.js
const prisma = require('../config/prisma');
const mongoose = require('mongoose');
const Product = require('../models/product.models');

// Helper function to validate MongoDB ObjectId
const isValidObjectId = (id) => {
  return mongoose.Types.ObjectId.isValid(id);
};

// Validate inventory data
const validateInventoryData = (data) => {
  const errors = [];
  
  // Required fields
  if (!data.productId) errors.push('Product ID is required');
  if (!data.netWeight && data.netWeight !== 0) errors.push('Net weight is required');
  if (!data.rollId) errors.push('Roll ID is required');
  
  // Type validation
  if (data.type && !['film', 'non-film'].includes(data.type)) {
    errors.push('Type must be either "film" or "non-film"');
  }
  
  // Status validation
  if (data.status && !['damaged', 'available', 'reserved'].includes(data.status)) {
    errors.push('Status must be one of: damaged, available, reserved');
  }
  
  // Numeric fields validation
  if (data.width && typeof data.width !== 'number') errors.push('Width must be a number');
  if (data.netWeight && typeof data.netWeight !== 'number') errors.push('Net weight must be a number');
  if (data.grossWeight && typeof data.grossWeight !== 'number') errors.push('Gross weight must be a number');
  if (data.micron && typeof data.micron !== 'number') errors.push('Micron must be a number');
  if (data.mtr && typeof data.mtr !== 'number') errors.push('Meter must be a number');
  
  return errors;
};

// Get all inventory items
const getAllInventory = async (req, res) => {
  try {
    const inventory = await prisma.inventory.findMany();
    res.json({
      success: true,
      data: inventory
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

// Get inventory by ID
const getInventoryById = async (req, res) => {
  const { id } = req.params;
  
  try {
    const inventoryItem = await prisma.inventory.findUnique({
      where: { id }
    });
    
    if (!inventoryItem) {
      return res.status(404).json({
        success: false,
        message: 'Inventory item not found'
      });
    }
    
    res.json({
      success: true,
      data: inventoryItem
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

// Create inventory
const generateRollId = (netWeight, width) => {
  const now = new Date();
  const year = now.getFullYear().toString().slice(-2); // Last 2 digits of year
  const widthDigit = width % 10; // Mod 10 of width
  const dayDigit = now.getDate() % 10; // Mod 10 of day
  const randomDigits = Math.floor(1000 + Math.random() * 9000); // 4-digit random

  return `${year}${widthDigit}${dayDigit}${randomDigits}`;
};

const createInventory = async (req, res) => {
  const inventoryData = req.body;

  // Validate inventory data
  const validationErrors = validateInventoryData(inventoryData);
  if (validationErrors.length > 0) {
    return res.status(400).json({
      success: false,
      errors: validationErrors
    });
  }

  // Validate that the product exists in MongoDB
  if (!isValidObjectId(inventoryData.productId)) {
    return res.status(400).json({
      success: false,
      message: 'Invalid product ID format'
    });
  }

  try {
    // Check if product exists in MongoDB
    const productExists = await Product.findById(inventoryData.productId);
    if (!productExists) {
      return res.status(404).json({
        success: false,
        message: 'Product not found in the database'
      });
    }

    // Generate rollId if not provided
    if (!inventoryData.rollId) {
      inventoryData.rollId = generateRollId(inventoryData.netWeight, inventoryData.width || 0);
    }

    // Create inventory in PostgreSQL
    const newInventory = await prisma.inventory.create({
      data: inventoryData
    });

    res.status(201).json({
      success: true,
      data: newInventory
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};


// Update inventory
const updateInventory = async (req, res) => {
  const { id } = req.params;
  const inventoryData = req.body;
  
  // If updating productId, validate it
  if (inventoryData.productId && !isValidObjectId(inventoryData.productId)) {
    return res.status(400).json({
      success: false,
      message: 'Invalid product ID format'
    });
  }
  
  try {
    // If updating productId, check if product exists
    if (inventoryData.productId) {
      const productExists = await Product.findById(inventoryData.productId);
      if (!productExists) {
        return res.status(404).json({
          success: false,
          message: 'Product not found in the database'
        });
      }
    }
    
    // Update inventory in PostgreSQL
    const updatedInventory = await prisma.inventory.update({
      where: { id },
      data: inventoryData
    });
    
    res.json({
      success: true,
      data: updatedInventory
    });
  } catch (error) {
    // Handle the case where the inventory item doesn't exist
    if (error.code === 'P2025') {
      return res.status(404).json({
        success: false,
        message: 'Inventory item not found'
      });
    }
    
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

// Delete inventory
const deleteInventory = async (req, res) => {
  const { id } = req.params;
  
  try {
    await prisma.inventory.delete({
      where: { id }
    });
    
    res.json({
      success: true,
      message: `Inventory item with ID ${id} has been deleted`
    });
  } catch (error) {
    // Handle the case where the inventory item doesn't exist
    if (error.code === 'P2025') {
      return res.status(404).json({
        success: false,
        message: 'Inventory item not found'
      });
    }
    
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

// Get inventory by product ID
const getInventoryByProductId = async (req, res) => {
  const { productId } = req.params;
  
  if (!isValidObjectId(productId)) {
    return res.status(400).json({
      success: false,
      message: 'Invalid product ID format'
    });
  }
  
  try {
    const inventory = await prisma.inventory.findMany({
      where: { productId }
    });
    
    res.json({
      success: true,
      data: inventory
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

// Get inventory by status
const getInventoryByStatus = async (req, res) => {
  const { status } = req.params;
  
  if (!['damaged', 'available', 'reserved'].includes(status)) {
    return res.status(400).json({
      success: false,
      message: 'Invalid status. Must be one of: damaged, available, reserved'
    });
  }
  
  try {
    const inventory = await prisma.inventory.findMany({
      where: { status }
    });
    
    res.json({
      success: true,
      data: inventory
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

module.exports = {
  getAllInventory,
  getInventoryById,
  createInventory,
  updateInventory,
  deleteInventory,
  getInventoryByProductId,
  getInventoryByStatus
};