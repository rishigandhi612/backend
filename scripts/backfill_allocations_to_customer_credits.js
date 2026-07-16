#!/usr/bin/env node
/*
  Backfill script: convert legacy on-account allocations and negative bill allocations
  into canonical CustomerCredit rows.

  Usage:
    node scripts/backfill_allocations_to_customer_credits.js               # dry-run (no changes)
    node scripts/backfill_allocations_to_customer_credits.js --apply --snapshot=./pre_migration_snapshot.json --verify
                                                                            # recommended: snapshot + apply + reconcile
    node scripts/backfill_allocations_to_customer_credits.js --apply       # apply changes (no Section 3.4 exact check)
    node scripts/backfill_allocations_to_customer_credits.js --verify-only --snapshot=./pre_migration_snapshot.json
                                                                            # only run reconciliation report
    node scripts/backfill_allocations_to_customer_credits.js --help        # show flags

  Flags:
    --apply           Apply changes (default is dry-run)
    --batch=N         Batch size for processing (default 200)
    --legacy-only     Only convert positive legacy on-account allocations
                       (billId = null && allocatedAmount > 0 && customerCreditId = null)
    --negative-only   Only convert negative allocations that reference a bill (allocatedAmount < 0 && billId != null)
    --verify          After applying, run a reconciliation pass and print any discrepancies
    --verify-only     Skip conversion entirely; just run the reconciliation pass against current data
    --snapshot=PATH   Before converting, write per-customer on-account totals (pre-migration) to
                       PATH as JSON. Required if you want the exact Section 3.4 comparison, since
                       conversion mutates the rows being compared (sign is dropped, billId is
                       nulled). Pass the same PATH to --verify to diff against it.
    --max-iterations=N  Safety cap on while-loop iterations per phase (default 10000). Prevents
                         an infinite loop if a row fails to leave the query filter after processing.

  Notes on sign convention:
    CustomerCredit.amount is stored as a POSITIVE magnitude representing the credit available
    to the customer, regardless of whether the source BillAllocation.allocatedAmount was negative
    (as it is for the negative-bill-allocation / overpaid-bill case). This keeps
    amount - consumedAmount meaningful everywhere a CustomerCredit is aggregated. If you need the
    original signed value preserved on CustomerCredit.amount specifically, set CARRY_SOURCE_SIGN=true
    below (or pass --carry-sign). This flag never affects BillAllocation.allocatedAmount itself --
    that field is always normalized to a positive magnitude on detachment, regardless of this flag,
    because live queries (getCustomerOnAccountBalance, getOnAccountAllocations) read it directly for
    billId:null rows and assume that convention.

  Schema alignment (per "On-Account Credit Handling" proposal, Section 3.1/3.4):
    CustomerCredit traces to sourceVoucherId (the receipt) and sourceAllocationId (the on-account
    allocation row) only -- it does NOT store a bill reference. The negative-on-bill pattern
    (isOverpaid forcing a negative allocationAmount onto a real bill) is the legacy workaround this
    proposal retires; per Section 5.3, those rows are detached from their bill and converted the
    same way as true billId:null on-account rows. Any later linkage between a credit and the bill(s)
    it eventually funds happens through CreditConsumption (Section 3.2), which is created when credit
    is *applied* via applyCreditToBill -- that's separate runtime logic, not part of this backfill.
    Idempotency: rows that already have customerCreditId set are skipped by the WHERE filters below,
    per Section 7 step 2 ("safe to re-run -- skip rows that already have a CustomerCredit via
    sourceAllocationId").
*/

const fs = require("fs");
const prisma = require("../config/prisma");

const argv = process.argv.slice(2);
const DRY_RUN = !argv.includes("--apply");
const VERIFY = argv.includes("--verify");
const VERIFY_ONLY = argv.includes("--verify-only");
const LEGACY_ONLY = argv.includes("--legacy-only");
const NEGATIVE_ONLY = argv.includes("--negative-only");
const CARRY_SOURCE_SIGN = argv.includes("--carry-sign");

const SNAPSHOT_PATH = (() => {
  const s = argv.find((a) => a.startsWith("--snapshot="));
  return s ? s.split("=").slice(1).join("=") : null;
})();

const BATCH = (() => {
  const b = argv.find((a) => a.startsWith("--batch="));
  if (!b) return 200;
  const n = parseInt(b.split("=")[1], 10);
  return isNaN(n) ? 200 : n;
})();

