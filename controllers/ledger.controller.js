const CustomerProduct = require("../models/cust-prod.models");
const Customer = require("../models/customer.models");

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
};
