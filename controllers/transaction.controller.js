const prisma = require("../config/prisma");
const mongoose = require("mongoose");
const Bank = require("../models/bank.models");
const InvoiceMongo = require("../models/cust-prod.models");
const {
  updateInvoicePaymentStatus,
  reverseInvoicePayment,
  getInvoiceDetails,
  validateInvoice,
} = require("../services/invoice.service");

/**
 * Generate unique transaction ID
 */
const generateTransactionId = async (db = prisma) => {
  const year = new Date().getFullYear();
  const lastTransaction = await db.transaction.findFirst({
    where: {
      transactionId: {
        startsWith: `TXN-${year}-`,
      },
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  if (lastTransaction) {
    const lastNum = parseInt(lastTransaction.transactionId.split("-")[2]);
    return `TXN-${year}-${String(lastNum + 1).padStart(4, "0")}`;
  }

  return `TXN-${year}-0001`;
};

/**
 * Convert various date inputs into a safe JavaScript Date instance (ISO-8601 compatible)
 * Accepts Date, number (timestamp), or string (YYYY-MM-DD or ISO string).
 * Throws Error on invalid input.
 */
const toSafeDate = (input) => {
  if (!input) return new Date();
  if (input instanceof Date && !isNaN(input)) return input;
  if (typeof input === "number") {
    const d = new Date(input);
    if (isNaN(d.getTime())) throw new Error("Invalid date");
    return d;
  }
  if (typeof input === "string") {
    // If only date part provided (YYYY-MM-DD), treat as UTC start of day
    if (/^\d{4}-\d{2}-\d{2}$/.test(input)) {
      const d = new Date(`${input}T00:00:00.000Z`);
      if (isNaN(d.getTime())) throw new Error("Invalid date");
      return d;
    }
    const d = new Date(input);
    if (isNaN(d.getTime())) throw new Error("Invalid date");
    return d;
  }
  throw new Error("Invalid date");
};

/**
 * Validate allocations
 */
const validateAllocations = async (allocations, totalAmount, customerId) => {
  if (!allocations || allocations.length === 0) {
    return { valid: true, errors: [] };
  }

  const errors = [];

  // 1. Check allocation sum matches total amount (with 0.01 tolerance for rounding)
  const allocationSum = allocations.reduce((sum, alloc) => {
    return sum + parseFloat(alloc.amount);
  }, 0);

  const difference = Math.abs(allocationSum - parseFloat(totalAmount));

  if (difference > 0.01) {
    errors.push(
      `Allocation sum (${allocationSum.toFixed(
        2,
      )}) does not match total amount (${parseFloat(totalAmount).toFixed(
        2,
      )}). Difference: ${difference.toFixed(2)}`,
    );
    return { valid: false, errors };
  }

  // 2. Validate each invoice
  for (const alloc of allocations) {
    const { invoiceNumber, amount } = alloc;

    if (!invoiceNumber || !amount || parseFloat(amount) <= 0) {
      errors.push(`Invalid allocation: ${JSON.stringify(alloc)}`);
      continue;
    }

    // Validate invoice exists and belongs to customer
    const validation = await validateInvoice(invoiceNumber, customerId);

    if (!validation.valid) {
      errors.push(validation.error);
      continue;
    }

    const invoice = validation.invoice;

    // Check if allocation exceeds pending amount (with 0.01 tolerance)
    const pendingAmount = parseFloat(invoice.pendingAmount);
    const allocationAmount = parseFloat(amount);

    if (allocationAmount > pendingAmount + 0.01) {
      errors.push(
        `Allocation ${allocationAmount.toFixed(
          2,
        )} exceeds pending amount ${pendingAmount.toFixed(
          2,
        )} for invoice ${invoiceNumber}`,
      );
    }
  }

  return { valid: errors.length === 0, errors };
};

const normalizeAllocations = (allocations = [], amountKey = "amount") =>
  allocations.map((alloc) => ({
    invoiceNumber: alloc.invoiceNumber,
    amount: parseFloat(alloc[amountKey]),
  }));

const applyAllocationsToInvoices = async (allocations = []) => {
  const applied = [];

  try {
    for (const alloc of allocations) {
      await updateInvoicePaymentStatus(alloc.invoiceNumber, alloc.amount);
      applied.push(alloc);
    }
  } catch (error) {
    for (const alloc of applied.reverse()) {
      await reverseInvoicePayment(alloc.invoiceNumber, alloc.amount);
    }
    throw error;
  }
};

const reverseAllocationsFromInvoices = async (allocations = []) => {
  const reversed = [];

  try {
    for (const alloc of allocations) {
      await reverseInvoicePayment(alloc.invoiceNumber, alloc.amount);
      reversed.push(alloc);
    }
  } catch (error) {
    for (const alloc of reversed.reverse()) {
      await updateInvoicePaymentStatus(alloc.invoiceNumber, alloc.amount);
    }
    throw error;
  }
};

const rollbackCreatedTransaction = async (transactionId) => {
  await prisma.$transaction(async (tx) => {
    await tx.transactionAllocation.deleteMany({
      where: { transactionId },
    });
    await tx.customerLedger.deleteMany({
      where: { transactionId },
    });
    await tx.transactionLog.deleteMany({
      where: { transactionId },
    });
    await tx.transaction.delete({
      where: { id: transactionId },
    });
  });
};

/**
 * Create a new transaction with proper allocation and status logic
 * POST /api/transactions
 */
exports.createTransaction = async (req, res) => {
  try {
    const {
      customerId,
      bankId,
      transactionType,
      voucherType,
      totalAmount,
      transactionDate,
      allocations = [],
      paymentMethod,
      reference,
      remarks,
      createdBy,
    } = req.body;

    if (!customerId || !bankId || !transactionType || !totalAmount) {
      throw new Error("Missing required fields");
    }

    const parsedTotalAmount = parseFloat(totalAmount);
    if (Number.isNaN(parsedTotalAmount) || parsedTotalAmount <= 0) {
      throw new Error("Total amount must be greater than zero");
    }

    if (!mongoose.Types.ObjectId.isValid(bankId)) {
      throw new Error("Invalid bankId");
    }

    const bank = await Bank.findById(bankId);
    if (!bank) throw new Error("Bank not found");

    const normalizedAllocations = normalizeAllocations(allocations);

    if (transactionType === "AGAINST_REF" && normalizedAllocations.length === 0) {
      throw new Error("Allocations required for AGAINST_REF transaction type");
    }

    if (
      ["AGAINST_REF", "ON_ACCOUNT"].includes(transactionType) &&
      normalizedAllocations.length > 0
    ) {
      const validation = await validateAllocations(
        normalizedAllocations,
        parsedTotalAmount,
        customerId,
      );

      if (!validation.valid) {
        throw new Error(
          `Allocation validation failed: ${validation.errors.join(", ")}`,
        );
      }
    }

    const safeTransactionDate = toSafeDate(transactionDate);

    const result = await prisma.$transaction(async (tx) => {
      const transactionId = await generateTransactionId(tx);

      const transaction = await tx.transaction.create({
        data: {
          transactionId,
          customerId,
          bankId,
          bankName: bank.name,
          transactionType,
          voucherType,
          totalAmount: parsedTotalAmount,
          transactionDate: safeTransactionDate,
          paymentMethod,
          paymentStatus: "completed",
          reference,
          remarks,
          createdBy,
        },
      });

      // Store allocations in Prisma; invoice sync happens after commit.
      if (normalizedAllocations.length > 0) {
        await tx.transactionAllocation.createMany({
          data: normalizedAllocations.map((alloc) => ({
            transactionId: transaction.id,
            invoiceNumber: alloc.invoiceNumber,
            allocatedAmount: alloc.amount,
          })),
        });
      }

      // Update Customer Ledger
      const lastBalance =
        (
          await tx.customerLedger.findFirst({
            where: { customerId },
            orderBy: { createdAt: "desc" },
          })
        )?.balanceAfter || 0;

      let debit = 0;
      let credit = 0;
      let balanceChange = 0;

      // Determine debit/credit based on voucher type
      if (voucherType === "RECEIPT") {
        credit = parsedTotalAmount;
        balanceChange = -parsedTotalAmount; // Reduces customer debt
      } else if (voucherType === "PAYMENT") {
        debit = parsedTotalAmount;
        balanceChange = parsedTotalAmount; // Increases customer debt (unusual)
      }

      const newBalance = parseFloat(lastBalance) + balanceChange;

      await tx.customerLedger.create({
        data: {
          customerId,
          transactionId: transaction.id,
          debit,
          credit,
          balanceAfter: newBalance,
          transactionDate: transaction.transactionDate,
          narration: `${voucherType} - ${transactionId}${
            allocations.length > 0
              ? ` - Allocated to ${allocations.length} invoice(s): ${allocations
                  .map((a) => a.invoiceNumber)
                  .join(", ")}`
              : ` - ${transactionType}`
          }`,
        },
      });

      // Create transaction log
      await tx.transactionLog.create({
        data: {
          transactionId: transaction.id,
          action: "created",
          changes: {
            transactionType,
            voucherType,
            totalAmount: parsedTotalAmount,
            allocations: normalizedAllocations.map((a) => ({
              invoiceNumber: a.invoiceNumber,
              amount: a.amount,
            })),
          },
          userId: createdBy,
        },
      });

      // Fetch complete transaction with relations
      const completeTransaction = await tx.transaction.findUnique({
        where: { id: transaction.id },
        include: {
          allocations: true,
          ledgerEntries: true,
        },
      });

      return completeTransaction;
    });

    if (normalizedAllocations.length > 0) {
      try {
        await applyAllocationsToInvoices(normalizedAllocations);
      } catch (syncError) {
        await rollbackCreatedTransaction(result.id);
        throw syncError;
      }
    }

    res.status(201).json({
      success: true,
      data: result,
      message: "Transaction created successfully",
    });
  } catch (error) {
    console.error("Create transaction error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to create transaction",
      error: error.message,
    });
  }
};
/**
 * Get invoices based on transaction type and filters
 * GET /api/transactions/invoices-by-type
 *
 * Query params:
 * - customerId (required): Customer ID
 * - transactionDate (required): Transaction date (YYYY-MM-DD or ISO string)
 * - transactionType (required): AGAINST_REF | ON_ACCOUNT | ADVANCE | REFUND
 */
exports.getInvoicesByTransactionType = async (req, res) => {
  try {
    const { customerId, transactionDate, transactionType } = req.query;

    // Validation
    if (!customerId) {
      return res.status(400).json({
        success: false,
        message: "customerId is required",
      });
    }

    if (!transactionDate) {
      return res.status(400).json({
        success: false,
        message: "transactionDate is required",
      });
    }

    if (!transactionType) {
      return res.status(400).json({
        success: false,
        message: "transactionType is required",
      });
    }

    // Validate transaction type
    const validTypes = ["AGAINST_REF", "ON_ACCOUNT", "ADVANCE", "REFUND"];
    if (!validTypes.includes(transactionType)) {
      return res.status(400).json({
        success: false,
        message: `Invalid transactionType. Must be one of: ${validTypes.join(
          ", ",
        )}`,
      });
    }

    // Validate customer exists
    if (!mongoose.Types.ObjectId.isValid(customerId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid customerId format",
      });
    }

    const customerExists = await InvoiceMongo.findOne({
      customer: customerId,
    });

    if (!customerExists) {
      return res.status(404).json({
        success: false,
        message: "No invoices found for this customer",
      });
    }

    // Parse transaction date
    let txnDate;
    try {
      txnDate = toSafeDate(transactionDate);
    } catch (error) {
      return res.status(400).json({
        success: false,
        message: "Invalid transactionDate format. Use YYYY-MM-DD or ISO string",
      });
    }

    let invoices = [];
    let filter = { customer: customerId };
    let message = "";

    switch (transactionType) {
      case "AGAINST_REF":
        // Return all unsettled invoices till that date
        filter.createdAt = { $lte: txnDate };
        filter.$or = [
          { paymentStatus: "UNPAID" },
          { paymentStatus: "PARTIAL" },
        ];

        invoices = await InvoiceMongo.find(filter)
          .populate("customer")
          .populate("products.product")
          .populate("transporter")
          .sort({ createdAt: -1 })
          .lean();

        message = `Found ${invoices.length} unsettled invoice(s) up to ${transactionDate}`;
        break;

      case "ON_ACCOUNT":
        // Return nothing (empty array)
        invoices = [];
        message = "ON_ACCOUNT transactions don't require invoice allocation";
        break;

      case "ADVANCE":
        // Return invoices after the transaction date (if any)
        filter.createdAt = { $gt: txnDate };

        invoices = await InvoiceMongo.find(filter)
          .populate("customer")
          .populate("products.product")
          .populate("transporter")
          .sort({ createdAt: 1 })
          .lean();

        message = `Found ${invoices.length} invoice(s) after ${transactionDate}`;
        break;

      case "REFUND":
        // Return all invoices for the customer
        invoices = await InvoiceMongo.find(filter)
          .populate("customer")
          .populate("products.product")
          .populate("transporter")
          .sort({ createdAt: -1 })
          .lean();

        message = `Found ${invoices.length} total invoice(s) for refund`;
        break;

      default:
        return res.status(400).json({
          success: false,
          message: "Invalid transaction type",
        });
    }

    // Add additional payment details to each invoice
    const enrichedInvoices = invoices.map((invoice) => ({
      ...invoice,
      availableForAllocation: invoice.pendingAmount || 0,
      paymentHistory: {
        paid: invoice.paidAmount || 0,
        pending: invoice.pendingAmount || 0,
        total: invoice.grandTotal || 0,
      },
    }));

    res.status(200).json({
      success: true,
      data: {
        transactionType,
        transactionDate: txnDate,
        customerId,
        invoiceCount: enrichedInvoices.length,
        invoices: enrichedInvoices,
        summary: {
          totalInvoices: enrichedInvoices.length,
          totalPending: enrichedInvoices.reduce(
            (sum, inv) => sum + (inv.pendingAmount || 0),
            0,
          ),
          totalAmount: enrichedInvoices.reduce(
            (sum, inv) => sum + (inv.grandTotal || 0),
            0,
          ),
        },
      },
      message,
    });
  } catch (error) {
    console.error("Get invoices by transaction type error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch invoices",
      error: error.message,
    });
  }
};
/**
 * Update transaction
 * PUT /api/transactions/:id
 */
