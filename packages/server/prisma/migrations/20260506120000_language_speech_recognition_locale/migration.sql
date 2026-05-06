-- AlterTable
ALTER TABLE "Language" ADD COLUMN "speechRecognitionLocale" TEXT;

-- Backfill seeded languages with BCP 47 locale tags for browser speech recognition.
UPDATE "Language" SET "speechRecognitionLocale" = 'en-US' WHERE "name" = 'English';
UPDATE "Language" SET "speechRecognitionLocale" = 'de-DE' WHERE "name" = 'Deutsch';
UPDATE "Language" SET "speechRecognitionLocale" = 'es-ES' WHERE "name" = 'Español';
UPDATE "Language" SET "speechRecognitionLocale" = 'fr-FR' WHERE "name" = 'Français';
UPDATE "Language" SET "speechRecognitionLocale" = 'it-IT' WHERE "name" = 'Italiano';
UPDATE "Language" SET "speechRecognitionLocale" = 'pt-BR' WHERE "name" = 'Português';
UPDATE "Language" SET "speechRecognitionLocale" = 'ja-JP' WHERE "name" = '日本語';
UPDATE "Language" SET "speechRecognitionLocale" = 'zh-CN' WHERE "name" = '中文';
UPDATE "Language" SET "speechRecognitionLocale" = 'ko-KR' WHERE "name" = '한국어';
UPDATE "Language" SET "speechRecognitionLocale" = 'nl-NL' WHERE "name" = 'Nederlands';
UPDATE "Language" SET "speechRecognitionLocale" = 'ru-RU' WHERE "name" = 'Русский';
UPDATE "Language" SET "speechRecognitionLocale" = 'ar-SA' WHERE "name" = 'العربية';
UPDATE "Language" SET "speechRecognitionLocale" = 'pl-PL' WHERE "name" = 'Polski';
UPDATE "Language" SET "speechRecognitionLocale" = 'tr-TR' WHERE "name" = 'Türkçe';
UPDATE "Language" SET "speechRecognitionLocale" = 'sv-SE' WHERE "name" = 'Svenska';
