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

  // Determine allocatedAmount from Mongo's paidAmount if available
  const allocatedFromMongo = parseFloat(invoice.paidAmount ?? 0) || 0;

  const invoiceNumber = invoice.invoiceNumber;
  const mongoId = invoice._id.toString();

  // Try to find an existing Bill by invoiceNumber first
  const existingByInvoiceNumber = await prisma.bill.findUnique({
    where: { invoiceNumber },
  });

  if (existingByInvoiceNumber) {
    return prisma.bill.update({
      where: { id: existingByInvoiceNumber.id },
      data: {
        billAmount,
        mongoInvoiceId: mongoId,
        invoiceDate,
        financialYear,
        // allocatedAmount: allocatedFromMongo,
      },
    });
  }

  // If not found by invoiceNumber, check if a Bill already exists with this mongoInvoiceId
  const existingByMongoId = await prisma.bill.findUnique({
    where: { mongoInvoiceId: mongoId },
  });

  if (existingByMongoId) {
    // Update existing record (ensure invoiceNumber is set)
    return prisma.bill.update({
      where: { id: existingByMongoId.id },
      data: {
        invoiceNumber,
        billAmount,
        invoiceDate,
        financialYear,
        // allocatedAmount: allocatedFromMongo,
      },
    });
  }

  // Neither exists — create a new Bill
  return prisma.bill.create({
    data: {
      mongoInvoiceId: mongoId,
      invoiceNumber,
      customerId: invoice.customer.toString(),
      billAmount,
      // allocatedAmount: allocatedFromMongo,
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
