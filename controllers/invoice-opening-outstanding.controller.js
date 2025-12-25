const mongoose = require("mongoose");
const InvoiceOpeningOutstanding = require("../models/invoice_opening_outstandings.models");
const CustomerProduct = require("../models/cust-prod.models");

const Customer = require("../models/customer.models");

// Create Opening Outstanding
const createOpeningOutstanding = async (req, res) => {
  try {
    const {
      customer,
      invoiceId,
      invoiceNumber,
      invoiceDate,
      openingPendingAmount,
      adjustedAmount = 0,
      asOfDate,
    } = req.body;

    // Validate required fields
    if (
      !customer ||
      !invoiceId ||
      !invoiceNumber ||
      !invoiceDate ||
      !openingPendingAmount
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Missing required fields: customer, invoiceId, invoiceNumber, invoiceDate, and openingPendingAmount are required",
      });
    }

    // Validate customer exists
    const customerExists = await Customer.findById(customer);
    if (!customerExists) {
      return res.status(404).json({
        success: false,
        message: `Customer with ID ${customer} not found`,
      });
    }

    // Validate invoice exists
    let invoiceExists = await CustomerProduct.findById(invoiceId);
    if (!invoiceExists) {
      const archivedDoc = await mongoose.connection.db
        .collection("archived") // <-- your collection name
        .findOne({ _id: new mongoose.Types.ObjectId(invoiceId) });
      invoiceExists = archivedDoc; // will be null if not found
    }

    if (!invoiceExists) {
      return res.status(404).json({
        success: false,
        message: `Invoice ${invoiceId} not found in either live or archived records`,
      });
    }
    // if (!invoiceExists) {
    //   return res.status(404).json({
    //     success: false,
    //     message: `Invoice with ID ${invoiceId} not found`,
    //   });
    // }

    // Check if opening outstanding already exists for this invoice
    const existingRecord = await InvoiceOpeningOutstanding.findOne({
      invoiceId,
    });
    if (existingRecord) {
      return res.status(400).json({
        success: false,
        message: `Opening outstanding already exists for invoice ${invoiceNumber}`,
      });
    }

    // Calculate balance pending
    const balancePending = openingPendingAmount - adjustedAmount;

    // Create opening outstanding record
    const openingOutstanding = await InvoiceOpeningOutstanding.create({
      customer,
      invoiceId,
      invoiceNumber,
      invoiceDate: new Date(invoiceDate),
      openingPendingAmount,
      adjustedAmount,
      balancePending,
      asOfDate: asOfDate ? new Date(asOfDate) : new Date("2024-04-01"),
    });

    res.status(201).json({
      success: true,
      data: openingOutstanding,
      message: "Opening outstanding created successfully",
    });
  } catch (error) {
    console.error("Error in createOpeningOutstanding:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};

// Get Customer Pending Invoices
const getCustomerPendingInvoices = async (req, res) => {
  try {
    const { customerId } = req.params;
    const {
      includeOpeningOutstanding = "true",
      minAmount,
      maxAmount,
      sortBy = "invoiceDate",
      sortOrder = "desc",
    } = req.query;

    if (!customerId) {
      return res.status(400).json({
        success: false,
        message: "Customer ID is required",
      });
    }

    // Validate customer exists
    const customerExists = await Customer.findById(customerId);
    if (!customerExists) {
      return res.status(404).json({
        success: false,
        message: `Customer with ID ${customerId} not found`,
      });
    }

    // Build filter for current invoices
    const invoiceFilter = {
      customer: customerId,
      $or: [
        { paymentStatus: "UNPAID" },
        { paymentStatus: "PARTIAL" },
        { pendingAmount: { $gt: 0 } },
      ],
    };

    // Add amount range filter if provided
    if (minAmount || maxAmount) {
      invoiceFilter.pendingAmount = {};
      if (minAmount) invoiceFilter.pendingAmount.$gte = parseFloat(minAmount);
      if (maxAmount) invoiceFilter.pendingAmount.$lte = parseFloat(maxAmount);
    }

    // Get current pending invoices
    const sortOptions = {};
    sortOptions[sortBy] = sortOrder === "desc" ? -1 : 1;

    const currentInvoices = await CustomerProduct.find(invoiceFilter)
      .populate("customer")
      .populate("transporter")
      .sort(sortOptions)
      .lean();

    // Format current invoices
    const formattedCurrentInvoices = currentInvoices.map((invoice) => ({
      invoiceId: invoice._id,
      invoiceNumber: invoice.invoiceNumber,
      invoiceDate: invoice.createdAt,
      totalAmount: invoice.grandTotal || 0,
      paidAmount: invoice.paidAmount || 0,
      pendingAmount: invoice.pendingAmount || 0,
      paymentStatus: invoice.paymentStatus,
      type: "current",
    }));

    let openingOutstandingRecords = [];
    let totalOpeningOutstanding = 0;

    // Get opening outstanding if requested
    if (includeOpeningOutstanding === "true") {
      const openingFilter = {
        customer: customerId,
        balancePending: { $gt: 0 },
      };

      if (minAmount || maxAmount) {
        openingFilter.balancePending = {};
        if (minAmount)
          openingFilter.balancePending.$gte = parseFloat(minAmount);
        if (maxAmount)
          openingFilter.balancePending.$lte = parseFloat(maxAmount);
      }

      openingOutstandingRecords = await InvoiceOpeningOutstanding.find(
        openingFilter
      )
        .populate("customer")
        .sort({ invoiceDate: -1 })
        .lean();

      totalOpeningOutstanding = openingOutstandingRecords.reduce(
        (sum, record) => sum + record.balancePending,
        0
      );

      // Format opening outstanding records
      openingOutstandingRecords = openingOutstandingRecords.map((record) => ({
        invoiceId: record.invoiceId,
        invoiceNumber: record.invoiceNumber,
        invoiceDate: record.invoiceDate,
        totalAmount: record.openingPendingAmount,
        paidAmount: record.adjustedAmount,
        pendingAmount: record.balancePending,
        paymentStatus: record.balancePending > 0 ? "UNPAID" : "PAID",
        type: "opening",
        asOfDate: record.asOfDate,
      }));
    }

    // Combine and calculate totals
    const allPendingInvoices = [
      ...openingOutstandingRecords,
      ...formattedCurrentInvoices,
    ];
    const totalCurrentPending = formattedCurrentInvoices.reduce(
      (sum, invoice) => sum + (invoice.pendingAmount || 0),
      0
    );
    const totalPending = totalOpeningOutstanding + totalCurrentPending;

    res.json({
      success: true,
      data: {
        customer: customerExists,
        pendingInvoices: allPendingInvoices,
        summary: {
          totalInvoices: allPendingInvoices.length,
          currentInvoicesCount: formattedCurrentInvoices.length,
          openingOutstandingCount: openingOutstandingRecords.length,
          totalCurrentPending: Math.round(totalCurrentPending * 100) / 100,
          totalOpeningOutstanding:
            Math.round(totalOpeningOutstanding * 100) / 100,
          totalPending: Math.round(totalPending * 100) / 100,
        },
      },
      message: `Retrieved ${allPendingInvoices.length} pending invoices for customer`,
    });
  } catch (error) {
    console.error("Error in getCustomerPendingInvoices:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};

// Get Invoice Payments (Payment History)
const getInvoicePayments = async (req, res) => {
  try {
    const { invoiceId } = req.params;
    const { includeOpeningOutstanding = "true" } = req.query;

    if (!invoiceId) {
      return res.status(400).json({
        success: false,
        message: "Invoice ID is required",
      });
    }

    // Get the invoice
    const invoice = await CustomerProduct.findById(invoiceId)
      .populate("customer")
      .populate("transporter")
      .lean();

    if (!invoice) {
      return res.status(404).json({
        success: false,
        message: `Invoice with ID ${invoiceId} not found`,
      });
    }

    // Check if this is an opening outstanding invoice
    let openingOutstanding = null;
    if (includeOpeningOutstanding === "true") {
      openingOutstanding = await InvoiceOpeningOutstanding.findOne({
        invoiceId,
      }).lean();
    }

    // Build payment history
    const paymentHistory = [];

    if (openingOutstanding) {
      // This is an opening outstanding invoice
      paymentHistory.push({
        date: openingOutstanding.asOfDate,
        type: "opening_balance",
        amount: openingOutstanding.openingPendingAmount,
        balance: openingOutstanding.openingPendingAmount,
        description: "Opening outstanding balance",
      });

      if (openingOutstanding.adjustedAmount > 0) {
        paymentHistory.push({
          date: openingOutstanding.updatedAt || openingOutstanding.createdAt,
          type: "adjustment",
          amount: -openingOutstanding.adjustedAmount,
          balance: openingOutstanding.balancePending,
          description: "Payment adjustment",
        });
      }
    } else {
      // Regular invoice - build payment history from invoice data
      paymentHistory.push({
        date: invoice.createdAt,
        type: "invoice_created",
        amount: invoice.grandTotal,
        balance: invoice.grandTotal,
        description: `Invoice ${invoice.invoiceNumber} created`,
      });

      if (invoice.paidAmount > 0) {
        paymentHistory.push({
          date: invoice.updatedAt,
          type: "payment",
          amount: -invoice.paidAmount,
          balance: invoice.pendingAmount,
          description: "Payment received",
        });
      }
    }

    // Calculate payment summary
    const totalAmount = openingOutstanding
      ? openingOutstanding.openingPendingAmount
      : invoice.grandTotal;
    const paidAmount = openingOutstanding
      ? openingOutstanding.adjustedAmount
      : invoice.paidAmount || 0;
    const pendingAmount = openingOutstanding
      ? openingOutstanding.balancePending
      : invoice.pendingAmount || invoice.grandTotal;

    res.json({
      success: true,
      data: {
        invoice: {
          invoiceId: invoice._id,
          invoiceNumber: invoice.invoiceNumber,
          invoiceDate: invoice.createdAt,
          customer: invoice.customer,
          totalAmount: invoice.grandTotal,
          isOpeningOutstanding: !!openingOutstanding,
        },
        paymentSummary: {
          totalAmount: Math.round(totalAmount * 100) / 100,
          paidAmount: Math.round(paidAmount * 100) / 100,
          pendingAmount: Math.round(pendingAmount * 100) / 100,
          paymentStatus: invoice.paymentStatus,
          paymentPercentage:
            totalAmount > 0
              ? Math.round((paidAmount / totalAmount) * 100 * 100) / 100
              : 0,
        },
        paymentHistory: paymentHistory.sort(
          (a, b) => new Date(b.date) - new Date(a.date)
        ),
      },
      message: "Invoice payment details retrieved successfully",
    });
  } catch (error) {
    console.error("Error in getInvoicePayments:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};

// Update Opening Outstanding (for adjustments)
const updateOpeningOutstanding = async (req, res) => {
  try {
    const { id } = req.params;
    const { adjustedAmount } = req.body;

    if (!id) {
      return res.status(400).json({
        success: false,
        message: "Opening outstanding ID is required",
      });
    }

    const openingOutstanding = await InvoiceOpeningOutstanding.findById(id);
    if (!openingOutstanding) {
      return res.status(404).json({
        success: false,
        message: "Opening outstanding record not found",
      });
    }

    // Update adjusted amount and recalculate balance
    if (adjustedAmount !== undefined) {
      openingOutstanding.adjustedAmount = parseFloat(adjustedAmount);
      openingOutstanding.balancePending =
        openingOutstanding.openingPendingAmount - parseFloat(adjustedAmount);
    }

    await openingOutstanding.save();

    res.json({
      success: true,
      data: openingOutstanding,
      message: "Opening outstanding updated successfully",
    });
  } catch (error) {
    console.error("Error in updateOpeningOutstanding:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};

// Delete Opening Outstanding
const deleteOpeningOutstanding = async (req, res) => {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({
        success: false,
        message: "Opening outstanding ID is required",
      });
    }

    const openingOutstanding =
      await InvoiceOpeningOutstanding.findByIdAndDelete(id);
    if (!openingOutstanding) {
      return res.status(404).json({
        success: false,
        message: "Opening outstanding record not found",
      });
    }

    res.json({
      success: true,
      data: openingOutstanding,
      message: "Opening outstanding deleted successfully",
    });
  } catch (error) {
    console.error("Error in deleteOpeningOutstanding:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};

// Get All Opening Outstanding (with pagination and filters)
const getAllOpeningOutstanding = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const itemsPerPage = parseInt(req.query.itemsPerPage) || 10;
    const sortBy = req.query.sortBy || "invoiceDate";
    const sortDesc = req.query.sortDesc === "true";
    const customerId = req.query.customerId;
    const skip = (page - 1) * itemsPerPage;

    const filter = {};
    if (customerId) {
      filter.customer = customerId;
    }

    const sort = {};
    sort[sortBy] = sortDesc ? -1 : 1;

    const totalItems = await InvoiceOpeningOutstanding.countDocuments(filter);

    const records = await InvoiceOpeningOutstanding.find(filter)
      .populate("customer")
      .sort(sort)
      .skip(skip)
      .limit(itemsPerPage)
      .lean();

    res.json({
      success: true,
      data: records,
      pagination: {
        page,
        itemsPerPage,
        totalItems,
        totalPages: Math.ceil(totalItems / itemsPerPage),
      },
    });
  } catch (error) {
    console.error("Error in getAllOpeningOutstanding:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};

module.exports = {
  createOpeningOutstanding,
  getCustomerPendingInvoices,
  getInvoicePayments,
  updateOpeningOutstanding,
  deleteOpeningOutstanding,
  getAllOpeningOutstanding,
};
