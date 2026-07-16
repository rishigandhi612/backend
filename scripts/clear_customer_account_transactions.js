#!/usr/bin/env node
/*
  One-time cleanup: remove PostgreSQL accounting transactions for one customer,
  while keeping all Bill rows and OpeningBalance rows intact.

  This does NOT touch MongoDB.

  Target customer:
    67d2b62075bf083cbca11438

  What is deleted:
    - credit_consumptions
    - customer_credits
    - bill_allocations
    - voucher_entries
    - vouchers
    - invoice_notes

  What is kept:
    - bills, including normal invoice bills and opening-balance bills
    - opening_balances
    - MongoDB invoices/customers/anything else

  Usage:
    node scripts/clear_customer_account_transactions.js
      Dry run only. Prints what would be deleted.

    node scripts/clear_customer_account_transactions.js --apply --confirm=67d2b62075bf083cbca11438
      Actually deletes the rows and resets this customer's Bill.allocatedAmount to 0.

    node scripts/clear_customer_account_transactions.js --apply --confirm=67d2b62075bf083cbca11438 --keep-invoice-notes
      Same cleanup, but keeps PostgreSQL invoice_notes.
*/

const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

const CUSTOMER_ID = "67d2b62075bf083cbca11438";
const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const KEEP_INVOICE_NOTES = args.includes("--keep-invoice-notes");
const CONFIRM_VALUE =
  args
    .find((arg) => arg.startsWith("--confirm="))
    ?.split("=")
    .slice(1)
    .join("=") ?? "";

const log = (...parts) => console.log(new Date().toISOString(), ...parts);

const orWhere = (clauses) => {
  const OR = clauses.filter(Boolean);
  return OR.length > 0 ? { OR } : { id: { in: [] } };
};

const usage = () => {
  console.log(`
Usage:
  node scripts/clear_customer_account_transactions.js
  node scripts/clear_customer_account_transactions.js --apply --confirm=${CUSTOMER_ID}

Options:
  --apply                    Commit changes. Without this, the script is dry-run only.
  --confirm=${CUSTOMER_ID}   Required with --apply.
  --keep-invoice-notes       Do not delete PostgreSQL invoice_notes.
`);
};

const unique = (values) => [...new Set(values.filter(Boolean))];

async function collectScope(tx) {
  const bills = await tx.bill.findMany({
    where: { customerId: CUSTOMER_ID },
    select: {
      id: true,
      invoiceNumber: true,
      allocatedAmount: true,
      isOpeningBalance: true,
      openingBalanceId: true,
    },
    orderBy: { invoiceDate: "asc" },
  });

  const vouchers = await tx.voucher.findMany({
    where: { customerId: CUSTOMER_ID },
    select: { id: true, voucherId: true, type: true, totalAmount: true },
    orderBy: { voucherDate: "asc" },
  });

  const billIds = bills.map((bill) => bill.id);
  const voucherIds = vouchers.map((voucher) => voucher.id);

  const allocations = await tx.billAllocation.findMany({
    where: orWhere([
      { customerId: CUSTOMER_ID },
      billIds.length ? { billId: { in: billIds } } : undefined,
      voucherIds.length ? { voucherId: { in: voucherIds } } : undefined,
    ]),
    select: {
      id: true,
      voucherId: true,
      billId: true,
      customerId: true,
      customerCreditId: true,
      allocatedAmount: true,
    },
  });

  const allocationIds = allocations.map((allocation) => allocation.id);

  const credits = await tx.customerCredit.findMany({
    where: orWhere([
      { customerId: CUSTOMER_ID },
      voucherIds.length ? { sourceVoucherId: { in: voucherIds } } : undefined,
      allocationIds.length
        ? { sourceAllocationId: { in: allocationIds } }
        : undefined,
    ]),
    select: {
      id: true,
      sourceVoucherId: true,
      sourceAllocationId: true,
      amount: true,
      consumedAmount: true,
      status: true,
    },
  });

  const creditIds = credits.map((credit) => credit.id);

  const consumptions = await tx.creditConsumption.findMany({
    where: orWhere([
      creditIds.length ? { creditId: { in: creditIds } } : undefined,
      billIds.length ? { billId: { in: billIds } } : undefined,
      voucherIds.length ? { voucherId: { in: voucherIds } } : undefined,
      allocationIds.length
        ? { billAllocationId: { in: allocationIds } }
        : undefined,
    ]),
    select: {
      id: true,
      creditId: true,
      billId: true,
      voucherId: true,
      billAllocationId: true,
      allocatedAmount: true,
    },
  });

  const noteWhere = orWhere([
    { customerId: CUSTOMER_ID },
    billIds.length ? { billId: { in: billIds } } : undefined,
  ]);

  const [voucherEntryCount, invoiceNoteCount, openingBalanceCount] =
    await Promise.all([
      voucherIds.length
        ? tx.voucherEntry.count({ where: { voucherId: { in: voucherIds } } })
        : 0,
      KEEP_INVOICE_NOTES ? 0 : tx.invoiceNote.count({ where: noteWhere }),
      tx.openingBalance.count({ where: { customerId: CUSTOMER_ID } }),
    ]);

  return {
    bills,
    vouchers,
    allocations,
    credits,
    consumptions,
    billIds,
    voucherIds,
    allocationIds,
    creditIds,
    voucherEntryCount,
    invoiceNoteCount,
    openingBalanceCount,
    noteWhere,
  };
}

