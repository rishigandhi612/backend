const prisma = require("../config/prisma");
const mongoose = require("mongoose");
const Bank = require("../models/bank.models"); // Your MongoDB bank model

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
 * Create a new transaction
 * POST /api/transactions
 */
exports.createTransaction = async (req, res) => {
  try {
    const {
      bankId,
      invoiceNumber,
      amount,
      transactionDate,
      paymentMethod,
      paymentStatus,
      reference,
      remarks,
      createdBy,
    } = req.body;

    // Validate required fields
    if (!bankId || !invoiceNumber || !amount) {
      return res.status(400).json({
        success: false,
        message: "Bank ID, invoice number, and amount are required",
      });
    }

    // Validate bank exists in MongoDB
    if (!mongoose.Types.ObjectId.isValid(bankId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid bank ID format",
      });
    }

    const bank = await Bank.findById(bankId);
    if (!bank) {
      return res.status(404).json({
        success: false,
        message: "Bank not found",
      });
    }

    // TODO: Validate invoice exists in MongoDB
    // const invoice = await Invoice.findOne({ invoiceNumber });
    // if (!invoice) {
    //   return res.status(404).json({
    //     success: false,
    //     message: 'Invoice not found'
    //   });
    // }

    // Generate unique transaction ID
    const transactionId = await generateTransactionId();

    // Create transaction
    const transaction = await prisma.transaction.create({
      data: {
        transactionId,
        bankId,
        bankName: bank.name,
        invoiceNumber,
        amount: parseFloat(amount),
        transactionDate: transactionDate
          ? new Date(transactionDate)
          : new Date(),
        paymentMethod: paymentMethod || "bank_transfer",
        paymentStatus: paymentStatus || "completed",
        reference,
        remarks,
        createdBy,
      },
    });

    res.status(201).json({
      success: true,
      message: "Transaction created successfully",
      data: transaction,
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
 * Get all transactions with filters and pagination
 * GET /api/transactions
 */
exports.getTransactions = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      bankId,
      invoiceNumber,
      paymentStatus,
      startDate,
      endDate,
      search,
    } = req.query;

    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Build where clause
    const where = {};

    if (bankId) where.bankId = bankId;
    if (invoiceNumber) where.invoiceNumber = invoiceNumber;
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
        { invoiceNumber: { contains: search, mode: "insensitive" } },
        { reference: { contains: search, mode: "insensitive" } },
      ];
    }

    // Execute query
    const [transactions, total] = await Promise.all([
      prisma.transaction.findMany({
        where,
        skip,
        take: parseInt(limit),
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
 * Get single transaction by ID
 * GET /api/transactions/:id
 */
exports.getTransactionById = async (req, res) => {
  try {
    const { id } = req.params;

    const transaction = await prisma.transaction.findUnique({
      where: { id },
    });

    if (!transaction) {
      return res.status(404).json({
        success: false,
        message: "Transaction not found",
      });
    }

    res.status(200).json({
      success: true,
      data: transaction,
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
 * Update transaction
 * PUT /api/transactions/:id
 */
exports.updateTransaction = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      amount,
      transactionDate,
      paymentMethod,
      paymentStatus,
      reference,
      remarks,
    } = req.body;

    // Check if transaction exists
    const existingTransaction = await prisma.transaction.findUnique({
      where: { id },
    });

    if (!existingTransaction) {
      return res.status(404).json({
        success: false,
        message: "Transaction not found",
      });
    }

    // Build update data
    const updateData = {};
    if (amount !== undefined) updateData.amount = parseFloat(amount);
    if (transactionDate) updateData.transactionDate = new Date(transactionDate);
    if (paymentMethod) updateData.paymentMethod = paymentMethod;
    if (paymentStatus) updateData.paymentStatus = paymentStatus;
    if (reference !== undefined) updateData.reference = reference;
    if (remarks !== undefined) updateData.remarks = remarks;

    // Update transaction
    const transaction = await prisma.transaction.update({
      where: { id },
      data: updateData,
    });

    res.status(200).json({
      success: true,
      message: "Transaction updated successfully",
      data: transaction,
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

    // Check if transaction exists
    const transaction = await prisma.transaction.findUnique({
      where: { id },
    });

    if (!transaction) {
      return res.status(404).json({
        success: false,
        message: "Transaction not found",
      });
    }

    // Delete transaction
    await prisma.transaction.delete({
      where: { id },
    });

    res.status(200).json({
      success: true,
      message: "Transaction deleted successfully",
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
 * Get transaction summary/statistics
 * GET /api/transactions/summary
 */
exports.getTransactionSummary = async (req, res) => {
  try {
    const { startDate, endDate, bankId } = req.query;

    const where = {};
    if (startDate || endDate) {
      where.transactionDate = {};
      if (startDate) where.transactionDate.gte = new Date(startDate);
      if (endDate) where.transactionDate.lte = new Date(endDate);
    }
    if (bankId) where.bankId = bankId;

    const [totalAmount, transactionCount, statusBreakdown] = await Promise.all([
      prisma.transaction.aggregate({
        where,
        _sum: { amount: true },
      }),
      prisma.transaction.count({ where }),
      prisma.transaction.groupBy({
        by: ["paymentStatus"],
        where,
        _sum: { amount: true },
        _count: true,
      }),
    ]);

    res.status(200).json({
      success: true,
      data: {
        totalAmount: totalAmount._sum.amount || 0,
        transactionCount,
        statusBreakdown,
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
