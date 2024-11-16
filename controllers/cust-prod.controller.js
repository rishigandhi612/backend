const CustomerProduct = require("../models/cust-prod.models");
const Product = require("../models/product.models");
const Customer = require("../models/customer.models");

const getAllCustomerProducts = async (req, res, next) => {
  try {
    let response = await CustomerProduct.find()
      .populate("customer")
      .populate("product")
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

const getCustomerProductsbyId = async (req, res, next) => {
  const id = req.params.id;
  try {
    let response = await CustomerProduct.findById(id)
      .populate("customer")
      .populate("product")
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
  const { customer, products } = req.body; // Extract customer and products from the request body

  // Validate customer data
  if (!customer || !customer._id) {
    return res.status(400).json({
      success: false,
      message: "Customer data is required and must have an _id",
    });
  }

  // Validate products array
  if (!Array.isArray(products) || products.length === 0) {
    return res.status(400).json({
      success: false,
      message: "You must provide an array of products",
    });
  }

  try {
    // Fetch customer info from the database
    let CustomerInfo = await Customer.findById(customer._id);
    if (!CustomerInfo) {
      return res.status(404).json({
        success: false,
        message: `Customer with ID ${customer._id} not found`,
      });
    }

    // Array to hold product details for the invoice
    const invoiceProducts = [];

    // Process each product in the request
    for (const productData of products) {
      const { product, quantity, unitPrice } = productData;

      // Validate product quantity and unit price
      if (isNaN(quantity) || parseInt(quantity) <= 0) {
        return res.status(400).json({
          success: false,
          message: "Quantity must be a positive number for each product",
        });
      }
      if (isNaN(unitPrice) || parseFloat(unitPrice) <= 0) {
        return res.status(400).json({
          success: false,
          message: "Unit price must be a positive number for each product",
        });
      }

      // Fetch product info from the database
      let ProductInfo = await Product.findById(product._id);
      if (!ProductInfo) {
        return res.status(404).json({
          success: false,
          message: `Product with ID ${product._id} not found`,
        });
      }

      // Check stock availability
      if (quantity > ProductInfo.quantity) {
        return res.status(400).json({
          success: false,
          message: `Insufficient stock for product ${ProductInfo.name}`,
        });
      }

      // Add the full product details (including name, hsn_code, desc, and price) to the invoice products array
      invoiceProducts.push({
        product: product._id,
        name: ProductInfo.name,        // Add product name
        hsn_code: ProductInfo.hsn_code, // Add product HSN code
        quantity,                      // Quantity ordered
        desc: ProductInfo.desc,        // Product description
        price: ProductInfo.price,      // Product price
        unit_price: parseFloat(unitPrice), // Unit price sent by the user
      });

      // Update product inventory after order processing
      let newQuantity = ProductInfo.quantity - quantity;
      await Product.findByIdAndUpdate(product._id, { quantity: newQuantity });
    }

    // Create the CustomerProduct with all product details
    let createdInvoice = await CustomerProduct.create({
      customer: customer._id,
      products: invoiceProducts, // Include all products in one invoice
      totalAmount: invoiceProducts.reduce((total, item) => total + (item.quantity * item.unit_price), 0), // Calculate total amount
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
  const newcustomerData = req.body;
  const pid = req.params.id;
  try {
    if (newcustomerData.unit_price && isNaN(newcustomerData.unit_price)) {
      return res.status(400).json({
        success: false,
        message: "Unit price must be a valid number",
      });
    }
    let response = await CustomerProduct.findByIdAndUpdate(pid, newcustomerData, { new: true });
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
    let response = await CustomerProduct.findByIdAndDelete(pid);
    if (!response) {
      return res.status(404).json({
        success: false,
        message: "CustomerProduct not found",
      });
    }
    res.json({
      success: true,
      data: response,
      message: "CustomerProduct deleted whose id was " + pid,
    });
  } catch (error) {
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
