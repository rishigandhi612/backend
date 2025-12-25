const prisma = require("../config/prisma");
const mongoose = require("mongoose");
const Bank = require("../models/bank.models");
const customer = require("../models/customer.models");
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
const generateTransactionId = async () => {
  const year = new Date().getFullYear();
  const lastTransaction = await prisma.transaction.findFirst({
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

  if (difference > 0.0) {
    errors.push(
      `Allocation sum (${allocationSum.toFixed(
        2
      )}) does not match total amount (${parseFloat(totalAmount).toFixed(
        2
      )}). Difference: ${difference.toFixed(2)}`
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
          2
        )} exceeds pending amount ${pendingAmount.toFixed(
          2
        )} for invoice ${invoiceNumber}`
      );
    }
  }

  return { valid: errors.length === 0, errors };
};

/**
 * Create a new transaction with proper allocation and status logic
 * POST /api/transactions
 */
exports.createTransaction = async (req, res) => {
  try {
    const result = await prisma.$transaction(async (tx) => {
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
      console.log("create transaction", req.body);

      // Validation
      if (!customerId || !bankId || !transactionType || !totalAmount) {
        throw new Error("Missing required fields");
      }

      if (parseFloat(totalAmount) <= 0) {
        throw new Error("Total amount must be greater than zero");
      }

      // Validate bank
      if (!mongoose.Types.ObjectId.isValid(bankId)) {
        throw new Error("Invalid bankId");
      }

      const bank = await Bank.findById(bankId);
      if (!bank) throw new Error("Bank not found");

      // For AGAINST_REF, allocations are mandatory
      if (transactionType === "AGAINST_REF") {
        if (!allocations || allocations.length === 0) {
          throw new Error(
            "Allocations required for AGAINST_REF transaction type"
          );
        }

        const validation = await validateAllocations(
          allocations,
          totalAmount,
          customerId
        );

        if (!validation.valid) {
          throw new Error(
            `Allocation validation failed: ${validation.errors.join(", ")}`
          );
        }
      }

      // For ON_ACCOUNT, allocations are optional
      if (
        transactionType === "ON_ACCOUNT" &&
        allocations &&
        allocations.length > 0
      ) {
        const validation = await validateAllocations(
          allocations,
          totalAmount,
          customerId
        );

        if (!validation.valid) {
          throw new Error(
            `Allocation validation failed: ${validation.errors.join(", ")}`
          );
        }
      }

      // Generate transaction ID
      const transactionId = await generateTransactionId();

      const safeTransactionDate = transactionDate
        ? new Date(transactionDate) // works for "2025-05-17" or "2025-05-17 16:56:59"
        : new Date();

      // Create transaction
      const transaction = await tx.transaction.create({
        data: {
          transactionId,
          customerId,
          bankId,
          bankName: bank.name,
          transactionType,
          voucherType, // ISO string Prisma accepts,
          transactionDate: safeTransactionDate, // ISO string Prisma accepts,
          totalAmount: parseFloat(totalAmount),
          paymentMethod,
          paymentStatus: "completed",
          reference,
          remarks,
          createdBy,
        },
      });

      // Process allocations and update invoices
      if (allocations && allocations.length > 0) {
        for (const alloc of allocations) {
          // Create allocation record in Prisma
          await tx.transactionAllocation.create({
            data: {
              transactionId: transaction.id,
              invoiceNumber: alloc.invoiceNumber,
              allocatedAmount: parseFloat(alloc.amount),
            },
          });

          // Update invoice payment status in MongoDB
          await updateInvoicePaymentStatus(alloc.invoiceNumber, alloc.amount);
        }
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
        credit = parseFloat(totalAmount);
        balanceChange = -parseFloat(totalAmount); // Reduces customer debt
      } else if (voucherType === "PAYMENT") {
        debit = parseFloat(totalAmount);
        balanceChange = parseFloat(totalAmount); // Increases customer debt (unusual)
      }

      const newBalance = parseFloat(lastBalance) + balanceChange;

      await tx.customerLedger.create({
        data: {
          customerId,
          transactionId: transaction.id,
          debit,
          credit,
          balanceAfter: newBalance,
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
            totalAmount,
            allocations: allocations.map((a) => ({
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

    const result = await prisma.$transaction(async (tx) => {
      // Get existing transaction
      const existingTransaction = await tx.transaction.findUnique({
        where: { id },
        include: {
          allocations: true,
        },
      });

      if (!existingTransaction) {
        throw new Error("Transaction not found");
      }

      // If allocations are being updated, reverse old ones first
      if (allocations) {
        // Reverse old allocations in MongoDB
        for (const oldAlloc of existingTransaction.allocations) {
          await reverseInvoicePayment(
            oldAlloc.invoiceNumber,
            oldAlloc.allocatedAmount.toString()
          );
        }

        // Delete old allocations from Prisma
        await tx.transactionAllocation.deleteMany({
          where: { transactionId: id },
        });

        // Validate new allocations
        const validation = await validateAllocations(
          allocations,
          totalAmount || existingTransaction.totalAmount.toString(),
          existingTransaction.customerId
        );

        if (!validation.valid) {
          throw new Error(
            `Allocation validation failed: ${validation.errors.join(", ")}`
          );
        }

        // Create new allocations
        for (const alloc of allocations) {
          await tx.transactionAllocation.create({
            data: {
              transactionId: id,
              invoiceNumber: alloc.invoiceNumber,
              allocatedAmount: parseFloat(alloc.amount),
            },
          });

          // Update invoice in MongoDB
          await updateInvoicePaymentStatus(alloc.invoiceNumber, alloc.amount);
        }
      }

      // Update transaction
      const updateData = {};
      if (totalAmount !== undefined)
        updateData.totalAmount = parseFloat(totalAmount);
      if (transactionDate)
        updateData.transactionDate = new Date(transactionDate);
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
          changes: { updateData, allocations },
          userId: updatedBy,
        },
      });

      return updatedTransaction;
    });

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

    const result = await prisma.$transaction(async (tx) => {
      const transaction = await tx.transaction.findUnique({
        where: { id },
        include: {
          allocations: true,
        },
      });

      if (!transaction) {
        throw new Error("Transaction not found");
      }

      // Reverse all allocations in MongoDB
      for (const alloc of transaction.allocations) {
        await reverseInvoicePayment(
          alloc.invoiceNumber,
          alloc.allocatedAmount.toString()
        );
      }

      // Log deletion before deleting (cascade will remove allocations and ledger)
      await tx.transactionLog.create({
        data: {
          transactionId: id,
          action: "deleted",
          changes: {
            deletedTransaction: {
              transactionId: transaction.transactionId,
              customerId: transaction.customerId,
              totalAmount: transaction.totalAmount.toString(),
              allocations: transaction.allocations.map((a) => ({
                invoiceNumber: a.invoiceNumber,
                amount: a.allocatedAmount.toString(),
              })),
            },
          },
          userId: deletedBy,
        },
      });

      // Delete transaction (cascade will handle allocations and ledger entries)
      await tx.transaction.delete({
        where: { id },
      });

      return transaction;
    });

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
      })
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
      if (startDate) where.transactionDate.gte = new Date(startDate);
      if (endDate) where.transactionDate.lte = new Date(endDate);
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
      if (startDate) where.transactionDate.gte = new Date(startDate);
      if (endDate) where.transactionDate.lte = new Date(endDate);
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
