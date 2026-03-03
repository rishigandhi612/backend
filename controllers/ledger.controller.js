/**
 * Ledger & Reporting Controller
 * Mount at: /api/reports
 */

const CustomerProduct = require("../models/cust-prod.models");
const Customer = require("../models/customer.models");
const {
  getCustomerLedger,
  getOutstandingBillsReport,
  getReceivablesSummary,
  getAgeingAnalysis,
  getBankwiseCollectionReport,
} = require("../services/ledger.service");

// ── GET /api/reports/ledger/:customerId ───────────────────────────────────────
/**
 * Full transaction history for one customer.
 *
 * Query params:
 *   financialYear  "current" | "previous" | "2024-25"
 *   startDate      "2025-04-01"   (overrides financialYear if provided)
 *   endDate        "2026-03-31"
 *   page           default 1
 *   limit          default 50
 *   sortOrder      "asc" | "desc"  default asc
 */
const customerLedger = async (req, res) => {
  try {
    const { customerId } = req.params;
    const {
      financialYear,
      startDate,
      endDate,
      page = 1,
      limit = 50,
      sortOrder = "asc",
    } = req.query;

    const customer = await Customer.findById(customerId).lean();
    if (!customer) {
      return res
        .status(404)
        .json({ success: false, message: "Customer not found" });
    }

    const result = await getCustomerLedger(customerId, {
      financialYear,
      startDate,
      endDate,
      page: parseInt(page),
      limit: parseInt(limit),
      sortOrder,
    });

    return res.json({
      success: true,
      customer: {
        id: customer._id,
        name: customer.name,
        email: customer.email,
        phone: customer.phone,
      },
      ...result,
    });
  } catch (error) {
    console.error("customerLedger error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ── GET /api/reports/outstanding ──────────────────────────────────────────────
/**
 * All unpaid/partial bills across all customers (or one customer).
 *
 * Query params:
 *   customerId     optional — filter to one customer
 *   financialYear
 *   startDate / endDate
 *   page / limit
 */
const outstandingBills = async (req, res) => {
  try {
    const {
      customerId,
      financialYear,
      startDate,
      endDate,
      page = 1,
      limit = 50,
    } = req.query;

    const result = await getOutstandingBillsReport({
      customerId,
      financialYear,
      startDate,
      endDate,
      page: parseInt(page),
      limit: parseInt(limit),
    });

    return res.json({ success: true, ...result });
  } catch (error) {
    console.error("outstandingBills error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ── GET /api/reports/receivables ──────────────────────────────────────────────
/**
 * Bill-wise receivables summary per customer.
 *
 * Query params:
 *   customerId     optional — scope to one customer
 *   financialYear
 *   startDate / endDate
 */
const receivablesSummary = async (req, res) => {
  try {
    const { customerId, financialYear, startDate, endDate } = req.query;

    const result = await getReceivablesSummary({
      customerId,
      financialYear,
      startDate,
      endDate,
    });

    return res.json({ success: true, ...result });
  } catch (error) {
    console.error("receivablesSummary error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ── GET /api/reports/ageing ───────────────────────────────────────────────────
/**
 * Ageing analysis — outstanding bills bucketed by age.
 *
 * Query params:
 *   customerId   optional — scope to one customer or all
 *   asOfDate     "2025-05-26" — age calculated relative to this date (default today)
 */
const ageingAnalysis = async (req, res) => {
  try {
    const { customerId, asOfDate } = req.query;

    const result = await getAgeingAnalysis({
      customerId,
      asOfDate: asOfDate ? new Date(asOfDate) : new Date(),
    });

    return res.json({ success: true, ...result });
  } catch (error) {
    console.error("ageingAnalysis error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ── GET /api/reports/bank-collection ─────────────────────────────────────────
/**
 * Receipts grouped by bank.
 *
 * Query params:
 *   financialYear
 *   startDate / endDate
 *   customerId   optional
 */
const bankwiseCollection = async (req, res) => {
  try {
    const { customerId, financialYear, startDate, endDate } = req.query;

    const result = await getBankwiseCollectionReport({
      customerId,
      financialYear,
      startDate,
      endDate,
    });

    return res.json({ success: true, ...result });
  } catch (error) {
    console.error("bankwiseCollection error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Get financial year date range
 * @param {string} year - Format: "2024-25" or "current" or "previous"
 * @returns {Object} { startDate, endDate }
 */
const getFinancialYearRange = (year) => {
  let startYear, endYear;
  const currentDate = new Date();
  const currentMonth = currentDate.getMonth(); // 0-11
  const currentYear = currentDate.getFullYear();

  if (year === "current") {
    // If current month is Jan-Mar (0-2), FY started last year
    // If current month is Apr-Dec (3-11), FY started this year
    startYear = currentMonth < 3 ? currentYear - 1 : currentYear;
    endYear = startYear + 1;
  } else if (year === "previous") {
    startYear = currentMonth < 3 ? currentYear - 2 : currentYear - 1;
    endYear = startYear + 1;
  } else if (year && year.includes("-")) {
    // Format: "2024-25"
    const [start, end] = year.split("-");
    startYear = parseInt(start);
    endYear = end.length === 2 ? 2000 + parseInt(end) : parseInt(end);
  } else {
    // Default to current financial year
    startYear = currentMonth < 3 ? currentYear - 1 : currentYear;
    endYear = startYear + 1;
  }

  const startDate = new Date(startYear, 3, 1); // April 1st
  const endDate = new Date(endYear, 2, 31, 23, 59, 59, 999); // March 31st

  return { startDate, endDate };
};

/**
 * Get all invoices for a specific customer with financial year filtering
 * @route GET /api/customers/:customerId/invoices
 * @query {string} financialYear - "current", "previous", or "2024-25"
 * @query {number} page - Page number (default: 1)
 * @query {number} itemsPerPage - Items per page (default: 10)
 * @query {string} sortBy - Sort field (default: "createdAt")
 * @query {boolean} sortDesc - Sort descending (default: true)
 * @query {string} search - Search in invoice number or roll IDs
 */
const getCustomerInvoicesByFinancialYear = async (req, res, next) => {
  try {
    const { customerId } = req.params;
    const page = parseInt(req.query.page) || 1;
    const itemsPerPage = parseInt(req.query.itemsPerPage) || 10;
    const sortBy = req.query.sortBy || "createdAt";
    const sortDesc = req.query.sortDesc !== "false"; // default true
    const search = req.query.search || "";
    const financialYear = req.query.financialYear || "current";
    const skip = (page - 1) * itemsPerPage;

    // Validate customer exists
    const customer = await Customer.findById(customerId);
    if (!customer) {
      return res.status(404).json({
        success: false,
        error: "Customer not found",
      });
    }

    // Get financial year date range
    const { startDate, endDate } = getFinancialYearRange(financialYear);

    // Build filter
    let filter = {
      customer: customerId,
      createdAt: {
        $gte: startDate,
        $lte: endDate,
      },
    };

    // Add search filter if provided
    if (search && search.trim() !== "") {
      const searchPattern = new RegExp(search.trim(), "i");
      filter.$or = [
        { invoiceNumber: searchPattern },
        { rollIds: { $in: [searchPattern] } },
      ];
    }

    // Build sort object
    const sort = {};
    sort[sortBy] = sortDesc ? -1 : 1;

    // Get total count
    const totalItems = await CustomerProduct.countDocuments(filter);

    // Fetch invoices
    const invoices = await CustomerProduct.find(filter)
      .populate("customer")
      .populate("products.product")
      .populate("transporter")
      .sort(sort)
      .skip(skip)
      .limit(itemsPerPage)
      .exec();

    // Calculate totals for the financial year
    const financialYearTotals = await CustomerProduct.aggregate([
      {
        $match: {
          customer: customer._id,
          createdAt: {
            $gte: startDate,
            $lte: endDate,
          },
        },
      },
      {
        $group: {
          _id: null,
          totalInvoices: { $sum: 1 },
          totalAmount: { $sum: "$totalAmount" },
          totalGrandTotal: { $sum: "$grandTotal" },
        },
      },
    ]);

    const summary =
      financialYearTotals.length > 0
        ? financialYearTotals[0]
        : { totalInvoices: 0, totalAmount: 0, totalGrandTotal: 0 };

    res.json({
      success: true,
      data: invoices,
      customer: {
        id: customer._id,
        name: customer.name,
        gstin: customer.gstin,
      },
      financialYear: {
        label: financialYear,
        startDate,
        endDate,
      },
      summary: {
        totalInvoices: summary.totalInvoices,
        totalAmount: summary.totalAmount,
        grandTotal: summary.totalGrandTotal,
      },
      pagination: {
        page,
        itemsPerPage,
        totalItems,
        totalPages: Math.ceil(totalItems / itemsPerPage),
      },
    });
  } catch (error) {
    console.error("Error in getCustomerInvoicesByFinancialYear:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};

module.exports = {
  getCustomerInvoicesByFinancialYear,
  getFinancialYearRange, // Export helper for reuse
  customerLedger,
  outstandingBills,
  receivablesSummary,
  ageingAnalysis,
  bankwiseCollection,
};
