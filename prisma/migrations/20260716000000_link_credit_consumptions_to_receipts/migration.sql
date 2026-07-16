ALTER TABLE "credit_consumptions"
ADD COLUMN "voucherId" TEXT,
ADD COLUMN "billAllocationId" TEXT;

CREATE UNIQUE INDEX "credit_consumptions_billAllocationId_key"
ON "credit_consumptions"("billAllocationId");

CREATE INDEX "credit_consumptions_voucherId_idx"
ON "credit_consumptions"("voucherId");

ALTER TABLE "credit_consumptions"
ADD CONSTRAINT "credit_consumptions_voucherId_fkey"
FOREIGN KEY ("voucherId") REFERENCES "vouchers"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "credit_consumptions"
ADD CONSTRAINT "credit_consumptions_billAllocationId_fkey"
FOREIGN KEY ("billAllocationId") REFERENCES "bill_allocations"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
