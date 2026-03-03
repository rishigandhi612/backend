/**
 * Voucher Service
 *
 * Rules:
 *   - Bill status is NEVER stored — always computed from allocations
 *   - Overpayment is valid — pendingAmount can go negative
 *   - Partial allocation is valid — remainder auto-becomes on-account
 *   - On-account: BillAllocation rows with billId = null
 *   - sum(allocations) must NOT exceed voucher.totalAmount
 *   - Bank is resolved from MongoDB banks collection via bankId
 */

const prisma = require("../config/prisma");
const Bank = require("../models/bank.models"); // MongoDB Bank model

// ── Helpers ────────────────────────────────────────────────────────────────────

const getFinancialYear = (date = new Date()) => {
  const month = date.getMonth();
  const year = date.getFullYear();
  const startYear = month < 3 ? year - 1 : year;
  return `${startYear}-${String(startYear + 1).slice(-2)}`;
};

const toFloat = (val) => parseFloat(parseFloat(val).toFixed(2));

/**
 * Compute bill status from billAmount and allocatedAmount.
 * Never stored — always derived at read time.
 */
const computeBillStatus = (billAmount, allocatedAmount) => {
  const bill = toFloat(billAmount);
  const allocated = toFloat(allocatedAmount);

  if (allocated === 0) return "UNPAID";
  if (allocated < bill) return "PARTIAL";
  if (allocated === bill) return "PAID";
  if (allocated > bill) return "OVERPAID";
  return "UNPAID";
};

/**
 * Attach computed pendingAmount and status to a Bill before returning to client.
 */
const hydrateBill = (bill) => ({
  ...bill,
  pendingAmount: toFloat(bill.billAmount) - toFloat(bill.allocatedAmount),
  status: computeBillStatus(bill.billAmount, bill.allocatedAmount),
});

/**
 * Generate next human-readable voucher ID inside a Prisma transaction.
 * e.g. RECEIPT + "2024-25" → "REC/0001/24-25"
 */
const generateVoucherId = async (type, financialYear, tx) => {
  const PREFIX_MAP = {
    RECEIPT: "REC",
    PAYMENT: "PAY",
    CONTRA: "CTR",
    JOURNAL: "JNL",
  };
  const prefix = PREFIX_MAP[type];
  if (!prefix) throw new Error(`Unknown voucher type: ${type}`);

  const shortFY = financialYear.slice(2);

  const counter = await tx.voucherCounter.upsert({
    where: { type_financialYear: { type: prefix, financialYear } },
    update: { lastValue: { increment: 1 } },
    create: { type: prefix, financialYear, lastValue: 1 },
  });

  return `${prefix}/${String(counter.lastValue).padStart(4, "0")}/${shortFY}`;
};

const generateOpeningBalanceRef = async (financialYear, tx) => {
  const shortFY = financialYear.slice(2);

  const counter = await tx.voucherCounter.upsert({
    where: { type_financialYear: { type: "OB", financialYear } },
    update: { lastValue: { increment: 1 } },
    create: { type: "OB", financialYear, lastValue: 1 },
  });

  return `OB/${String(counter.lastValue).padStart(4, "0")}/${shortFY}`;
};

// ── Bank resolution ────────────────────────────────────────────────────────────

/**
 * Resolve bank details from MongoDB for non-CASH payments.
 * Returns { bankId, bankName } to store on the Voucher.
 *
 * For CASH: no bank needed — returns { bankId: null, bankName: null }.
 * For all others: bankId (MongoDB banks._id) is required.
 */
const resolveBank = async (paymentMethod, bankId) => {
  if (paymentMethod === "CASH") {
    return { bankId: null, bankName: null };
  }

  if (!bankId) {
    throw new Error(`bankId is required for payment method ${paymentMethod}`);
  }

  const bank = await Bank.findById(bankId).lean();
  if (!bank) {
    throw new Error(`Bank with ID ${bankId} not found`);
  }

  return {
    bankId: bank._id.toString(),
    bankName: bank.name,
  };
};

// ── Ledger account helpers ─────────────────────────────────────────────────────

const getAccount = async (code) => {
  const account = await prisma.ledgerAccount.findUnique({ where: { code } });
  if (!account)
    throw new Error(`Ledger account '${code}' not found. Run migration first.`);
  if (!account.isActive)
    throw new Error(`Ledger account '${code}' is inactive.`);
  return account;
};

