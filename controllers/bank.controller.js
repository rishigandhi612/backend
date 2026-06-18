const bank = require("../models/bank.models");
const prisma = require("../config/prisma");
const Customer = require("../models/customer.models");

const toFloat = (val) => parseFloat(parseFloat(val ?? 0).toFixed(2));

const getAllBanks = async (req, res, next) => {
  try {
    let response = await bank.find();
    res.json({
      success: true,
      data: response,
    });
  } catch (error) {
    res.json({
      success: false,
      error: error,
    });
  }
};
const getBankById = async (req, res, next) => {
  const id = req.params.id;
  try {
    let response = await bank.findById(id);
    res.json({
      success: true,
      data: response,
    });
  } catch (error) {
    res.json({
      success: false,
      error: error,
    });
  }
};
const createBank = async (req, res, next) => {
  let bankData = req.body;

  try {
    let response = await bank.create(bankData);
    res.json({
      success: true,
      data: response,
    });
  } catch (error) {
    res.json({
      success: false,
      error: error,
    });
  }
};
const updateBank = async (req, res, next) => {
  let newBankData = req.body;
  let pid = req.params.id;
  try {
    let response = await bank.findByIdAndUpdate(pid, newBankData);
    res.json({
      success: true,
      data: response,
      newBankData,
    });
  } catch (error) {
    res.json({
      success: false,
      error: error,
    });
  }
};
const deleteBank = async (req, res, next) => {
  let pid = req.params.id;
  console.log("Deleting bank with id:", pid);
  try {
    let response = await bank.findByIdAndDelete(pid);
    res.json({
      success: true,
      data: response,
      message: "Bank Deleted whose id was " + pid,
    });
  } catch (error) {
    res.json({
      success: false,
      error: error,
    });
  }
};

