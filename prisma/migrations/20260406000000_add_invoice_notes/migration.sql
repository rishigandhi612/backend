CREATE TYPE "NoteType" AS ENUM ('DEBIT_NOTE', 'CREDIT_NOTE');

CREATE TYPE "DocumentType" AS ENUM ('SALE', 'PURCHASE');

CREATE TYPE "BalanceEffect" AS ENUM ('INCREASE', 'DECREASE');

CREATE TYPE "NoteStatus" AS ENUM ('DRAFT', 'POSTED', 'CANCELLED');

CREATE TABLE "invoice_notes" (
    "id" TEXT NOT NULL,
    "noteNumber" TEXT NOT NULL,
    "noteType" "NoteType" NOT NULL,
    "documentType" "DocumentType" NOT NULL,
    "balanceEffect" "BalanceEffect" NOT NULL,
    "status" "NoteStatus" NOT NULL DEFAULT 'POSTED',
    "billId" TEXT,
    "invoiceNumber" TEXT NOT NULL,
    "customerId" TEXT,
    "supplierId" TEXT,
    "amount" DECIMAL(12,2) NOT NULL,
    "noteDate" TIMESTAMP(3) NOT NULL,
    "financialYear" TEXT NOT NULL,
    "reason" TEXT,
    "narration" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invoice_notes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "invoice_notes_noteNumber_key" ON "invoice_notes"("noteNumber");
CREATE INDEX "invoice_notes_billId_idx" ON "invoice_notes"("billId");
CREATE INDEX "invoice_notes_invoiceNumber_idx" ON "invoice_notes"("invoiceNumber");
CREATE INDEX "invoice_notes_customerId_noteDate_idx" ON "invoice_notes"("customerId", "noteDate");
CREATE INDEX "invoice_notes_supplierId_noteDate_idx" ON "invoice_notes"("supplierId", "noteDate");
CREATE INDEX "invoice_notes_financialYear_idx" ON "invoice_notes"("financialYear");
CREATE INDEX "invoice_notes_status_idx" ON "invoice_notes"("status");
CREATE INDEX "invoice_notes_documentType_status_idx" ON "invoice_notes"("documentType", "status");

ALTER TABLE "invoice_notes"
ADD CONSTRAINT "invoice_notes_billId_fkey"
FOREIGN KEY ("billId") REFERENCES "bills"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
