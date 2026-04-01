#!/usr/bin/env node
/**
 * scripts/repair_allocated_amounts.js
 *
 * One-time repair: recompute Bill.allocatedAmount for every bill
 * from BillAllocation rows (the ground truth).
 *
 * Safe to run multiple times — it's purely a recalculation, no data is deleted.
 *
 * Usage:
 *   node scripts/repair_allocated_amounts.js           # dry run (default)
 *   node scripts/repair_allocated_amounts.js --apply   # actually write to DB
 */

const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

const DRY_RUN = !process.argv.includes("--apply");

const toFloat = (val) => parseFloat(parseFloat(val ?? 0).toFixed(2));

async function main() {
  console.log("=".repeat(60));
  console.log(
    DRY_RUN
      ? "DRY RUN — no changes will be written (pass --apply to commit)"
      : "LIVE RUN — changes WILL be written to the database",
  );
  console.log("=".repeat(60));

  // 1. Fetch every bill with its allocations in one query
  const bills = await prisma.bill.findMany({
    select: {
      id: true,
      invoiceNumber: true,
      billAmount: true,
      allocatedAmount: true, // current (possibly wrong) cached value
      allocations: {
        select: { allocatedAmount: true },
      },
    },
  });

  console.log(`\nFound ${bills.length} bills to check.\n`);

  let correct = 0;
  let drifted = 0;
  let fixed = 0;
  let errors = 0;

  const driftedRows = []; // for summary table

  for (const bill of bills) {
    // Ground truth: sum of all BillAllocation rows for this bill
    const trueAllocated = toFloat(
      bill.allocations.reduce((sum, a) => sum + toFloat(a.allocatedAmount), 0),
    );
    const cachedAllocated = toFloat(bill.allocatedAmount);
    const diff = Math.abs(trueAllocated - cachedAllocated);

    if (diff < 0.01) {
      correct++;
      continue; // already accurate — skip
    }

    drifted++;
    driftedRows.push({
      invoiceNumber: bill.invoiceNumber,
      cached: cachedAllocated,
      correct: trueAllocated,
      diff: (trueAllocated - cachedAllocated).toFixed(2),
    });

    if (DRY_RUN) continue; // don't write in dry-run mode

    try {
      await prisma.bill.update({
        where: { id: bill.id },
        data: { allocatedAmount: trueAllocated },
      });
      fixed++;
    } catch (err) {
      errors++;
      console.error(
        `  ✗ Failed to update bill ${bill.invoiceNumber}: ${err.message}`,
      );
    }
  }

  // ── Print drifted rows ──────────────────────────────────────────────────────
  if (driftedRows.length > 0) {
    console.log(
      `${"Invoice".padEnd(24)} ${"Cached".padStart(12)} ${"Correct".padStart(12)} ${"Diff".padStart(12)}`,
    );
    console.log("-".repeat(62));
    for (const row of driftedRows) {
      const arrow = parseFloat(row.diff) > 0 ? "▲" : "▼";
      console.log(
        `${row.invoiceNumber.padEnd(24)} ${String(row.cached).padStart(12)} ${String(row.correct).padStart(12)} ${(arrow + " " + row.diff).padStart(12)}`,
      );
    }
    console.log();
  }

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log("=".repeat(60));
  console.log(`Total bills checked : ${bills.length}`);
  console.log(`Already correct     : ${correct}`);
  console.log(`Drifted             : ${drifted}`);
  if (!DRY_RUN) {
    console.log(`Fixed               : ${fixed}`);
    console.log(`Errors              : ${errors}`);
  } else {
    console.log(
      `\nRun with --apply to fix the ${drifted} drifted bill(s) above.`,
    );
  }
  console.log("=".repeat(60));
}

main()
  .catch((err) => {
    console.error("Script failed:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
