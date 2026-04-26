-- Mark all pre-existing users as email-verified so they aren't locked out
-- when requireEmailVerification is enabled going forward.
UPDATE "User" SET "emailVerified" = 1 WHERE "emailVerified" = 0;