exports.updateTransaction = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      allocations,
      totalAmount,
      transactionDate,
      paymentMethod,
      paymentStatus,
      reference,
      remarks,
      updatedBy,
    } = req.body;

    const existingTransaction = await prisma.transaction.findUnique({
      where: { id },
      include: {
        allocations: true,
      },
    });

    if (!existingTransaction) {
      throw new Error("Transaction not found");
    }

    const normalizedAllocations = allocations
      ? normalizeAllocations(allocations)
      : null;
    const previousAllocations = normalizeAllocations(
      existingTransaction.allocations,
      "allocatedAmount",
    );

    const parsedTotalAmount =
      totalAmount !== undefined
        ? parseFloat(totalAmount)
        : parseFloat(existingTransaction.totalAmount);

    if (Number.isNaN(parsedTotalAmount) || parsedTotalAmount <= 0) {
      throw new Error("Total amount must be greater than zero");
    }

    if (normalizedAllocations) {
      const validation = await validateAllocations(
        normalizedAllocations,
        parsedTotalAmount,
        existingTransaction.customerId,
      );

      if (!validation.valid) {
        throw new Error(
          `Allocation validation failed: ${validation.errors.join(", ")}`,
        );
      }
    }

    const parsedTransactionDate = transactionDate
      ? toSafeDate(transactionDate)
      : undefined;

    const result = await prisma.$transaction(async (tx) => {
      if (normalizedAllocations) {
        await tx.transactionAllocation.deleteMany({
          where: { transactionId: id },
        });

        if (normalizedAllocations.length > 0) {
          await tx.transactionAllocation.createMany({
            data: normalizedAllocations.map((alloc) => ({
              transactionId: id,
              invoiceNumber: alloc.invoiceNumber,
              allocatedAmount: alloc.amount,
            })),
          });
        }
      }

      const updateData = {};
      if (totalAmount !== undefined) updateData.totalAmount = parsedTotalAmount;
      if (parsedTransactionDate) updateData.transactionDate = parsedTransactionDate;
      if (paymentMethod) updateData.paymentMethod = paymentMethod;
      if (paymentStatus) updateData.paymentStatus = paymentStatus;
      if (reference !== undefined) updateData.reference = reference;
      if (remarks !== undefined) updateData.remarks = remarks;

      const updatedTransaction = await tx.transaction.update({
        where: { id },
        data: updateData,
        include: {
          allocations: true,
          ledgerEntries: true,
        },
      });

      // Log the update
      await tx.transactionLog.create({
        data: {
          transactionId: id,
          action: "updated",
          changes: {
            updateData,
            allocations: normalizedAllocations ?? undefined,
          },
          userId: updatedBy,
        },
      });

      return updatedTransaction;
    });

    if (normalizedAllocations) {
      await reverseAllocationsFromInvoices(previousAllocations);
      await applyAllocationsToInvoices(normalizedAllocations);
    }

    res.status(200).json({
      success: true,
      message: "Transaction updated successfully",
      data: result,
    });
  } catch (error) {
    console.error("Update transaction error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update transaction",
      error: error.message,
    });
  }
};

