/**
 * Accounting Controller
 * Mount at: /api/accounting
 */

const Customer = require("../models/customer.models");

const CustomerProduct = require("../models/cust-prod.models");
const {
  createReceipt,
  createOpeningBalance,
  applyOnAccountToBill,
  computeBillStatus,
  getCustomerBills,
  getCustomerVouchers,
  getCustomerOnAccountBalance,
  getOnAccountAllocations,
  getReceiptById,
  updateReceipt,
  deleteReceipt,
} = require("../services/voucher.service");
const {
  createInvoiceNote,
  listInvoiceNotes,
} = require("../services/invoiceNote.service");

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

// ── POST /api/accounting/invoice-notes ────────────────────────────────────────

const TOLERANCE = 0.0;
const toFloat = (val) => parseFloat(parseFloat(val ?? 0).toFixed(2));

const ROLL_REASON_TYPES = ["GOODS_RETURN", "DAMAGED_GOODS"];
const WEIGHT_RATE_REASON_TYPES = ["RATE_DIFFERENCE"];
const FREE_REASON_TYPES = ["PRICE_ADJUSTMENT", "OTHER"];
const ALL_REASON_TYPES = [
  ...ROLL_REASON_TYPES,
  ...WEIGHT_RATE_REASON_TYPES,
  ...FREE_REASON_TYPES,
];

// ─────────────────────────────────────────────────────────────────────────────
// Validators
// ─────────────────────────────────────────────────────────────────────────────

const validateTaxBreakdown = ({
  taxableAmount,
  cgst,
  sgst,
  igst,
  otherCharges,
  totalAmount,
}) => {
  const computed = toFloat(
    toFloat(taxableAmount) +
      toFloat(cgst) +
      toFloat(sgst) +
      toFloat(igst) +
      toFloat(otherCharges),
  );
  const claimed = toFloat(totalAmount);

  if (Math.abs(computed - claimed) > TOLERANCE) {
    throw new Error(
      `Amount mismatch: taxableAmount + taxes + otherCharges = ${computed} but totalAmount = ${claimed}`,
    );
  }
};

const validateRateDifferenceFields = ({
  netWeight,
  originalRate,
  revisedRate,
  taxableAmount,
}) => {
  if (!netWeight || isNaN(netWeight) || parseFloat(netWeight) <= 0) {
    throw new Error(
      "netWeight is required and must be a positive number for RATE_DIFFERENCE",
    );
  }
  if (!originalRate || isNaN(originalRate) || parseFloat(originalRate) <= 0) {
    throw new Error("originalRate is required for RATE_DIFFERENCE");
  }
  if (!revisedRate || isNaN(revisedRate) || parseFloat(revisedRate) <= 0) {
    throw new Error("revisedRate is required for RATE_DIFFERENCE");
  }

  const oRate = toFloat(originalRate);
  const rRate = toFloat(revisedRate);

  if (rRate >= oRate) {
    throw new Error(
      `revisedRate (${rRate}) must be lower than originalRate (${oRate}) for a credit note. ` +
        `If the rate increased, raise a Debit Note instead.`,
    );
  }

  const rateDiff = toFloat(oRate - rRate);
  const computedTaxable = toFloat(parseFloat(netWeight) * rateDiff);
  const claimedTaxable = toFloat(taxableAmount);

  if (Math.abs(computedTaxable - claimedTaxable) > TOLERANCE) {
    throw new Error(
      `netWeight × (originalRate - revisedRate) = ${netWeight} × ${rateDiff} = ${computedTaxable} ` +
        `but taxableAmount = ${claimedTaxable}`,
    );
  }

  return rateDiff;
};

