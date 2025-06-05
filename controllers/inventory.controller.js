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
  
  // Status validation - updated to include 'sold'
  if (data.status && !['damaged', 'available', 'reserved', 'sold'].includes(data.status)) {
    errors.push('Status must be one of: damaged, available, reserved, sold');
  }
  
  // Numeric fields validation
  if (data.width && typeof data.width !== 'number') errors.push('Width must be a number');
  if (data.netWeight && typeof data.netWeight !== 'number') errors.push('Net weight must be a number');
  if (data.grossWeight && typeof data.grossWeight !== 'number') errors.push('Gross weight must be a number');
  if (data.micron && typeof data.micron !== 'number') errors.push('Micron must be a number');
  if (data.mtr && typeof data.mtr !== 'number') errors.push('Meter must be a number');
  
  return errors;
};

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
    const productId = req.query.productId; // Add productId filter

    // Calculate skip for pagination
    const skip = (page - 1) * limit;

    // Build where clause for filtering
    const whereClause = {};
    
    // Add productId filter if provided
    if (productId) {
      // Validate productId format if it's a MongoDB ObjectId
      if (!isValidObjectId(productId)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid product ID format'
        });
      }
      whereClause.productId = productId;
    }
    
    // Add comprehensive search filter
    if (search) {
      const searchTerm = search.trim();
      whereClause.OR = [
        // Text fields - case insensitive search
        { rollId: { contains: searchTerm, mode: 'insensitive' } },
        { productId: { contains: searchTerm, mode: 'insensitive' } },
        { status: { contains: searchTerm, mode: 'insensitive' } },
        { type: { contains: searchTerm, mode: 'insensitive' } },
        { invoiceNumber: { contains: searchTerm, mode: 'insensitive' } },
        
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
      'updatedAt': 'updatedAt',
      'soldAt': 'soldAt',
      'invoiceNumber': 'invoiceNumber'
    };
    
    const dbSortField = sortFieldMap[sortBy] || 'createdAt';
    orderBy[dbSortField] = sortOrder === 'desc' ? 'desc' : 'asc';

    // Execute queries
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
      total: total,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
        hasNextPage: page < Math.ceil(total / limit),
        hasPrevPage: page > 1,
      },
      // Add metadata for frontend context
      filters: {
        productId: productId || null,
        status: status || null,
        type: type || null,
        search: search || null,
      }
    });
  } catch (error) {
    console.error('Inventory fetch error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      data: [],
      total: 0,
    });
  }
};

