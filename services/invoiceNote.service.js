const prisma = require("../config/prisma");

const toFloat = (val) => parseFloat(parseFloat(val ?? 0).toFixed(2));

const hasInvoiceNoteDelegate = (client = prisma) =>
  typeof client?.invoiceNote?.findMany === "function" &&
  typeof client?.invoiceNote?.groupBy === "function";

const isInvoiceNoteInfraError = (error) => {
  const message = error?.message?.toLowerCase?.() ?? "";

  return (
    message.includes("invoicenote") ||
    message.includes("invoice_notes") ||
    message.includes("groupby") ||
    message.includes("does not exist") ||
    message.includes("unknown field") ||
    message.includes("unknown arg")
  );
};

const getInvoiceNoteUnavailableMessage = () =>
  "Invoice notes are not available on this environment yet. Run prisma migrate deploy and prisma generate.";

const withInvoiceNoteReadFallback = async (operation, fallbackValue) => {
  if (!hasInvoiceNoteDelegate()) return fallbackValue;

  try {
    return await operation();
  } catch (error) {
    if (isInvoiceNoteInfraError(error)) {
      return fallbackValue;
    }
    throw error;
  }
};

const getFinancialYear = (date = new Date()) => {
  const parsedDate = new Date(date);
  const month = parsedDate.getMonth();
  const year = parsedDate.getFullYear();
  const startYear = month < 3 ? year - 1 : year;
  return `${startYear}-${String(startYear + 1).slice(-2)}`;
};

const computeBillStatus = (billAmount, allocatedAmount) => {
  const bill = toFloat(billAmount);
  const allocated = toFloat(allocatedAmount);

  if (allocated === 0) return "UNPAID";
  if (allocated < bill) return "PARTIAL";
  if (allocated === bill) return "PAID";
  if (allocated > bill) return "OVERPAID";
  return "UNPAID";
};

const getBalanceEffect = (noteType, documentType = "SALE") => {
  if (documentType === "SALE") {
    return noteType === "DEBIT_NOTE" ? "INCREASE" : "DECREASE";
  }

  if (documentType === "PURCHASE") {
    return noteType === "DEBIT_NOTE" ? "DECREASE" : "INCREASE";
  }

  throw new Error(`Unsupported documentType ${documentType}`);
};

const getNoteCounterConfig = (noteType, documentType = "SALE") => {
  const config = {
    SALE: {
      DEBIT_NOTE: { type: "SDN", prefix: "SDN" },
      CREDIT_NOTE: { type: "SCN", prefix: "SCN" },
    },
    PURCHASE: {
      DEBIT_NOTE: { type: "PDN", prefix: "PDN" },
      CREDIT_NOTE: { type: "PCN", prefix: "PCN" },
    },
  };

  return config[documentType]?.[noteType] ?? null;
};

const generateNoteNumber = async (noteType, documentType, financialYear, tx) => {
  const config = getNoteCounterConfig(noteType, documentType);
  if (!config) {
    throw new Error(
      `Unsupported noteType/documentType combination: ${noteType}/${documentType}`,
    );
  }

  const shortFY = financialYear.slice(2);
  const counter = await tx.voucherCounter.upsert({
    where: {
      type_financialYear: { type: config.type, financialYear },
    },
    update: { lastValue: { increment: 1 } },
    create: { type: config.type, financialYear, lastValue: 1 },
  });

  return `${config.prefix}/${String(counter.lastValue).padStart(4, "0")}/${shortFY}`;
};

const normalizeNote = (note) => ({
  ...note,
  amount: toFloat(note.amount),
});

const resolveSaleBill = async ({ billId, invoiceNumber, customerId }, tx = prisma) => {
  if (!billId && !invoiceNumber) {
    throw new Error("billId or invoiceNumber is required");
  }

  const bill = billId
    ? await tx.bill.findUnique({ where: { id: billId } })
    : await tx.bill.findUnique({ where: { invoiceNumber } });

  if (!bill) {
    throw new Error("Invoice bill not found");
  }

  if (customerId && bill.customerId !== customerId) {
    throw new Error("Bill and customer do not match");
  }

  return bill;
};

