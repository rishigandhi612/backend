#!/usr/bin/env node
/*
  Read-only diagnostic for explaining why customer ledger closing balance and
  bill-wise pending do not match.

  Usage:
    node scripts/reconcile_customer_balance.js 677512d447161382de94fc24
    node scripts/reconcile_customer_balance.js 677512d447161382de94fc24 --financialYear=2025-26
    node scripts/reconcile_customer_balance.js 677512d447161382de94fc24 --startDate=2025-04-01 --endDate=2026-03-31
*/

const prisma = require("../config/prisma");
const { getCustomerLedger, resolveDateRange } = require("../services/ledger.service");
const {
  getCustomerBills,
  getCustomerOnAccountBalance,
} = require("../services/voucher.service");

const customerId = process.argv[2];
const args = process.argv.slice(3);

const getArg = (name) => {
  const arg = args.find((item) => item.startsWith(`--${name}=`));
  return arg ? arg.split("=").slice(1).join("=") : undefined;
};

const opts = {
  financialYear: getArg("financialYear"),
  startDate: getArg("startDate"),
  endDate: getArg("endDate"),
};

const toFloat = (value) => Number(Number(value ?? 0).toFixed(2));
const money = (value) =>
  toFloat(value).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

const printRows = (title, rows, formatter, limit = 25) => {
  console.log(`\n${title} (${rows.length})`);
  console.log("-".repeat(80));
  for (const row of rows.slice(0, limit)) console.log(formatter(row));
  if (rows.length > limit) console.log(`... ${rows.length - limit} more`);
};