function printScope(scope) {
  const openingBills = scope.bills.filter((bill) => bill.isOpeningBalance);
  const allocatedBills = scope.bills.filter(
    (bill) => Number(bill.allocatedAmount) !== 0,
  );

  console.log("=".repeat(72));
  console.log(
    APPLY
      ? "LIVE RUN - PostgreSQL rows will be deleted"
      : "DRY RUN - no changes will be written",
  );
  console.log(`Customer ID: ${CUSTOMER_ID}`);
  console.log("=".repeat(72));
  console.log(`Bills kept                         : ${scope.bills.length}`);
  console.log(`  Opening-balance bills kept        : ${openingBills.length}`);
  console.log(`OpeningBalance rows kept            : ${scope.openingBalanceCount}`);
  console.log(`Bills whose allocatedAmount -> 0    : ${allocatedBills.length}`);
  console.log(`Vouchers deleted                    : ${scope.vouchers.length}`);
  console.log(`Voucher entries deleted             : ${scope.voucherEntryCount}`);
  console.log(`Bill allocations deleted            : ${scope.allocations.length}`);
  console.log(`Customer credits deleted            : ${scope.credits.length}`);
  console.log(`Credit consumptions deleted         : ${scope.consumptions.length}`);
  console.log(
    KEEP_INVOICE_NOTES
      ? "Invoice notes deleted               : 0 (kept by flag)"
      : `Invoice notes deleted               : ${scope.invoiceNoteCount}`,
  );

  if (scope.vouchers.length > 0) {
    console.log("\nVoucher sample:");
    for (const voucher of scope.vouchers.slice(0, 10)) {
      console.log(
        `  ${voucher.voucherId} ${voucher.type} amount=${voucher.totalAmount}`,
      );
    }
    if (scope.vouchers.length > 10) {
      console.log(`  ... ${scope.vouchers.length - 10} more`);
    }
  }

  if (allocatedBills.length > 0) {
    console.log("\nAllocated bill sample to reset:");
    for (const bill of allocatedBills.slice(0, 10)) {
      console.log(
        `  ${bill.invoiceNumber} allocatedAmount=${bill.allocatedAmount}`,
      );
    }
    if (allocatedBills.length > 10) {
      console.log(`  ... ${allocatedBills.length - 10} more`);
    }
  }
  console.log("=".repeat(72));
}

async function applyCleanup() {
  return prisma.$transaction(
    async (tx) => {
      const scope = await collectScope(tx);
      printScope(scope);

      const creditIds = unique(scope.creditIds);
      const allocationIds = unique(scope.allocationIds);
      const voucherIds = unique(scope.voucherIds);
      const billIds = unique(scope.billIds);

      if (!KEEP_INVOICE_NOTES) {
        await tx.invoiceNote.deleteMany({ where: scope.noteWhere });
      }

      await tx.creditConsumption.deleteMany({
        where: { id: { in: scope.consumptions.map((row) => row.id) } },
      });

      if (creditIds.length > 0) {
        await tx.customerCredit.deleteMany({
          where: { id: { in: creditIds } },
        });
      }

      if (allocationIds.length > 0) {
        await tx.billAllocation.deleteMany({
          where: { id: { in: allocationIds } },
        });
      }

      if (voucherIds.length > 0) {
        await tx.voucherEntry.deleteMany({
          where: { voucherId: { in: voucherIds } },
        });
        await tx.voucher.deleteMany({
          where: { id: { in: voucherIds } },
        });
      }

      if (billIds.length > 0) {
        await tx.bill.updateMany({
          where: { id: { in: billIds } },
          data: { allocatedAmount: 0 },
        });
      }

      return collectScope(tx);
    },
    { maxWait: 10000, timeout: 30000 },
  );
}

async function main() {
  if (args.includes("--help") || args.includes("-h")) {
    usage();
    return;
  }

  if (APPLY && CONFIRM_VALUE !== CUSTOMER_ID) {
    usage();
    throw new Error(
      `Live run requires --confirm=${CUSTOMER_ID}. Received "${CONFIRM_VALUE}".`,
    );
  }

  if (!APPLY) {
    const scope = await collectScope(prisma);
    printScope(scope);
    console.log(
      `\nRun with --apply --confirm=${CUSTOMER_ID} to perform the cleanup.`,
    );
    return;
  }

  const after = await applyCleanup();

  console.log("\nPost-cleanup verification:");
  console.log(`  Remaining vouchers        : ${after.vouchers.length}`);
  console.log(`  Remaining allocations     : ${after.allocations.length}`);
  console.log(`  Remaining customer credits: ${after.credits.length}`);
  console.log(`  Remaining consumptions    : ${after.consumptions.length}`);
  console.log(`  Bills still present       : ${after.bills.length}`);
  console.log(`  Opening balances present  : ${after.openingBalanceCount}`);
  log("Cleanup complete.");
}

main()
  .catch((error) => {
    console.error("Script failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
