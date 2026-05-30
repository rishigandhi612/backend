/**
 * Ledger & Reporting Service
 *
 * Reports:
 *   1. Customer Ledger          — full Dr/Cr history for one customer
 *   2. Outstanding Bills        — unpaid/partial bills across all customers
 *   3. Bill-wise Receivables    — per customer summary (billed, collected, pending)
 *   4. Ageing Analysis          — 0-30, 31-60, 61-90, 90+ days
 *   5. Bank-wise Collection     — receipts grouped by bank
 *
 * Date filtering:
 *   - financialYear: "2024-25" | "current" | "previous"
 *   - startDate / endDate: ISO date strings (takes priority over financialYear)
 *   - If neither provided, defaults to current financial year
 */

const prisma = require("../config/prisma");
const {
  enrichBillsWithPostedNotes,
  getPostedNoteTotalsBeforeDate,
  getPostedNotesForCustomer,
} = require("./invoiceNote.service");

// ── Helpers ────────────────────────────────────────────────────────────────────

const toFloat = (val) => parseFloat(parseFloat(val ?? 0).toFixed(2));

const getBalanceType = (balance) => {
  if (balance > 0) return "RECEIVABLE";
  if (balance < 0) return "PAYABLE";
  return "SETTLED";
};

const computeBillStatus = (billAmount, allocatedAmount) => {
  const bill = toFloat(billAmount);
  const allocated = toFloat(allocatedAmount);
  if (allocated === 0) return "UNPAID";
  if (allocated < bill) return "PARTIAL";
  if (allocated === bill) return "PAID";
  if (allocated > bill) return "OVERPAID";
  return "UNPAID";
};

const hydrateBill = (bill) => ({
  ...bill,
  billAmount: toFloat(bill.billAmount),
  allocatedAmount: toFloat(bill.allocatedAmount),
  pendingAmount: toFloat(bill.billAmount) - toFloat(bill.allocatedAmount),
  status: computeBillStatus(bill.billAmount, bill.allocatedAmount),
});

/**
 * Resolve date range from filter options.
 * Priority: explicit startDate/endDate > financialYear > current FY default
 */
const resolveDateRange = (opts = {}) => {
  const { startDate, endDate, financialYear } = opts;

  if (startDate || endDate) {
    return {
      startDate: startDate ? new Date(startDate) : new Date("2000-01-01"),
      endDate: endDate ? new Date(endDate) : new Date(),
    };
  }

  const now = new Date();
  const currentMonth = now.getMonth();
  const currentYear = now.getFullYear();

  let startYear;
  if (
    financialYear &&
    financialYear !== "current" &&
    financialYear !== "previous"
  ) {
    // Format "2024-25"
    startYear = parseInt(financialYear.split("-")[0]);
  } else if (financialYear === "previous") {
    startYear = currentMonth < 3 ? currentYear - 2 : currentYear - 1;
  } else {
    // current (default)
    startYear = currentMonth < 3 ? currentYear - 1 : currentYear;
  }

  return {
    startDate: new Date(startYear, 3, 1), // April 1
    endDate: new Date(startYear + 1, 2, 31, 23, 59, 59, 999), // March 31
  };
};

/**
 * Days between two dates (positive = overdue)
 */
const daysDiff = (from, to = new Date()) => {
  return Math.floor((to - new Date(from)) / (1000 * 60 * 60 * 24));
};