const MAX_ITERATIONS = (() => {
  const m = argv.find((a) => a.startsWith("--max-iterations="));
  if (!m) return 10000;
  const n = parseInt(m.split("=")[1], 10);
  return isNaN(n) ? 10000 : n;
})();

const log = (...args) => console.log(new Date().toISOString(), ...args);
const round2 = (n) => parseFloat((n ?? 0).toFixed(2));

/**
 * Snapshot per-customer on-account totals BEFORE conversion, so the literal Section 3.4
 * check ("new CustomerCredit sums == old BillAllocation sums") can be done after the fact.
 * Sums the absolute value of allocatedAmount across both convertible row shapes, since that's
 * the magnitude each conversion path is defined to preserve into CustomerCredit.amount.
 */
async function takeSnapshot(path) {
  log(`Taking pre-migration snapshot -> ${path}`);
  const rows = await prisma.billAllocation.findMany({
    where: {
      OR: [
        { billId: null, allocatedAmount: { gt: 0 }, customerCreditId: null },
        {
          billId: { not: null },
          allocatedAmount: { lt: 0 },
          customerCreditId: null,
        },
      ],
    },
    select: { customerId: true, allocatedAmount: true },
  });

  const totals = {};
  for (const r of rows) {
    totals[r.customerId] = round2(
      (totals[r.customerId] ?? 0) + Math.abs(round2(r.allocatedAmount)),
    );
  }

  fs.writeFileSync(
    path,
    JSON.stringify({ takenAt: new Date().toISOString(), totals }, null, 2),
  );
  log(
    `Snapshot written: ${Object.keys(totals).length} customer(s), ${rows.length} row(s)`,
  );
  return totals;
}

/**
 * Compare current converted-credit totals against a pre-migration snapshot. This is the
 * literal Section 3.4 check. Returns a list of per-customer mismatches.
 */
async function diffAgainstSnapshot(path, currentTotalsByCustomer) {
  if (!fs.existsSync(path)) {
    log(
      `WARNING: snapshot file not found at ${path}; skipping Section 3.4 exact comparison`,
    );
    return [{ type: "snapshot_missing", path }];
  }
  const { totals: before } = JSON.parse(fs.readFileSync(path, "utf8"));
  const mismatches = [];
  const customerIds = new Set([
    ...Object.keys(before),
    ...currentTotalsByCustomer.keys(),
  ]);
  for (const customerId of customerIds) {
    const expected = round2(before[customerId] ?? 0);
    const actual = round2(currentTotalsByCustomer.get(customerId) ?? 0);
    if (expected !== actual) {
      mismatches.push({
        type: "section_3_4_mismatch",
        customerId,
        expected,
        actual,
      });
    }
  }
  return mismatches;
}

/**
 * Recalculate a voucher's onAccountAmount from the sum of its CustomerCredits.
 * Shared by both conversion paths so the formula can't drift between them.
 * Matches recalculateVoucherOnAccount() in Section 4.2 of the proposal.
 */
async function recalcVoucherOnAccount(tx, voucherId) {
  const agg = await tx.customerCredit.aggregate({
    where: { sourceVoucherId: voucherId },
    _sum: { amount: true, consumedAmount: true },
  });
  const onAccountAmount = round2(
    round2(agg._sum.amount) - round2(agg._sum.consumedAmount),
  );
  await tx.voucher.update({
    where: { id: voucherId },
    data: { onAccountAmount },
  });
  return onAccountAmount;
}

async function convertLegacyOnAccount(batchSize = BATCH) {
  log(
    "Scanning positive legacy on-account allocations (billId=null & allocatedAmount>0 & customerCreditId=null)",
  );
  let processed = 0;
  let failed = 0;
  const failures = [];
  let iterations = 0;

  while (true) {
    iterations += 1;
    if (iterations > MAX_ITERATIONS) {
      log(
        `WARNING: hit max-iterations cap (${MAX_ITERATIONS}) in convertLegacyOnAccount; stopping early`,
      );
      break;
    }

    const rows = await prisma.billAllocation.findMany({
      where: {
        billId: null,
        allocatedAmount: { gt: 0 },
        customerCreditId: null,
      },
      orderBy: { createdAt: "asc" },
      take: batchSize,
    });
    if (!rows.length) break;

    for (const row of rows) {
      if (DRY_RUN) {
        processed += 1;
        log(
          `[dry-run] legacy allocation: id=${row.id} voucher=${row.voucherId} amt=${row.allocatedAmount}`,
        );
        continue;
      }

      try {
        await prisma.$transaction(async (tx) => {
          const credit = await tx.customerCredit.create({
            data: {
              customerId: row.customerId,
              sourceVoucherId: row.voucherId,
              sourceAllocationId: row.id,
              amount: row.allocatedAmount,
              consumedAmount: 0,
              status: "OPEN",
            },
          });

          await tx.billAllocation.update({
            where: { id: row.id },
            data: { customerCreditId: credit.id },
          });

          await recalcVoucherOnAccount(tx, row.voucherId);
        });
        processed += 1;
      } catch (err) {
        failed += 1;
        failures.push({
          id: row.id,
          voucherId: row.voucherId,
          error: err.message,
        });
        log(`ERROR converting legacy allocation id=${row.id}: ${err.message}`);
      }
    }

    if (DRY_RUN) break; // only show first batch in dry-run
  }

  return { processed, failed, failures };
}

