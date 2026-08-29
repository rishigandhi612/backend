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
const { enrichBillsWithPostedNotes } = require("./invoiceNote.service");

// ── Helpers ────────────────────────────────────────────────────────────────────

const getFinancialYear = (date = new Date()) => {
  const month = date.getMonth();
  const year = date.getFullYear();
  const startYear = month < 3 ? year - 1 : year;
  return `${startYear}-${String(startYear + 1).slice(-2)}`;
};

const toFloat = (val) => parseFloat(parseFloat(val).toFixed(2));

const parsePositiveAmount = (value, fieldName) => {
  if (value == null || isNaN(value) || parseFloat(value) <= 0) {
    throw new Error(`${fieldName} must be a positive number`);
  }
  return toFloat(value);
};

const parseAllocationAmount = (value) => {
  if (value == null || isNaN(value) || parseFloat(value) === 0) {
    throw new Error("allocatedAmount must be a non-zero number");
  }
  return toFloat(value);
};

const parseOptionalDate = (value, fieldName) => {
  if (value == null || value === "") return null;
  const date = new Date(value);
  if (isNaN(date.getTime()))
    throw new Error(`${fieldName} must be a valid date`);
  return date;
};

const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
const VALID_PAYMENT_METHODS = ["NEFT_RTGS", "CHEQUE", "CASH", "UPI"];

const tryDecodeReceiptRef = (value) => {
  const raw = String(value ?? "").trim();
  if (!raw || raw.includes("/")) return raw;

  const normalized = raw.replace(/-/g, "+").replace(/_/g, "/");
  if (!/^[A-Za-z0-9+/=]+$/.test(normalized)) return raw;

  const padded = normalized.padEnd(
    normalized.length + ((4 - (normalized.length % 4)) % 4),
    "=",
  );

  try {
    const decoded = Buffer.from(padded, "base64").toString("utf8");
    if (/^[A-Z]+\/\d+\/\d{2}-\d{2}$/.test(decoded)) return decoded;
  } catch (error) {
    return raw;
  }

  return raw;
};

const getVoucherWhereFromRef = (voucherRef) => {
  const decodedRef = tryDecodeReceiptRef(voucherRef);
  return decodedRef.includes("/")
    ? { voucherId: decodedRef }
    : { id: decodedRef };
};

const VOUCHER_DETAIL_INCLUDE = {
  entries: {
    include: {
      debitAccount: true,
    },
  },
  allocations: { include: { bill: true } },
};

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
  billAmount: toFloat(bill.billAmount),
  allocatedAmount: toFloat(bill.allocatedAmount),
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

  // Increment and read in one atomic query — no separate findUnique needed
  const result = await tx.$queryRaw`
    INSERT INTO "voucher_counters" (id, type, "financialYear", "lastValue")
    VALUES (gen_random_uuid(), ${prefix}, ${financialYear}, 1)
    ON CONFLICT (type, "financialYear")
    DO UPDATE SET "lastValue" = "voucher_counters"."lastValue" + 1
    RETURNING "lastValue"
  `;

  const lastValue = result[0].lastValue;

  return `${prefix}/${String(lastValue).padStart(4, "0")}/${shortFY}`;
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