// ── Recalculate Bill.allocatedAmount ──────────────────────────────────────────

const recalculateBillAllocated = async (billId, tx) => {
  const agg = await tx.billAllocation.aggregate({
    where: { billId },
    _sum: { allocatedAmount: true },
  });

  const allocatedAmount = toFloat(agg._sum.allocatedAmount ?? 0);

  return tx.bill.update({
    where: { id: billId },
    data: { allocatedAmount },
  });
};

// ── Recalculate Voucher.onAccountAmount ───────────────────────────────────────

const recalculateVoucherOnAccount = async (voucherId, tx) => {
  const agg = await tx.billAllocation.aggregate({
    where: { voucherId, billId: null },
    _sum: { allocatedAmount: true },
  });

  return tx.voucher.update({
    where: { id: voucherId },
    data: { onAccountAmount: toFloat(agg._sum.allocatedAmount ?? 0) },
  });
};

// ── Create Receipt ─────────────────────────────────────────────────────────────

/**
 * Record a payment received from a customer.
 *
 * @param {Object}   params
 * @param {string}   params.customerId
 * @param {number}   params.totalAmount
 * @param {string}   params.paymentMethod    NEFT_RTGS | CHEQUE | CASH | UPI
 * @param {string}   [params.bankId]         MongoDB banks._id — required unless CASH
 * @param {string}   [params.chequeNumber]
 * @param {Date}     [params.chequeDate]
 * @param {string}   [params.utrNumber]
 * @param {string}   [params.upiRef]
 * @param {string}   [params.reference]
 * @param {string}   [params.narration]
 * @param {Date}     [params.voucherDate]    Defaults to today
 * @param {string}   [params.createdBy]
 * @param {Array}    [params.allocations]    [{ billId, allocatedAmount, narration? }]
 *                                           billId = null → explicit on-account
 *                                           Omit entirely → full amount on-account
 */
