/**
 * Migration Script — Full clean slate sync
 *
 * What this does:
 *   1. Seeds Chart of Accounts (LedgerAccount rows)
 *   2. Syncs ALL CustomerProduct invoices as Bills (allocatedAmount=0)
 *   3. Opening balances are entered manually via the API after migration
 *
 * Safe to re-run — uses upsert / skipDuplicates throughout.
 * Bill status and pendingAmount are computed on read — NOT stored.
 *
 * Run: node scripts/migrate.js
 */

require("dotenv").config();
const mongoose = require("mongoose");
const CustomerProduct = require("../models/cust-prod.models");
const prisma = require("../config/prisma");

const MONGODB_URI = process.env.MONGODB_URI;
const BATCH_SIZE = 100;

const getFinancialYear = (date = new Date()) => {
  const month = date.getMonth();
  const year = date.getFullYear();
  const startYear = month < 3 ? year - 1 : year;
  return `${startYear}-${String(startYear + 1).slice(-2)}`;
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Phase 1: Chart of Accounts ─────────────────────────────────────────────────

const seedChartOfAccounts = async () => {
  console.log("\nPhase 1 — Chart of Accounts");
  console.log("─────────────────────────────");

  const accounts = [
    {
      code: "AR-001",
      name: "Accounts Receivable",
      type: "ACCOUNTS_RECEIVABLE",
      description: "Customer control account",
    },
    {
      code: "SALES-001",
      name: "Sales Revenue",
      type: "SALES",
      description: "Primary sales account",
    },
    {
      code: "BANK-001",
      name: "Primary Bank Account", // ← update to your actual bank name
      type: "BANK_CASH",
      description: "Main operating bank account",
    },
    {
      code: "CASH-001",
      name: "Cash in Hand",
      type: "BANK_CASH",
      description: "Physical cash account",
    },
  ];

  for (const account of accounts) {
    await prisma.ledgerAccount.upsert({
      where: { code: account.code },
      update: { name: account.name, description: account.description },
      create: { ...account, isActive: true },
    });
    console.log(`  ✓ ${account.code}  ${account.name}`);
  }
};

// ── Phase 2: Sync all invoices as Bills ────────────────────────────────────────

const syncInvoices = async () => {
  console.log("\nPhase 2 — Invoice → Bill Sync");
  console.log("─────────────────────────────");

  const invoices = await CustomerProduct.find({})
    .select("_id invoiceNumber customer grandTotal createdAt")
    .lean();

  console.log(`  Found ${invoices.length} invoices in MongoDB`);

  if (invoices.length === 0) {
    console.log("  Nothing to sync.");
    return;
  }

  const existing = await prisma.bill.findMany({
    where: { isOpeningBalance: false },
    select: { invoiceNumber: true },
  });
  const existingSet = new Set(existing.map((b) => b.invoiceNumber));
  console.log(`  Already synced: ${existingSet.size}`);

  let synced = 0;
  let skipped = 0;
  const errors = [];

  for (let i = 0; i < invoices.length; i += BATCH_SIZE) {
    const batch = invoices.slice(i, i + BATCH_SIZE);
    const toCreate = [];

    for (const invoice of batch) {
      if (existingSet.has(invoice.invoiceNumber)) {
        skipped++;
        continue;
      }

      if (!invoice.invoiceNumber || !invoice.customer || !invoice.grandTotal) {
        errors.push({
          id: invoice._id?.toString(),
          reason:
            "Missing required fields (invoiceNumber, customer, or grandTotal)",
        });
        continue;
      }

      const billAmount = parseFloat(invoice.grandTotal);
      if (isNaN(billAmount) || billAmount <= 0) {
        errors.push({
          invoiceNumber: invoice.invoiceNumber,
          reason: `Invalid grandTotal: ${invoice.grandTotal}`,
        });
        continue;
      }

      const invoiceDate = invoice.createdAt ?? new Date();

      // NOTE: no status, no pendingAmount — both are computed on read
      toCreate.push({
        mongoInvoiceId: invoice._id.toString(),
        invoiceNumber: invoice.invoiceNumber,
        customerId: invoice.customer.toString(),
        billAmount,
        allocatedAmount: 0,
        isOpeningBalance: false,
        invoiceDate,
        financialYear: getFinancialYear(new Date(invoiceDate)),
      });
    }

    if (toCreate.length > 0) {
      await prisma.bill.createMany({
        data: toCreate,
        skipDuplicates: true,
      });
      synced += toCreate.length;
    }

    const processed = Math.min(i + BATCH_SIZE, invoices.length);
    process.stdout.write(`\r  Progress: ${processed}/${invoices.length}`);

    if (i + BATCH_SIZE < invoices.length) await sleep(50);
  }

  console.log(`\n  ✓ Synced : ${synced}`);
  console.log(`  ↷ Skipped: ${skipped} (already existed)`);

  if (errors.length > 0) {
    console.error(`  ✗ Errors : ${errors.length}`);
    errors.forEach((e) =>
      console.error(`    - ${e.invoiceNumber ?? e.id}: ${e.reason}`),
    );
  }
};

// ── Phase 3: Summary ───────────────────────────────────────────────────────────

const printSummary = async () => {
  const [totalBills, openingBills, accounts] = await Promise.all([
    prisma.bill.count(),
    prisma.bill.count({ where: { isOpeningBalance: true } }),
    prisma.ledgerAccount.count(),
  ]);

  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  Migration Complete ✓");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`  Ledger Accounts   : ${accounts}`);
  console.log(`  Total Bills       : ${totalBills}`);
  console.log(`    Regular invoices: ${totalBills - openingBills}`);
  console.log(`    Opening balances: ${openingBills}`);
  console.log(`  All bills synced with allocatedAmount=0`);
  console.log(`  (status + pendingAmount computed on read, not stored)`);
  console.log("");
  console.log("  Next steps:");
  console.log(
    "  1. Enter opening balances via POST /api/accounting/opening-balances",
  );
  console.log(
    "  2. Start recording payments via POST /api/accounting/receipts",
  );
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
};

// ── Main ───────────────────────────────────────────────────────────────────────

const migrate = async () => {
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  Accounting Migration — Clean Slate");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  await mongoose.connect(MONGODB_URI);
  console.log("✓ MongoDB connected");

  await prisma.$connect();
  console.log("✓ PostgreSQL connected");

  await seedChartOfAccounts();
  await syncInvoices();
  await printSummary();
};

migrate()
  .catch((err) => {
    console.error("\n✗ Migration failed:", err.message);
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await mongoose.disconnect();
    await prisma.$disconnect();
  });
