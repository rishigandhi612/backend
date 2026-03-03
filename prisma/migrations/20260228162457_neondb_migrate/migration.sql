-- CreateEnum
CREATE TYPE "LedgerAccountType" AS ENUM ('ACCOUNTS_RECEIVABLE', 'BANK_CASH', 'SALES');

-- CreateEnum
CREATE TYPE "VoucherType" AS ENUM ('RECEIPT', 'PAYMENT', 'CONTRA', 'JOURNAL');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('NEFT_RTGS', 'CHEQUE', 'CASH', 'UPI');

-- CreateEnum
CREATE TYPE "EntryType" AS ENUM ('DEBIT', 'CREDIT');

-- CreateTable
CREATE TABLE "Inventory" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "width" DOUBLE PRECISION,
    "netWeight" DOUBLE PRECISION NOT NULL,
    "grossWeight" DOUBLE PRECISION,
    "rollId" TEXT NOT NULL,
    "micron" DOUBLE PRECISION,
    "mtr" DOUBLE PRECISION,
    "type" TEXT NOT NULL DEFAULT 'film',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'available',
    "invoiceNumber" TEXT,
    "soldAt" TIMESTAMP(3),

    CONSTRAINT "Inventory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_accounts" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "LedgerAccountType" NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ledger_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bills" (
    "id" TEXT NOT NULL,
    "mongoInvoiceId" TEXT,
    "invoiceNumber" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "billAmount" DECIMAL(12,2) NOT NULL,
    "allocatedAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "isOpeningBalance" BOOLEAN NOT NULL DEFAULT false,
    "invoiceDate" TIMESTAMP(3) NOT NULL,
    "dueDate" TIMESTAMP(3),
    "financialYear" TEXT NOT NULL,
    "openingBalanceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bills_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "opening_balances" (
    "id" TEXT NOT NULL,
    "referenceNo" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "customerName" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "narration" TEXT,
    "asOfDate" TIMESTAMP(3) NOT NULL,
    "financialYear" TEXT NOT NULL,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "opening_balances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vouchers" (
    "id" TEXT NOT NULL,
    "voucherId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "type" "VoucherType" NOT NULL,
    "totalAmount" DECIMAL(12,2) NOT NULL,
    "onAccountAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "paymentMethod" "PaymentMethod" NOT NULL,
    "bankId" TEXT,
    "bankName" TEXT,
    "chequeNumber" TEXT,
    "chequeDate" TIMESTAMP(3),
    "utrNumber" TEXT,
    "upiRef" TEXT,
    "reference" TEXT,
    "narration" TEXT,
    "voucherDate" TIMESTAMP(3) NOT NULL,
    "financialYear" TEXT NOT NULL,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vouchers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "voucher_entries" (
    "id" TEXT NOT NULL,
    "voucherId" TEXT NOT NULL,
    "ledgerAccountId" TEXT NOT NULL,
    "entryType" "EntryType" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "narration" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "voucher_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bill_allocations" (
    "id" TEXT NOT NULL,
    "voucherId" TEXT NOT NULL,
    "billId" TEXT,
    "customerId" TEXT NOT NULL,
    "allocatedAmount" DECIMAL(12,2) NOT NULL,
    "narration" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bill_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "voucher_counters" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "financialYear" TEXT NOT NULL,
    "lastValue" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "voucher_counters_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Inventory_rollId_key" ON "Inventory"("rollId");

-- CreateIndex
CREATE INDEX "Inventory_productId_idx" ON "Inventory"("productId");

-- CreateIndex
CREATE INDEX "Inventory_rollId_idx" ON "Inventory"("rollId");

-- CreateIndex
CREATE INDEX "Inventory_status_idx" ON "Inventory"("status");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_accounts_code_key" ON "ledger_accounts"("code");

-- CreateIndex
CREATE INDEX "ledger_accounts_type_idx" ON "ledger_accounts"("type");

-- CreateIndex
CREATE INDEX "ledger_accounts_isActive_idx" ON "ledger_accounts"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "bills_mongoInvoiceId_key" ON "bills"("mongoInvoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "bills_invoiceNumber_key" ON "bills"("invoiceNumber");

-- CreateIndex
CREATE UNIQUE INDEX "bills_openingBalanceId_key" ON "bills"("openingBalanceId");

-- CreateIndex
CREATE INDEX "bills_customerId_idx" ON "bills"("customerId");

-- CreateIndex
CREATE INDEX "bills_financialYear_idx" ON "bills"("financialYear");

-- CreateIndex
CREATE INDEX "bills_customerId_financialYear_idx" ON "bills"("customerId", "financialYear");

-- CreateIndex
CREATE INDEX "bills_isOpeningBalance_idx" ON "bills"("isOpeningBalance");

-- CreateIndex
CREATE UNIQUE INDEX "opening_balances_referenceNo_key" ON "opening_balances"("referenceNo");

-- CreateIndex
CREATE INDEX "opening_balances_customerId_idx" ON "opening_balances"("customerId");

-- CreateIndex
CREATE INDEX "opening_balances_financialYear_idx" ON "opening_balances"("financialYear");

-- CreateIndex
CREATE UNIQUE INDEX "vouchers_voucherId_key" ON "vouchers"("voucherId");

-- CreateIndex
CREATE INDEX "vouchers_customerId_idx" ON "vouchers"("customerId");

-- CreateIndex
CREATE INDEX "vouchers_type_idx" ON "vouchers"("type");

-- CreateIndex
CREATE INDEX "vouchers_bankId_idx" ON "vouchers"("bankId");

-- CreateIndex
CREATE INDEX "vouchers_voucherDate_idx" ON "vouchers"("voucherDate");

-- CreateIndex
CREATE INDEX "vouchers_customerId_voucherDate_idx" ON "vouchers"("customerId", "voucherDate");

-- CreateIndex
CREATE INDEX "vouchers_financialYear_idx" ON "vouchers"("financialYear");

-- CreateIndex
CREATE INDEX "vouchers_customerId_onAccountAmount_idx" ON "vouchers"("customerId", "onAccountAmount");

-- CreateIndex
CREATE INDEX "voucher_entries_voucherId_idx" ON "voucher_entries"("voucherId");

-- CreateIndex
CREATE INDEX "voucher_entries_ledgerAccountId_idx" ON "voucher_entries"("ledgerAccountId");

-- CreateIndex
CREATE INDEX "bill_allocations_voucherId_idx" ON "bill_allocations"("voucherId");

-- CreateIndex
CREATE INDEX "bill_allocations_billId_idx" ON "bill_allocations"("billId");

-- CreateIndex
CREATE INDEX "bill_allocations_customerId_idx" ON "bill_allocations"("customerId");

-- CreateIndex
CREATE INDEX "bill_allocations_customerId_billId_idx" ON "bill_allocations"("customerId", "billId");

-- CreateIndex
CREATE UNIQUE INDEX "voucher_counters_type_financialYear_key" ON "voucher_counters"("type", "financialYear");

-- AddForeignKey
ALTER TABLE "bills" ADD CONSTRAINT "bills_openingBalanceId_fkey" FOREIGN KEY ("openingBalanceId") REFERENCES "opening_balances"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "voucher_entries" ADD CONSTRAINT "voucher_entries_voucherId_fkey" FOREIGN KEY ("voucherId") REFERENCES "vouchers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "voucher_entries" ADD CONSTRAINT "voucher_entry_debit_fk" FOREIGN KEY ("ledgerAccountId") REFERENCES "ledger_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bill_allocations" ADD CONSTRAINT "bill_allocations_billId_fkey" FOREIGN KEY ("billId") REFERENCES "bills"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bill_allocations" ADD CONSTRAINT "bill_allocations_voucherId_fkey" FOREIGN KEY ("voucherId") REFERENCES "vouchers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