async function main() {
  if (!customerId) {
    throw new Error("customerId is required");
  }

  const range = resolveDateRange(opts);
  const ledgerResult = await getCustomerLedger(customerId, {
    ...opts,
    page: 1,
    limit: 1,
  });
  const [bills, onAccountBalance] = await Promise.all([
    getCustomerBills(customerId, {
      startDate: range.startDate,
      endDate: range.endDate,
      asOfDate: range.endDate,
    }),
    getCustomerOnAccountBalance(customerId, range),
  ]);

  const sourceBills =
    ledgerResult.summary.openingBalanceSource === "PREVIOUS_CLOSING_BALANCE"
      ? bills.filter((bill) => !bill.isOpeningBalance)
      : bills;

  const billWiseGrossPending = toFloat(
    sourceBills.reduce((sum, bill) => sum + toFloat(bill.pendingAmount), 0),
  );
  const billWiseNetPending = toFloat(billWiseGrossPending - onAccountBalance);
  const ledgerClosing = toFloat(ledgerResult.summary.closingBalance);
  const difference = toFloat(ledgerClosing - billWiseNetPending);
  const adjustedBillWiseNetPending = toFloat(billWiseNetPending + difference);

  console.log("=".repeat(80));
  console.log(`Customer: ${customerId}`);
  console.log(`Date range: ${range.startDate.toISOString()} -> ${range.endDate.toISOString()}`);
  console.log("=".repeat(80));
  console.log(`Ledger closing balance     : ${money(ledgerClosing)}`);
  console.log(`Bill-wise gross pending    : ${money(billWiseGrossPending)}`);
  console.log(`On-account balance         : ${money(onAccountBalance)}`);
  console.log(`Bill-wise net pending      : ${money(billWiseNetPending)}`);
  console.log(`Ledger - bill-wise net     : ${money(difference)}`);
  console.log(`Adjusted bill-wise net     : ${money(adjustedBillWiseNetPending)}`);
  console.log(`Ledger opening source      : ${ledgerResult.summary.openingBalanceSource}`);
  console.log(`Ledger opening balance     : ${money(ledgerResult.summary.openingBalance)}`);

  const billIds = sourceBills.map((bill) => bill.id);
  const billIdSet = new Set(billIds);

  const [
    allocationsByBill,
    vouchers,
    notesInRange,
    notesAll,
    billsInRangeRaw,
  ] = await Promise.all([
    prisma.billAllocation.groupBy({
      by: ["billId"],
      where: {
        customerId,
        billId: { in: billIds },
      },
      _sum: { allocatedAmount: true },
    }),
    prisma.voucher.findMany({
      where: {
        customerId,
        voucherDate: { gte: range.startDate, lte: range.endDate },
      },
      orderBy: { voucherDate: "asc" },
      include: { allocations: { include: { bill: true } } },
    }),
    prisma.invoiceNote.findMany({
      where: {
        customerId,
        documentType: "SALE",
        status: "POSTED",
        noteDate: { gte: range.startDate, lte: range.endDate },
      },
      orderBy: { noteDate: "asc" },
    }),
    prisma.invoiceNote.findMany({
      where: {
        customerId,
        documentType: "SALE",
        status: "POSTED",
      },
      orderBy: { noteDate: "asc" },
    }),
    prisma.bill.findMany({
      where: {
        customerId,
        invoiceDate: { gte: range.startDate, lte: range.endDate },
      },
      orderBy: { invoiceDate: "asc" },
    }),
  ]);

  const allocationSumByBillId = new Map(
    allocationsByBill.map((row) => [
      row.billId,
      toFloat(row._sum.allocatedAmount ?? 0),
    ]),
  );

  const driftedBills = bills
    .map((bill) => {
      const allocationSum = toFloat(allocationSumByBillId.get(bill.id) ?? 0);
      const cachedAllocated = toFloat(bill.allocatedAmount);
      return {
        invoiceNumber: bill.invoiceNumber,
        cachedAllocated,
        allocationSum,
        diff: toFloat(cachedAllocated - allocationSum),
        pendingAmount: toFloat(bill.pendingAmount),
      };
    })
    .filter((row) => Math.abs(row.diff) >= 0.01);

  const notesWithoutBillInCurrentBills = notesInRange.filter(
    (note) => note.billId && !billIdSet.has(note.billId),
  );
  const notesWithoutBillId = notesInRange.filter((note) => !note.billId);
  const voucherOnAccountRows = vouchers.flatMap((voucher) =>
    voucher.allocations
      .filter((allocation) => allocation.billId == null)
      .map((allocation) => ({
        voucherId: voucher.voucherId,
        voucherDate: voucher.voucherDate,
        amount: toFloat(allocation.allocatedAmount),
        narration: allocation.narration,
      })),
  );

  const currentBillRawTotal = toFloat(
    billsInRangeRaw.reduce((sum, bill) => sum + toFloat(bill.billAmount), 0),
  );
  const currentVoucherReceiptTotal = toFloat(
    vouchers
      .filter((voucher) => voucher.type === "RECEIPT")
      .reduce((sum, voucher) => sum + toFloat(voucher.totalAmount), 0),
  );
  const currentVoucherPaymentTotal = toFloat(
    vouchers
      .filter((voucher) => voucher.type === "PAYMENT")
      .reduce((sum, voucher) => sum + toFloat(voucher.totalAmount), 0),
  );
  const debitNoteTotal = toFloat(
    notesInRange
      .filter((note) => note.balanceEffect === "INCREASE")
      .reduce((sum, note) => sum + toFloat(note.amount), 0),
  );
  const creditNoteTotal = toFloat(
    notesInRange
      .filter((note) => note.balanceEffect === "DECREASE")
      .reduce((sum, note) => sum + toFloat(note.amount), 0),
  );

  console.log("\nLedger component check");
  console.log("-".repeat(80));
  console.log(`Opening/BF                : ${money(ledgerResult.summary.openingBalance)}`);
  console.log(`Bills in range            : ${money(currentBillRawTotal)}`);
  console.log(`Debit notes in range      : ${money(debitNoteTotal)}`);
  console.log(`Payments in range         : ${money(currentVoucherPaymentTotal)}`);
  console.log(`Receipts in range         : ${money(currentVoucherReceiptTotal)}`);
  console.log(`Credit notes in range     : ${money(creditNoteTotal)}`);

  printRows(
    "Allocation cache drift: Bill.allocatedAmount minus actual allocations",
    driftedBills,
    (row) =>
      `${row.invoiceNumber} cached=${money(row.cachedAllocated)} actualAlloc=${money(row.allocationSum)} diff=${money(row.diff)} pending=${money(row.pendingAmount)}`,
  );

  printRows(
    "Invoice notes in range",
    notesInRange,
    (note) =>
      `${note.noteDate.toISOString().slice(0, 10)} ${note.noteNumber} ${note.noteType}/${note.balanceEffect} amount=${money(note.amount)} invoice=${note.invoiceNumber} billId=${note.billId ?? "null"}`,
  );

  printRows(
    "Notes in range whose billId is not in current bill set",
    notesWithoutBillInCurrentBills,
    (note) =>
      `${note.noteNumber} amount=${money(note.amount)} invoice=${note.invoiceNumber} billId=${note.billId}`,
  );

  printRows(
    "Notes in range with null billId",
    notesWithoutBillId,
    (note) =>
      `${note.noteNumber} amount=${money(note.amount)} invoice=${note.invoiceNumber}`,
  );

  printRows(
    "On-account allocation rows in range",
    voucherOnAccountRows,
    (row) =>
      `${row.voucherDate.toISOString().slice(0, 10)} ${row.voucherId} amount=${money(row.amount)} ${row.narration ?? ""}`,
  );

  const exactAmountMatches = [
    ...notesAll.map((note) => ({
      source: "NOTE",
      date: note.noteDate,
      ref: note.noteNumber,
      amount: toFloat(note.amount),
      detail: `${note.noteType}/${note.balanceEffect} invoice=${note.invoiceNumber}`,
    })),
    ...voucherOnAccountRows.map((row) => ({
      source: "ON_ACCOUNT",
      date: row.voucherDate,
      ref: row.voucherId,
      amount: Math.abs(toFloat(row.amount)),
      detail: row.narration ?? "",
    })),
    ...driftedBills.map((row) => ({
      source: "ALLOC_DRIFT",
      date: null,
      ref: row.invoiceNumber,
      amount: Math.abs(toFloat(row.diff)),
      detail: `cached allocated differs from allocation rows`,
    })),
  ].filter((row) => Math.abs(row.amount - Math.abs(difference)) < 0.01);

  printRows(
    `Rows exactly matching absolute difference ${money(Math.abs(difference))}`,
    exactAmountMatches,
    (row) =>
      `${row.source} ${row.date ? row.date.toISOString().slice(0, 10) : ""} ${row.ref} amount=${money(row.amount)} ${row.detail}`,
  );
}

main()
  .catch((error) => {
    console.error("Reconciliation failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