/**
 * Delete transaction
 * DELETE /api/transactions/:id
 */
exports.deleteTransaction = async (req, res) => {
  try {
    const { id } = req.params;
    const { deletedBy } = req.body;

    const transaction = await prisma.transaction.findUnique({
      where: { id },
      include: {
        allocations: true,
      },
    });

    if (!transaction) {
      throw new Error("Transaction not found");
    }

    const normalizedAllocations = normalizeAllocations(
      transaction.allocations,
      "allocatedAmount",
    );

    const result = await prisma.$transaction(async (tx) => {
      await tx.transactionLog.create({
        data: {
          transactionId: id,
          action: "deleted",
          changes: {
            deletedTransaction: {
              transactionId: transaction.transactionId,
              customerId: transaction.customerId,
              totalAmount: transaction.totalAmount.toString(),
              allocations: normalizedAllocations.map((alloc) => ({
                invoiceNumber: alloc.invoiceNumber,
                amount: alloc.amount.toString(),
              })),
            },
          },
          userId: deletedBy,
        },
      });

      await tx.transaction.delete({
        where: { id },
      });

      return transaction;
    });

    await reverseAllocationsFromInvoices(normalizedAllocations);

    res.status(200).json({
      success: true,
      message: "Transaction deleted successfully and invoice payments reversed",
      data: result,
    });
  } catch (error) {
    console.error("Delete transaction error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to delete transaction",
      error: error.message,
    });
  }
};

