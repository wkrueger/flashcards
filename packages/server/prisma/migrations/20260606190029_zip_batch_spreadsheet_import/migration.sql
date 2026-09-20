-- AlterTable
ALTER TABLE "SpreadsheetImport" ADD COLUMN "batchId" TEXT;
ALTER TABLE "SpreadsheetImport" ADD COLUMN "pendingDeckName" TEXT;

-- CreateIndex
CREATE INDEX "SpreadsheetImport_batchId_idx" ON "SpreadsheetImport"("batchId");
