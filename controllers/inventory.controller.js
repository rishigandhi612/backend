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
// Fixed getAllInventory function in controllers/inventory.controller.js

// Helper function to check if a string is numeric
const isNumeric = (str) => {
  return !isNaN(str) && !isNaN(parseFloat(str)) && isFinite(str);
};

const getAllInventory = async (req, res) => {
  try {
    // Parse query parameters with defaults
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const sortBy = req.query.sortBy || 'createdAt';
    const sortOrder = req.query.sortOrder || 'desc';
    const search = req.query.search;
    const status = req.query.status;
    const type = req.query.type;

    // Calculate skip for pagination
    const skip = (page - 1) * limit;

    // Build where clause for filtering
    const whereClause = {};
    
    // Add comprehensive search filter
    if (search) {
      const searchTerm = search.trim();
      whereClause.OR = [
        // Text fields - case insensitive search
        { rollId: { contains: searchTerm, mode: 'insensitive' } },
        { productId: { contains: searchTerm, mode: 'insensitive' } },
        { status: { contains: searchTerm, mode: 'insensitive' } },
        { type: { contains: searchTerm, mode: 'insensitive' } },
        
        // If search term is numeric, search in numeric fields too
        ...(isNumeric(searchTerm) ? [
          { netWeight: { equals: parseFloat(searchTerm) } },
          { grossWeight: { equals: parseFloat(searchTerm) } },
          { width: { equals: parseFloat(searchTerm) } },
          { micron: { equals: parseFloat(searchTerm) } },
          { mtr: { equals: parseFloat(searchTerm) } },
        ] : []),
      ];
    }
    
    // Add status filter
    if (status) {
      whereClause.status = status;
    }
    
    // Add type filter
    if (type) {
      whereClause.type = type;
    }

    // Build orderBy clause
    const orderBy = {};
    
    // Map frontend sortBy values to actual database fields
    const sortFieldMap = {
      'rollId': 'rollId',
      'productId': 'productId',
      'status': 'status',
      'type': 'type',
      'netWeight': 'netWeight',
      'width': 'width',
      'createdAt': 'createdAt',
      'updatedAt': 'updatedAt'
    };
    
    const dbSortField = sortFieldMap[sortBy] || 'createdAt';
    orderBy[dbSortField] = sortOrder === 'desc' ? 'desc' : 'asc';

    // Execute queries sequentially to avoid prepared statement conflicts
    const inventory = await prisma.inventory.findMany({
      where: whereClause,
      skip,
      take: limit,
      orderBy,
    });

    const total = await prisma.inventory.count({
      where: whereClause,
    });

    // Return response in the format expected by frontend
    res.json({
      success: true,
      data: inventory,
      total: total, // Frontend expects this at root level
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
        hasNextPage: page < Math.ceil(total / limit),
        hasPrevPage: page > 1,
      },
    });
  } catch (error) {
    console.error('Pagination error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      data: [],
      total: 0,
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
const generateSequentialRollId = async (netWeight, width) => {
  // Determine prefix based on width (I for < 70, M for >= 70)
  const widthPrefix = width < 70 ? 'I' : 'M';
  
  // Format width to 4 digits (remove decimal point and pad/truncate)
  const widthStr = Math.round(width * 100).toString().padStart(4, '0').slice(0, 4);
  
  // Format net weight to 4 digits (remove decimal point and pad/truncate)
  const weightStr = Math.round(netWeight * 100).toString().padStart(4, '0').slice(0, 4);
  
  // Create the base pattern (without sequence number)
  const basePattern = `${widthPrefix}${widthStr}${weightStr}`;

  // Find the latest inventory with this base pattern
  const latestInventory = await prisma.inventory.findFirst({
    where: {
      rollId: {
        startsWith: basePattern,
      },
    },
    orderBy: {
      rollId: 'desc',
    },
  });

  let sequence = 1;
  if (latestInventory && latestInventory.rollId.length === basePattern.length + 2) {
    const lastSeq = parseInt(latestInventory.rollId.slice(-2));
    if (!isNaN(lastSeq)) {
      sequence = lastSeq + 1;
    }
  }

  // Format sequence to 2 digits
  const sequenceStr = sequence.toString().padStart(2, '0');
  
  return `${basePattern}${sequenceStr}`;
};

const createInventory = async (req, res) => {
  const inventoryData = req.body;

  const validationErrors = validateInventoryData(inventoryData);
  if (validationErrors.length > 0) {
    return res.status(400).json({
      success: false,
      errors: validationErrors,
    });
  }

  if (!isValidObjectId(inventoryData.productId)) {
    return res.status(400).json({
      success: false,
      message: 'Invalid product ID format',
    });
  }

  try {
    const productExists = await Product.findById(inventoryData.productId);
    if (!productExists) {
      return res.status(404).json({
        success: false,
        message: 'Product not found in the database',
      });
    }

    // Generate sequential and unique rollId
    if (!inventoryData.rollId) {
      inventoryData.rollId = await generateSequentialRollId(
        inventoryData.netWeight,
        inventoryData.width || 0
      );
    }

    // Final uniqueness check before insert - rollId is unique in schema
    const existing = await prisma.inventory.findUnique({
      where: { rollId: inventoryData.rollId },
    });
    if (existing) {
      return res.status(409).json({
        success: false,
        message: 'Generated rollId already exists. Please try again.',
      });
    }

    const newInventory = await prisma.inventory.create({
      data: inventoryData,
    });

    res.status(201).json({
      success: true,
      data: newInventory,
    });
  } catch (error) {
    // Handle unique constraint violation if rollId has unique constraint at DB level
    if (error.code === 'P2002' && error.meta?.target?.includes('rollId')) {
      return res.status(409).json({
        success: false,
        message: 'Roll ID already exists. Please try again.',
      });
    }
    
    res.status(500).json({
      success: false,
      error: error.message,
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
    
    // If updating rollId, check for uniqueness
    if (inventoryData.rollId) {
      const existing = await prisma.inventory.findUnique({
        where: { rollId: inventoryData.rollId },
      });
      if (existing && existing.id !== id) {
        return res.status(409).json({
          success: false,
          message: 'Roll ID already exists.',
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
    
    // Handle unique constraint violation
    if (error.code === 'P2002' && error.meta?.target?.includes('rollId')) {
      return res.status(409).json({
        success: false,
        message: 'Roll ID already exists.',
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