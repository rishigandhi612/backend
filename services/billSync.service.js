/**
 * Bill Sync Service
 *
 * Syncs MongoDB invoices into PostgreSQL as Bill records.
 * Called after CustomerProduct.create() in createCustomerProducts controller.
 *
 * Schema rules (no stored status or pendingAmount):
 *   - billAmount      → stored (original invoice total, never changes)
 *   - allocatedAmount → stored, starts at 0, updated on payment
 *   - pendingAmount   → NOT stored, computed as billAmount - allocatedAmount
 *   - status          → NOT stored, computed from allocatedAmount vs billAmount
 */

const prisma = require("../config/prisma");

const getFinancialYear = (date = new Date()) => {
  const month = date.getMonth();
  const year = date.getFullYear();
  const startYear = month < 3 ? year - 1 : year;
  return `${startYear}-${String(startYear + 1).slice(-2)}`;
};

/**
 * Sync a single MongoDB invoice into PostgreSQL as a Bill.
 * Called immediately after CustomerProduct.create().
 * Idempotent — safe to call multiple times for the same invoice.
 *
 * @param {Object} invoice - Mongoose document from CustomerProduct.create()
 * @returns {Promise<Object>} Created or updated Bill record
 */
const syncInvoiceToBill = async (invoice) => {
  const billAmount = parseFloat(invoice.grandTotal);
  const invoiceDate = invoice.createdAt ?? new Date();
  const financialYear = getFinancialYear(invoiceDate);

  return prisma.bill.upsert({
    where: { invoiceNumber: invoice.invoiceNumber },
    update: {
      // Keep billAmount in sync if invoice was amended before sync completed
      billAmount,
      mongoInvoiceId: invoice._id.toString(),
      invoiceDate,
      financialYear,
    },
    create: {
      mongoInvoiceId: invoice._id.toString(),
      invoiceNumber: invoice.invoiceNumber,
      customerId: invoice.customer.toString(),
      billAmount,
      allocatedAmount: 0, // no payments yet
      isOpeningBalance: false,
      invoiceDate,
      financialYear,
    },
  });
};

/**
 * Recalculate a Bill's allocatedAmount after a payment allocation changes.
 * Only updates allocatedAmount — status and pendingAmount are computed on read.
 * Must be called inside a Prisma transaction (tx).
 *
 * @param {string} billId - PostgreSQL Bill UUID
 * @param {Object} tx     - Prisma transaction client
 * @returns {Promise<Object>} Updated Bill record
 */
const recalculateBillAllocated = async (billId, tx) => {
  const agg = await tx.billAllocation.aggregate({
    where: { billId },
    _sum: { allocatedAmount: true },
  });

  const allocatedAmount = parseFloat(
    parseFloat(agg._sum.allocatedAmount ?? 0).toFixed(2),
  );

  return tx.bill.update({
    where: { id: billId },
    data: { allocatedAmount },
  });
};

module.exports = {
  syncInvoiceToBill,
  recalculateBillAllocated,
  getFinancialYear,
};