// Dedicated endpoint for getting inventory by product ID with enhanced filtering
const getInventoryByProductId = async (req, res) => {
  const { productId } = req.params;
  
  if (!isValidObjectId(productId)) {
    return res.status(400).json({
      success: false,
      message: 'Invalid product ID format'
    });
  }
  
  try {
    // First verify that the product exists
    const productExists = await Product.findById(productId);
    if (!productExists) {
      return res.status(404).json({
        success: false,
        message: 'Product not found in the database'
      });
    }

    // Parse query parameters for additional filtering
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const sortBy = req.query.sortBy || 'createdAt';
    const sortOrder = req.query.sortOrder || 'desc';
    const status = req.query.status;
    const type = req.query.type;
    const search = req.query.search;

    // Calculate skip for pagination
    const skip = (page - 1) * limit;

    // Build where clause
    const whereClause = { productId };
    
    // Add additional filters
    if (status) {
      whereClause.status = status;
    }
    
    if (type) {
      whereClause.type = type;
    }

    // Add search functionality
    if (search) {
      const searchTerm = search.trim();
      whereClause.OR = [
        { rollId: { contains: searchTerm, mode: 'insensitive' } },
        { status: { contains: searchTerm, mode: 'insensitive' } },
        { type: { contains: searchTerm, mode: 'insensitive' } },
        { invoiceNumber: { contains: searchTerm, mode: 'insensitive' } },
        
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

    // Build orderBy clause
    const orderBy = {};
    const sortFieldMap = {
      'rollId': 'rollId',
      'status': 'status',
      'type': 'type',
      'netWeight': 'netWeight',
      'width': 'width',
      'createdAt': 'createdAt',
      'updatedAt': 'updatedAt',
      'soldAt': 'soldAt',
      'invoiceNumber': 'invoiceNumber'
    };
    
    const dbSortField = sortFieldMap[sortBy] || 'createdAt';
    orderBy[dbSortField] = sortOrder === 'desc' ? 'desc' : 'asc';

    // Execute queries
    const inventory = await prisma.inventory.findMany({
      where: whereClause,
      skip,
      take: limit,
      orderBy,
    });

    const total = await prisma.inventory.count({
      where: whereClause,
    });
  
    res.json({
      success: true,
      data: inventory,
      total: total,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
        hasNextPage: page < Math.ceil(total / limit),
        hasPrevPage: page > 1,
      },
      // Include product information in response
      product: {
        _id: productExists._id,
        name: productExists.name,
      },
      filters: {
        productId: productId,
        status: status || null,
        type: type || null,
        search: search || null,
      }
    });
  } catch (error) {
    console.error(`Error fetching inventory for product ${productId}:`, error);
    res.status(500).json({
      success: false,
      error: error.message,
      data: [],
      total: 0,
    });
  }
};

// Get available inventory items for a specific product (helper for invoicing)
const getAvailableInventoryByProductId = async (req, res) => {
  const { productId } = req.params;
  
  if (!isValidObjectId(productId)) {
    return res.status(400).json({
      success: false,
      message: 'Invalid product ID format'
    });
  }
  
  try {
    // Verify product exists
    const productExists = await Product.findById(productId);
    if (!productExists) {
      return res.status(404).json({
        success: false,
        message: 'Product not found in the database'
      });
    }

    // Parse query parameters
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 1000; // Default to high limit for inventory selection
    const sortBy = req.query.sortBy || 'rollId';
    const sortOrder = req.query.sortOrder || 'asc';

    // Calculate skip for pagination
    const skip = (page - 1) * limit;

    // Build where clause for available items only
    const whereClause = { 
      productId,
      status: {
        in: ['available', 'reserved'] // Only show available and reserved items
      }
    };

    // Build orderBy clause
    const orderBy = {};
    const dbSortField = sortBy === 'rollId' ? 'rollId' : 'createdAt';
    orderBy[dbSortField] = sortOrder === 'desc' ? 'desc' : 'asc';

    // Execute queries
    const inventory = await prisma.inventory.findMany({
      where: whereClause,
      skip,
      take: limit,
      orderBy,
    });

    const total = await prisma.inventory.count({
      where: whereClause,
    });
   
    res.json({
      success: true,
      data: inventory,
      total: total,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
        hasNextPage: page < Math.ceil(total / limit),
        hasPrevPage: page > 1,
      },
      product: {
        _id: productExists._id,
        name: productExists.name,
      }
    });
  } catch (error) {
    console.error(`Error fetching available inventory for product ${productId}:`, error);
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

// Generate sequential rollId
const generateSequentialRollId = async (netWeight, width) => {
  const widthPrefix = width < 70 ? 'I' : 'M';
  const widthStr = Math.round(width * 100).toString().padStart(4, '0').slice(0, 4);
  const weightStr = Math.round(netWeight * 100).toString().padStart(4, '0').slice(0, 4);
  const basePattern = `${widthPrefix}${widthStr}${weightStr}`;

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

    // Final uniqueness check before insert
    const existing = await prisma.inventory.findUnique({
      where: { rollId: inventoryData.rollId },
    });
    if (existing) {
      return res.status(409).json({
        success: false,
        message: 'Generated rollId already exists. Please try again.',
      });
    }

    // Set default status to 'available' if not provided
    if (!inventoryData.status) {
      inventoryData.status = 'available';
    }

    // If status is 'sold', add soldAt timestamp
    if (inventoryData.status === 'sold') {
      inventoryData.soldAt = new Date();
    }

    const newInventory = await prisma.inventory.create({
      data: inventoryData,
    });

    res.status(201).json({
      success: true,
      data: newInventory,
    });
  } catch (error) {
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
  
  if (inventoryData.productId && !isValidObjectId(inventoryData.productId)) {
    return res.status(400).json({
      success: false,
      message: 'Invalid product ID format'
    });
  }
  
  try {
    const existingItem = await prisma.inventory.findUnique({
      where: { id }
    });
    
    if (!existingItem) {
      return res.status(404).json({
        success: false,
        message: 'Inventory item not found'
      });
    }
    
    if (inventoryData.productId) {
      const productExists = await Product.findById(inventoryData.productId);
      if (!productExists) {
        return res.status(404).json({
          success: false,
          message: 'Product not found in the database'
        });
      }
    }
    
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
    
    // Handle status changes
    if (inventoryData.status) {
      if (inventoryData.status === 'sold' && existingItem.status !== 'sold') {
        inventoryData.soldAt = new Date();
      }
      
      if (inventoryData.status !== 'sold' && existingItem.status === 'sold') {
        inventoryData.soldAt = null;
        inventoryData.invoiceNumber = null;
      }
    }
    
    const updatedInventory = await prisma.inventory.update({
      where: { id },
      data: inventoryData
    });
    
    res.json({
      success: true,
      data: updatedInventory
    });
  } catch (error) {
    if (error.code === 'P2025') {
      return res.status(404).json({
        success: false,
        message: 'Inventory item not found'
      });
    }
    
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
    const existingItem = await prisma.inventory.findUnique({
      where: { id }
    });
    
    if (!existingItem) {
      return res.status(404).json({
        success: false,
        message: 'Inventory item not found'
      });
    }
    
    if (existingItem.status === 'sold') {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete sold inventory items. Consider changing status instead.'
      });
    }
    
    await prisma.inventory.delete({
      where: { id }
    });
    
    res.json({
      success: true,
      message: `Inventory item with ID ${id} has been deleted`
    });
  } catch (error) {
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

// Get inventory by status
const getInventoryByStatus = async (req, res) => {
  const { status } = req.params;
  
  if (!['damaged', 'available', 'reserved', 'sold'].includes(status)) {
    return res.status(400).json({
      success: false,
      message: 'Invalid status. Must be one of: damaged, available, reserved, sold'
    });
  }
  
  try {
    const inventory = await prisma.inventory.findMany({
      where: { status },
      orderBy: status === 'sold' ? { soldAt: 'desc' } : { createdAt: 'desc' }
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

// Get sold inventory items
const getSoldInventory = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;
    
    const soldInventory = await prisma.inventory.findMany({
      where: { 
        status: 'sold' 
      },
      skip,
      take: limit,
      orderBy: { 
        soldAt: 'desc' 
      }
    });
    
    const total = await prisma.inventory.count({
      where: { status: 'sold' }
    });
    
    res.json({
      success: true,
      data: soldInventory,
      total,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
        hasNextPage: page < Math.ceil(total / limit),
        hasPrevPage: page > 1,
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

// Get inventory by invoice number
const getInventoryByInvoice = async (req, res) => {
  const { invoiceNumber } = req.params;
  
  try {
    const inventory = await prisma.inventory.findMany({
      where: { 
        invoiceNumber: invoiceNumber,
        status: 'sold'
      },
      orderBy: { rollId: 'asc' }
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

// Bulk update inventory status
const bulkUpdateInventoryStatus = async (req, res) => {
  const { rollIds, status, invoiceNumber } = req.body;
  
  if (!rollIds || !Array.isArray(rollIds) || rollIds.length === 0) {
    return res.status(400).json({
      success: false,
      message: 'Roll IDs array is required'
    });
  }
  
  if (!['damaged', 'available', 'reserved', 'sold'].includes(status)) {
    return res.status(400).json({
      success: false,
      message: 'Invalid status. Must be one of: damaged, available, reserved, sold'
    });
  }
  
  try {
    const updateData = { 
      status,
      updatedAt: new Date()
    };
    
    if (status === 'sold') {
      updateData.soldAt = new Date();
      if (invoiceNumber) {
        updateData.invoiceNumber = invoiceNumber;
      }
    }
    
    if (status === 'available') {
      updateData.invoiceNumber = null;
      updateData.soldAt = null;
    }
    
    const result = await prisma.inventory.updateMany({
      where: {
        rollId: { in: rollIds }
      },
      data: updateData
    });
    
    res.json({
      success: true,
      message: `Updated ${result.count} inventory items to status: ${status}`,
      updatedCount: result.count
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
  getAvailableInventoryByProductId, // New export
  getInventoryByStatus,
  getSoldInventory,
  getInventoryByInvoice,
  bulkUpdateInventoryStatus
};