const getCustomerOpeningContext = async (customerId, startDate, endDate) => {
  const [
    previousBills,
    previousReceipts,
    previousPayments,
    previousNotes,
    currentOpeningBills,
  ] = await Promise.all([
      prisma.bill.aggregate({
        where: {
          customerId,
          invoiceDate: { lt: startDate },
        },
        _sum: { billAmount: true },
        _count: { id: true },
      }),
      prisma.voucher.aggregate({
        where: {
          customerId,
          type: "RECEIPT",
          voucherDate: { lt: startDate },
        },
        _sum: { totalAmount: true },
        _count: { id: true },
      }),
      prisma.voucher.aggregate({
        where: {
          customerId,
          type: "PAYMENT",
          voucherDate: { lt: startDate },
        },
        _sum: { totalAmount: true },
        _count: { id: true },
      }),
      getPostedNoteTotalsBeforeDate(customerId, startDate),
      prisma.bill.findMany({
        where: {
          customerId,
          isOpeningBalance: true,
          invoiceDate: { gte: startDate, lte: endDate },
        },
        orderBy: { invoiceDate: "asc" },
      }),
    ]);

  const previousBillsTotal = toFloat(previousBills._sum.billAmount ?? 0);
  const previousReceiptsTotal = toFloat(previousReceipts._sum.totalAmount ?? 0);
  const previousPaymentsTotal = toFloat(previousPayments._sum.totalAmount ?? 0);
  const previousDebitNotesTotal = toFloat(previousNotes.increaseTotal ?? 0);
  const previousCreditNotesTotal = toFloat(previousNotes.decreaseTotal ?? 0);
  const previousActivityCount =
    previousBills._count.id +
    previousReceipts._count.id +
    previousPayments._count.id +
    (previousNotes.count ?? 0);
  const broughtForwardBalance = toFloat(
    previousBillsTotal +
      previousPaymentsTotal +
      previousDebitNotesTotal -
      previousReceiptsTotal -
      previousCreditNotesTotal,
  );
  const storedOpeningBalance = toFloat(
    currentOpeningBills.reduce((sum, bill) => sum + toFloat(bill.billAmount), 0),
  );
  const hasPreviousActivity = previousActivityCount > 0;

  return {
    hasPreviousActivity,
    broughtForwardBalance,
    storedOpeningBalance,
    currentOpeningBills,
    openingBalance: hasPreviousActivity
      ? broughtForwardBalance
      : storedOpeningBalance,
    openingSource: hasPreviousActivity
      ? "PREVIOUS_CLOSING_BALANCE"
      : currentOpeningBills.length > 0
        ? "OPENING_BALANCE_TABLE"
        : "NONE",
  };
};

// ── 1. Customer Ledger ─────────────────────────────────────────────────────────

/**
 * Full transaction history for one customer.
 * Combines Bills (debits) and Vouchers (credits) into a single
 * chronological ledger with running balance.
 *
 * @param {string} customerId  - MongoDB Customer._id
 * @param {Object} opts
 * @param {string} [opts.startDate]
 * @param {string} [opts.endDate]
 * @param {string} [opts.financialYear]
 * @param {number} [opts.page]
 * @param {number} [opts.limit]
 * @param {string} [opts.sortOrder]  "asc" | "desc" (default: asc)
 */
