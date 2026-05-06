-- Add per-deck speech recognition opt-out while preserving existing behavior.
ALTER TABLE "Deck" ADD COLUMN "speechRecognitionEnabled" BOOLEAN NOT NULL DEFAULT true;