async function convertNegativeBillAllocations(batchSize = BATCH) {
  log(
    "Scanning negative bill allocations (billId != null && allocatedAmount < 0 && customerCreditId = null)",
  );
  let processed = 0;
  let failed = 0;
  const failures = [];
  let iterations = 0;

  while (true) {
    iterations += 1;
    if (iterations > MAX_ITERATIONS) {
      log(
        `WARNING: hit max-iterations cap (${MAX_ITERATIONS}) in convertNegativeBillAllocations; stopping early`,
      );
      break;
    }

    const rows = await prisma.billAllocation.findMany({
      where: {
        billId: { not: null },
        allocatedAmount: { lt: 0 },
        customerCreditId: null,
      },
      orderBy: { createdAt: "asc" },
      take: batchSize,
    });
    if (!rows.length) break;

    for (const row of rows) {
      if (DRY_RUN) {
        processed += 1;
        log(
          `[dry-run] negative allocation: id=${row.id} bill=${row.billId} voucher=${row.voucherId} amt=${row.allocatedAmount}`,
        );
        continue;
      }

      try {
        await prisma.$transaction(async (tx) => {
          // CARRY_SOURCE_SIGN only affects CustomerCredit.amount (see header note) — it must
          // NEVER affect the BillAllocation row's own allocatedAmount below. That field has to
          // stay a positive magnitude regardless, to match every other billId:null row in the
          // system; flipping it negative would reintroduce the getCustomerOnAccountBalance /
          // getOnAccountAllocations corruption this script exists to avoid.
          const creditAmount = CARRY_SOURCE_SIGN
            ? row.allocatedAmount
            : Math.abs(row.allocatedAmount);
          const detachedAllocatedAmount = Math.abs(row.allocatedAmount);

          const credit = await tx.customerCredit.create({
            data: {
              customerId: row.customerId,
              sourceVoucherId: row.voucherId,
              sourceAllocationId: row.id,
              amount: creditAmount,
              consumedAmount: 0,
              status: "OPEN",
            },
          });

          // Detach the allocation from the bill and link to the credit (move to on-account).
          // IMPORTANT: allocatedAmount on the row itself must also flip to positive here.
          // Every other billId:null row in the system (see createOnAccountAllocationWithCredit
          // in voucher.service.js) stores a positive allocatedAmount; getCustomerOnAccountBalance
          // and getOnAccountAllocations both read this field directly for billId:null rows, with
          // no involvement of CustomerCredit. Leaving the original negative value here would
          // silently corrupt those live aggregates after this row is detached from its bill.
          await tx.billAllocation.update({
            where: { id: row.id },
            data: {
              customerCreditId: credit.id,
              billId: null,
              allocatedAmount: detachedAllocatedAmount,
              narration:
                (row.narration ?? "") + " | Converted to CustomerCredit",
            },
          });

          // Recalc the original bill's allocatedAmount now that this row has been detached.
          const agg = await tx.billAllocation.aggregate({
            where: { billId: row.billId },
            _sum: { allocatedAmount: true },
          });
          const allocatedAmount = round2(agg._sum.allocatedAmount);
          await tx.bill.update({
            where: { id: row.billId },
            data: { allocatedAmount },
          });

          await recalcVoucherOnAccount(tx, row.voucherId);
        });
        processed += 1;
      } catch (err) {
        failed += 1;
        failures.push({
          id: row.id,
          billId: row.billId,
          voucherId: row.voucherId,
          error: err.message,
        });
        log(
          `ERROR converting negative allocation id=${row.id}: ${err.message}`,
        );
      }
    }

    if (DRY_RUN) break; // only show first batch in dry-run
  }

  return { processed, failed, failures };
}