const getCustomerLedger = async (customerId, opts = {}) => {
  const { page = 1, limit = 50, sortOrder = "asc" } = opts;
  const { startDate, endDate } = resolveDateRange(opts);
  const openingContext = await getCustomerOpeningContext(
    customerId,
    startDate,
    endDate,
  );

  // Fetch bills (debit side — what customer owes)
  const [bills, vouchers, notes] = await Promise.all([
    prisma.bill.findMany({
      where: {
        customerId,
        ...(openingContext.hasPreviousActivity
          ? { isOpeningBalance: false }
          : {}),
        invoiceDate: { gte: startDate, lte: endDate },
      },
      orderBy: { invoiceDate: "asc" },
    }),
    prisma.voucher.findMany({
      where: {
        customerId,
        type: { in: ["RECEIPT", "PAYMENT"] },
        voucherDate: { gte: startDate, lte: endDate },
      },
      include: {
        allocations: {
          include: { bill: true },
        },
      },
      orderBy: { voucherDate: "asc" },
    }),
    getPostedNotesForCustomer(customerId, { startDate, endDate }),
  ]);

  // ── Build ledger entries ───────────────────────────────────────────────────

  const entries = [];

  if (openingContext.hasPreviousActivity && openingContext.openingBalance !== 0) {
    const openingBalance = openingContext.openingBalance;
    entries.push({
      date: startDate,
      type: "OPENING_BALANCE",
      referenceNumber: "B/F",
      referenceId: null,
      voucherId: null,
      description: "Opening Balance — Brought Forward",
      debit: openingBalance > 0 ? toFloat(openingBalance) : 0,
      credit: openingBalance < 0 ? toFloat(Math.abs(openingBalance)) : 0,
      balance: 0,
      details: {
        source: openingContext.openingSource,
        openingBalance,
      },
    });
  }

  // Bills → DEBIT entries
  for (const bill of bills) {
    const h = hydrateBill(bill);
    entries.push({
      date: bill.invoiceDate,
      type: bill.isOpeningBalance ? "OPENING_BALANCE" : "INVOICE",
      referenceNumber: bill.invoiceNumber,
      referenceId: bill.id,
      voucherId: bill.mongoInvoiceId,
      description: bill.isOpeningBalance
        ? `Opening Balance — ${bill.invoiceNumber}`
        : `Invoice ${bill.invoiceNumber}`,
      debit: h.billAmount,
      credit: 0,
      balance: 0, // recalculated below
      details: {
        billAmount: h.billAmount,
        allocatedAmount: h.allocatedAmount,
        pendingAmount: h.pendingAmount,
        status: h.status,
        isOpeningBalance: bill.isOpeningBalance,
      },
    });
  }

  // Vouchers → CREDIT (RECEIPT) or DEBIT (PAYMENT/REFUND) entries
  for (const voucher of vouchers) {
    const amount = toFloat(voucher.totalAmount);
    const isReceipt = voucher.type === "RECEIPT";

    const allocationDetails = voucher.allocations.map((a) => ({
      billId: a.billId,
      invoiceNumber: a.bill?.invoiceNumber ?? "On-Account",
      allocatedAmount: toFloat(a.allocatedAmount),
    }));

    entries.push({
      date: voucher.voucherDate,
      type: voucher.type,
      referenceNumber: voucher.voucherId,
      referenceId: voucher.id,
      description:
        `${isReceipt ? "Receipt" : "Payment"} ${voucher.voucherId}` +
        (voucher.narration ? ` — ${voucher.narration}` : ""),
      debit: isReceipt ? 0 : amount,
      credit: isReceipt ? amount : 0,
      balance: 0,
      details: {
        paymentMethod: voucher.paymentMethod,
        bankId: voucher.bankId,
        bankName: voucher.bankName,
        utrNumber: voucher.utrNumber,
        chequeNumber: voucher.chequeNumber,
        onAccountAmount: toFloat(voucher.onAccountAmount),
        allocations: allocationDetails,
      },
    });
  }

  for (const note of notes) {
    const amount = toFloat(note.amount);
    const increasesBalance = note.balanceEffect === "INCREASE";

    entries.push({
      date: note.noteDate,
      type: note.noteType,
      referenceNumber: note.noteNumber,
      referenceId: note.id,
      voucherId: null,
      description:
        `${note.noteType === "DEBIT_NOTE" ? "Debit Note" : "Credit Note"} ${note.noteNumber}` +
        (note.invoiceNumber ? ` against ${note.invoiceNumber}` : "") +
        (note.reason ? ` — ${note.reason}` : ""),
      debit: increasesBalance ? amount : 0,
      credit: increasesBalance ? 0 : amount,
      balance: 0,
      details: {
        invoiceNumber: note.invoiceNumber,
        amount,
        noteType: note.noteType,
        balanceEffect: note.balanceEffect,
        narration: note.narration,
      },
    });
  }

  // ── Sort: date asc, then INVOICE before RECEIPT on same date ──────────────

  const TYPE_ORDER = {
    OPENING_BALANCE: 1,
    INVOICE: 2,
    DEBIT_NOTE: 3,
    CREDIT_NOTE: 3,
    RECEIPT: 4,
    PAYMENT: 4,
  };
  entries.sort((a, b) => {
    const dateDiff = new Date(a.date) - new Date(b.date);
    if (dateDiff !== 0) return dateDiff;
    return (TYPE_ORDER[a.type] ?? 4) - (TYPE_ORDER[b.type] ?? 4);
  });

  // ── Running balance ────────────────────────────────────────────────────────

  let runningBalance = 0;
  for (const entry of entries) {
    runningBalance += entry.debit - entry.credit;
    entry.balance = toFloat(runningBalance);
  }

  if (sortOrder === "desc") entries.reverse();

  // ── Summary (on full dataset before pagination) ────────────────────────────

  const totalDebit = entries.reduce((s, e) => s + e.debit, 0);
  const totalCredit = entries.reduce((s, e) => s + e.credit, 0);
  const closingBalance = toFloat(totalDebit - totalCredit);

  const summary = {
    openingBalance: toFloat(openingContext.openingBalance),
    openingBalanceType: getBalanceType(openingContext.openingBalance),
    openingBalanceSource: openingContext.openingSource,
    totalDebit: toFloat(totalDebit),
    totalCredit: toFloat(totalCredit),
    closingBalance,
    balanceType: getBalanceType(closingBalance),
    totalEntries: entries.length,
    dateRange: { startDate, endDate },
  };

  // ── Paginate ───────────────────────────────────────────────────────────────

  const skip = (page - 1) * limit;
  const paginatedEntries = entries.slice(skip, skip + limit);

  return {
    summary,
    ledger: paginatedEntries,
    pagination: {
      page,
      limit,
      total: entries.length,
      totalPages: Math.ceil(entries.length / limit),
    },
  };
};

