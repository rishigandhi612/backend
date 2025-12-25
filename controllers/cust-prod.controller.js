const CustomerProduct = require("../models/cust-prod.models");
const Product = require("../models/product.models");
const Customer = require("../models/customer.models");
const Counter = require("../models/counter.models");
const prisma = require("../config/prisma"); // Add prisma for inventory operations

const Transporter = require("../models/transport.models");

// Helper function to validate roll IDs
const validateRollIds = async (rollIds) => {
  if (!rollIds || rollIds.length === 0) return { valid: true, errors: [] };

  const errors = [];
  const validRollIds = [];

  for (const rollId of rollIds) {
    try {
      const inventoryItem = await prisma.inventory.findUnique({
        where: { rollId: rollId.trim() },
      });

      if (!inventoryItem) {
        errors.push(`Roll ID ${rollId} not found in inventory`);
      } else if (inventoryItem.status === "sold") {
        errors.push(`Roll ID ${rollId} is already sold`);
      } else if (inventoryItem.status === "damaged") {
        errors.push(
          `Roll ID ${rollId} is marked as damaged and cannot be sold`
        );
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
      updatedAt: new Date(),
    };

    // Add invoice reference when marking as sold
    if (status === "sold" && invoiceNumber) {
      updateData.invoiceNumber = invoiceNumber;
      updateData.soldAt = new Date();
    }

    // Remove invoice reference when marking as available
    if (status === "available") {
      updateData.invoiceNumber = null;
      updateData.soldAt = null;
    }

    await prisma.inventory.updateMany({
      where: {
        rollId: { in: rollIds },
      },
      data: updateData,
    });
  } catch (error) {
    console.error("Error updating inventory status:", error);
    throw error;
  }
};

// getAllCustomerProducts function
const getAllCustomerProducts = async (req, res, next) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const itemsPerPage = parseInt(req.query.itemsPerPage) || 10;
    const sortBy = req.query.sortBy || "createdAt";
    const sortDesc = req.query.sortDesc === "true";
    const search = req.query.search || "";
    const skip = (page - 1) * itemsPerPage;

    const sort = {};
    sort[sortBy] = sortDesc ? -1 : 1;

    let filter = {};
    if (search && search.trim() !== "") {
      const searchPattern = new RegExp(search.trim(), "i");
      const matchingCustomers = await Customer.find({
        $or: [
          { name: searchPattern },
          { email: searchPattern },
          { phone: searchPattern },
        ],
      }).select("_id");

      const customerIds = matchingCustomers.map((customer) => customer._id);

      filter = {
        $or: [
          { invoiceNumber: searchPattern },
          { rollIds: { $in: [searchPattern] } },
          { customer: { $in: customerIds } },
        ],
      };
    }

    const totalItems = await CustomerProduct.countDocuments(filter);

    let response = await CustomerProduct.find(filter)
      .populate("customer")
      .populate("products.product")
      .populate("transporter")
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
        totalPages: Math.ceil(totalItems / itemsPerPage),
      },
    });
  } catch (error) {
    console.error("Error in getAllCustomerProducts:", error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// getCustomerProductsbyId function
const getCustomerProductsbyId = async (req, res, next) => {
  const id = req.params.id;
  try {
    let response = await CustomerProduct.findById(id)
      .populate("customer")
      .populate("products.product")
      .populate("transporter") // ✅ Added transporter populate
      .exec();

    if (!response) {
      return res
        .status(404)
        .json({ success: false, message: "CustomerProduct not found" });
    }

    if (response.rollIds && response.rollIds.length > 0) {
      try {
        const inventoryItems = await prisma.inventory.findMany({
          where: { rollId: { in: response.rollIds } },
        });

        response = response.toObject();
        response.inventoryDetails = inventoryItems;
      } catch (error) {
        console.error("Error fetching inventory details:", error);
      }
    }

    res.json({ success: true, data: response });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

const createCustomerProducts = async (req, res, next) => {
  const {
    customer,
    products,
    otherCharges,
    cgst,
    sgst,
    igst,
    grandTotal,
    rollIds,
    transporter,
  } = req.body; // ✅ transporter in body

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

  if (rollIds && Array.isArray(rollIds) && rollIds.length > 0) {
    const rollIdValidation = await validateRollIds(rollIds);
    if (!rollIdValidation.valid) {
      return res.status(400).json({
        success: false,
        message: "Roll ID validation failed",
        errors: rollIdValidation.errors,
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

    // ✅ Validate transporter if provided
    if (transporter) {
      const transporterExists = await Transporter.findById(transporter);
      if (!transporterExists) {
        return res.status(400).json({
          success: false,
          message: `Transporter with ID ${transporter} not found`,
        });
      }
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

      // if (quantity > ProductInfo.quantity) {
      //   return res.status(400).json({
      //   success: false,
      //  message: `Insufficient stock for product ${ProductInfo.name}`,
      //   });
      // }

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

      calculatedTotalAmount += totalPrice;
      let newQuantity = ProductInfo.quantity - quantity;
      await Product.findByIdAndUpdate(product._id, { quantity: newQuantity });
    }

    const totalWithOtherCharges =
      calculatedTotalAmount + (parseFloat(otherCharges) || 0);
    const cgstAmount = parseFloat(cgst) || 0;
    const sgstAmount = parseFloat(sgst) || 0;
    const igstAmount = parseFloat(igst) || 0;

    let counter = await Counter.findOneAndUpdate(
      { name: "invoiceNumber" },
      { $inc: { value: 1 } },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    // If the counter doesn't exist, set the initial value to
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
    const formattedYear = `${financialYearStart
      .toString()
      .slice(-2)}-${financialYearEnd.toString().slice(-2)}`;
    const invoiceNumber = `HT/${counter.value
      .toString()
      .padStart(4, "0")}/20${formattedYear}`;

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

    if (rollIds && Array.isArray(rollIds) && rollIds.length > 0) {
      const cleanRollIds = rollIds
        .map((id) => id.trim())
        .filter((id) => id.length > 0);
      if (cleanRollIds.length > 0) invoiceData.rollIds = cleanRollIds;
    }

    if (transporter) {
      invoiceData.transporter = transporter; // ✅ save transporter
    }

    let createdInvoice = await CustomerProduct.create(invoiceData);

    if (invoiceData.rollIds && invoiceData.rollIds.length > 0) {
      try {
        await updateInventoryStatus(invoiceData.rollIds, "sold", invoiceNumber);
      } catch (inventoryError) {
        console.error("Error updating inventory status:", inventoryError);
      }
    }
    createdInvoice = await CustomerProduct.findByIdAndUpdate(
      createdInvoice._id,
      {
        $set: {
          paidAmount: 0,
          pendingAmount: parseFloat(grandTotal),
          paymentStatus: "UNPAID",
        },
      },
      { new: true }
    );
    return res.status(201).json({
      success: true,
      data: createdInvoice,
      message: invoiceData.rollIds
        ? `Invoice created and ${invoiceData.rollIds.length} inventory items marked as sold`
        : "Invoice created successfully",
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

const updateCustomerProducts = async (req, res, next) => {
  const updatedData = req.body;
  const pid = req.params.id;

  try {
    if (!pid || pid.length !== 24) {
      return res.status(400).json({
        success: false,
        message: "Invalid or missing CustomerProduct ID",
      });
    }

    const existingInvoice = await CustomerProduct.findById(pid);
    if (!existingInvoice) {
      return res
        .status(404)
        .json({ success: false, message: "CustomerProduct not found" });
    }

    // FIX 1: Deduplicate roll IDs
    const newRollIds = updatedData.rollIds
      ? [
          ...new Set(
            updatedData.rollIds
              .map((id) => id.trim())
              .filter((id) => id.length > 0)
          ),
        ]
      : [];

    // FIX 2: Validate with current invoice context
    if (newRollIds.length > 0) {
      const rollIdValidation = await validateRollIdsForUpdate(
        newRollIds,
        existingInvoice.invoiceNumber
      );
      if (!rollIdValidation.valid) {
        return res.status(400).json({
          success: false,
          message: "Roll ID validation failed",
          errors: rollIdValidation.errors,
        });
      }
    }

    // Validate transporter if provided
    if (updatedData.transporter) {
      const transporterExists = await Transporter.findById(
        updatedData.transporter
      );
      if (!transporterExists) {
        return res.status(400).json({
          success: false,
          message: `Transporter with ID ${updatedData.transporter} not found`,
        });
      }
    }

    // Calculate totals and prepare invoice data
    let totalAmount = 0;
    const updatedProducts = [];

    if (updatedData.products && Array.isArray(updatedData.products)) {
      for (const productData of updatedData.products) {
        const { product, width, quantity, unit_price, totalPrice } =
          productData;

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

        updatedProducts.push({
          product,
          width,
          quantity,
          unit_price: parseFloat(unit_price),
          totalPrice: parseFloat(totalPrice),
        });

        totalAmount += parseFloat(totalPrice);
      }
    }

    const otherCharges = parseFloat(updatedData.otherCharges) || 0;
    const cgstAmount = parseFloat(updatedData.cgst) || 0;
    const sgstAmount = parseFloat(updatedData.sgst) || 0;
    const igstAmount = parseFloat(updatedData.igst) || 0;

    const totalWithOtherCharges = totalAmount + otherCharges;
    const grandTotal = Math.round(
      totalWithOtherCharges + cgstAmount + sgstAmount + igstAmount
    );

    const newInvoiceData = {
      ...updatedData,
      products: updatedProducts.length > 0 ? updatedProducts : undefined,
      totalAmount,
      grandTotal,
      cgst: cgstAmount,
      sgst: sgstAmount,
      igst: igstAmount,
    };

    // Calculate roll ID changes
    const oldRollIds = existingInvoice.rollIds || [];
    const removedRollIds = oldRollIds.filter((id) => !newRollIds.includes(id));
    const addedRollIds = newRollIds.filter((id) => !oldRollIds.includes(id));

    // FIX 3: Update inventory BEFORE invoice update with rollback capability
    let inventoryUpdateSuccess = false;
    try {
      // Re-validate just before updating (prevents race conditions)
      if (addedRollIds.length > 0) {
        const finalValidation = await validateRollIdsForUpdate(
          addedRollIds,
          existingInvoice.invoiceNumber
        );
        if (!finalValidation.valid) {
          return res.status(400).json({
            success: false,
            message: "Roll IDs became unavailable during update",
            errors: finalValidation.errors,
          });
        }
      }

      // Update inventory status
      if (removedRollIds.length > 0) {
        await updateInventoryStatus(removedRollIds, "available");
      }

      if (addedRollIds.length > 0) {
        await updateInventoryStatus(
          addedRollIds,
          "sold",
          existingInvoice.invoiceNumber
        );
      }

      inventoryUpdateSuccess = true;
    } catch (inventoryError) {
      console.error("Error updating inventory status:", inventoryError);

      // FIX 4: Return error instead of silent failure
      return res.status(500).json({
        success: false,
        message: "Failed to update inventory status",
        error: inventoryError.message,
      });
    }

    // Now update the invoice
    let response;
    try {
      response = await CustomerProduct.findByIdAndUpdate(pid, newInvoiceData, {
        new: true,
      });

      if (!response) {
        // FIX 5: Rollback inventory changes if invoice update fails
        if (inventoryUpdateSuccess) {
          // Reverse the changes
          if (addedRollIds.length > 0) {
            await updateInventoryStatus(addedRollIds, "available");
          }
          if (removedRollIds.length > 0) {
            await updateInventoryStatus(
              removedRollIds,
              "sold",
              existingInvoice.invoiceNumber
            );
          }
        }

        return res.status(404).json({
          success: false,
          message: "CustomerProduct not found",
        });
      }
    } catch (invoiceError) {
      // Rollback inventory changes
      if (inventoryUpdateSuccess) {
        try {
          if (addedRollIds.length > 0) {
            await updateInventoryStatus(addedRollIds, "available");
          }
          if (removedRollIds.length > 0) {
            await updateInventoryStatus(
              removedRollIds,
              "sold",
              existingInvoice.invoiceNumber
            );
          }
        } catch (rollbackError) {
          console.error(
            "CRITICAL: Failed to rollback inventory:",
            rollbackError
          );
        }
      }

      throw invoiceError; // Re-throw to be caught by outer catch
    }

    res.json({
      success: true,
      data: response,
      message: "Invoice updated successfully",
      inventoryUpdates: {
        added: addedRollIds.length,
        removed: removedRollIds.length,
      },
    });
  } catch (error) {
    console.error("Error in updateCustomerProducts:", error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// FIX 6: New validation function that allows current invoice's rolls
const validateRollIdsForUpdate = async (rollIds, currentInvoiceNumber) => {
  if (!rollIds || rollIds.length === 0) return { valid: true, errors: [] };

  const errors = [];
  const validRollIds = [];

  for (const rollId of rollIds) {
    try {
      const inventoryItem = await prisma.inventory.findUnique({
        where: { rollId: rollId.trim() },
      });

      if (!inventoryItem) {
        errors.push(`Roll ID ${rollId} not found in inventory`);
      } else if (inventoryItem.status === "damaged") {
        errors.push(
          `Roll ID ${rollId} is marked as damaged and cannot be sold`
        );
      } else if (
        inventoryItem.status === "sold" &&
        inventoryItem.invoiceNumber !== currentInvoiceNumber
      ) {
        // Allow if it's sold to THIS invoice, reject if sold to another
        errors.push(
          `Roll ID ${rollId} is already sold to invoice ${inventoryItem.invoiceNumber}`
        );
      } else {
        validRollIds.push(rollId.trim());
      }
    } catch (error) {
      errors.push(`Error validating Roll ID ${rollId}: ${error.message}`);
    }
  }

  return { valid: errors.length === 0, errors, validRollIds };
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
        await updateInventoryStatus(rollIds, "available");
      } catch (inventoryError) {
        console.error(
          "Error updating inventory status during deletion:",
          inventoryError
        );
        // Continue with the response but log the error
      }
    }

    // Respond with success
    res.json({
      success: true,
      data: response,
      message: `CustomerProduct with id ${pid} deleted successfully${
        rollIds.length > 0
          ? ` and ${rollIds.length} inventory items marked as available`
          : ""
      }`,
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
        status: "available",
      },
      select: {
        rollId: true,
        netWeight: true,
        width: true,
        micron: true,
      },
      orderBy: {
        rollId: "asc",
      },
    });

    res.json({
      success: true,
      data: availableInventory,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};
// Add this function to your controller file

const getMonthlyInvoiceTotals = async (req, res) => {
  try {
    // Extract query parameters for dynamic filtering
    const {
      startDate,
      endDate,
      customerId,
      groupBy = "month", // Options: 'month', 'quarter', 'year', 'week'
      includeProducts = "false",
      includeCustomers = "false",
      sortBy = "date", // Options: 'date', 'revenue', 'count'
      sortOrder = "asc", // Options: 'asc', 'desc'
      minRevenue,
      maxRevenue,
      limit,
      comparisonPeriod = "false", // Compare with previous period
    } = req.query;

    // Build match stage for filtering
    const matchStage = {};

    // Date range filter
    if (startDate || endDate) {
      matchStage.createdAt = {};
      if (startDate) {
        matchStage.createdAt.$gte = new Date(startDate);
      }
      if (endDate) {
        matchStage.createdAt.$lte = new Date(endDate);
      }
    }

    // Customer filter
    if (customerId) {
      matchStage.customer = require("mongoose").Types.ObjectId(customerId);
    }

    // Revenue range filter
    if (minRevenue || maxRevenue) {
      matchStage.grandTotal = {};
      if (minRevenue) {
        matchStage.grandTotal.$gte = parseFloat(minRevenue);
      }
      if (maxRevenue) {
        matchStage.grandTotal.$lte = parseFloat(maxRevenue);
      }
    }

    // Define grouping based on groupBy parameter
    let groupId = {};
    let dateLabel = {};

    switch (groupBy) {
      case "week":
        groupId = {
          year: { $year: "$createdAt" },
          week: { $week: "$createdAt" },
        };
        dateLabel = {
          period: {
            $concat: [
              { $toString: "$_id.year" },
              "-W",
              { $toString: "$_id.week" },
            ],
          },
        };
        break;

      case "quarter":
        groupId = {
          year: { $year: "$createdAt" },
          quarter: {
            $ceil: { $divide: [{ $month: "$createdAt" }, 3] },
          },
        };
        dateLabel = {
          period: {
            $concat: [
              { $toString: "$_id.year" },
              "-Q",
              { $toString: "$_id.quarter" },
            ],
          },
        };
        break;

      case "year":
        groupId = {
          year: { $year: "$createdAt" },
        };
        dateLabel = {
          period: { $toString: "$_id.year" },
        };
        break;

      case "month":
      default:
        groupId = {
          year: { $year: "$createdAt" },
          month: { $month: "$createdAt" },
        };
        dateLabel = {
          period: {
            $concat: [
              { $toString: "$_id.year" },
              "-",
              {
                $cond: [
                  { $lt: ["$_id.month", 10] },
                  { $concat: ["0", { $toString: "$_id.month" }] },
                  { $toString: "$_id.month" },
                ],
              },
            ],
          },
          monthName: {
            $switch: {
              branches: [
                { case: { $eq: ["$_id.month", 1] }, then: "January" },
                { case: { $eq: ["$_id.month", 2] }, then: "February" },
                { case: { $eq: ["$_id.month", 3] }, then: "March" },
                { case: { $eq: ["$_id.month", 4] }, then: "April" },
                { case: { $eq: ["$_id.month", 5] }, then: "May" },
                { case: { $eq: ["$_id.month", 6] }, then: "June" },
                { case: { $eq: ["$_id.month", 7] }, then: "July" },
                { case: { $eq: ["$_id.month", 8] }, then: "August" },
                { case: { $eq: ["$_id.month", 9] }, then: "September" },
                { case: { $eq: ["$_id.month", 10] }, then: "October" },
                { case: { $eq: ["$_id.month", 11] }, then: "November" },
                { case: { $eq: ["$_id.month", 12] }, then: "December" },
              ],
              default: "Unknown",
            },
          },
        };
        break;
    }

    // Build aggregation pipeline
    const pipeline = [];

    // Add match stage if filters exist
    if (Object.keys(matchStage).length > 0) {
      pipeline.push({ $match: matchStage });
    }

    // Group stage
    const groupStage = {
      $group: {
        _id: groupId,
        totalRevenue: { $sum: "$grandTotal" },
        totalAmount: { $sum: "$totalAmount" },
        totalCGST: { $sum: "$cgst" },
        totalSGST: { $sum: "$sgst" },
        totalIGST: { $sum: "$igst" },
        totalOtherCharges: { $sum: "$otherCharges" },
        invoiceCount: { $sum: 1 },
        averageInvoiceValue: { $avg: "$grandTotal" },
        maxInvoiceValue: { $max: "$grandTotal" },
        minInvoiceValue: { $min: "$grandTotal" },
        invoiceNumbers: { $push: "$invoiceNumber" },
      },
    };

    // Add customer aggregation if requested
    if (includeCustomers === "true") {
      groupStage.$group.uniqueCustomers = { $addToSet: "$customer" };
      groupStage.$group.customerCount = { $sum: 1 };
    }

    // Add product aggregation if requested
    if (includeProducts === "true") {
      groupStage.$group.totalProductsSold = { $sum: { $size: "$products" } };
    }

    pipeline.push(groupStage);

    // Project stage
    const projectStage = {
      $project: {
        _id: 0,
        ...dateLabel,
        totalRevenue: { $round: ["$totalRevenue", 2] },
        totalAmount: { $round: ["$totalAmount", 2] },
        totalCGST: { $round: ["$totalCGST", 2] },
        totalSGST: { $round: ["$totalSGST", 2] },
        totalIGST: { $round: ["$totalIGST", 2] },
        totalOtherCharges: { $round: ["$totalOtherCharges", 2] },
        totalTax: {
          $round: [{ $add: ["$totalCGST", "$totalSGST", "$totalIGST"] }, 2],
        },
        invoiceCount: 1,
        averageInvoiceValue: { $round: ["$averageInvoiceValue", 2] },
        maxInvoiceValue: { $round: ["$maxInvoiceValue", 2] },
        minInvoiceValue: { $round: ["$minInvoiceValue", 2] },
        invoiceNumbers: 1,
      },
    };

    if (includeCustomers === "true") {
      projectStage.$project.uniqueCustomerCount = { $size: "$uniqueCustomers" };
    }

    if (includeProducts === "true") {
      projectStage.$project.totalProductsSold = 1;
    }

    pipeline.push(projectStage);

    // Sort stage
    let sortStage = {};
    switch (sortBy) {
      case "revenue":
        sortStage.totalRevenue = sortOrder === "desc" ? -1 : 1;
        break;
      case "count":
        sortStage.invoiceCount = sortOrder === "desc" ? -1 : 1;
        break;
      case "date":
      default:
        sortStage.period = sortOrder === "desc" ? -1 : 1;
        break;
    }
    pipeline.push({ $sort: sortStage });

    // Limit stage
    if (limit && !isNaN(limit)) {
      pipeline.push({ $limit: parseInt(limit) });
    }

    // Execute aggregation
    const periodTotals = await CustomerProduct.aggregate(pipeline);

    // Calculate overall statistics
    const overallPipeline = [];
    if (Object.keys(matchStage).length > 0) {
      overallPipeline.push({ $match: matchStage });
    }

    overallPipeline.push({
      $group: {
        _id: null,
        totalRevenue: { $sum: "$grandTotal" },
        totalAmount: { $sum: "$totalAmount" },
        totalCGST: { $sum: "$cgst" },
        totalSGST: { $sum: "$sgst" },
        totalIGST: { $sum: "$igst" },
        totalOtherCharges: { $sum: "$otherCharges" },
        totalInvoices: { $sum: 1 },
        averageInvoiceValue: { $avg: "$grandTotal" },
        minInvoiceValue: { $min: "$grandTotal" },
        maxInvoiceValue: { $max: "$grandTotal" },
        uniqueCustomers: { $addToSet: "$customer" },
      },
    });

    const overallStats = await CustomerProduct.aggregate(overallPipeline);

    // Calculate comparison with previous period if requested
    let comparison = null;
    if (comparisonPeriod === "true" && startDate && endDate) {
      const start = new Date(startDate);
      const end = new Date(endDate);
      const periodLength = end - start;

      const prevStart = new Date(start.getTime() - periodLength);
      const prevEnd = new Date(start.getTime());

      const prevPeriodStats = await CustomerProduct.aggregate([
        {
          $match: {
            createdAt: {
              $gte: prevStart,
              $lt: prevEnd,
            },
          },
        },
        {
          $group: {
            _id: null,
            totalRevenue: { $sum: "$grandTotal" },
            totalInvoices: { $sum: 1 },
          },
        },
      ]);

      if (prevPeriodStats.length > 0 && overallStats.length > 0) {
        const currentRevenue = overallStats[0].totalRevenue;
        const prevRevenue = prevPeriodStats[0].totalRevenue;
        const revenueChange = currentRevenue - prevRevenue;
        const revenueChangePercent =
          prevRevenue > 0
            ? ((revenueChange / prevRevenue) * 100).toFixed(2)
            : 0;

        const currentInvoices = overallStats[0].totalInvoices;
        const prevInvoices = prevPeriodStats[0].totalInvoices;
        const invoiceChange = currentInvoices - prevInvoices;
        const invoiceChangePercent =
          prevInvoices > 0
            ? ((invoiceChange / prevInvoices) * 100).toFixed(2)
            : 0;

        comparison = {
          previousPeriod: {
            startDate: prevStart,
            endDate: prevEnd,
            totalRevenue: Math.round(prevRevenue * 100) / 100,
            totalInvoices: prevInvoices,
          },
          changes: {
            revenueChange: Math.round(revenueChange * 100) / 100,
            revenueChangePercent: parseFloat(revenueChangePercent),
            invoiceChange,
            invoiceChangePercent: parseFloat(invoiceChangePercent),
          },
        };
      }
    }

    // Calculate growth trends
    const trends =
      periodTotals.length > 1
        ? {
            averageGrowthRate: calculateAverageGrowth(periodTotals),
            bestPeriod: periodTotals.reduce((max, period) =>
              period.totalRevenue > max.totalRevenue ? period : max
            ),
            worstPeriod: periodTotals.reduce((min, period) =>
              period.totalRevenue < min.totalRevenue ? period : min
            ),
          }
        : null;

    res.json({
      success: true,
      data: {
        periodBreakdown: periodTotals,
        overallStatistics:
          overallStats.length > 0
            ? {
                totalRevenue:
                  Math.round(overallStats[0].totalRevenue * 100) / 100,
                totalAmount:
                  Math.round(overallStats[0].totalAmount * 100) / 100,
                totalCGST: Math.round(overallStats[0].totalCGST * 100) / 100,
                totalSGST: Math.round(overallStats[0].totalSGST * 100) / 100,
                totalIGST: Math.round(overallStats[0].totalIGST * 100) / 100,
                totalTax:
                  Math.round(
                    (overallStats[0].totalCGST +
                      overallStats[0].totalSGST +
                      overallStats[0].totalIGST) *
                      100
                  ) / 100,
                totalOtherCharges:
                  Math.round(overallStats[0].totalOtherCharges * 100) / 100,
                totalInvoices: overallStats[0].totalInvoices,
                uniqueCustomerCount: overallStats[0].uniqueCustomers.length,
                averageInvoiceValue:
                  Math.round(overallStats[0].averageInvoiceValue * 100) / 100,
                minInvoiceValue:
                  Math.round(overallStats[0].minInvoiceValue * 100) / 100,
                maxInvoiceValue:
                  Math.round(overallStats[0].maxInvoiceValue * 100) / 100,
              }
            : null,
        comparison,
        trends,
        filters: {
          groupBy,
          startDate: startDate || "all time",
          endDate: endDate || "present",
          customerId: customerId || "all",
          sortBy,
          sortOrder,
        },
      },
      message: `Retrieved data for ${periodTotals.length} ${groupBy} periods`,
    });
  } catch (error) {
    console.error("Error in getMonthlyInvoiceTotals:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};

// Helper function to calculate average growth rate
function calculateAverageGrowth(periods) {
  if (periods.length < 2) return 0;

  let totalGrowth = 0;
  for (let i = 1; i < periods.length; i++) {
    const prevRevenue = periods[i - 1].totalRevenue;
    const currentRevenue = periods[i].totalRevenue;
    if (prevRevenue > 0) {
      const growth = ((currentRevenue - prevRevenue) / prevRevenue) * 100;
      totalGrowth += growth;
    }
  }

  return Math.round((totalGrowth / (periods.length - 1)) * 100) / 100;
}

// Export functions
module.exports = {
  getAllCustomerProducts,
  getCustomerProductsbyId,
  createCustomerProducts,
  updateCustomerProducts,
  deleteCustomerProducts,
  resetCounter,
  getAvailableRollIds,
  getMonthlyInvoiceTotals,
};
