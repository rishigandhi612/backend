/**
 * Accounting Controller
 * Mount at: /api/accounting
 */

const Customer = require("../models/customer.models");
const {
  createReceipt,
  createOpeningBalance,
  applyOnAccountToBill,
  getCustomerBills,
  getCustomerVouchers,
  getCustomerOnAccountBalance,
  getOnAccountAllocations,
  getReceiptById,
  updateReceipt,
} = require("../services/voucher.service");

// ── POST /api/accounting/receipts ─────────────────────────────────────────────
/**
 * Body:
 * {
 *   customerId:    "mongo_customer_id",
 *   totalAmount:   15000,
 *   paymentMethod: "NEFT_RTGS" | "CHEQUE" | "CASH" | "UPI",
 *   bankId:        "mongo_bank_id",   // required unless paymentMethod = CASH
 *   utrNumber:     "UTR123",          // for NEFT_RTGS
 *   chequeNumber:  "004521",          // for CHEQUE
 *   chequeDate:    "2025-02-20",      // for CHEQUE
 *   upiRef:        "UPI123",          // for UPI
 *   voucherDate:   "2025-05-26",
 *   narration:     "Payment against May invoices",
 *   allocations: [
 *     { billId: "postgres-uuid", allocatedAmount: 10000 },
 *     // remainder auto-becomes on-account
 *   ]
 * }
 */
const recordReceipt = async (req, res) => {
  try {
    const {
      customerId,
      totalAmount,
      paymentMethod,
      bankId,
      chequeNumber,
      chequeDate,
      utrNumber,
      upiRef,
      reference,
      narration,
      voucherDate,
      allocations,
    } = req.body;

    const customer = await Customer.findById(customerId);
    if (!customer) {
      return res
        .status(404)
        .json({ success: false, message: `Customer ${customerId} not found` });
    }

    const voucher = await createReceipt({
      customerId,
      totalAmount,
      paymentMethod,
      bankId,
      chequeNumber,
      chequeDate,
      utrNumber,
      upiRef,
      reference,
      narration,
      voucherDate,
      createdBy: req.user?.id ?? null,
      allocations: allocations ?? [],
    });

    return res.status(201).json({
      success: true,
      data: voucher,
      message: `Receipt ${voucher.voucherId} recorded. On-account: ₹${voucher.onAccountAmount}`,
    });
  } catch (error) {
    return res.status(isValidation(error) ? 400 : 500).json({
      success: false,
      message: error.message,
    });
  }
};

// ── POST /api/accounting/opening-balances ─────────────────────────────────────
/**
 * Body:
 * {
 *   customerId: "mongo_id",
 *   amount:     25000,
 *   asOfDate:   "2024-04-01",
 *   narration:  "Balance brought forward from Tally"
 * }
 */
const recordOpeningBalance = async (req, res) => {
  try {
    const { customerId, amount, asOfDate, narration } = req.body;

    const customer = await Customer.findById(customerId);
    if (!customer) {
      return res
        .status(404)
        .json({ success: false, message: `Customer ${customerId} not found` });
    }

    const result = await createOpeningBalance({
      customerId,
      customerName: customer.name,
      amount,
      asOfDate,
      narration,
      createdBy: req.user?.id ?? null,
    });

    return res.status(201).json({
      success: true,
      data: result,
      message: `Opening balance ${result.openingBalance.referenceNo} created`,
    });
  } catch (error) {
    return res.status(isValidation(error) ? 400 : 500).json({
      success: false,
      message: error.message,
    });
  }
};

// ── POST /api/accounting/on-account/apply ─────────────────────────────────────
/**
 * Apply an on-account allocation to a specific bill.
 *
 * Body:
 * {
 *   allocationId: "uuid",   // BillAllocation where billId is null
 *   billId:       "uuid",   // Bill to apply it to
 *   amount:       5000      // Optional — partial application
 * }
 */
const applyOnAccount = async (req, res) => {
  try {
    const { allocationId, billId, amount } = req.body;

    if (!allocationId)
      return res
        .status(400)
        .json({ success: false, message: "allocationId is required" });
    if (!billId)
      return res
        .status(400)
        .json({ success: false, message: "billId is required" });

    const updatedBill = await applyOnAccountToBill(
      allocationId,
      billId,
      amount,
    );

    return res.json({
      success: true,
      data: updatedBill,
      message: `On-account amount applied to bill ${updatedBill.invoiceNumber}`,
    });
  } catch (error) {
    return res.status(isValidation(error) ? 400 : 500).json({
      success: false,
      message: error.message,
    });
  }
};