/**
 * Get transaction with full details
 * GET /api/transactions/:id
 */
exports.getTransactionById = async (req, res) => {
  try {
    const { id } = req.params;

    const transaction = await prisma.transaction.findUnique({
      where: { id },
      include: {
        allocations: true,
        ledgerEntries: true,
      },
    });

    if (!transaction) {
      return res.status(404).json({
        success: false,
        message: "Transaction not found",
      });
    }

    // Enrich with invoice details from MongoDB
    const enrichedAllocations = await Promise.all(
      transaction.allocations.map(async (alloc) => {
        const invoice = await InvoiceMongo.findOne({
          invoiceNumber: alloc.invoiceNumber,
        })
          .populate("customer")
          .lean();

        return {
          ...alloc,
          invoiceDetails: invoice,
        };
      }),
    );

    res.status(200).json({
      success: true,
      data: {
        ...transaction,
        allocations: enrichedAllocations,
      },
    });
  } catch (error) {
    console.error("Get transaction error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch transaction",
      error: error.message,
    });
  }
};

/**
 * Get all transactions with filters
 * GET /api/transactions
 */
exports.getTransactions = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      customerId,
      bankId,
      transactionType,
      voucherType,
      paymentStatus,
      startDate,
      endDate,
      search,
    } = req.query;

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const where = {};

    if (customerId) where.customerId = customerId;
    if (bankId) where.bankId = bankId;
    if (transactionType) where.transactionType = transactionType;
    if (voucherType) where.voucherType = voucherType;
    if (paymentStatus) where.paymentStatus = paymentStatus;

    if (startDate || endDate) {
      where.transactionDate = {};
      if (startDate) where.transactionDate.gte = toSafeDate(startDate);
      if (endDate) where.transactionDate.lte = toSafeDate(endDate);
    }

    if (search) {
      where.OR = [
        { transactionId: { contains: search, mode: "insensitive" } },
        { bankName: { contains: search, mode: "insensitive" } },
        { reference: { contains: search, mode: "insensitive" } },
      ];
    }

    const [transactions, total] = await Promise.all([
      prisma.transaction.findMany({
        where,
        skip,
        take: parseInt(limit),
        include: {
          allocations: true,
        },
        orderBy: {
          transactionDate: "desc",
        },
      }),
      prisma.transaction.count({ where }),
    ]);

    res.status(200).json({
      success: true,
      data: transactions,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    console.error("Get transactions error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch transactions",
      error: error.message,
    });
  }
};