/**
 * Reconciliation pass. Run after --apply (with --verify) or standalone (--verify-only)
 * to catch drift between CustomerCredit rows, their source allocations, and voucher totals.
 *
 * Checks:
 *  1. [Primary, per Section 3.4 -- requires snapshotPath] Per customer: sum(CustomerCredit.amount)
 *     for credits sourced from a converted allocation must equal the pre-migration on-account total
 *     captured by --snapshot. Without a snapshot this check is skipped (logged, not silently dropped),
 *     since the comparison requires data captured before conversion mutated the source rows.
 *     A mismatch means the backfill has a bug and must be caught before sign-off, per the proposal.
 *  2. Every BillAllocation with customerCreditId set has a CustomerCredit that still exists.
 *  3. Every CustomerCredit's sourceAllocationId points back to an allocation that points back to it.
 *  4. For every voucher with at least one CustomerCredit, onAccountAmount matches
 *     sum(amount) - sum(consumedAmount) for that voucher's credits (Section 4.2 formula).
 *  5. No remaining legacy or negative allocations are left unconverted (informational only,
 *     since --legacy-only/--negative-only runs can leave one side untouched on purpose).
 */
async function verify(snapshotPath = null) {
  log("Running reconciliation pass...");
  const issues = [];

  // Check 1 (primary, Section 3.4): per-customer totals must match.
  // Always compare magnitudes: the snapshot stores Math.abs(allocatedAmount), and
  // CustomerCredit.amount is normally already positive -- but under --carry-sign it can be
  // negative for the overpayment case, so Math.abs() here keeps this check valid either way.
  const convertedCredits = await prisma.customerCredit.findMany({
    where: { sourceAllocationId: { not: null } },
    select: { customerId: true, amount: true },
  });
  const creditTotalsByCustomer = new Map();
  for (const c of convertedCredits) {
    creditTotalsByCustomer.set(
      c.customerId,
      round2(
        (creditTotalsByCustomer.get(c.customerId) ?? 0) +
          Math.abs(round2(c.amount)),
      ),
    );
  }

  // Without a snapshot, the best available check is: does a CustomerCredit exist for every
  // allocation that should have one, with the right magnitude? Checks 2-3 below (missing/dangling
  // links) cover existence; per-customer totals are logged here for spot-checking regardless.
  // With --snapshot, the block below does the literal Section 3.4 comparison.
  for (const [customerId, total] of creditTotalsByCustomer) {
    log(`  customer=${customerId} converted-credit-total=${total}`);
  }

  if (snapshotPath) {
    const mismatches = await diffAgainstSnapshot(
      snapshotPath,
      creditTotalsByCustomer,
    );
    issues.push(...mismatches);
    if (!mismatches.length)
      log("  Section 3.4 check: all per-customer totals match snapshot.");
  } else {
    log(
      "  No --snapshot path provided; skipping the literal Section 3.4 comparison (see header notes).",
    );
  }

  const orphanedAllocations = await prisma.billAllocation.findMany({
    where: { customerCreditId: { not: null } },
    select: { id: true, customerCreditId: true },
  });
  const creditIds = orphanedAllocations.map((a) => a.customerCreditId);
  const existingCredits = await prisma.customerCredit.findMany({
    where: { id: { in: creditIds } },
    select: { id: true },
  });
  const existingCreditIdSet = new Set(existingCredits.map((c) => c.id));
  for (const a of orphanedAllocations) {
    if (!existingCreditIdSet.has(a.customerCreditId)) {
      issues.push({
        type: "missing_credit",
        allocationId: a.id,
        customerCreditId: a.customerCreditId,
      });
    }
  }

  const credits = await prisma.customerCredit.findMany({
    where: { sourceAllocationId: { not: null } },
    select: { id: true, sourceAllocationId: true, sourceVoucherId: true },
  });
  const sourceAllocations = await prisma.billAllocation.findMany({
    where: { id: { in: credits.map((c) => c.sourceAllocationId) } },
    select: { id: true, customerCreditId: true },
  });
  const allocById = new Map(sourceAllocations.map((a) => [a.id, a]));
  for (const c of credits) {
    const alloc = allocById.get(c.sourceAllocationId);
    if (!alloc) {
      issues.push({
        type: "dangling_source_allocation",
        creditId: c.id,
        sourceAllocationId: c.sourceAllocationId,
      });
    } else if (alloc.customerCreditId !== c.id) {
      issues.push({
        type: "allocation_credit_mismatch",
        creditId: c.id,
        allocationId: alloc.id,
        allocationPointsTo: alloc.customerCreditId,
      });
    }
  }

  const voucherIds = [
    ...new Set(credits.map((c) => c.sourceVoucherId).filter(Boolean)),
  ];
  for (const voucherId of voucherIds) {
    const agg = await prisma.customerCredit.aggregate({
      where: { sourceVoucherId: voucherId },
      _sum: { amount: true, consumedAmount: true },
    });
    const expected = round2(
      round2(agg._sum.amount) - round2(agg._sum.consumedAmount),
    );
    const voucher = await prisma.voucher.findUnique({
      where: { id: voucherId },
      select: { onAccountAmount: true },
    });
    if (!voucher) {
      issues.push({ type: "missing_voucher", voucherId });
      continue;
    }
    if (round2(voucher.onAccountAmount) !== expected) {
      issues.push({
        type: "voucher_onaccount_mismatch",
        voucherId,
        expected,
        actual: round2(voucher.onAccountAmount),
      });
    }
  }

  const remainingLegacy = await prisma.billAllocation.count({
    where: {
      billId: null,
      allocatedAmount: { gt: 0 },
      customerCreditId: null,
    },
  });
  const remainingNegative = await prisma.billAllocation.count({
    where: {
      billId: { not: null },
      allocatedAmount: { lt: 0 },
      customerCreditId: null,
    },
  });

  log(`Reconciliation summary: ${issues.length} issue(s) found`);
  if (issues.length) {
    for (const issue of issues) log("  ISSUE:", JSON.stringify(issue));
  }
  log(`Remaining unconverted legacy allocations: ${remainingLegacy}`);
  log(`Remaining unconverted negative allocations: ${remainingNegative}`);

  return { issues, remainingLegacy, remainingNegative, creditTotalsByCustomer };
}

