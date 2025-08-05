const CustomerProduct = require("../models/cust-prod.models");
const Product = require("../models/product.models");
const Customer = require("../models/customer.models");
const Counter = require("../models/counter.models");
const prisma = require('../config/prisma'); // Add prisma for inventory operations

// Helper function to validate roll IDs
const validateRollIds = async (rollIds) => {
  if (!rollIds || rollIds.length === 0) return { valid: true, errors: [] };
  
  const errors = [];
  const validRollIds = [];
  
  for (const rollId of rollIds) {
    try {
      const inventoryItem = await prisma.inventory.findUnique({
        where: { rollId: rollId.trim() }
      });
      
      if (!inventoryItem) {
        errors.push(`Roll ID ${rollId} not found in inventory`);
      } else if (inventoryItem.status === 'sold') {
        errors.push(`Roll ID ${rollId} is already sold`);
      } else if (inventoryItem.status === 'damaged') {
        errors.push(`Roll ID ${rollId} is marked as damaged and cannot be sold`);
      } else {
        validRollIds.push(rollId.trim());
      }
    } catch (error) {
      errors.push(`Error validating Roll ID ${rollId}: ${error.message}`);
    }
  }
  
  return { valid: errors.length === 0, errors, validRollIds };
};

// Helper function to update inventory status
const updateInventoryStatus = async (rollIds, status, invoiceNumber = null) => {
  if (!rollIds || rollIds.length === 0) return;
  
  try {
    const updateData = { 
      status,
      updatedAt: new Date()
    };
    
    // Add invoice reference when marking as sold
    if (status === 'sold' && invoiceNumber) {
      updateData.invoiceNumber = invoiceNumber;
      updateData.soldAt = new Date();
    }
    
    // Remove invoice reference when marking as available
    if (status === 'available') {
      updateData.invoiceNumber = null;
      updateData.soldAt = null;
    }
    
    await prisma.inventory.updateMany({
      where: {
        rollId: { in: rollIds }
      },
      data: updateData
    });
    
  } catch (error) {
    console.error('Error updating inventory status:', error);
    throw error;
  }
};