/**
 * Get invoice payment history
 * GET /api/transactions/invoice/:invoiceNumber
 */
exports.getInvoicePaymentHistory = async (req, res) => {
  try {
    const { invoiceNumber } = req.params;

    const invoiceDetails = await getInvoiceDetails(invoiceNumber);

    if (!invoiceDetails) {
      return res.status(404).json({
        success: false,
        message: "Invoice not found",
      });
    }

    res.status(200).json({
      success: true,
      data: invoiceDetails,
    });
  } catch (error) {
    console.error("Get invoice payment history error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch invoice payment history",
      error: error.message,
    });
  }
};

/**
 * Get transaction summary/statistics
 * GET /api/transactions/summary
 */
exports.getTransactionSummary = async (req, res) => {
  try {
    const { startDate, endDate, bankId, customerId } = req.query;

    const where = {};
    if (startDate || endDate) {
      where.transactionDate = {};
      if (startDate) where.transactionDate.gte = toSafeDate(startDate);
      if (endDate) where.transactionDate.lte = toSafeDate(endDate);
    }
    if (bankId) where.bankId = bankId;
    if (customerId) where.customerId = customerId;

    const [totalAmount, transactionCount, statusBreakdown, typeBreakdown] =
      await Promise.all([
        prisma.transaction.aggregate({
          where,
          _sum: { totalAmount: true },
        }),
        prisma.transaction.count({ where }),
        prisma.transaction.groupBy({
          by: ["paymentStatus"],
          where,
          _sum: { totalAmount: true },
          _count: true,
        }),
        prisma.transaction.groupBy({
          by: ["transactionType"],
          where,
          _sum: { totalAmount: true },
          _count: true,
        }),
      ]);

    res.status(200).json({
      success: true,
      data: {
        totalAmount: totalAmount._sum.totalAmount || 0,
        transactionCount,
        statusBreakdown,
        typeBreakdown,
      },
    });
  } catch (error) {
    console.error("Get summary error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch transaction summary",
      error: error.message,
    });
  }
};

module.exports = exports;
