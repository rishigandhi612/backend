#!/usr/bin/env node
/*
  Read-only audit: compare ledger closing balance against bill-wise net pending
  for every customer present in PostgreSQL accounting tables.

  Usage:
    node scripts/audit_customer_balance_reconciliation.js
    node scripts/audit_customer_balance_reconciliation.js --financialYear=2026-27
    node scripts/audit_customer_balance_reconciliation.js --startDate=2026-04-01 --endDate=2027-03-31
    node scripts/audit_customer_balance_reconciliation.js --tolerance=1
*/

const prisma = require("../config/prisma");
const { getCustomerLedger, resolveDateRange } = require("../services/ledger.service");
const {
  getCustomerBills,
  getCustomerOnAccountBalance,
} = require("../services/voucher.service");

const args = process.argv.slice(2);

const getArg = (name) => {
  const arg = args.find((item) => item.startsWith(`--${name}=`));
  return arg ? arg.split("=").slice(1).join("=") : undefined;
};

const opts = {
  financialYear: getArg("financialYear"),
  startDate: getArg("startDate"),
  endDate: getArg("endDate"),
};

const tolerance = Number(getArg("tolerance") ?? 0.01);
const toFloat = (value) => Number(Number(value ?? 0).toFixed(2));
const money = (value) =>
  toFloat(value).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

async function getCustomerIds() {
  const [billRows, voucherRows, noteRows, creditRows, openingRows] =
    await Promise.all([
      prisma.bill.findMany({ distinct: ["customerId"], select: { customerId: true } }),
      prisma.voucher.findMany({
        distinct: ["customerId"],
        select: { customerId: true },
      }),
      prisma.invoiceNote.findMany({
        where: { customerId: { not: null } },
        distinct: ["customerId"],
        select: { customerId: true },
      }),
      prisma.customerCredit.findMany({
        distinct: ["customerId"],
        select: { customerId: true },
      }),
      prisma.openingBalance.findMany({
        distinct: ["customerId"],
        select: { customerId: true },
      }),
    ]);

  return [
    ...new Set(
      [...billRows, ...voucherRows, ...noteRows, ...creditRows, ...openingRows]
        .map((row) => row.customerId)
        .filter(Boolean),
    ),
  ].sort();
}

async function main() {
  const range = resolveDateRange(opts);
  const customerIds = await getCustomerIds();
  const mismatches = [];
  const adjustments = [];
  const errors = [];

  console.log("=".repeat(90));
  console.log(`Customers to audit: ${customerIds.length}`);
  console.log(`Date range: ${range.startDate.toISOString()} -> ${range.endDate.toISOString()}`);
  console.log(`Tolerance: ${money(tolerance)}`);
  console.log("=".repeat(90));

  for (const customerId of customerIds) {
    try {
      const [ledgerResult, bills, onAccountBalance] = await Promise.all([
        getCustomerLedger(customerId, { ...opts, page: 1, limit: 1 }),
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
      const billWiseNetPending = toFloat(
        billWiseGrossPending - toFloat(onAccountBalance),
      );
      const ledgerClosing = toFloat(ledgerResult.summary.closingBalance);
      const difference = toFloat(ledgerClosing - billWiseNetPending);
      const adjustedBillWiseNetPending = toFloat(
        billWiseNetPending + difference,
      );
      const adjustedDifference = toFloat(
        ledgerClosing - adjustedBillWiseNetPending,
      );

      if (Math.abs(difference) > tolerance) {
        adjustments.push({
          customerId,
          ledgerClosing,
          billWiseNetPending,
          ledgerAdjustment: difference,
        });
      }

      if (Math.abs(adjustedDifference) > tolerance) {
        mismatches.push({
          customerId,
          ledgerClosing,
          billWiseGrossPending,
          onAccountBalance,
          billWiseNetPending,
          difference: adjustedDifference,
        });
      }
    } catch (error) {
      errors.push({ customerId, error: error.message });
    }
  }

  if (mismatches.length > 0) {
    console.log("\nMismatches");
    console.log("-".repeat(90));
    console.log(
      `${"Customer".padEnd(26)} ${"Ledger".padStart(14)} ${"BillNet".padStart(14)} ${"Diff".padStart(14)} ${"OnAcct".padStart(14)}`,
    );
    for (const row of mismatches) {
      console.log(
        `${row.customerId.padEnd(26)} ${money(row.ledgerClosing).padStart(14)} ${money(row.billWiseNetPending).padStart(14)} ${money(row.difference).padStart(14)} ${money(row.onAccountBalance).padStart(14)}`,
      );
    }
  }

  if (adjustments.length > 0) {
    console.log("\nLedger adjustment rows needed");
    console.log("-".repeat(90));
    console.log(
      `${"Customer".padEnd(26)} ${"Ledger".padStart(14)} ${"RawBillNet".padStart(14)} ${"Adjustment".padStart(14)}`,
    );
    for (const row of adjustments) {
      console.log(
        `${row.customerId.padEnd(26)} ${money(row.ledgerClosing).padStart(14)} ${money(row.billWiseNetPending).padStart(14)} ${money(row.ledgerAdjustment).padStart(14)}`,
      );
    }
  }

  if (errors.length > 0) {
    console.log("\nErrors");
    console.log("-".repeat(90));
    for (const row of errors) {
      console.log(`${row.customerId}: ${row.error}`);
    }
  }

  console.log("\nSummary");
  console.log("-".repeat(90));
  console.log(`Audited customers : ${customerIds.length}`);
  console.log(`Mismatches        : ${mismatches.length}`);
  console.log(`Adjustments       : ${adjustments.length}`);
  console.log(`Errors            : ${errors.length}`);
  console.log("=".repeat(90));
}

main()
  .catch((error) => {
    console.error("Audit failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
