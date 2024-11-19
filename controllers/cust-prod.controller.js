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

    // Variable to calculate the total amount for the invoice (if not sent)
    let calculatedTotalAmount = 0;

    // Process each product in the request
    for (const productData of products) {
      const { product, width, quantity, unitPrice, totalPrice } = productData;
      // Validate product width
      if (width && isNaN(width)) {
        return res.status(400).json({
          success: false,
          message: "Width must be a valid number for each product",
        });
      }
      
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
      if (isNaN(totalPrice) || parseFloat(totalPrice) <= 0) {
        return res.status(400).json({
          success: false,
          message: "Total price must be a positive number for each product",
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
        width,
        quantity,                      // Quantity ordered
        desc: ProductInfo.desc,        // Product description
        price: ProductInfo.price,      // Product price (from the Product document)
        unit_price: parseFloat(unitPrice), // Unit price sent by the user
        total_price: parseFloat(totalPrice), // Total price sent by the user
      });

      // Update total amount for the invoice
      calculatedTotalAmount += totalPrice;

      // Update product inventory after order processing
      let newQuantity = ProductInfo.quantity - quantity;
      await Product.findByIdAndUpdate(product._id, { quantity: newQuantity });
    }

    // Create the CustomerProduct with all product details
    let createdInvoice = await CustomerProduct.create({
      customer: customer._id,
      products: invoiceProducts, // Include all products in one invoice
      totalAmount: calculatedTotalAmount, // Use calculated total amount
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
