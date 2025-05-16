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
    "status" TEXT NOT NULL DEFAULT 'available',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Inventory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Inventory_productId_idx" ON "Inventory"("productId");

-- CreateIndex
CREATE INDEX "Inventory_rollId_idx" ON "Inventory"("rollId");

-- CreateIndex
CREATE INDEX "Inventory_status_idx" ON "Inventory"("status");