const validateRollsAgainstInvoice = async (
  rollIds,
  originalInvoice,
  invoiceNumber,
) => {
  const invoiceRollIds = originalInvoice.rollIds ?? [];
  const invalidRolls = rollIds.filter((r) => !invoiceRollIds.includes(r));

  if (invalidRolls.length > 0) {
    throw new Error(
      `These rollIds do not belong to invoice ${invoiceNumber}: ${invalidRolls.join(", ")}`,
    );
  }

  // Check all rolls are still in "sold" state in Postgres Inventory
  const notSold = await prisma.inventory.findMany({
    where: {
      rollId: { in: rollIds },
      status: { not: "sold" },
    },
    select: { rollId: true, status: true },
  });

  if (notSold.length > 0) {
    const detail = notSold.map((r) => `${r.rollId} (${r.status})`).join(", ");
    throw new Error(
      `These rolls are not in sold state and cannot be returned: ${detail}`,
    );
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Non-blocking side effects
// ─────────────────────────────────────────────────────────────────────────────

const updateInventoryForReturn = async (rollIds, reasonType, noteNumber) => {
  const newStatus = reasonType === "DAMAGED_GOODS" ? "damaged" : "returned";

  try {
    await prisma.inventory.updateMany({
      where: { rollId: { in: rollIds } },
      data: {
        status: newStatus,
        returnedAt: new Date(),
        creditNoteNumber: noteNumber,
      },
    });
  } catch (err) {
    console.error(
      `[CreditNote] Inventory update failed for note ${noteNumber}:`,
      err.message,
    );
    // TODO: push to retry queue (Redis/BullMQ)
  }
};

const restoreProductQuantities = async (
  rollIds,
  originalInvoice,
  noteNumber,
) => {
  try {
    for (const productData of originalInvoice.products) {
      const productRollIds = originalInvoice.rollIds ?? [];
      const returnedQty = rollIds.filter((r) =>
        productRollIds.includes(r),
      ).length;

      if (returnedQty > 0) {
        await Product.findByIdAndUpdate(productData.product, {
          $inc: { quantity: returnedQty },
        });
      }
    }
  } catch (err) {
    console.error(
      `[CreditNote] Product quantity restore failed for note ${noteNumber}:`,
      err.message,
    );
    // TODO: push to retry queue
  }
};

const pushCreditNoteRefToInvoice = async (invoiceId, note) => {
  try {
    await CustomerProduct.findByIdAndUpdate(invoiceId, {
      $push: {
        creditNotes: {
          noteNumber: note.noteNumber,
          amount: note.amount,
          noteDate: note.noteDate,
        },
      },
    });
  } catch (err) {
    console.error(
      `[CreditNote] Failed to push note ref to MongoDB invoice:`,
      err.message,
    );
    // TODO: push to retry queue
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Controller
// ─────────────────────────────────────────────────────────────────────────────

const recordCreditNote = async (req, res) => {
  try {
    // const { customerId } = req.params;
    const {
      invoiceNumber,
      reasonType,
      reason,
      narration,
      customerId,
      // tax breakdown
      taxableAmount,
      cgst = 0,
      sgst = 0,
      igst = 0,
      otherCharges = 0,
      totalAmount,
      // scenario A — goods return
      rollIds = [],
      // scenario B — rate difference
      netWeight,
      originalRate,
      revisedRate,
      // common
      noteDate,
      status = "POSTED",
    } = req.body;

    // ── 1. Required field presence ─────────────────────────────────────────

    if (!invoiceNumber) {
      return res
        .status(400)
        .json({ success: false, message: "invoiceNumber is required" });
    }
    if (!reasonType || !ALL_REASON_TYPES.includes(reasonType)) {
      return res.status(400).json({
        success: false,
        message: `reasonType must be one of: ${ALL_REASON_TYPES.join(", ")}`,
      });
    }
    if (!totalAmount || isNaN(totalAmount) || parseFloat(totalAmount) <= 0) {
      return res.status(400).json({
        success: false,
        message: "totalAmount must be a positive number",
      });
    }
    if (
      !taxableAmount ||
      isNaN(taxableAmount) ||
      parseFloat(taxableAmount) <= 0
    ) {
      return res.status(400).json({
        success: false,
        message: "taxableAmount must be a positive number",
      });
    }

    // FREE_REASON_TYPES must have a reason text — no other validation available
    if (FREE_REASON_TYPES.includes(reasonType) && !reason?.trim()) {
      return res.status(400).json({
        success: false,
        message: `reason is mandatory for reasonType: ${reasonType}`,
      });
    }

    // ── 2. Scenario routing — mutually exclusive ───────────────────────────

    const hasRolls = Array.isArray(rollIds) && rollIds.length > 0;
    const hasWeightRate =
      netWeight != null && originalRate != null && revisedRate != null;

    if (ROLL_REASON_TYPES.includes(reasonType) && !hasRolls) {
      return res.status(400).json({
        success: false,
        message: `rollIds are required for reasonType: ${reasonType}`,
      });
    }
    if (WEIGHT_RATE_REASON_TYPES.includes(reasonType) && !hasWeightRate) {
      return res.status(400).json({
        success: false,
        message: `netWeight, originalRate and revisedRate are required for reasonType: ${reasonType}`,
      });
    }
    if (!ROLL_REASON_TYPES.includes(reasonType) && hasRolls) {
      return res.status(400).json({
        success: false,
        message: `rollIds are not applicable for reasonType: ${reasonType}`,
      });
    }

    // ── 3. Validate customer ───────────────────────────────────────────────

    const customer = await Customer.findById(customerId);
    if (!customer) {
      return res
        .status(404)
        .json({ success: false, message: "Customer not found" });
    }

    // ── 4. Fetch and verify original invoice from MongoDB ──────────────────

    const originalInvoice = await CustomerProduct.findOne({ invoiceNumber });
    if (!originalInvoice) {
      return res.status(404).json({
        success: false,
        message: `Invoice ${invoiceNumber} not found`,
      });
    }
    if (String(originalInvoice.customer) !== String(customerId)) {
      return res.status(400).json({
        success: false,
        message: `Invoice ${invoiceNumber} does not belong to customer ${customerId}`,
      });
    }

    // ── 5. Tax breakdown verification ─────────────────────────────────────

    try {
      validateTaxBreakdown({
        taxableAmount,
        cgst,
        sgst,
        igst,
        otherCharges,
        totalAmount,
      });
    } catch (err) {
      return res.status(400).json({ success: false, message: err.message });
    }

    // ── 6. Scenario-specific validation ───────────────────────────────────

    let rateDiff = null;

    // Scenario A — goods return: validate rolls
    if (hasRolls) {
      try {
        await validateRollsAgainstInvoice(
          rollIds,
          originalInvoice,
          invoiceNumber,
        );
      } catch (err) {
        return res.status(400).json({ success: false, message: err.message });
      }
    }

    // Scenario B — rate difference: validate weight × rate = taxableAmount
    if (hasWeightRate) {
      try {
        rateDiff = validateRateDifferenceFields({
          netWeight,
          originalRate,
          revisedRate,
          taxableAmount,
        });
      } catch (err) {
        return res.status(400).json({ success: false, message: err.message });
      }
    }

    // ── 7. Create credit note in Postgres (blocking — must succeed) ────────

    const note = await createInvoiceNote({
      noteType: "CREDIT_NOTE",
      documentType: "SALE",
      invoiceNumber,
      customerId,
      taxableAmount,
      cgst,
      sgst,
      igst,
      otherCharges,
      amount: totalAmount, // grand total — what hits the bill
      reasonType,
      reason: reason ?? null,
      narration: narration ?? null,
      rollIds,
      netWeight: netWeight ?? null,
      originalRate: originalRate ?? null,
      revisedRate: revisedRate ?? null,
      rateDiff: rateDiff ?? null,
      mongoInvoiceId: String(originalInvoice._id),
      noteDate,
      status,
      createdBy: req.user?.id ?? null,
    });

    // ── 8. Non-blocking side effects (scenario A only) ─────────────────────

    if (hasRolls) {
      // fire and forget — failures are logged, note is already committed
      updateInventoryForReturn(rollIds, reasonType, note.noteNumber);
      restoreProductQuantities(rollIds, originalInvoice, note.noteNumber);
    }

    // Always push ref back to MongoDB invoice regardless of scenario
    pushCreditNoteRefToInvoice(originalInvoice._id, note);

    // ── 9. Response ────────────────────────────────────────────────────────

    return res.status(201).json({
      success: true,
      data: note,
      message: `Credit note ${note.noteNumber} created against invoice ${invoiceNumber}`,
      meta: {
        scenario: hasRolls
          ? "GOODS_RETURN"
          : hasWeightRate
            ? "RATE_DIFFERENCE"
            : "VALUE_ADJUSTMENT",
        rollsAffected: hasRolls ? rollIds.length : 0,
        inventoryUpdated: hasRolls,
      },
    });
  } catch (error) {
    return res.status(isValidation(error) ? 400 : 500).json({
      success: false,
      message: error.message,
    });
  }
};

// ── GET /api/accounting/customers/:customerId/invoice-notes ───────────────────

const getInvoiceNotes = async (req, res) => {
  try {
    const { customerId } = req.params;
    const { invoiceNumber, financialYear, status } = req.query;

    const customer = await Customer.findById(customerId);
    if (!customer) {
      return res
        .status(404)
        .json({ success: false, message: "Customer not found" });
    }

    const notes = await listInvoiceNotes({
      customerId,
      invoiceNumber,
      financialYear,
      status,
      documentType: "SALE",
    });

    const summary = {
      total: notes.length,
      debitNotes: notes.filter((n) => n.noteType === "DEBIT_NOTE").length,
      creditNotes: notes.filter((n) => n.noteType === "CREDIT_NOTE").length,
      totalDebitAmount:
        Math.round(
          notes
            .filter((n) => n.noteType === "DEBIT_NOTE")
            .reduce((sum, note) => sum + note.amount, 0) * 100,
        ) / 100,
      totalCreditAmount:
        Math.round(
          notes
            .filter((n) => n.noteType === "CREDIT_NOTE")
            .reduce((sum, note) => sum + note.amount, 0) * 100,
        ) / 100,
    };

    return res.json({
      success: true,
      data: notes,
      summary,
      customer: {
        id: customer._id,
        name: customer.name,
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
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

    const statusFilter =
      status && status.trim()
        ? status.split(",").map((s) => s.trim().toUpperCase())
        : undefined;

    const [allBills, onAccountBalance] = await Promise.all([
      getCustomerBills(customerId, { financialYear }),
      getCustomerOnAccountBalance(customerId),
    ]);

    // ─── BUG 5 FIX ────────────────────────────────────────────────────────────
    // Opening balance bills are ledger anchors, not transactional bills.
    // Separate them out BEFORE applying the status filter so they are never
    // accidentally excluded by a status=PAID / status=UNPAID query.
    const openingBalanceBills = allBills.filter((b) => b.isOpeningBalance);
    const transactionalBills = allBills.filter((b) => !b.isOpeningBalance);

    const filteredTransactional =
      statusFilter && statusFilter.length > 0
        ? transactionalBills.filter((b) => statusFilter.includes(b.status))
        : transactionalBills;

    // Recombine: opening balance rows are always present in the result set.
    const filteredBills = [...openingBalanceBills, ...filteredTransactional];

    // ─── BUG 3 FIX ────────────────────────────────────────────────────────────
    // totalAdjustedAmount must NOT include opening balance bills, otherwise
    // those amounts are counted twice (once here, once in openingBalanceAmount).
    const totalAdjustedAmount = filteredTransactional.reduce(
      (s, b) => s + (b.adjustedAmount ?? b.billAmount),
      0,
    );

    const openingBalanceAmount = openingBalanceBills.reduce(
      (s, b) => s + (b.billAmount ?? 0),
      0,
    );

    const totalDebitNoteAmount = filteredBills.reduce(
      (s, b) => s + (b.debitNoteAmount ?? 0),
      0,
    );
    const totalCreditNoteAmount = filteredBills.reduce(
      (s, b) => s + (b.creditNoteAmount ?? 0),
      0,
    );

    // ─── BUG 4 FIX ────────────────────────────────────────────────────────────
    // On-account balance is advance money already paid by the customer.
    // Net pending = sum of bill pending amounts MINUS the on-account credit.
    // Clamped to 0 so it never goes negative in the summary (surplus is shown
    // separately via the onAccount field).
    const grossPending = filteredBills.reduce(
      (s, b) => s + (b.pendingAmount ?? 0),
      0,
    );
    const totalPending = Math.max(0, grossPending - onAccountBalance);

    const shaped = filteredBills.map((b) => ({
      id: b.id,
      invoiceDate: b.invoiceDate,
      invoiceno: b.invoiceNumber ?? b.mongoInvoiceId ?? null,
      mongoInvoiceId: b.mongoInvoiceId ?? null,
      debitNoteAmount: b.debitNoteAmount ?? 0,
      creditNoteAmount: b.creditNoteAmount ?? 0,
      adjustedAmount: b.adjustedAmount ?? b.billAmount,
      allocatedAmount: b.allocatedAmount ?? 0,
      pendingAmount: b.pendingAmount ?? 0,
      openingAmount: b.billAmount,
      isOpeningBalance: b.isOpeningBalance,
      status: b.status,
    }));

    // ─── BUG 6 FIX ────────────────────────────────────────────────────────────
    // On-account balance is a credit, so pendingAmount should be negative
    // (or zero if there is no balance). This allows frontend running-balance
    // calculations to correctly offset it against outstanding invoices.
    const onAccountEntry = {
      id: null,
      invoiceDate: null,
      invoiceno: "ON-ACCOUNT",
      mongoInvoiceId: null,
      debitNoteAmount: 0,
      creditNoteAmount: 0,
      adjustedAmount: 0,
      allocatedAmount: onAccountBalance,
      pendingAmount: onAccountBalance > 0 ? -onAccountBalance : 0,
      openingAmount: onAccountBalance,
      isOpeningBalance: false,
      status: "ON_ACCOUNT",
    };

    // ─── BUG 2 FIX ────────────────────────────────────────────────────────────
    // data has N+1 rows (bills + ON-ACCOUNT entry).
    // summary.total must reflect the full data array length, not just filteredBills,
    // so the frontend can rely on it for table rendering / pagination.
    const data = [...shaped, onAccountEntry];

    // ─── BUG 1 FIX ────────────────────────────────────────────────────────────
    // byStatus counts are derived from ALL bills (unfiltered transactional set),
    // not just filteredBills. This way the summary always shows the true
    // distribution across statuses regardless of the active status filter,
    // and summary.total reflects the unfiltered bill count so callers can
    // distinguish "X of Y shown" from "X total".
    return res.json({
      success: true,
      data,
      summary: {
        // Total unfiltered bill count (excludes the synthetic ON-ACCOUNT row)
        total: allBills.length,
        // Count actually returned in data (excludes ON-ACCOUNT row)
        filtered: filteredBills.length,
        totalAdjustedAmount: Math.round(totalAdjustedAmount * 100) / 100,
        totalPending: Math.round(totalPending * 100) / 100,
        grossPending: Math.round(grossPending * 100) / 100,
        totalDebitNoteAmount: Math.round(totalDebitNoteAmount * 100) / 100,
        totalCreditNoteAmount: Math.round(totalCreditNoteAmount * 100) / 100,
        onAccount: Math.round(onAccountBalance * 100) / 100,
        openingBalanceAmount: Math.round(openingBalanceAmount * 100) / 100,
        // Always reflects the full unfiltered distribution
        byStatus: {
          UNPAID: transactionalBills.filter((b) => b.status === "UNPAID")
            .length,
          PARTIAL: transactionalBills.filter((b) => b.status === "PARTIAL")
            .length,
          PAID: transactionalBills.filter((b) => b.status === "PAID").length,
          OVERPAID: transactionalBills.filter((b) => b.status === "OVERPAID")
            .length,
        },
      },
      customer: {
        id: customer._id,
        name: customer.name,
        address: customer.address,
        email: customer.email_id,
        phone: customer.phone_no,
        gstin: customer.gstin,
      },
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

    if (updates.customerId) {
      const customer = await Customer.findById(updates.customerId);
      if (!customer) {
        return res.status(404).json({
          success: false,
          message: `Customer ${updates.customerId} not found`,
        });
      }
    }

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

// ── DELETE /api/accounting/receipts/:voucherId ────────────────────────────────

const removeReceipt = async (req, res) => {
  try {
    const { voucherId } = req.params;
    const deletedVoucher = await deleteReceipt(voucherId);

    return res.json({
      success: true,
      data: deletedVoucher,
      message: `Receipt ${deletedVoucher.voucherId} deleted`,
    });
  } catch (error) {
    const status = isValidation(error)
      ? 400
      : error.message.toLowerCase().includes("not found")
        ? 404
        : 500;

    return res.status(status).json({
      success: false,
      message: error.message,
    });
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
  "valid date",
  "not found",
  "do not belong",
  "cannot exceed",
  "cannot be less",
  "exceeds overpaid",
  "negative allocations",
  "already applied",
  "only has",
  "supported yet",
  "unsupported",
];

const isValidation = (error) =>
  VALIDATION_KEYWORDS.some((kw) => error.message.toLowerCase().includes(kw));

module.exports = {
  recordReceipt,
  recordOpeningBalance,
  applyOnAccount,
  getInvoiceNotes,
  getBills,
  getOnAccount,
  getVouchers,
  fetchReceipt,
  editReceipt,
  removeReceipt,
  recordCreditNote,
};
