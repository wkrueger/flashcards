-- Add a persisted random key for Subject so review picking can use indexed range scans
-- instead of ORDER BY RANDOM() or large OFFSET scans.
ALTER TABLE "Subject" ADD COLUMN "randomKey" INTEGER NOT NULL DEFAULT 0;

UPDATE "Subject"
SET "randomKey" = (random() & 2147483647);

DROP INDEX "Subject_userId_cooldownAt_idx";

CREATE INDEX "Subject_userId_randomKey_idx" ON "Subject"("userId", "randomKey");
CREATE INDEX "Subject_userId_cooldownAt_randomKey_idx" ON "Subject"("userId", "cooldownAt", "randomKey");
