const CustomerProduct = require("../models/cust-prod.models");
const Product = require("../models/product.models");
const Customer = require("../models/customer.models");

// getAllCustomerProducts function
// getAllCustomerProducts function
const getAllCustomerProducts = async (req, res, next) => {
  try {
    let response = await CustomerProduct.find()
      .populate("customer") // Populate customer details
      .populate("products.product") // Populate product details inside the products array
      .exec();
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


// getCustomerProductsbyId function
const getCustomerProductsbyId = async (req, res, next) => {
  const id = req.params.id;
  try {
    // Fetch a single customer product (invoice) and populate customer and product details
    let response = await CustomerProduct.findById(id)
      .populate('customer') // Populate customer details
      .populate('products.product') // Populate the product details for each product in the products array
      .exec();
    
    if (!response) {
      return res.status(404).json({
        success: false,
        message: "CustomerProduct not found",
      });
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
  const { customer, products, otherCharges, cgst, sgst, grandTotal } = req.body;

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
      const { product, width, quantity, unitPrice, totalPrice } = productData;

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
        unit_price: parseFloat(unitPrice),
        total_price: parseFloat(totalPrice),
      });

      // Update total amount for the invoice
      calculatedTotalAmount += totalPrice;

      // Update product inventory
      let newQuantity = ProductInfo.quantity - quantity;
      await Product.findByIdAndUpdate(product._id, { quantity: newQuantity });
    }

    // Calculate grand total without affecting CGST and SGST
    const totalWithOtherCharges = calculatedTotalAmount + (parseFloat(otherCharges) || 0);

    // Use CGST and SGST values directly from the request body
    const cgstAmount = parseFloat(cgst) || 0;
    const sgstAmount = parseFloat(sgst) || 0;

    // Create the invoice
    let createdInvoice = await CustomerProduct.create({
      customer: customer._id,
      products: invoiceProducts,
      otherCharges: parseFloat(otherCharges) || 0,
      cgst: cgstAmount,
      sgst: sgstAmount,
      totalAmount: calculatedTotalAmount,
      grandTotal: parseFloat(grandTotal),
    });

    // Respond with the created invoice
    return res.status(201).json({
      success: true,
      data: createdInvoice,
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
    // Validate the presence of products if provided
    if (updatedData.products && (!Array.isArray(updatedData.products) || updatedData.products.length === 0)) {
      return res.status(400).json({
        success: false,
        message: "You must provide a valid array of products",
      });
    }

    // Validate products data
    let totalAmount = 0;
    const updatedProducts = [];

    if (updatedData.products) {
      for (const productData of updatedData.products) {
        const { product, width, quantity, unit_price, total_price } = productData;

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
        if (isNaN(unit_price) || parseFloat(unit_price) <= 0) {
          return res.status(400).json({
            success: false,
            message: "Unit price must be a positive number for each product",
          });
        }
        if (isNaN(total_price) || parseFloat(total_price) <= 0) {
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
          total_price: parseFloat(total_price),
        });

        // Update total amount
        totalAmount += parseFloat(total_price);
      }
    }

    // Directly use CGST and SGST values from the request body (no calculation)
    const otherCharges = parseFloat(updatedData.otherCharges) || 0;
    const cgstAmount = parseFloat(updatedData.cgst) || 0;
    const sgstAmount = parseFloat(updatedData.sgst) || 0;

    const totalWithOtherCharges = totalAmount + otherCharges;
    const grandTotal = Math.round(totalWithOtherCharges + cgstAmount + sgstAmount);

    // Prepare updated invoice data
    const newInvoiceData = {
      ...updatedData,
      products: updatedProducts.length > 0 ? updatedProducts : undefined,
      totalAmount: totalAmount,
      grandTotal: grandTotal,
      cgst: cgstAmount, // Keep CGST from the request body as is
      sgst: sgstAmount, // Keep SGST from the request body as is
    };

    // Update the invoice in the database
    let response = await CustomerProduct.findByIdAndUpdate(pid, newInvoiceData, { new: true });

    if (!response) {
      return res.status(404).json({
        success: false,
        message: "CustomerProduct not found",
      });
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

const deleteCustomerProducts = async (req, res, next) => {
  const pid = req.params.id;

  try {
    // Check if the ID is valid
    if (!pid || pid.length !== 24) { // MongoDB ObjectId is 24 characters long
      return res.status(400).json({
        success: false,
        message: "Invalid or missing CustomerProduct ID",
      });
    }

    // Check if the document exists
    const product = await CustomerProduct.findById(pid);
    if (!product) {
      return res.status(404).json({
        success: false,
        message: "CustomerProduct not found",
      });
    }

    // Delete the document
    const response = await CustomerProduct.findByIdAndDelete(pid);
    if (!response) {
      return res.status(500).json({
        success: false,
        message: "Failed to delete CustomerProduct",
      });
    }

    // Respond with success
    res.json({
      success: true,
      data: response,
      message: `CustomerProduct with id ${pid} deleted successfully`,
    });
  } catch (error) {
    console.error("Error deleting CustomerProduct:", error.message);
    res.status(500).json({
      success: false,
      error: error.message,
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
};
