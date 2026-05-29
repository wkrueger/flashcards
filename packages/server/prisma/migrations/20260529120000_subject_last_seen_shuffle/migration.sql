-- Add a shuffled seen timestamp for review candidate ordering.
ALTER TABLE "Subject" ADD COLUMN "lastSeenShuffle" DATETIME;

UPDATE "Subject"
SET "lastSeenShuffle" = "lastSeenAt";

CREATE INDEX "Subject_deckId_lastSeenShuffle_idx" ON "Subject"("deckId", "lastSeenShuffle");
CREATE INDEX "Subject_userId_lastSeenShuffle_idx" ON "Subject"("userId", "lastSeenShuffle");