const createInvoiceNote = async (params) => {
  const {
    noteType,
    documentType = "SALE",
    billId,
    invoiceNumber,
    customerId,
    supplierId,
    amount,
    noteDate = new Date(),
    reason,
    narration,
    status = "POSTED",
    createdBy,
  } = params;

  if (!noteType || !["DEBIT_NOTE", "CREDIT_NOTE"].includes(noteType)) {
    throw new Error("Valid noteType is required");
  }
  if (!documentType || !["SALE", "PURCHASE"].includes(documentType)) {
    throw new Error("Valid documentType is required");
  }
  if (!amount || isNaN(amount) || parseFloat(amount) <= 0) {
    throw new Error("amount must be a positive number");
  }
  if (!status || !["DRAFT", "POSTED", "CANCELLED"].includes(status)) {
    throw new Error("Valid status is required");
  }
  if (!hasInvoiceNoteDelegate()) {
    throw new Error(getInvoiceNoteUnavailableMessage());
  }

  const parsedAmount = toFloat(amount);
  const parsedNoteDate = new Date(noteDate);
  const financialYear = getFinancialYear(parsedNoteDate);
  const balanceEffect = getBalanceEffect(noteType, documentType);

  if (documentType !== "SALE") {
    throw new Error("Purchase invoice notes are not supported yet");
  }

  try {
    return await prisma.$transaction(async (tx) => {
      if (!hasInvoiceNoteDelegate(tx)) {
        throw new Error(getInvoiceNoteUnavailableMessage());
      }

      const bill = await resolveSaleBill({ billId, invoiceNumber, customerId }, tx);
      const noteNumber = await generateNoteNumber(
        noteType,
        documentType,
        financialYear,
        tx,
      );

      const note = await tx.invoiceNote.create({
        data: {
          noteNumber,
          noteType,
          documentType,
          balanceEffect,
          status,
          billId: bill.id,
          invoiceNumber: bill.invoiceNumber,
          customerId: bill.customerId,
          supplierId: supplierId ?? null,
          amount: parsedAmount,
          noteDate: parsedNoteDate,
          financialYear,
          reason: reason ?? null,
          narration: narration ?? null,
          createdBy: createdBy ?? null,
        },
      });

      return normalizeNote(note);
    });
  } catch (error) {
    if (isInvoiceNoteInfraError(error)) {
      throw new Error(getInvoiceNoteUnavailableMessage());
    }
    throw error;
  }
};

const listInvoiceNotes = async (opts = {}) => {
  const {
    customerId,
    billId,
    invoiceNumber,
    financialYear,
    status,
    documentType = "SALE",
  } = opts;

  const where = { documentType };
  if (customerId) where.customerId = customerId;
  if (billId) where.billId = billId;
  if (invoiceNumber) where.invoiceNumber = invoiceNumber;
  if (financialYear) where.financialYear = financialYear;
  if (status) where.status = status;

  const notes = await withInvoiceNoteReadFallback(
    () =>
      prisma.invoiceNote.findMany({
        where,
        orderBy: [{ noteDate: "asc" }, { createdAt: "asc" }],
      }),
    [],
  );

  return notes.map(normalizeNote);
};