async function main() {
  if (argv.includes("--help")) {
    console.log(
      "Usage: node scripts/backfill_allocations_to_customer_credits.js " +
        "[--apply] [--batch=N] [--legacy-only] [--negative-only] [--verify] [--verify-only] " +
        "[--snapshot=PATH] [--max-iterations=N] [--carry-sign]",
    );
    process.exit(0);
  }

  log(
    `dryRun=${DRY_RUN} batch=${BATCH} legacyOnly=${LEGACY_ONLY} negativeOnly=${NEGATIVE_ONLY} ` +
      `verify=${VERIFY} verifyOnly=${VERIFY_ONLY} carrySourceSign=${CARRY_SOURCE_SIGN} snapshot=${SNAPSHOT_PATH ?? "none"}`,
  );

  try {
    if (VERIFY_ONLY) {
      const result = await verify(SNAPSHOT_PATH);
      process.exitCode = result.issues.length ? 1 : 0;
      return;
    }

    if (SNAPSHOT_PATH && !DRY_RUN) {
      await takeSnapshot(SNAPSHOT_PATH);
    } else if (SNAPSHOT_PATH && DRY_RUN) {
      log(
        "Note: --snapshot has no effect in dry-run mode (no rows are converted); re-run with --apply.",
      );
    }

    let legacyResult = { processed: 0, failed: 0, failures: [] };
    let negativeResult = { processed: 0, failed: 0, failures: [] };

    if (!NEGATIVE_ONLY) {
      legacyResult = await convertLegacyOnAccount(BATCH);
      log(
        `legacy allocations processed=${legacyResult.processed} failed=${legacyResult.failed}`,
      );
    }

    if (!LEGACY_ONLY) {
      negativeResult = await convertNegativeBillAllocations(BATCH);
      log(
        `negative allocations processed=${negativeResult.processed} failed=${negativeResult.failed}`,
      );
    }

    log("Done. Summary:", {
      legacy: legacyResult,
      negative: negativeResult,
      applied: !DRY_RUN,
    });

    if (legacyResult.failed || negativeResult.failed) {
      process.exitCode = 2;
    }

    if (VERIFY && !DRY_RUN) {
      const result = await verify(SNAPSHOT_PATH);
      if (result.issues.length) process.exitCode = 2;
    }
  } catch (err) {
    console.error(err);
    process.exitCode = 2;
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main();
}
