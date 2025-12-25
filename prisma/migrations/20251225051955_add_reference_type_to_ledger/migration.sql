-- CreateEnum
CREATE TYPE "TransactionType" AS ENUM ('ADVANCE', 'AGAINST_REF', 'ON_ACCOUNT', 'REFUND');

-- CreateEnum
CREATE TYPE "VoucherType" AS ENUM ('RECEIPT', 'PAYMENT', 'CONTRA', 'JOURNAL');

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
CREATE TABLE "Transaction" (
    "id" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "bankId" TEXT NOT NULL,
    "bankName" TEXT NOT NULL,
    "transactionType" "TransactionType" NOT NULL,
    "voucherType" "VoucherType" NOT NULL,
    "totalAmount" DECIMAL(10,2) NOT NULL,
    "paymentMethod" TEXT NOT NULL,
    "paymentStatus" TEXT NOT NULL,
    "reference" TEXT,
    "remarks" TEXT,
    "transactionDate" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Transaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransactionAllocation" (
    "id" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "invoiceNumber" TEXT NOT NULL,
    "allocatedAmount" DECIMAL(10,2) NOT NULL,

    CONSTRAINT "TransactionAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_ledger" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "transactionId" TEXT,
    "transactionDate" TIMESTAMP(3) NOT NULL,
    "debit" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "credit" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "balanceAfter" DECIMAL(10,2) NOT NULL,
    "narration" TEXT NOT NULL,
    "referenceType" TEXT,
    "referenceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_ledger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransactionLog" (
    "id" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "changes" JSONB,
    "userId" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TransactionLog_pkey" PRIMARY KEY ("id")
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
CREATE UNIQUE INDEX "Transaction_transactionId_key" ON "Transaction"("transactionId");

-- CreateIndex
CREATE INDEX "Transaction_customerId_idx" ON "Transaction"("customerId");

-- CreateIndex
CREATE INDEX "Transaction_transactionType_idx" ON "Transaction"("transactionType");

-- CreateIndex
CREATE INDEX "TransactionAllocation_invoiceNumber_idx" ON "TransactionAllocation"("invoiceNumber");

-- CreateIndex
CREATE INDEX "customer_ledger_customerId_transactionDate_createdAt_idx" ON "customer_ledger"("customerId", "transactionDate", "createdAt");

-- CreateIndex
CREATE INDEX "customer_ledger_customerId_idx" ON "customer_ledger"("customerId");

-- CreateIndex
CREATE INDEX "customer_ledger_transactionDate_idx" ON "customer_ledger"("transactionDate");

-- CreateIndex
CREATE INDEX "customer_ledger_transactionId_idx" ON "customer_ledger"("transactionId");

-- CreateIndex
CREATE INDEX "customer_ledger_referenceType_referenceId_idx" ON "customer_ledger"("referenceType", "referenceId");

-- CreateIndex
CREATE INDEX "TransactionLog_transactionId_idx" ON "TransactionLog"("transactionId");

-- AddForeignKey
ALTER TABLE "TransactionAllocation" ADD CONSTRAINT "TransactionAllocation_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_ledger" ADD CONSTRAINT "customer_ledger_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;