// ── GET /api/accounting/customers/:customerId/bills ───────────────────────────
/**
 * Query params:
 *   status        - UNPAID | PARTIAL | PAID | OVERPAID (comma-separated, optional)
 *   financialYear - "2024-25" (optional)
 */
const getBills = async (req, res) => {
  try {
    const { customerId } = req.params;
    const { status, financialYear } = req.query;

    const customer = await Customer.findById(customerId);
    if (!customer) {
      return res
        .status(404)
        .json({ success: false, message: "Customer not found" });
    }

    const statusFilter = status
      ? status.split(",").map((s) => s.trim().toUpperCase())
      : undefined;

    const bills = await getCustomerBills(customerId, {
      status: statusFilter,
      financialYear,
    });

    const totalPending = bills.reduce((s, b) => s + b.pendingAmount, 0);

    return res.json({
      success: true,
      data: bills,
      summary: {
        total: bills.length,
        totalPending: Math.round(totalPending * 100) / 100,
        byStatus: {
          UNPAID: bills.filter((b) => b.status === "UNPAID").length,
          PARTIAL: bills.filter((b) => b.status === "PARTIAL").length,
          PAID: bills.filter((b) => b.status === "PAID").length,
          OVERPAID: bills.filter((b) => b.status === "OVERPAID").length,
        },
      },
      customer: { id: customer._id, name: customer.name },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ── GET /api/accounting/customers/:customerId/on-account ──────────────────────

const getOnAccount = async (req, res) => {
  try {
    const { customerId } = req.params;

    const customer = await Customer.findById(customerId);
    if (!customer) {
      return res
        .status(404)
        .json({ success: false, message: "Customer not found" });
    }

    const [balance, allocations] = await Promise.all([
      getCustomerOnAccountBalance(customerId),
      getOnAccountAllocations(customerId),
    ]);

    return res.json({
      success: true,
      data: {
        balance,
        allocations,
      },
      customer: { id: customer._id, name: customer.name },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ── GET /api/accounting/receipts/:voucherId ─────────────────────────────────

const fetchReceipt = async (req, res) => {
  try {
    const { voucherId } = req.params;
    const voucher = await getReceiptById(voucherId);
    return res.json({ success: true, data: voucher });
  } catch (error) {
    const status = error.message.toLowerCase().includes("not found")
      ? 404
      : 500;
    return res.status(status).json({ success: false, message: error.message });
  }
};

// ── PUT /api/accounting/receipts/:voucherId (edit existing receipt)

const editReceipt = async (req, res) => {
  try {
    const { voucherId } = req.params;
    const updates = req.body;
    const voucher = await updateReceipt(voucherId, {
      ...updates,
      // pass user information if needed (though not used currently)
      createdBy: req.user?.id ?? null,
    });
    return res.json({
      success: true,
      data: voucher,
      message: `Receipt ${voucher.voucherId} updated`,
    });
  } catch (error) {
    const status = isValidation(error)
      ? 400
      : error.message.toLowerCase().includes("not found")
        ? 404
        : 500;
    return res.status(status).json({ success: false, message: error.message });
  }
};

// ── GET /api/accounting/customers/:customerId/vouchers ────────────────────────

const getVouchers = async (req, res) => {
  try {
    const { customerId } = req.params;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;

    const customer = await Customer.findById(customerId);
    if (!customer) {
      return res
        .status(404)
        .json({ success: false, message: "Customer not found" });
    }

    const result = await getCustomerVouchers(customerId, { page, limit });
    return res.json({ success: true, ...result });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ── Helpers ────────────────────────────────────────────────────────────────────

const VALIDATION_KEYWORDS = [
  "required",
  "must be",
  "not found",
  "do not belong",
  "cannot exceed",
  "already applied",
  "only has",
];

const isValidation = (error) =>
  VALIDATION_KEYWORDS.some((kw) => error.message.toLowerCase().includes(kw));

module.exports = {
  recordReceipt,
  recordOpeningBalance,
  applyOnAccount,
  getBills,
  getOnAccount,
  getVouchers,
  fetchReceipt,
  editReceipt,
};