const recalculateBillAllocated = async (billId, tx = prisma) => {
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

const recalculateVoucherOnAccount = async (voucherId, tx = prisma) => {
  const agg = await tx.customerCredit.aggregate({
    where: { sourceVoucherId: voucherId },
    _sum: { amount: true, consumedAmount: true },
  });

  const onAccountAmount = toFloat(
    toFloat(agg._sum.amount ?? 0) - toFloat(agg._sum.consumedAmount ?? 0),
  );

  return tx.voucher.update({
    where: { id: voucherId },
    data: { onAccountAmount },
  });
};

const computeCreditAvailable = (credit) =>
  toFloat(toFloat(credit.amount) - toFloat(credit.consumedAmount));

const getCreditStatusForBalance = (available) =>
  available <= 0.001 ? "EXHAUSTED" : "OPEN";

const createOnAccountAllocationWithCredit = async (
  tx,
  voucherId,
  customerId,
  allocation,
) => {
  const allocationRow = await tx.billAllocation.create({
    data: {
      voucherId,
      billId: null,
      customerId,
      allocatedAmount: toFloat(allocation.allocatedAmount),
      narration: allocation.narration ?? "On-account (unallocated)",
    },
  });

  const credit = await tx.customerCredit.create({
    data: {
      customerId,
      sourceVoucherId: voucherId,
      sourceAllocationId: allocationRow.id,
      amount: toFloat(allocationRow.allocatedAmount),
      consumedAmount: 0,
      status: "OPEN",
    },
  });

  await tx.billAllocation.update({
    where: { id: allocationRow.id },
    data: { customerCreditId: credit.id },
  });

  return allocationRow;
};

const splitReceiptAllocationsByFunding = (
  finalAllocations,
  amount,
) => {
  const positiveBillAllocations = finalAllocations.filter(
    (a) => a.billId != null && toFloat(a.allocatedAmount) > 0,
  );
  const billAdjustmentAllocations = finalAllocations.filter(
    (a) => a.billId != null && toFloat(a.allocatedAmount) < 0,
  );
  const onAccountAllocations = finalAllocations.filter((a) => a.billId == null);
  const positiveOnAccountAmount = toFloat(
    onAccountAllocations
      .filter((a) => toFloat(a.allocatedAmount) > 0)
      .reduce((sum, a) => sum + toFloat(a.allocatedAmount), 0),
  );
  const creditConsumptionAmount = toFloat(
    Math.abs(
      onAccountAllocations
        .filter((a) => toFloat(a.allocatedAmount) < 0)
        .reduce((sum, a) => sum + toFloat(a.allocatedAmount), 0),
    ),
  );

  if (creditConsumptionAmount > 0.001 && positiveBillAllocations.length === 0) {
    throw new Error("Negative on-account allocations must be applied to bills");
  }

  const nonCreditFundingForBills = toFloat(
    amount -
      positiveOnAccountAmount +
      Math.abs(
        billAdjustmentAllocations.reduce(
          (sum, a) => sum + toFloat(a.allocatedAmount),
          0,
        ),
      ),
  );
  if (nonCreditFundingForBills < -0.001) {
    throw new Error("On-account credit cannot exceed receipt totalAmount");
  }

  let remainingNonCreditFunding = Math.max(0, nonCreditFundingForBills);
  const cashBillAllocations = [];
  const creditApplications = [];

  for (const allocation of positiveBillAllocations) {
    const requestedAmount = toFloat(allocation.allocatedAmount);
    const cashAmount = toFloat(
      Math.min(requestedAmount, remainingNonCreditFunding),
    );
    const creditAmount = toFloat(requestedAmount - cashAmount);

    if (cashAmount > 0.001) {
      cashBillAllocations.push({
        ...allocation,
        allocatedAmount: cashAmount,
      });
    }

    if (creditAmount > 0.001) {
      creditApplications.push({
        billId: allocation.billId,
        allocatedAmount: creditAmount,
        narration: allocation.narration ?? "Applied from on-account",
      });
    }

    remainingNonCreditFunding = toFloat(remainingNonCreditFunding - cashAmount);
  }

  const splitCreditAmount = toFloat(
    creditApplications.reduce(
      (sum, allocation) => sum + toFloat(allocation.allocatedAmount),
      0,
    ),
  );

  if (Math.abs(splitCreditAmount - creditConsumptionAmount) > 0.001) {
    throw new Error(
      `Negative on-account total (${creditConsumptionAmount}) must match bill allocations funded from credit (${splitCreditAmount})`,
    );
  }

  return {
    cashBillAllocations,
    creditApplications,
    billAdjustmentAllocations,
    positiveOnAccountAmount,
    positiveOnAccountAllocations: onAccountAllocations.filter(
      (a) => toFloat(a.allocatedAmount) > 0,
    ),
  };
};

const getAvailableCustomerCreditsTx = async (
  tx,
  customerId,
  { excludeSourceVoucherId = null } = {},
) => {
  const credits = await tx.customerCredit.findMany({
    where: {
      customerId,
      status: { not: "REVERSED" },
      ...(excludeSourceVoucherId
        ? { sourceVoucherId: { not: excludeSourceVoucherId } }
        : {}),
    },
    select: { amount: true, consumedAmount: true },
  });

  return toFloat(
    credits.reduce((sum, credit) => sum + computeCreditAvailable(credit), 0),
  );
};

const assertSufficientCustomerCreditsTx = async (
  tx,
  { customerId, requiredAmount, excludeSourceVoucherId = null },
) => {
  const required = toFloat(requiredAmount);
  if (required <= 0.001) return;

  const available = await getAvailableCustomerCreditsTx(tx, customerId, {
    excludeSourceVoucherId,
  });

  if (available + 0.001 < required) {
    throw new Error(
      `Insufficient on-account balance. Required ${required}, available ${available}`,
    );
  }
};

const consumeCustomerCreditsForBillTx = async (
  tx,
  {
    customerId,
    billId,
    amount,
    voucherId = null,
    excludeSourceVoucherId = null,
    createdBy = null,
    narration = "Applied from on-account",
  },
) => {
  const applyAmount = parsePositiveAmount(amount, "on-account amount");
  await assertSufficientCustomerCreditsTx(tx, {
    customerId,
    requiredAmount: applyAmount,
    excludeSourceVoucherId,
  });

  const credits = await tx.customerCredit.findMany({
    where: {
      customerId,
      status: { not: "REVERSED" },
      ...(excludeSourceVoucherId
        ? { sourceVoucherId: { not: excludeSourceVoucherId } }
        : {}),
    },
    orderBy: { createdAt: "asc" },
  });

  let remaining = applyAmount;
  const touchedCreditVoucherIds = new Set();

  for (const credit of credits) {
    if (remaining <= 0.001) break;

    const available = computeCreditAvailable(credit);
    if (available <= 0.001) continue;

    const consumedNow = toFloat(Math.min(available, remaining));
    const allocationRow = await tx.billAllocation.create({
      data: {
        voucherId: voucherId ?? credit.sourceVoucherId,
        billId,
        customerId,
        allocatedAmount: consumedNow,
        narration,
        customerCreditId: credit.id,
      },
    });

    await tx.creditConsumption.create({
      data: {
        creditId: credit.id,
        billId,
        voucherId: voucherId ?? null,
        billAllocationId: allocationRow.id,
        allocatedAmount: consumedNow,
        narration,
        createdBy: createdBy ?? null,
      },
    });

    const updatedConsumedAmount = toFloat(
      toFloat(credit.consumedAmount) + consumedNow,
    );
    await tx.customerCredit.update({
      where: { id: credit.id },
      data: {
        consumedAmount: updatedConsumedAmount,
        status: getCreditStatusForBalance(
          toFloat(toFloat(credit.amount) - updatedConsumedAmount),
        ),
      },
    });

    touchedCreditVoucherIds.add(credit.sourceVoucherId);
    remaining = toFloat(remaining - consumedNow);
  }

  if (remaining > 0.001) {
    throw new Error(
      `Insufficient on-account balance. Required ${applyAmount}, available ${toFloat(applyAmount - remaining)}`,
    );
  }

  for (const sourceVoucherId of touchedCreditVoucherIds) {
    await recalculateVoucherOnAccount(sourceVoucherId, tx);
  }
};

const reverseReceiptCreditConsumptionsTx = async (tx, voucherId) => {
  const consumptions = await tx.creditConsumption.findMany({
    where: { voucherId },
    include: { credit: true },
  });

  const affectedBillIds = [];
  const allocationIds = [];
  const sourceVoucherIds = new Set();

  for (const consumption of consumptions) {
    affectedBillIds.push(consumption.billId);
    if (consumption.billAllocationId) {
      allocationIds.push(consumption.billAllocationId);
    }

    const updatedConsumedAmount = toFloat(
      toFloat(consumption.credit.consumedAmount) -
        toFloat(consumption.allocatedAmount),
    );
    await tx.customerCredit.update({
      where: { id: consumption.creditId },
      data: {
        consumedAmount: Math.max(0, updatedConsumedAmount),
        status: getCreditStatusForBalance(
          toFloat(toFloat(consumption.credit.amount) - updatedConsumedAmount),
        ),
      },
    });
    sourceVoucherIds.add(consumption.credit.sourceVoucherId);
  }

  if (consumptions.length > 0) {
    await tx.creditConsumption.deleteMany({
      where: { id: { in: consumptions.map((consumption) => consumption.id) } },
    });
  }

  if (allocationIds.length > 0) {
    await tx.billAllocation.deleteMany({
      where: { id: { in: allocationIds } },
    });
  }

  for (const sourceVoucherId of sourceVoucherIds) {
    await recalculateVoucherOnAccount(sourceVoucherId, tx);
  }

  return affectedBillIds;
};

/**
 * Customer's available on-account / credit balance.
 *
 * Sums every CustomerCredit's (amount - consumedAmount) for this customer, excluding REVERSED
 * credits, plus the raw allocatedAmount of any not-yet-converted legacy on-account row
 * (billId: null, customerCreditId: null).
 */
const getVoucherDateFilter = ({ startDate, endDate } = {}) => {
  if (!startDate && !endDate) return null;
  return {
    ...(startDate ? { gte: new Date(startDate) } : {}),
    ...(endDate ? { lte: new Date(endDate) } : {}),
  };
};

const getCustomerCreditBalance = async (customerId, opts = {}) => {
  const voucherDateFilter = getVoucherDateFilter(opts);
  const [creditAgg, legacyAgg] = await Promise.all([
    prisma.customerCredit.aggregate({
      where: {
        customerId,
        status: { not: "REVERSED" },
        ...(voucherDateFilter
          ? { sourceVoucher: { voucherDate: voucherDateFilter } }
          : {}),
      },
      _sum: { amount: true, consumedAmount: true },
    }),
    prisma.billAllocation.aggregate({
      where: {
        customerId,
        billId: null,
        customerCreditId: null,
        ...(voucherDateFilter ? { voucher: { voucherDate: voucherDateFilter } } : {}),
      },
      _sum: { allocatedAmount: true },
    }),
  ]);

  const availableBalance = toFloat(
    toFloat(creditAgg._sum.amount ?? 0) -
      toFloat(creditAgg._sum.consumedAmount ?? 0) +
      toFloat(legacyAgg._sum.allocatedAmount ?? 0),
  );

  return Math.max(0, availableBalance);
};

/**
 * Alias kept for existing callers. Previously this summed BillAllocation.allocatedAmount
 * directly for billId:null rows, ignoring consumedAmount entirely — which overstated the
 * balance as soon as any credit was partially applied via applyCreditToBill. Delegating to
 * getCustomerCreditBalance keeps both names returning the same, correct number going forward.
 */
const getCustomerOnAccountBalance = async (customerId, opts = {}) =>
  getCustomerCreditBalance(customerId, opts);

const getCustomerCredits = async (customerId) =>
  prisma.customerCredit.findMany({
    where: { customerId, status: { not: "REVERSED" } },
    orderBy: { createdAt: "asc" },
    include: { sourceVoucher: true, sourceAllocation: true },
  });

const applyCreditToBill = async ({ creditId, billId, amount, createdBy }) =>
  prisma.$transaction(async (tx) =>
    applyCreditToBillTx(tx, creditId, billId, amount, createdBy),
  );

const applyCreditToBillTx = async (tx, creditId, billId, amount, createdBy) => {
  const credit = await tx.customerCredit.findUnique({
    where: { id: creditId },
  });
  if (!credit) throw new Error(`CustomerCredit ${creditId} not found`);

  const bill = await tx.bill.findUnique({ where: { id: billId } });
  if (!bill) throw new Error(`Bill ${billId} not found`);
  if (bill.customerId !== credit.customerId) {
    throw new Error("Bill and credit belong to different customers");
  }

  const available = computeCreditAvailable(credit);
  if (available <= 0.001) {
    throw new Error(`CustomerCredit ${creditId} has no available balance`);
  }

  const applyAmount =
    amount == null ? available : parsePositiveAmount(amount, "amount");
  if (applyAmount > available + 0.001) {
    throw new Error(
      `Cannot apply ${applyAmount} — credit only has ${available}`,
    );
  }

  const allocationRow = await tx.billAllocation.create({
    data: {
      voucherId: credit.sourceVoucherId,
      billId,
      customerId: credit.customerId,
      allocatedAmount: applyAmount,
      narration: "Applied from on-account",
      customerCreditId: credit.id,
    },
  });

  await tx.creditConsumption.create({
    data: {
      creditId,
      billId,
      billAllocationId: allocationRow.id,
      allocatedAmount: applyAmount,
      narration: "Applied from on-account",
      createdBy: createdBy ?? null,
    },
  });

  const updatedConsumedAmount = toFloat(credit.consumedAmount) + applyAmount;
  await tx.customerCredit.update({
    where: { id: credit.id },
    data: {
      consumedAmount: updatedConsumedAmount,
      status: getCreditStatusForBalance(
        toFloat(toFloat(credit.amount) - updatedConsumedAmount),
      ),
    },
  });

  const updatedBill = await recalculateBillAllocated(billId, tx);
  await recalculateVoucherOnAccount(credit.sourceVoucherId, tx);

  return hydrateBill(updatedBill);
};

const hydrateVoucher = (voucher) => ({
  ...voucher,
  allocations: voucher.allocations.map((a) => ({
    ...a,
    bill: a.bill ? hydrateBill(a.bill) : null,
  })),
});

const getVoucherWithDetails = async (where) => {
  const fullVoucher = await prisma.voucher.findUnique({
    where,
    include: VOUCHER_DETAIL_INCLUDE,
  });

  if (!fullVoucher) {
    const whereLabel = Object.entries(where)
      .map(([key, value]) => `${key}=${value}`)
      .join(", ");
    throw new Error(`Voucher not found (${whereLabel})`);
  }

  return hydrateVoucher(fullVoucher);
};

const getReceiptById = async (voucherId) => {
  if (!voucherId) throw new Error("voucherId is required");

  const where = getVoucherWhereFromRef(voucherId);
  const voucher = await getVoucherWithDetails(where);

  if (voucher.type !== "RECEIPT") {
    throw new Error(`Receipt ${voucherId} not found`);
  }

  return voucher;
};

const validateReceiptAllocations = async (
  allocations,
  amount,
  customerId,
  { existingVoucherId = null } = {},
) => {
  const providedSum = toFloat(
    allocations.reduce((sum, allocation) => {
      return sum + parseFloat(allocation.allocatedAmount ?? 0);
    }, 0),
  );

  if (providedSum > amount + 0.001) {
    throw new Error(
      `Allocation total (${providedSum}) cannot exceed totalAmount (${amount})`,
    );
  }

  // Negative on-account allocations (billId == null) are allowed — they
  // reduce the customer's on-account balance. Negative allocations that
  // reference specific bills are validated below against overpaid amounts.

  const billIds = allocations
    .filter((allocation) => allocation.billId != null)
    .map((allocation) => allocation.billId);

  if (billIds.length > 0) {
    const uniqueBillIds = [...new Set(billIds)];
    const bills = await prisma.bill.findMany({
      where: { id: { in: uniqueBillIds } },
    });

    if (bills.length !== uniqueBillIds.length) {
      const found = new Set(bills.map((bill) => bill.id));
      const missing = uniqueBillIds.filter((id) => !found.has(id));
      throw new Error(`Bills not found: ${missing.join(", ")}`);
    }

    const wrongCustomer = bills.filter(
      (bill) => bill.customerId !== customerId,
    );
    if (wrongCustomer.length > 0) {
      throw new Error(
        `Bills do not belong to customer ${customerId}: ` +
          wrongCustomer.map((bill) => bill.invoiceNumber).join(", "),
      );
    }

    const netByBillId = new Map();
    for (const allocation of allocations) {
      if (allocation.billId == null) continue;
      netByBillId.set(
        allocation.billId,
        toFloat(
          (netByBillId.get(allocation.billId) ?? 0) +
            toFloat(allocation.allocatedAmount),
        ),
      );
    }

    const negativeBillIds = [...netByBillId.entries()]
      .filter(([, netAmount]) => netAmount < 0)
      .map(([billId]) => billId);

    if (negativeBillIds.length > 0) {
      const oldAllocationSumByBillId = new Map();
      if (existingVoucherId) {
        const oldAllocations = await prisma.billAllocation.groupBy({
          by: ["billId"],
          where: {
            voucherId: existingVoucherId,
            billId: { in: negativeBillIds },
          },
          _sum: { allocatedAmount: true },
        });

        for (const oldAllocation of oldAllocations) {
          oldAllocationSumByBillId.set(
            oldAllocation.billId,
            toFloat(oldAllocation._sum.allocatedAmount ?? 0),
          );
        }
      }

      const billsWithPostedNotes = await enrichBillsWithPostedNotes(bills);
      const billById = new Map(
        billsWithPostedNotes.map((bill) => [bill.id, bill]),
      );
      for (const billId of negativeBillIds) {
        const bill = billById.get(billId);
        const baseAllocated = toFloat(
          toFloat(bill.allocatedAmount) -
            (oldAllocationSumByBillId.get(billId) ?? 0),
        );
        const availableOverpaid = toFloat(
          baseAllocated - toFloat(bill.adjustedAmount ?? bill.billAmount),
        );
        const requestedAdjustment = Math.abs(netByBillId.get(billId));

        if (
          availableOverpaid <= 0 ||
          requestedAdjustment > availableOverpaid + 0.001
        ) {
          throw new Error(
            `Negative allocation ${requestedAdjustment} exceeds overpaid amount ` +
              `${Math.max(availableOverpaid, 0)} for bill ${bill.invoiceNumber}`,
          );
        }
      }
    }
  }

  return { providedSum, billIds };
};

const buildAllocationsWithRemainder = async (
  allocations,
  amount,
  customerId,
  opts = {},
) => {
  const normalized = (allocations ?? []).map((allocation) => {
    const allocatedAmount = parseAllocationAmount(allocation.allocatedAmount);

    // accept sentinel values for explicit on-account such as "ON-ACCOUNT"
    let billId = allocation.billId ?? null;
    if (typeof billId === "string") {
      const sentinel = billId.trim().toUpperCase();
      if (
        sentinel === "ON-ACCOUNT" ||
        sentinel === "ON ACCOUNT" ||
        sentinel === "ON_ACCOUNT"
      ) {
        billId = null;
      }
    }

    return {
      billId,
      allocatedAmount,
      narration: allocation.narration ?? null,
    };
  });

  const { providedSum, billIds } = await validateReceiptAllocations(
    normalized,
    amount,
    customerId,
    opts,
  );

  const remainder = toFloat(amount - providedSum);
  if (remainder > 0) {
    normalized.push({
      billId: null,
      allocatedAmount: remainder,
      narration: "On-account (unallocated)",
    });
  }

  return { finalAllocations: normalized, billIds };
};

const preserveAllocationsForAmountChange = async (
  existingAllocations,
  amount,
  customerId,
) => {
  const billAllocations = existingAllocations
    .filter(
      (allocation) =>
        allocation.billId != null && allocation.customerCreditId == null,
    )
    .map((allocation) => ({
      billId: allocation.billId,
      allocatedAmount: toFloat(allocation.allocatedAmount),
      narration: allocation.narration ?? null,
    }));

  const billAllocatedAmount = toFloat(
    billAllocations.reduce(
      (sum, allocation) => sum + allocation.allocatedAmount,
      0,
    ),
  );

  if (billAllocatedAmount > amount + 0.001) {
    throw new Error(
      `totalAmount (${amount}) cannot be less than bill allocations (${billAllocatedAmount})`,
    );
  }

  const existingOnAccount = existingAllocations.find(
    (allocation) => allocation.billId == null,
  );
  const finalAllocations = [...billAllocations];
  const remainder = toFloat(amount - billAllocatedAmount);

  if (remainder > 0) {
    finalAllocations.push({
      billId: null,
      allocatedAmount: remainder,
      narration: existingOnAccount?.narration ?? "On-account (unallocated)",
    });
  }

  const { billIds } = await validateReceiptAllocations(
    finalAllocations,
    amount,
    customerId,
  );

  return { finalAllocations, billIds };
};

/**
 * Reconcile a voucher's BillAllocation rows against a fresh allocation payload, WITHOUT ever
 * deleting a CustomerCredit. This exists because the naive "deleteMany then createMany" approach
 * violates the customer_credits_sourceAllocationId_fkey (onDelete: Restrict) the moment any
 * on-account allocation for this voucher already has a CustomerCredit pointing at it -- which is
 * true for every voucher that has ever had an on-account remainder, including all backfilled ones.
 *
 * Rules (per product decision):
 *   - Bill-targeted allocations (billId != null) never have a CustomerCredit attached
 *     (only on-account rows get one, via createOnAccountAllocationWithCredit). These are always
 *     safe to delete-and-recreate freely.
 *   - The on-account allocation (billId == null), if one exists on the old AND/OR new side, is
 *     never deleted. Its CustomerCredit.amount is adjusted in place to match the new remainder.
 *   - If the new remainder would drop the credit's amount below what's already been consumed
 *     (CreditConsumption history exists against it), the edit is REJECTED with a clear error --
 *     the receipt no longer has enough unconsumed money to honor what's already been applied to
 *     a bill. The caller must reverse/adjust that consumption first; this function will not
 *     silently destroy or shrink consumed history.
 */
const reconcileAllocationsForUpdate = async (
  tx,
  { voucherId, customerId, amount, finalAllocations, oldBillIds, newBillIds },
) => {
  const reversedCreditBillIds = await reverseReceiptCreditConsumptionsTx(
    tx,
    voucherId,
  );
  const {
    cashBillAllocations: billTargeted,
    creditApplications,
    billAdjustmentAllocations,
    positiveOnAccountAmount: newCreditAmount,
    positiveOnAccountAllocations,
  } = splitReceiptAllocationsByFunding(finalAllocations, amount);
  const creditNarration =
    positiveOnAccountAllocations[0]?.narration ?? "On-account (unallocated)";
  const totalCreditApplicationAmount = toFloat(
    creditApplications.reduce(
      (sum, application) => sum + toFloat(application.allocatedAmount),
      0,
    ),
  );

  await assertSufficientCustomerCreditsTx(tx, {
    customerId,
    requiredAmount: totalCreditApplicationAmount,
    excludeSourceVoucherId: voucherId,
  });

  // Normal bill-targeted receipt rows are safe to replace. Credit-backed rows
  // are application history and must remain tied to their CustomerCredit.
  await tx.billAllocation.deleteMany({
    where: { voucherId, billId: { not: null }, customerCreditId: null },
  });
  if (billTargeted.length > 0) {
    await tx.billAllocation.createMany({
      data: billTargeted.map((a) => ({
        voucherId,
        billId: a.billId,
        customerId,
        allocatedAmount: a.allocatedAmount,
        narration: a.narration,
      })),
    });
  }
  if (billAdjustmentAllocations.length > 0) {
    await tx.billAllocation.createMany({
      data: billAdjustmentAllocations.map((a) => ({
        voucherId,
        billId: a.billId,
        customerId,
        allocatedAmount: a.allocatedAmount,
        narration: a.narration,
      })),
    });
  }

  // Remove stale plain adjustment rows. We recreate them below only when the
  // voucher does not already have its own credit-backed source row.
  await tx.billAllocation.deleteMany({
    where: { voucherId, billId: null, customerCreditId: null },
  });

  // The existing credit-backed on-account row (if any) for this voucher.
  const existingOnAccountAllocations = await tx.billAllocation.findMany({
    where: { voucherId, billId: null, customerCreditId: { not: null } },
    include: { customerCredit: true },
    orderBy: { createdAt: "asc" },
  });
  if (existingOnAccountAllocations.length > 1) {
    throw new Error(
      "This receipt has multiple on-account credit rows. Consolidate those credits before editing the receipt.",
    );
  }
  const existingOnAccountAllocation = existingOnAccountAllocations[0] ?? null;

  const existingCredit = existingOnAccountAllocation?.customerCredit ?? null;

  if (!existingCredit) {
    // Nothing to preserve. Either this voucher never had an on-account remainder, or it
    // only has plain adjustment rows handled above.
    for (const creditApplication of creditApplications) {
      await consumeCustomerCreditsForBillTx(tx, {
        customerId,
        billId: creditApplication.billId,
        amount: creditApplication.allocatedAmount,
        voucherId,
        excludeSourceVoucherId: voucherId,
        narration: creditApplication.narration ?? "Applied from on-account",
      });
    }
    if (newCreditAmount > 0.001) {
      await createOnAccountAllocationWithCredit(tx, voucherId, customerId, {
        billId: null,
        allocatedAmount: newCreditAmount,
        narration: creditNarration,
      });
    }
    const affectedBillIds = [
      ...new Set([...oldBillIds, ...newBillIds, ...reversedCreditBillIds]),
    ];
    for (const billId of affectedBillIds) {
      await recalculateBillAllocated(billId, tx);
    }
    return;
  }

  const consumedAmount = toFloat(existingCredit.consumedAmount);
  const newAmount = newCreditAmount;

  if (newAmount < consumedAmount - 0.001) {
    throw new Error(
      `Cannot reduce on-account credit to ${newAmount} — ${consumedAmount} of it has already ` +
        `been applied to a bill. Reverse that application before reducing this receipt's amount ` +
        `or allocations.`,
    );
  }

  if (consumedAmount > 0.001 && customerId !== existingCredit.customerId) {
    throw new Error(
      `Cannot change this receipt's customer — ${consumedAmount} of its on-account credit has ` +
        `already been applied to a bill for the original customer. Reverse that application first.`,
    );
  }

  for (const creditApplication of creditApplications) {
    await consumeCustomerCreditsForBillTx(tx, {
      customerId,
      billId: creditApplication.billId,
      amount: creditApplication.allocatedAmount,
      voucherId,
      excludeSourceVoucherId: voucherId,
      narration: creditApplication.narration ?? "Applied from on-account",
    });
  }

  // Adjust the credit and its backing allocation in place. Never delete.
  await tx.customerCredit.update({
    where: { id: existingCredit.id },
    data: {
      customerId,
      amount: newAmount,
      status: newAmount - consumedAmount <= 0.001 ? "EXHAUSTED" : "OPEN",
    },
  });

  if (newAmount > 0.001) {
    await tx.billAllocation.update({
      where: { id: existingOnAccountAllocation.id },
      data: {
        customerId,
        allocatedAmount: newAmount,
        narration: creditNarration ?? existingOnAccountAllocation.narration,
      },
    });
  } else {
    // No on-account remainder anymore, but consumedAmount may be > 0 (fully exhausted is fine —
    // amount was just set to consumedAmount above, so the row is allowed to stay at that value).
    await tx.billAllocation.update({
      where: { id: existingOnAccountAllocation.id },
      data: { customerId, allocatedAmount: newAmount },
    });
  }

  const affectedBillIds = [
    ...new Set([...oldBillIds, ...newBillIds, ...reversedCreditBillIds]),
  ];
  for (const billId of affectedBillIds) {
    await recalculateBillAllocated(billId, tx);
  }
};

const updateReceipt = async (voucherRef, params = {}) => {
  if (!voucherRef) throw new Error("voucherId is required");

  const existing = await getReceiptById(voucherRef);
  const customerId = params.customerId ?? existing.customerId;

  if (
    customerId !== existing.customerId &&
    !hasOwn(params, "allocations") &&
    existing.allocations.some((allocation) => allocation.billId != null)
  ) {
    throw new Error("allocations are required when changing customerId");
  }

  const amount = hasOwn(params, "totalAmount")
    ? parsePositiveAmount(params.totalAmount, "totalAmount")
    : toFloat(existing.totalAmount);
  const paymentMethod = params.paymentMethod ?? existing.paymentMethod;
  if (!VALID_PAYMENT_METHODS.includes(paymentMethod)) {
    throw new Error(
      `paymentMethod must be one of: ${VALID_PAYMENT_METHODS.join(", ")}`,
    );
  }
  const voucherDate = hasOwn(params, "voucherDate")
    ? parseOptionalDate(params.voucherDate, "voucherDate")
    : existing.voucherDate;

  if (!voucherDate) throw new Error("voucherDate must be a valid date");

  const bankInput = hasOwn(params, "bankId") ? params.bankId : existing.bankId;
  const { bankId: resolvedBankId, bankName } = await resolveBank(
    paymentMethod,
    bankInput,
  );

  const bankLedgerCode = paymentMethod === "CASH" ? "CASH-001" : "BANK-001";
  const [arAccount, bankAccount] = await Promise.all([
    getAccount("AR-001"),
    getAccount(bankLedgerCode),
  ]);

  const oldBillIds = [
    ...new Set(
      existing.allocations
        .map((allocation) => allocation.billId)
        .filter(Boolean),
    ),
  ];

  let allocationPayload = null;
  if (hasOwn(params, "allocations")) {
    allocationPayload = await buildAllocationsWithRemainder(
      params.allocations ?? [],
      amount,
      customerId,
      { existingVoucherId: existing.id },
    );
  } else if (
    hasOwn(params, "totalAmount") ||
    customerId !== existing.customerId
  ) {
    allocationPayload = await preserveAllocationsForAmountChange(
      existing.allocations,
      amount,
      customerId,
    );
  }

  const chequeDate = hasOwn(params, "chequeDate")
    ? parseOptionalDate(params.chequeDate, "chequeDate")
    : existing.chequeDate;

  await prisma.$transaction(
    async (tx) => {
      await tx.voucher.update({
        where: { id: existing.id },
        data: {
          customerId,
          totalAmount: amount,
          paymentMethod,
          bankId: resolvedBankId,
          bankName: bankName ?? null,
          chequeNumber: hasOwn(params, "chequeNumber")
            ? params.chequeNumber
            : existing.chequeNumber,
          chequeDate,
          utrNumber: hasOwn(params, "utrNumber")
            ? params.utrNumber
            : existing.utrNumber,
          upiRef: hasOwn(params, "upiRef") ? params.upiRef : existing.upiRef,
          reference: hasOwn(params, "reference")
            ? params.reference
            : existing.reference,
          narration: hasOwn(params, "narration")
            ? params.narration
            : existing.narration,
          voucherDate,
          financialYear: getFinancialYear(voucherDate),
        },
      });

      await tx.voucherEntry.deleteMany({
        where: { voucherId: existing.id },
      });
      await tx.voucherEntry.createMany({
        data: [
          {
            voucherId: existing.id,
            ledgerAccountId: bankAccount.id,
            entryType: "DEBIT",
            amount,
            narration: `Receipt ${existing.voucherId}`,
          },
          {
            voucherId: existing.id,
            ledgerAccountId: arAccount.id,
            entryType: "CREDIT",
            amount,
            narration: `Receipt ${existing.voucherId}`,
          },
        ],
      });

      if (allocationPayload) {
        await reconcileAllocationsForUpdate(tx, {
          voucherId: existing.id,
          customerId,
          amount,
          finalAllocations: allocationPayload.finalAllocations,
          oldBillIds,
          newBillIds: allocationPayload.billIds,
        });
      }

      await recalculateVoucherOnAccount(existing.id, tx);
    },
    {
      maxWait: 10000,
      timeout: 15000,
    },
  );

  return getVoucherWithDetails({ id: existing.id });
};

const deleteReceipt = async (voucherRef) => {
  if (!voucherRef) throw new Error("voucherId is required");

  const where = voucherRef.includes("/")
    ? { voucherId: voucherRef }
    : getVoucherWhereFromRef(voucherRef);
  const voucher = await getVoucherWithDetails(where);

  if (voucher.type !== "RECEIPT") {
    throw new Error(
      `Only receipt vouchers can be deleted via this endpoint (${voucher.voucherId})`,
    );
  }

  const affectedBillIds = [
    ...new Set(
      voucher.allocations
        .map((allocation) => allocation.billId)
        .filter(Boolean),
    ),
  ];

  await prisma.$transaction(
    async (tx) => {
      const reversedCreditBillIds = await reverseReceiptCreditConsumptionsTx(
        tx,
        voucher.id,
      );
      const credits = await tx.customerCredit.findMany({
        where: { sourceVoucherId: voucher.id },
        select: { id: true, sourceAllocationId: true },
      });

      const creditIds = credits.map((credit) => credit.id);
      const sourceAllocationIds = credits.map(
        (credit) => credit.sourceAllocationId,
      );
      const creditConsumptions = creditIds.length
        ? await tx.creditConsumption.findMany({
            where: { creditId: { in: creditIds } },
            select: { billId: true },
          })
        : [];
      const consumedCreditBillIds = creditConsumptions.map(
        (consumption) => consumption.billId,
      );

      await tx.creditConsumption.deleteMany({
        where: { creditId: { in: creditIds } },
      });
      await tx.billAllocation.deleteMany({
        where: {
          customerCreditId: { in: creditIds },
          id: { notIn: sourceAllocationIds },
        },
      });
      await tx.customerCredit.deleteMany({
        where: { id: { in: creditIds } },
      });
      await tx.billAllocation.deleteMany({
        where: { id: { in: sourceAllocationIds } },
      });

      await tx.voucher.delete({
        where: { id: voucher.id },
      });

      for (const billId of [
        ...new Set([
          ...affectedBillIds,
          ...reversedCreditBillIds,
          ...consumedCreditBillIds,
        ]),
      ]) {
        await recalculateBillAllocated(billId, tx);
      }
    },
    {
      maxWait: 10000,
      timeout: 15000,
    },
  );

  return voucher;
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

  const { finalAllocations, billIds } = await buildAllocationsWithRemainder(
    allocations,
    amount,
    customerId,
  );

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

  const createdVoucher = await prisma.$transaction(
    async (tx) => {
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
          chequeDate: chequeDate ? new Date(chequeDate) : null,
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

      // 3. Bill allocations. Positive on-account creates a CustomerCredit.
      // Negative on-account consumes existing credits and applies them to bills.
      const {
        cashBillAllocations,
        creditApplications,
        billAdjustmentAllocations,
        positiveOnAccountAmount,
        positiveOnAccountAllocations,
      } = splitReceiptAllocationsByFunding(finalAllocations, amount);
      const totalCreditApplicationAmount = toFloat(
        creditApplications.reduce(
          (sum, application) => sum + toFloat(application.allocatedAmount),
          0,
        ),
      );

      await assertSufficientCustomerCreditsTx(tx, {
        customerId,
        requiredAmount: totalCreditApplicationAmount,
        excludeSourceVoucherId: voucher.id,
      });

      if (cashBillAllocations.length > 0) {
        await tx.billAllocation.createMany({
          data: cashBillAllocations.map((a) => ({
            voucherId: voucher.id,
            billId: a.billId,
            customerId,
            allocatedAmount: toFloat(a.allocatedAmount),
            narration: a.narration ?? null,
          })),
        });
      }
      if (billAdjustmentAllocations.length > 0) {
        await tx.billAllocation.createMany({
          data: billAdjustmentAllocations.map((a) => ({
            voucherId: voucher.id,
            billId: a.billId,
            customerId,
            allocatedAmount: toFloat(a.allocatedAmount),
            narration: a.narration ?? null,
          })),
        });
      }

      for (const creditApplication of creditApplications) {
        await consumeCustomerCreditsForBillTx(tx, {
          customerId,
          billId: creditApplication.billId,
          amount: creditApplication.allocatedAmount,
          voucherId: voucher.id,
          excludeSourceVoucherId: voucher.id,
          createdBy: createdBy ?? null,
          narration: creditApplication.narration ?? "Applied from on-account",
        });
      }

      if (positiveOnAccountAmount > 0.001) {
        await createOnAccountAllocationWithCredit(tx, voucher.id, customerId, {
          billId: null,
          allocatedAmount: positiveOnAccountAmount,
          narration:
            positiveOnAccountAllocations[0]?.narration ??
            "On-account (unallocated)",
        });
      }

      // 4. Recalculate allocatedAmount on each affected Bill
      for (const billId of [...new Set(billIds)]) {
        await recalculateBillAllocated(billId, tx);
      }

      // 5. Update onAccountAmount on Voucher
      const updatedVoucher = await recalculateVoucherOnAccount(voucher.id, tx);

      return {
        id: voucher.id,
        voucherId: voucher.voucherId,
        onAccountAmount: updatedVoucher.onAccountAmount,
      };
    },
    {
      maxWait: 10000,
      timeout: 15000,
    },
  );

  return getVoucherWithDetails({ id: createdVoucher.id });
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

  if (allocation.customerCreditId) {
    return prisma.$transaction(async (tx) =>
      applyCreditToBillTx(
        tx,
        allocation.customerCreditId,
        billId,
        amount,
        null,
      ),
    );
  }

  const availableAllocationAmount = toFloat(allocation.allocatedAmount);
  if (availableAllocationAmount <= 0) {
    throw new Error(
      `Allocation ${allocationId} does not have a positive on-account balance`,
    );
  }

  const applyAmount = amount
    ? parsePositiveAmount(amount, "amount")
    : availableAllocationAmount;

  if (applyAmount > availableAllocationAmount + 0.001) {
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
          allocatedAmount: availableAllocationAmount - applyAmount,
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
  const { status, financialYear, startDate, endDate, asOfDate } = opts;

  const where = { customerId };
  if (startDate || endDate) {
    where.invoiceDate = {
      ...(startDate ? { gte: new Date(startDate) } : {}),
      ...(endDate ? { lte: new Date(endDate) } : {}),
    };
  } else if (financialYear) {
    where.financialYear = financialYear;
  }

  const bills = await prisma.bill.findMany({
    where,
    orderBy: { invoiceDate: "asc" },
  });
  const hydrated = await enrichBillsWithPostedNotes(bills, { asOfDate });

  if (status && status.length > 0) {
    return hydrated.filter((b) => status.includes(b.status));
  }

  return hydrated;
};

const getOnAccountAllocations = async (customerId) => {
  return prisma.billAllocation.findMany({
    where: { customerId, billId: null },
    include: { voucher: true, customerCredit: true },
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
      include: {
        allocations: { include: { bill: true, customerCredit: true } },
      },
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
  applyCreditToBill,
  getReceiptById,
  updateReceipt,
  deleteReceipt,
  getCustomerBills,
  getCustomerVouchers,
  getCustomerOnAccountBalance,
  getCustomerCreditBalance,
  getCustomerCredits,
  getOnAccountAllocations,
  computeBillStatus,
  hydrateBill,
  getFinancialYear,
};