// getAllCustomerProducts function
const getAllCustomerProducts = async (req, res, next) => {
  try {
    // Extract pagination and sorting parameters from query
    const page = parseInt(req.query.page) || 1;
    const itemsPerPage = parseInt(req.query.itemsPerPage) || 10;
    const sortBy = req.query.sortBy || 'createdAt';
    const sortDesc = req.query.sortDesc === 'true';
    const search = req.query.search || '';
    
    // Calculate skip value for pagination
    const skip = (page - 1) * itemsPerPage;
    
    // Prepare sort object for MongoDB
    const sort = {};
    sort[sortBy] = sortDesc ? -1 : 1;
    
    // Prepare search filter if search term exists
    let filter = {};
    if (search && search.trim() !== '') {
      // Create a regex pattern for the search term
      const searchPattern = new RegExp(search.trim(), 'i');
      
      // First, find all customers matching the search pattern
      const matchingCustomers = await Customer.find({
        $or: [
          { name: searchPattern },
          { email: searchPattern },
          { phone: searchPattern }
        ]
      }).select('_id');
      
      const customerIds = matchingCustomers.map(customer => customer._id);
      
      // Then create a filter that searches both invoice numbers, roll IDs, and customer IDs
      filter = {
        $or: [
          { invoiceNumber: searchPattern },
          { rollIds: { $in: [searchPattern] } }, // Search in roll IDs array
          { customer: { $in: customerIds } }
        ]
      };
    }
    
    // Get total count for pagination
    const totalItems = await CustomerProduct.countDocuments(filter);
    
    // Fetch paginated and sorted data
    let response = await CustomerProduct.find(filter)
      .populate("customer")
      .populate("products.product")
      .sort(sort)
      .skip(skip)
      .limit(itemsPerPage)
      .exec();
    
    res.json({
      success: true,
      data: response,
      pagination: {
        page,
        itemsPerPage,
        totalItems,
        totalPages: Math.ceil(totalItems / itemsPerPage)
      }
    });
  } catch (error) {
    console.error("Error in getAllCustomerProducts:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};

// getCustomerProductsbyId function
const getCustomerProductsbyId = async (req, res, next) => {
  const id = req.params.id;
  try {
    // Fetch a single customer product (invoice) and populate customer and product details
    let response = await CustomerProduct.findById(id)
      .populate("customer")
      .populate("products.product")
      .exec();

    if (!response) {
      return res.status(404).json({
        success: false,
        message: "CustomerProduct not found",
      });
    }

    // If invoice has roll IDs, get inventory details
    if (response.rollIds && response.rollIds.length > 0) {
      try {
        const inventoryItems = await prisma.inventory.findMany({
          where: {
            rollId: { in: response.rollIds }
          }
        });
        
        response = response.toObject();
        response.inventoryDetails = inventoryItems;
      } catch (error) {
        console.error('Error fetching inventory details:', error);
        // Continue without inventory details
      }
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
  const { customer, products, otherCharges, cgst, sgst, igst, grandTotal, rollIds } = req.body;

  if (!customer || !customer._id) {
    return res.status(400).json({
      success: false,
      message: "Customer data is required and must have an _id",
    });
  }

  if (!Array.isArray(products) || products.length === 0) {
    return res.status(400).json({
      success: false,
      message: "You must provide an array of products",
    });
  }

  if (isNaN(grandTotal) || parseFloat(grandTotal) <= 0) {
    return res.status(400).json({
      success: false,
      message: "Grand Total must be a positive number",
    });
  }

  // Validate roll IDs if provided
  if (rollIds && Array.isArray(rollIds) && rollIds.length > 0) {
    const rollIdValidation = await validateRollIds(rollIds);
    if (!rollIdValidation.valid) {
      return res.status(400).json({
        success: false,
        message: "Roll ID validation failed",
        errors: rollIdValidation.errors
      });
    }
  }

  try {
    let CustomerInfo = await Customer.findById(customer._id);
    if (!CustomerInfo) {
      return res.status(404).json({
        success: false,
        message: `Customer with ID ${customer._id} not found`,
      });
    }

    const invoiceProducts = [];
    let calculatedTotalAmount = 0;

    for (const productData of products) {
      const { product, width, quantity, unit_price, totalPrice } = productData;

      if (isNaN(quantity) || parseInt(quantity) <= 0) {
        return res.status(400).json({
          success: false,
          message: "Quantity must be a positive number for each product",
        });
      }

      let ProductInfo = await Product.findById(product._id);
      if (!ProductInfo) {
        return res.status(404).json({
          success: false,
          message: `Product with ID ${product._id} not found`,
        });
      }

      if (quantity > ProductInfo.quantity) {
        return res.status(400).json({
          success: false,
          message: `Insufficient stock for product ${ProductInfo.name}`,
        });
      }

      // Add product details to the invoice
      invoiceProducts.push({
        product: product._id,
        name: ProductInfo.name,
        hsn_code: ProductInfo.hsn_code,
        width,
        quantity,
        desc: ProductInfo.desc,
        price: ProductInfo.price,
        unit_price: parseFloat(unit_price),
        total_price: parseFloat(totalPrice),
      });

      // Update total amount for the invoice
      calculatedTotalAmount += totalPrice;

      // Update product inventory
      let newQuantity = ProductInfo.quantity - quantity;
      await Product.findByIdAndUpdate(product._id, { quantity: newQuantity });
    }

    // Calculate total amount with other charges
    const totalWithOtherCharges = calculatedTotalAmount + (parseFloat(otherCharges) || 0);

    // Use tax values directly from the request body
    const cgstAmount = parseFloat(cgst) || 0;
    const sgstAmount = parseFloat(sgst) || 0;
    const igstAmount = parseFloat(igst) || 0;

    // Generate unique invoice number using the counter
    let counter = await Counter.findOneAndUpdate(
      { name: "invoiceNumber" },
      { $inc: { value: 1 } },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    // If the counter doesn't exist, set the initial value to 787
    if (counter.value === 1) {
      counter = await Counter.findOneAndUpdate(
        { name: "invoiceNumber" },
        { value: 1 },
        { new: true }
      );
    }

    // Get current date and format financial year
    const currentDate = new Date();
    let financialYearStart, financialYearEnd;
    
    if (currentDate.getMonth() < 3) {
      financialYearStart = currentDate.getFullYear() - 1;
      financialYearEnd = currentDate.getFullYear();
    } else {
      financialYearStart = currentDate.getFullYear();
      financialYearEnd = currentDate.getFullYear() + 1;
    }
    
    const formattedYear = `${financialYearStart.toString().slice(-2)}-${financialYearEnd.toString().slice(-2)}`;
    const invoiceNumber = `HT/${counter.value.toString().padStart(4, '0')}/20${formattedYear}`;

    // Prepare invoice data
    const invoiceData = {
      invoiceNumber,
      customer: customer._id,
      products: invoiceProducts,
      otherCharges: parseFloat(otherCharges) || 0,
      cgst: cgstAmount,
      sgst: sgstAmount,
      igst: igstAmount,
      totalAmount: calculatedTotalAmount,
      grandTotal: parseFloat(grandTotal),
    };

    // Add roll IDs if provided
    if (rollIds && Array.isArray(rollIds) && rollIds.length > 0) {
      const cleanRollIds = rollIds.map(id => id.trim()).filter(id => id.length > 0);
      if (cleanRollIds.length > 0) {
        invoiceData.rollIds = cleanRollIds;
      }
    }

    // Create the invoice
    let createdInvoice = await CustomerProduct.create(invoiceData);

    // Update inventory status to 'sold' if roll IDs are provided
    if (invoiceData.rollIds && invoiceData.rollIds.length > 0) {
      try {
        await updateInventoryStatus(invoiceData.rollIds, 'sold', invoiceNumber);
      } catch (inventoryError) {
        console.error('Error updating inventory status:', inventoryError);
        // Consider whether to rollback the invoice creation or continue
        // For now, we'll continue but log the error
      }
    }

    // Respond with the created invoice
    return res.status(201).json({
      success: true,
      data: createdInvoice,
      message: invoiceData.rollIds ? 
        `Invoice created and ${invoiceData.rollIds.length} inventory items marked as sold` : 
        'Invoice created successfully'
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};

const updateCustomerProducts = async (req, res, next) => {
  const updatedData = req.body;
  const pid = req.params.id;

  try {
    // Check if the ID is valid
    if (!pid || pid.length !== 24) {
      return res.status(400).json({
        success: false,
        message: "Invalid or missing CustomerProduct ID",
      });
    }

    // Get the existing invoice to compare roll IDs
    const existingInvoice = await CustomerProduct.findById(pid);
    if (!existingInvoice) {
      return res.status(404).json({
        success: false,
        message: "CustomerProduct not found",
      });
    }

    // Validate new roll IDs if provided
    if (updatedData.rollIds && Array.isArray(updatedData.rollIds) && updatedData.rollIds.length > 0) {
      const rollIdValidation = await validateRollIds(updatedData.rollIds);
      if (!rollIdValidation.valid) {
        return res.status(400).json({
          success: false,
          message: "Roll ID validation failed",
          errors: rollIdValidation.errors
        });
      }
    }

    // Initialize totalAmount and updatedProducts
    let totalAmount = 0;
    const updatedProducts = [];

    if (updatedData.products && Array.isArray(updatedData.products)) {
      for (const productData of updatedData.products) {
        const { product, width, quantity, unit_price, totalPrice } = productData;

        // Validate product fields
        if (width && isNaN(width)) {
          return res.status(400).json({
            success: false,
            message: "Width must be a valid number for each product",
          });
        }
        if (isNaN(quantity) || parseInt(quantity) <= 0) {
          return res.status(400).json({
            success: false,
            message: "Quantity must be a positive number for each product",
          });
        }
        if (isNaN(unit_price)) {
          return res.status(400).json({
            success: false,
            message: "Unit price must be a number for each product",
          });
        }
        if (isNaN(totalPrice) || parseFloat(totalPrice) <= 0) {
          return res.status(400).json({
            success: false,
            message: "Total price must be a positive number for each product",
          });
        }

        // Add the product details to the updated products list
        updatedProducts.push({
          product,
          width,
          quantity,
          unit_price: parseFloat(unit_price),
          totalPrice: parseFloat(totalPrice),
        });

        // Update total amount
        totalAmount += parseFloat(totalPrice);
      }
    }

    // Use tax values directly from the request body
    const otherCharges = parseFloat(updatedData.otherCharges) || 0;
    const cgstAmount = parseFloat(updatedData.cgst) || 0;
    const sgstAmount = parseFloat(updatedData.sgst) || 0;
    const igstAmount = parseFloat(updatedData.igst) || 0;

    // Calculate grand total including all applicable taxes
    const totalWithOtherCharges = totalAmount + otherCharges;
    const grandTotal = Math.round(totalWithOtherCharges + cgstAmount + sgstAmount + igstAmount);

    // Prepare updated invoice data
    const newInvoiceData = {
      ...updatedData,
      products: updatedProducts.length > 0 ? updatedProducts : undefined,
      totalAmount,
      grandTotal,
      cgst: cgstAmount,
      sgst: sgstAmount,
      igst: igstAmount
    };

    // Handle roll ID changes
    const oldRollIds = existingInvoice.rollIds || [];
    const newRollIds = updatedData.rollIds ? 
      updatedData.rollIds.map(id => id.trim()).filter(id => id.length > 0) : [];

    // Update the invoice in the database
    let response = await CustomerProduct.findByIdAndUpdate(pid, newInvoiceData, { new: true });

    if (!response) {
      return res.status(404).json({
        success: false,
        message: "CustomerProduct not found",
      });
    }

    // Update inventory status based on roll ID changes
    try {
      // Find roll IDs that were removed (mark as available)
      const removedRollIds = oldRollIds.filter(id => !newRollIds.includes(id));
      if (removedRollIds.length > 0) {
        await updateInventoryStatus(removedRollIds, 'available');
      }

      // Find roll IDs that were added (mark as sold)
      const addedRollIds = newRollIds.filter(id => !oldRollIds.includes(id));
      if (addedRollIds.length > 0) {
        await updateInventoryStatus(addedRollIds, 'sold', existingInvoice.invoiceNumber);
      }
    } catch (inventoryError) {
      console.error('Error updating inventory status during update:', inventoryError);
      // Continue with the response but log the error
    }

    res.json({
      success: true,
      data: response,
      message: 'Invoice updated successfully'
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
    // Check if the ID is valid
    if (!pid || pid.length !== 24) {
      return res.status(400).json({
        success: false,
        message: "Invalid or missing CustomerProduct ID",
      });
    }

    // Check if the document exists and get roll IDs
    const invoice = await CustomerProduct.findById(pid);
    if (!invoice) {
      return res.status(404).json({
        success: false,
        message: "CustomerProduct not found",
      });
    }

    // Store roll IDs before deletion
    const rollIds = invoice.rollIds || [];

    // Delete the document
    const response = await CustomerProduct.findByIdAndDelete(pid);
    if (!response) {
      return res.status(500).json({
        success: false,
        message: "Failed to delete CustomerProduct",
      });
    }

    // Update inventory status to 'available' for associated roll IDs
    if (rollIds.length > 0) {
      try {
        await updateInventoryStatus(rollIds, 'available');
      } catch (inventoryError) {
        console.error('Error updating inventory status during deletion:', inventoryError);
        // Continue with the response but log the error
      }
    }

    // Respond with success
    res.json({
      success: true,
      data: response,
      message: `CustomerProduct with id ${pid} deleted successfully${rollIds.length > 0 ? ` and ${rollIds.length} inventory items marked as available` : ''}`,
    });
  } catch (error) {
    console.error("Error deleting CustomerProduct:", error.message);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};

const resetCounter = async (req, res) => {
  try {
    const updatedCounter = await Counter.findOneAndUpdate(
      { name: "invoiceNumber" },
      { value: 5 },
      { new: true, upsert: true }
    );

    res.json({
      success: true,
      message: "Counter reset successfully",
      data: updatedCounter,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};

// New function to get available roll IDs for a specific product
const getAvailableRollIds = async (req, res) => {
  const { productId } = req.params;
  
  try {
    const availableInventory = await prisma.inventory.findMany({
      where: {
        productId: productId,
        status: 'available'
      },
      select: {
        rollId: true,
        netWeight: true,
        width: true,
        micron: true
      },
      orderBy: {
        rollId: 'asc'
      }
    });

    res.json({
      success: true,
      data: availableInventory
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
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
  resetCounter,
  getAvailableRollIds
};