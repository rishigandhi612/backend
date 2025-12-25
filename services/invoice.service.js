const mongoose = require("mongoose");
const InvoiceMongo = require("../models/cust-prod.models");
const Customer = require("../models/customer.models");
/**
 * Determine payment status based on amounts
 */
const determinePaymentStatus = (totalAmount, paidAmount) => {
  const total = parseFloat(totalAmount);
  const paid = parseFloat(paidAmount);

  if (paid === 0) return "UNPAID";
  if (paid < total) return "PARTIAL";
  if (paid === total) return "PAID";
  if (paid > total) return "OVERPAID";

  return "UNPAID";
};

async function findInvoiceAnywhere(filter) {
  // 1. live collection (already populated)
  const inv = await InvoiceMongo.findOne(filter)
    .populate("customer")
    .populate("products.product")
    .populate("transporter")
    .lean();
  if (inv) return inv;

  // 2. archived collection
  const doc = await mongoose.connection.db
    .collection("archived")
    .findOne(filter);
  if (!doc) return null;

  // populate customer – do it **before** you build the returned object
  const customer = await Customer.findById(doc.customer).lean();
  if (!customer) return null; // customer really missing

  return {
    ...doc,
    _id: doc._id.toString(),
    customer, // now safe to use
    products: doc.products || [],
    transporter: doc.transporter,
  };
}
/**
 * Get invoice from MongoDB
 */
const getInvoice = async (invoiceNumber) => {
  const inv = await findInvoiceAnywhere({ invoiceNumber });
  if (!inv) throw new Error(`Invoice ${invoiceNumber} not found`);
  return inv;
};

/**
 * Update invoice payment status
 */
const updateInvoicePaymentStatus = async (invoiceNumber, allocatedAmount) => {
  const invoice = await findInvoiceAnywhere({ invoiceNumber });
  if (!invoice) throw new Error(`Invoice ${invoiceNumber} not found`);

  const newPaid =
    parseFloat(invoice.paidAmount || 0) + parseFloat(allocatedAmount);
  const newPending = parseFloat(invoice.grandTotal) - newPaid;
  const newStatus = determinePaymentStatus(invoice.grandTotal, newPaid);

  // write back to the **live** collection only (archived stays read-only)
  return InvoiceMongo.findOneAndUpdate(
    { invoiceNumber },
    {
      $set: {
        paidAmount: newPaid,
        pendingAmount: newPending,
        paymentStatus: newStatus,
      },
    },
    { new: true }
  );
};

/**
 * Reverse invoice payment (for transaction deletion/update)
 */
const reverseInvoicePayment = async (invoiceNumber, allocatedAmount) => {
  try {
    const invoice = await findInvoiceAnywhere({ invoiceNumber });

    if (!invoice) {
      throw new Error(`Invoice ${invoiceNumber} not found`);
    }

    const newPaidAmount = Math.max(
      0,
      parseFloat(invoice.paidAmount || 0) - parseFloat(allocatedAmount)
    );
    const newPendingAmount = parseFloat(invoice.grandTotal) - newPaidAmount;
    const newStatus = determinePaymentStatus(invoice.grandTotal, newPaidAmount);

    // Update MongoDB
    const updatedInvoice = await InvoiceMongo.findOneAndUpdate(
      { invoiceNumber },
      {
        $set: {
          paidAmount: newPaidAmount,
          pendingAmount: newPendingAmount,
          paymentStatus: newStatus,
        },
      },
      { new: true }
    );

    return updatedInvoice;
  } catch (error) {
    console.error("Error reversing invoice payment:", error);
    throw error;
  }
};

/**
 * Get invoice with payment details (including Prisma allocations)
 */
const getInvoiceDetails = async (invoiceNumber) => {
  try {
    const prisma = require("../config/prisma");

    // Get invoice from MongoDB
    const invoice = await findInvoiceAnywhere({ invoiceNumber });

    if (!invoice) {
      throw new Error(`Invoice ${invoiceNumber} not found`);
    }

    // Get allocations from Prisma
    const allocations = await prisma.transactionAllocation.findMany({
      where: { invoiceNumber },
      include: {
        transaction: true,
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    // Combine data
    return {
      ...invoice.toObject(),
      allocations,
    };
  } catch (error) {
    console.error("Error getting invoice details:", error);
    throw error;
  }
};

/**
 * Create opening outstanding invoice
 */
const createOpeningInvoice = async (data) => {
  try {
    const {
      customerId,
      invoiceNumber,
      totalAmount,
      paidAmount = 0,
      invoiceDate,
      description = "Opening Outstanding",
    } = data;

    if (!customerId || !invoiceNumber || !totalAmount) {
      throw new Error("Missing required fields for opening invoice");
    }

    const pendingAmount = parseFloat(totalAmount) - parseFloat(paidAmount);
    const paymentStatus = determinePaymentStatus(totalAmount, paidAmount);

    // Create opening invoice in MongoDB
    const invoice = await InvoiceMongo.create({
      invoiceNumber,
      customer: customerId,
      products: [], // Opening invoice has no products
      grandTotal: parseFloat(totalAmount),
      totalAmount: parseFloat(totalAmount),
      paidAmount: parseFloat(paidAmount),
      pendingAmount,
      paymentStatus,
      otherCharges: 0,
      cgst: 0,
      sgst: 0,
      igst: 0,
      deliveryStatus: "delivered", // Opening invoices are already delivered
      deliveryNotes: description,
      createdAt: invoiceDate ? new Date(invoiceDate) : new Date(),
    });

    return invoice;
  } catch (error) {
    console.error("Error creating opening invoice:", error);
    throw error;
  }
};

/**
 * Get customer's pending invoices
 */
const getCustomerPendingInvoices = async (customerId) => {
  try {
    const invoices = await InvoiceMongo.find({
      customer: customerId,
      paymentStatus: { $in: ["UNPAID", "PARTIAL"] },
    })
      .populate("customer")
      .sort({ createdAt: 1 });

    return invoices;
  } catch (error) {
    console.error("Error getting pending invoices:", error);
    throw error;
  }
};

/**
 * Validate invoice exists and belongs to customer
 */
const validateInvoice = async (invoiceNumber, customerId) => {
  try {
    const invoice = await findInvoiceAnywhere({ invoiceNumber });

    if (!invoice) {
      return { valid: false, error: `Invoice ${invoiceNumber} not found` };
    }

    if (invoice.customer._id.toString() !== customerId) {
      return {
        valid: false,
        error: `Invoice ${invoiceNumber} does not belong to customer ${customerId}`,
      };
    }

    return { valid: true, invoice };
  } catch (error) {
    return { valid: false, error: error.message };
  }
};

module.exports = {
  determinePaymentStatus,
  getInvoice,
  updateInvoicePaymentStatus,
  reverseInvoicePayment,
  getInvoiceDetails,
  createOpeningInvoice,
  getCustomerPendingInvoices,
  validateInvoice,
};
