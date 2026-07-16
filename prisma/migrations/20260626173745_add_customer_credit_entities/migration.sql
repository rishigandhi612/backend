-- CreateEnum
CREATE TYPE "CreditStatus" AS ENUM ('OPEN', 'EXHAUSTED', 'REVERSED');

-- AlterTable
ALTER TABLE "bill_allocations" ADD COLUMN     "customerCreditId" TEXT;

-- CreateTable
CREATE TABLE "customer_credits" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "sourceVoucherId" TEXT NOT NULL,
    "sourceAllocationId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "consumedAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "status" "CreditStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_credits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credit_consumptions" (
    "id" TEXT NOT NULL,
    "creditId" TEXT NOT NULL,
    "billId" TEXT NOT NULL,
    "allocatedAmount" DECIMAL(12,2) NOT NULL,
    "narration" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "credit_consumptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "customer_credits_sourceAllocationId_key" ON "customer_credits"("sourceAllocationId");

-- CreateIndex
CREATE INDEX "customer_credits_customerId_idx" ON "customer_credits"("customerId");

-- CreateIndex
CREATE INDEX "customer_credits_customerId_status_idx" ON "customer_credits"("customerId", "status");

-- CreateIndex
CREATE INDEX "customer_credits_sourceVoucherId_idx" ON "customer_credits"("sourceVoucherId");

-- CreateIndex
CREATE INDEX "credit_consumptions_creditId_idx" ON "credit_consumptions"("creditId");

-- CreateIndex
CREATE INDEX "credit_consumptions_billId_idx" ON "credit_consumptions"("billId");

-- AddForeignKey
ALTER TABLE "customer_credits" ADD CONSTRAINT "customer_credits_sourceVoucherId_fkey" FOREIGN KEY ("sourceVoucherId") REFERENCES "vouchers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_credits" ADD CONSTRAINT "customer_credits_sourceAllocationId_fkey" FOREIGN KEY ("sourceAllocationId") REFERENCES "bill_allocations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_consumptions" ADD CONSTRAINT "credit_consumptions_creditId_fkey" FOREIGN KEY ("creditId") REFERENCES "customer_credits"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_consumptions" ADD CONSTRAINT "credit_consumptions_billId_fkey" FOREIGN KEY ("billId") REFERENCES "bills"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