const getPostedNoteSummaryByBillIds = async (billIds = [], opts = {}) => {
  if (!billIds.length) return new Map();

  const where = {
    billId: { in: billIds },
    documentType: "SALE",
    status: "POSTED",
  };

  if (opts.asOfDate) {
    where.noteDate = { lte: new Date(opts.asOfDate) };
  }

  const grouped = await withInvoiceNoteReadFallback(
    () =>
      prisma.invoiceNote.groupBy({
        by: ["billId", "noteType"],
        where,
        _sum: { amount: true },
      }),
    [],
  );

  const summaryMap = new Map();
  for (const billId of billIds) {
    summaryMap.set(billId, {
      debitNoteAmount: 0,
      creditNoteAmount: 0,
      netNoteAmount: 0,
    });
  }

  for (const row of grouped) {
    const billSummary = summaryMap.get(row.billId) ?? {
      debitNoteAmount: 0,
      creditNoteAmount: 0,
      netNoteAmount: 0,
    };
    const amount = toFloat(row._sum.amount ?? 0);

    if (row.noteType === "DEBIT_NOTE") {
      billSummary.debitNoteAmount = toFloat(billSummary.debitNoteAmount + amount);
    } else {
      billSummary.creditNoteAmount = toFloat(
        billSummary.creditNoteAmount + amount,
      );
    }

    billSummary.netNoteAmount = toFloat(
      billSummary.debitNoteAmount - billSummary.creditNoteAmount,
    );
    summaryMap.set(row.billId, billSummary);
  }

  return summaryMap;
};

const enrichBillsWithPostedNotes = async (bills = [], opts = {}) => {
  if (!bills.length) return [];

  const normalizedBills = bills.map((bill) => ({
    ...bill,
    billAmount: toFloat(bill.billAmount),
    allocatedAmount: toFloat(bill.allocatedAmount),
  }));

  const noteSummaryMap = await getPostedNoteSummaryByBillIds(
    normalizedBills.map((bill) => bill.id),
    opts,
  );

  return normalizedBills.map((bill) => {
    const noteSummary = noteSummaryMap.get(bill.id) ?? {
      debitNoteAmount: 0,
      creditNoteAmount: 0,
      netNoteAmount: 0,
    };
    const adjustedAmount = toFloat(bill.billAmount + noteSummary.netNoteAmount);
    const pendingAmount = toFloat(adjustedAmount - bill.allocatedAmount);

    return {
      ...bill,
      debitNoteAmount: toFloat(noteSummary.debitNoteAmount),
      creditNoteAmount: toFloat(noteSummary.creditNoteAmount),
      adjustedAmount,
      pendingAmount,
      status: computeBillStatus(adjustedAmount, bill.allocatedAmount),
    };
  });
};

const getPostedNoteTotalsBeforeDate = async (customerId, beforeDate) => {
  const grouped = await withInvoiceNoteReadFallback(
    () =>
      prisma.invoiceNote.groupBy({
        by: ["balanceEffect"],
        where: {
          customerId,
          documentType: "SALE",
          status: "POSTED",
          noteDate: { lt: new Date(beforeDate) },
        },
        _sum: { amount: true },
        _count: { id: true },
      }),
    [],
  );

  return {
    increaseTotal: toFloat(
      grouped
        .filter((note) => note.balanceEffect === "INCREASE")
        .reduce((sum, note) => sum + toFloat(note._sum.amount ?? 0), 0),
    ),
    decreaseTotal: toFloat(
      grouped
        .filter((note) => note.balanceEffect === "DECREASE")
        .reduce((sum, note) => sum + toFloat(note._sum.amount ?? 0), 0),
    ),
    count: grouped.reduce((sum, note) => sum + (note._count?.id ?? 0), 0),
  };
};

const getPostedNotesForCustomer = async (customerId, opts = {}) => {
  const where = {
    customerId,
    documentType: "SALE",
    status: "POSTED",
  };

  if (opts.startDate || opts.endDate) {
    where.noteDate = {};
    if (opts.startDate) where.noteDate.gte = new Date(opts.startDate);
    if (opts.endDate) where.noteDate.lte = new Date(opts.endDate);
  }

  const notes = await withInvoiceNoteReadFallback(
    () =>
      prisma.invoiceNote.findMany({
        where,
        orderBy: { noteDate: "asc" },
      }),
    [],
  );

  return notes.map(normalizeNote);
};

module.exports = {
  createInvoiceNote,
  listInvoiceNotes,
  getBalanceEffect,
  getPostedNoteSummaryByBillIds,
  getPostedNoteTotalsBeforeDate,
  getPostedNotesForCustomer,
  enrichBillsWithPostedNotes,
};