const createReceipt = async (params) => {
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
    voucherDate = new Date(),
    createdBy,
    allocations = [],
  } = params;

  if (!customerId) throw new Error("customerId is required");
  if (!totalAmount || isNaN(totalAmount) || parseFloat(totalAmount) <= 0)
    throw new Error("totalAmount must be a positive number");
  if (!paymentMethod) throw new Error("paymentMethod is required");

  const amount = toFloat(totalAmount);
  const financialYear = getFinancialYear(new Date(voucherDate));

  // ── Validate allocation sum doesn't exceed totalAmount ─────────────────────

  const providedSum = toFloat(
    allocations.reduce((s, a) => s + parseFloat(a.allocatedAmount ?? 0), 0),
  );

  if (providedSum > amount + 0.001) {
    throw new Error(
      `Allocation total (${providedSum}) cannot exceed totalAmount (${amount})`,
    );
  }

  // ── Auto on-account row for remainder ─────────────────────────────────────

  const finalAllocations = [...allocations];
  const remainder = toFloat(amount - providedSum);
  if (remainder > 0) {
    finalAllocations.push({
      billId: null,
      allocatedAmount: remainder,
      narration: "On-account (unallocated)",
    });
  }

  // ── Validate bills ─────────────────────────────────────────────────────────

  const billIds = finalAllocations
    .filter((a) => a.billId != null)
    .map((a) => a.billId);

  if (billIds.length > 0) {
    const bills = await prisma.bill.findMany({
      where: { id: { in: billIds } },
    });

    if (bills.length !== billIds.length) {
      const found = new Set(bills.map((b) => b.id));
      const missing = billIds.filter((id) => !found.has(id));
      throw new Error(`Bills not found: ${missing.join(", ")}`);
    }

    const wrongCustomer = bills.filter((b) => b.customerId !== customerId);
    if (wrongCustomer.length > 0) {
      throw new Error(
        `Bills do not belong to customer ${customerId}: ` +
          wrongCustomer.map((b) => b.invoiceNumber).join(", "),
      );
    }
  }

  // ── Resolve bank from MongoDB ──────────────────────────────────────────────

  const { bankId: resolvedBankId, bankName } = await resolveBank(
    paymentMethod,
    bankId,
  );

  // ── Resolve ledger accounts ────────────────────────────────────────────────
  // All receipts Dr the same BANK-001 or CASH-001 ledger account.
  // Specific bank identity lives on Voucher.bankId.

  const bankLedgerCode = paymentMethod === "CASH" ? "CASH-001" : "BANK-001";
  const [arAccount, bankAccount] = await Promise.all([
    getAccount("AR-001"),
    getAccount(bankLedgerCode),
  ]);

  // ── Atomic transaction ─────────────────────────────────────────────────────

  const result = await prisma.$transaction(async (tx) => {
    const voucherId = await generateVoucherId("RECEIPT", financialYear, tx);

    // 1. Create Voucher
    const voucher = await tx.voucher.create({
      data: {
        voucherId,
        customerId,
        type: "RECEIPT",
        totalAmount: amount,
        onAccountAmount: 0, // updated after allocations
        paymentMethod,
        bankId: resolvedBankId,
        bankName: bankName ?? null,
        chequeNumber: chequeNumber ?? null,
        chequeDate: chequeDate ?? null,
        utrNumber: utrNumber ?? null,
        upiRef: upiRef ?? null,
        reference: reference ?? null,
        narration: narration ?? null,
        voucherDate: new Date(voucherDate),
        financialYear,
        createdBy: createdBy ?? null,
      },
    });

    // 2. Double-entry: Dr Bank/Cash, Cr AR
    await tx.voucherEntry.createMany({
      data: [
        {
          voucherId: voucher.id,
          ledgerAccountId: bankAccount.id,
          entryType: "DEBIT",
          amount,
          narration: `Receipt ${voucherId}`,
        },
        {
          voucherId: voucher.id,
          ledgerAccountId: arAccount.id,
          entryType: "CREDIT",
          amount,
          narration: `Receipt ${voucherId}`,
        },
      ],
    });

    // 3. Bill allocations
    await tx.billAllocation.createMany({
      data: finalAllocations.map((a) => ({
        voucherId: voucher.id,
        billId: a.billId ?? null,
        customerId,
        allocatedAmount: toFloat(a.allocatedAmount),
        narration: a.narration ?? null,
      })),
    });

    // 4. Recalculate allocatedAmount on each affected Bill
    for (const billId of [...new Set(billIds)]) {
      await recalculateBillAllocated(billId, tx);
    }

    // 5. Update onAccountAmount on Voucher
    await recalculateVoucherOnAccount(voucher.id, tx);

    // 6. Return full voucher with hydrated bills
    const fullVoucher = await tx.voucher.findUnique({
      where: { id: voucher.id },
      include: {
        entries: {
          include: {
            debitAccount: true, // this is the relation name for the ledger account
          },
        },
        allocations: { include: { bill: true } },
      },
    });

    return {
      ...fullVoucher,
      allocations: fullVoucher.allocations.map((a) => ({
        ...a,
        bill: a.bill ? hydrateBill(a.bill) : null,
      })),
    };
  });

  return result;
};

// ── Apply On-Account to a Bill ────────────────────────────────────────────────

/**
 * Apply an existing on-account BillAllocation to a specific bill.
 *
 * @param {string} allocationId  - BillAllocation.id where billId is currently null
 * @param {string} billId        - Bill to apply it to
 * @param {number} [amount]      - Partial application (defaults to full allocation)
 */
const applyOnAccountToBill = async (allocationId, billId, amount) => {
  const allocation = await prisma.billAllocation.findUnique({
    where: { id: allocationId },
  });

  if (!allocation) throw new Error(`Allocation ${allocationId} not found`);
  if (allocation.billId !== null)
    throw new Error("This allocation is already applied to a bill");

  const applyAmount = amount
    ? toFloat(amount)
    : toFloat(allocation.allocatedAmount);

  if (applyAmount > toFloat(allocation.allocatedAmount) + 0.001) {
    throw new Error(
      `Cannot apply ${applyAmount} — allocation only has ${allocation.allocatedAmount}`,
    );
  }

  const bill = await prisma.bill.findUnique({ where: { id: billId } });
  if (!bill) throw new Error(`Bill ${billId} not found`);
  if (bill.customerId !== allocation.customerId) {
    throw new Error("Bill and allocation belong to different customers");
  }

  return prisma.$transaction(async (tx) => {
    if (applyAmount < toFloat(allocation.allocatedAmount)) {
      // Partial — shrink on-account row, create new applied row
      await tx.billAllocation.update({
        where: { id: allocationId },
        data: {
          allocatedAmount: toFloat(allocation.allocatedAmount) - applyAmount,
        },
      });
      await tx.billAllocation.create({
        data: {
          voucherId: allocation.voucherId,
          billId,
          customerId: allocation.customerId,
          allocatedAmount: applyAmount,
          narration: "Applied from on-account",
        },
      });
    } else {
      // Full — just update the existing row
      await tx.billAllocation.update({
        where: { id: allocationId },
        data: { billId },
      });
    }

    const updatedBill = await recalculateBillAllocated(billId, tx);
    await recalculateVoucherOnAccount(allocation.voucherId, tx);

    return hydrateBill(updatedBill);
  });
};