// Get transactions for a specific bank with pagination and filters
const getTransactionsByBank = async (req, res, next) => {
  try {
    const bankId = req.params.id;

    // validate bank exists
    let bankDoc = await bank.findById(bankId);
    if (!bankDoc) {
      return res
        .status(404)
        .json({ success: false, message: "Bank not found" });
    }

    const {
      page = 1,
      limit = 20,
      startDate,
      endDate,
      transactionType,
      voucherType,
      paymentStatus,
      search,
      sortBy = "voucherDate",
      sortDir = "asc",
    } = req.query;

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const where = { bankId };
    if (startDate || endDate) {
      where.voucherDate = {};
      if (startDate) where.voucherDate.gte = new Date(startDate);
      if (endDate) where.voucherDate.lte = new Date(endDate);
    }

    const [totalAmountAgg, count, typeBreakdown, methodBreakdown] =
      await Promise.all([
        prisma.voucher.aggregate({ where, _sum: { totalAmount: true } }),
        prisma.voucher.count({ where }),
        prisma.voucher.groupBy({
          by: ["type"],
          where,
          _sum: { totalAmount: true },
          _count: true,
        }),
        prisma.voucher.groupBy({
          by: ["paymentMethod"],
          where,
          _sum: { totalAmount: true },
          _count: true,
        }),
      ]);

    if (search) {
      where.OR = [
        { transactionId: { contains: search, mode: "insensitive" } },
        { reference: { contains: search, mode: "insensitive" } },
        { bankName: { contains: search, mode: "insensitive" } },
      ];
    }

    const [transactions, total] = await Promise.all([
      prisma.voucher.findMany({
        where,
        skip,
        take: parseInt(limit),
        include: { allocations: { include: { bill: true } } },
        orderBy: { [sortBy]: sortDir === "asc" ? "asc" : "desc" },
      }),
      prisma.voucher.count({ where }),
    ]);

    // Enrich transactions with customer name from MongoDB
    const customerIds = Array.from(
      new Set(transactions.map((t) => t.customerId).filter(Boolean)),
    );
    let customers = [];
    if (customerIds.length > 0) {
      customers = await Customer.find({ _id: { $in: customerIds } }).lean();
    }
    const customerMap = customers.reduce((m, c) => {
      m[c._id.toString()] = c;
      return m;
    }, {});

    const enrichedTransactions = transactions.map((t) => ({
      ...t,
      customer: t.customerId
        ? { id: t.customerId, name: customerMap[t.customerId]?.name || null }
        : null,
      allocations: (t.allocations || []).map((a) => {
        const bill = a.bill || null;
        const toNum = (v) => {
          if (v === null || v === undefined) return null;
          try {
            return parseFloat(v.toString());
          } catch (e) {
            return Number(v);
          }
        };

        const totalAmount = bill ? toNum(bill.billAmount) : null;
        const allocated = toNum(a.allocatedAmount);
        const pendingAmount =
          bill && totalAmount !== null
            ? Math.round((totalAmount - toNum(bill.allocatedAmount)) * 100) /
              100
            : null;

        return {
          ...a,
          allocatedAmount: allocated,
          totalAmount,
          pendingAmount,
          bill: bill
            ? {
                id: bill.mongoInvoiceId,

                invoiceNumber: bill.invoiceNumber,
              }
            : null,
        };
      }),
    }));

    res.status(200).json({
      success: true,
      data: enrichedTransactions,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    console.error("Get transactions by bank error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch transactions",
      error: error.message,
    });
  }
};

// Get total debit/credit for a bank during a period
const getBankTotals = async (req, res, next) => {
  try {
    const bankId = req.params.id;
    const { startDate, endDate } = req.query;

    // validate bank exists
    let bankDoc = await bank.findById(bankId);
    if (!bankDoc) {
      return res
        .status(404)
        .json({ success: false, message: "Bank not found" });
    }

    const whereBase = { bankId };
    if (startDate || endDate) {
      whereBase.voucherDate = {};
      if (startDate) whereBase.voucherDate.gte = new Date(startDate);
      if (endDate) whereBase.voucherDate.lte = new Date(endDate);
    }

    // Based on existing logic: type === 'PAYMENT' -> debit, 'RECEIPT' -> credit
    const [debitAgg, creditAgg, count] = await Promise.all([
      prisma.voucher.aggregate({
        where: { ...whereBase, type: "PAYMENT" },
        _sum: { totalAmount: true },
      }),
      prisma.voucher.aggregate({
        where: { ...whereBase, type: "RECEIPT" },
        _sum: { totalAmount: true },
      }),
      prisma.voucher.count({ where: whereBase }),
    ]);

    const totalDebit = toFloat(debitAgg._sum.totalAmount);
    const totalCredit = toFloat(creditAgg._sum.totalAmount);

    res.status(200).json({
      success: true,
      data: {
        totalDebit,
        totalCredit,
        net: toFloat(totalCredit - totalDebit),
        transactionCount: count,
      },
    });
  } catch (error) {
    console.error("Get bank totals error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch bank totals",
      error: error.message,
    });
  }
};

// Get bank-level summary (counts and breakdowns)
const getBankSummary = async (req, res, next) => {
  try {
    const bankId = req.params.id;
    const { startDate, endDate } = req.query;

    // validate bank exists
    let bankDoc = await bank.findById(bankId);
    if (!bankDoc) {
      return res
        .status(404)
        .json({ success: false, message: "Bank not found" });
    }

    const where = { bankId };
    if (startDate || endDate) {
      where.voucherDate = {};
      if (startDate) where.voucherDate.gte = new Date(startDate);
      if (endDate) where.voucherDate.lte = new Date(endDate);
    }

    const [totalAmountAgg, count, typeBreakdown, methodBreakdown] =
      await Promise.all([
        prisma.voucher.aggregate({ where, _sum: { totalAmount: true } }),
        prisma.voucher.count({ where }),
        prisma.voucher.groupBy({
          by: ["type"],
          where,
          _sum: { totalAmount: true },
          _count: true,
        }),
        prisma.voucher.groupBy({
          by: ["paymentMethod"],
          where,
          _sum: { totalAmount: true },
          _count: true,
        }),
      ]);

    res.status(200).json({
      success: true,
      data: {
        totalAmount: totalAmountAgg._sum.totalAmount || 0,
        transactionCount: count,
        typeBreakdown,
        methodBreakdown,
      },
    });
  } catch (error) {
    console.error("Get bank summary error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch bank summary",
      error: error.message,
    });
  }
};

module.exports = {
  getAllBanks,
  getBankById,
  createBank,
  updateBank,
  deleteBank,
  getTransactionsByBank,
  getBankTotals,
  getBankSummary,
};