// ── 2. Outstanding Bills Report ────────────────────────────────────────────────

/**
 * All unpaid/partial bills across all customers (or one customer).
 * Sorted by invoiceDate ascending (oldest first).
 *
 * @param {Object} opts
 * @param {string} [opts.customerId]    Filter to one customer
 * @param {string} [opts.startDate]
 * @param {string} [opts.endDate]
 * @param {string} [opts.financialYear]
 * @param {number} [opts.page]
 * @param {number} [opts.limit]
 */
const getOutstandingBillsReport = async (opts = {}) => {
  const { customerId, page = 1, limit = 50 } = opts;
  const { startDate, endDate } = resolveDateRange(opts);

  const where = {
    invoiceDate: { gte: startDate, lte: endDate },
  };
  if (customerId) where.customerId = customerId;

  const bills = await prisma.bill.findMany({
    where,
    orderBy: { invoiceDate: "asc" },
  });

  // Filter to only outstanding (not fully paid) after hydration
  const outstanding = (await enrichBillsWithPostedNotes(bills, { asOfDate: endDate }))
    .filter((b) => b.status !== "PAID");

  // ── Totals ─────────────────────────────────────────────────────────────────

  const totalOriginalBillAmount = toFloat(
    outstanding.reduce((s, b) => s + b.billAmount, 0),
  );
  const totalBillAmount = toFloat(
    outstanding.reduce((s, b) => s + b.adjustedAmount, 0),
  );
  const totalAllocated = toFloat(
    outstanding.reduce((s, b) => s + b.allocatedAmount, 0),
  );
  const totalPending = toFloat(
    outstanding.reduce((s, b) => s + b.pendingAmount, 0),
  );

  const byStatus = {
    UNPAID: outstanding.filter((b) => b.status === "UNPAID").length,
    PARTIAL: outstanding.filter((b) => b.status === "PARTIAL").length,
    OVERPAID: outstanding.filter((b) => b.status === "OVERPAID").length,
  };

  // ── Paginate ───────────────────────────────────────────────────────────────

  const skip = (page - 1) * limit;
  const paged = outstanding.slice(skip, skip + limit);

  return {
    summary: {
      totalBills: outstanding.length,
      totalOriginalBillAmount,
      totalBillAmount,
      totalAllocated,
      totalPending,
      byStatus,
      dateRange: { startDate, endDate },
    },
    data: paged,
    pagination: {
      page,
      limit,
      total: outstanding.length,
      totalPages: Math.ceil(outstanding.length / limit),
    },
  };
};