// ── Create Opening Balance ─────────────────────────────────────────────────────

const createOpeningBalance = async (params) => {
  const {
    customerId,
    customerName,
    amount,
    asOfDate = new Date(),
    narration,
    createdBy,
  } = params;

  if (!customerId) throw new Error("customerId is required");
  if (!customerName) throw new Error("customerName is required");
  if (!amount || isNaN(amount) || parseFloat(amount) <= 0)
    throw new Error("amount must be a positive number");

  const parsedAmount = toFloat(amount);
  const financialYear = getFinancialYear(new Date(asOfDate));

  return prisma.$transaction(async (tx) => {
    const referenceNo = await generateOpeningBalanceRef(financialYear, tx);

    const openingBalance = await tx.openingBalance.create({
      data: {
        referenceNo,
        customerId,
        customerName,
        amount: parsedAmount,
        narration:
          narration ??
          `Opening balance as of ${new Date(asOfDate).toLocaleDateString("en-IN")}`,
        asOfDate: new Date(asOfDate),
        financialYear,
        createdBy: createdBy ?? null,
      },
    });

    const bill = await tx.bill.create({
      data: {
        invoiceNumber: referenceNo,
        mongoInvoiceId: null,
        customerId,
        billAmount: parsedAmount,
        allocatedAmount: 0,
        isOpeningBalance: true,
        invoiceDate: new Date(asOfDate),
        financialYear,
        openingBalanceId: openingBalance.id,
      },
    });

    return { openingBalance, bill: hydrateBill(bill) };
  });
};

// ── Queries ────────────────────────────────────────────────────────────────────

const getCustomerBills = async (customerId, opts = {}) => {
  const { status, financialYear } = opts;

  const where = { customerId };
  if (financialYear) where.financialYear = financialYear;

  const bills = await prisma.bill.findMany({
    where,
    orderBy: { invoiceDate: "asc" },
  });
  const hydrated = bills.map(hydrateBill);

  if (status && status.length > 0) {
    return hydrated.filter((b) => status.includes(b.status));
  }

  return hydrated;
};

const getCustomerOnAccountBalance = async (customerId) => {
  const agg = await prisma.billAllocation.aggregate({
    where: { customerId, billId: null },
    _sum: { allocatedAmount: true },
  });
  return toFloat(agg._sum.allocatedAmount ?? 0);
};

const getOnAccountAllocations = async (customerId) => {
  return prisma.billAllocation.findMany({
    where: { customerId, billId: null },
    include: { voucher: true },
    orderBy: { createdAt: "asc" },
  });
};

const getCustomerVouchers = async (
  customerId,
  { page = 1, limit = 20 } = {},
) => {
  const skip = (page - 1) * limit;

  const [vouchers, total] = await Promise.all([
    prisma.voucher.findMany({
      where: { customerId },
      include: { allocations: { include: { bill: true } } },
      orderBy: { voucherDate: "desc" },
      skip,
      take: limit,
    }),
    prisma.voucher.count({ where: { customerId } }),
  ]);

  return {
    data: vouchers.map((v) => ({
      ...v,
      allocations: v.allocations.map((a) => ({
        ...a,
        bill: a.bill ? hydrateBill(a.bill) : null,
      })),
    })),
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
};

module.exports = {
  createReceipt,
  createOpeningBalance,
  applyOnAccountToBill,
  getCustomerBills,
  getCustomerVouchers,
  getCustomerOnAccountBalance,
  getOnAccountAllocations,
  computeBillStatus,
  hydrateBill,
  getFinancialYear,
};