// ── 3. Bill-wise Receivables Summary ──────────────────────────────────────────

/**
 * Per-customer summary: total billed, collected, pending.
 * One row per customer. All customers unless customerId is provided.
 *
 * @param {Object} opts
 * @param {string} [opts.customerId]
 * @param {string} [opts.startDate]
 * @param {string} [opts.endDate]
 * @param {string} [opts.financialYear]
 */
const getReceivablesSummary = async (opts = {}) => {
  const { customerId } = opts;
  const { startDate, endDate } = resolveDateRange(opts);

  const where = {
    invoiceDate: { gte: startDate, lte: endDate },
  };
  if (customerId) where.customerId = customerId;

  // Group by customerId using Prisma groupBy
  const bills = await prisma.bill.findMany({ where });
  const enrichedBills = await enrichBillsWithPostedNotes(bills, {
    asOfDate: endDate,
  });
  const customerMap = new Map();

  for (const bill of enrichedBills) {
    if (!customerMap.has(bill.customerId)) {
      customerMap.set(bill.customerId, {
        customerId: bill.customerId,
        totalBills: 0,
        totalBilled: 0,
        totalCollected: 0,
        totalPending: 0,
      });
    }

    const row = customerMap.get(bill.customerId);
    row.totalBills += 1;
    row.totalBilled = toFloat(row.totalBilled + bill.adjustedAmount);
    row.totalCollected = toFloat(row.totalCollected + bill.allocatedAmount);
    row.totalPending = toFloat(row.totalPending + bill.pendingAmount);
  }

  const rows = Array.from(customerMap.values()).map((row) => ({
    ...row,
    collectionRate:
      row.totalBilled > 0
        ? Math.round((row.totalCollected / row.totalBilled) * 100 * 100) / 100
        : 0,
  }));

  // Sort by totalPending descending (highest outstanding first)
  rows.sort((a, b) => b.totalPending - a.totalPending);

  // Grand totals
  const grandTotals = {
    totalBilled: toFloat(rows.reduce((s, r) => s + r.totalBilled, 0)),
    totalCollected: toFloat(rows.reduce((s, r) => s + r.totalCollected, 0)),
    totalPending: toFloat(rows.reduce((s, r) => s + r.totalPending, 0)),
    totalCustomers: rows.length,
    totalBills: rows.reduce((s, r) => s + r.totalBills, 0),
  };

  return {
    grandTotals,
    data: rows,
    dateRange: { startDate, endDate },
  };
};

// ── 4. Ageing Analysis ─────────────────────────────────────────────────────────

/**
 * Outstanding bills bucketed by age (days since invoiceDate).
 * Buckets: 0-30, 31-60, 61-90, 90+
 * Only includes bills with pendingAmount > 0.
 *
 * @param {Object} opts
 * @param {string} [opts.customerId]   Scope to one customer or all
 * @param {Date}   [opts.asOfDate]     Age calculated relative to this date (default: today)
 */
const getAgeingAnalysis = async (opts = {}) => {
  const { customerId, asOfDate = new Date() } = opts;

  const where = {};
  if (customerId) where.customerId = customerId;

  const bills = await prisma.bill.findMany({ where });
  const enrichedBills = await enrichBillsWithPostedNotes(bills, {
    asOfDate,
  });

  // Only outstanding bills
  const outstanding = enrichedBills.filter((b) => b.pendingAmount > 0);

  const buckets = {
    "0-30": { bills: [], totalPending: 0 },
    "31-60": { bills: [], totalPending: 0 },
    "61-90": { bills: [], totalPending: 0 },
    "90+": { bills: [], totalPending: 0 },
  };

  for (const bill of outstanding) {
    const age = daysDiff(bill.invoiceDate, asOfDate);
    const entry = {
      id: bill.id,
      invoiceNumber: bill.invoiceNumber,
      customerId: bill.customerId,
      invoiceDate: bill.invoiceDate,
      billAmount: bill.adjustedAmount,
      allocatedAmount: bill.allocatedAmount,
      pendingAmount: bill.pendingAmount,
      status: bill.status,
      ageDays: age,
      isOpeningBalance: bill.isOpeningBalance,
      debitNoteAmount: bill.debitNoteAmount,
      creditNoteAmount: bill.creditNoteAmount,
    };

    if (age <= 30) buckets["0-30"].bills.push(entry);
    else if (age <= 60) buckets["31-60"].bills.push(entry);
    else if (age <= 90) buckets["61-90"].bills.push(entry);
    else buckets["90+"].bills.push(entry);
  }

  // Compute bucket totals
  for (const key of Object.keys(buckets)) {
    buckets[key].count = buckets[key].bills.length;
    buckets[key].totalPending = toFloat(
      buckets[key].bills.reduce((s, b) => s + b.pendingAmount, 0),
    );
  }

  const totalPending = toFloat(
    outstanding.reduce((s, b) => s + b.pendingAmount, 0),
  );

  return {
    asOfDate,
    totalOutstandingBills: outstanding.length,
    totalPending,
    buckets,
  };
};

// ── 5. Bank-wise Collection Report ────────────────────────────────────────────

/**
 * Receipts grouped by bank (bankId + bankName).
 * Shows how much was collected through each bank in the period.
 *
 * @param {Object} opts
 * @param {string} [opts.startDate]
 * @param {string} [opts.endDate]
 * @param {string} [opts.financialYear]
 * @param {string} [opts.customerId]   Optional: filter to one customer
 */
const getBankwiseCollectionReport = async (opts = {}) => {
  const { customerId } = opts;
  const { startDate, endDate } = resolveDateRange(opts);

  const where = {
    type: "RECEIPT",
    voucherDate: { gte: startDate, lte: endDate },
  };
  if (customerId) where.customerId = customerId;

  const vouchers = await prisma.voucher.findMany({
    where,
    orderBy: { voucherDate: "asc" },
  });

  // Group by bankId (null = CASH)
  const bankMap = new Map();

  for (const v of vouchers) {
    const key = v.bankId ?? "CASH";
    const amount = toFloat(v.totalAmount);

    if (!bankMap.has(key)) {
      bankMap.set(key, {
        bankId: v.bankId ?? null,
        bankName: v.bankName ?? "Cash",
        paymentMethod: v.paymentMethod,
        totalReceipts: 0,
        totalAmount: 0,
        vouchers: [],
      });
    }

    const entry = bankMap.get(key);
    entry.totalReceipts += 1;
    entry.totalAmount = toFloat(entry.totalAmount + amount);
    entry.vouchers.push({
      voucherId: v.voucherId,
      voucherDate: v.voucherDate,
      customerId: v.customerId,
      amount,
      paymentMethod: v.paymentMethod,
      utrNumber: v.utrNumber,
      chequeNumber: v.chequeNumber,
      narration: v.narration,
    });
  }

  const banks = Array.from(bankMap.values()).sort(
    (a, b) => b.totalAmount - a.totalAmount,
  );

  const grandTotal = toFloat(banks.reduce((s, b) => s + b.totalAmount, 0));

  return {
    dateRange: { startDate, endDate },
    grandTotal,
    totalReceipts: vouchers.length,
    banks,
  };
};

module.exports = {
  getCustomerLedger,
  getOutstandingBillsReport,
  getReceivablesSummary,
  getAgeingAnalysis,
  getBankwiseCollectionReport,
  resolveDateRange,
  hydrateBill,
};
