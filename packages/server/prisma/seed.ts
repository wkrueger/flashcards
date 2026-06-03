import { PrismaClient } from "../src/generated/prisma/client.js"
import { createPrismaAdapter } from "../src/infra/prismaAdapter.js"

const prisma = new PrismaClient({ adapter: createPrismaAdapter() })

async function main() {
  const seeds = [
    { name: "English", englishName: "English", emoji: "🇬🇧", speechRecognitionLocale: "en-US" },
    { name: "Deutsch", englishName: "German", emoji: "🇩🇪", speechRecognitionLocale: "de-DE" },
    { name: "Español", englishName: "Spanish", emoji: "🇪🇸", speechRecognitionLocale: "es-ES" },
    { name: "Français", englishName: "French", emoji: "🇫🇷", speechRecognitionLocale: "fr-FR" },
    { name: "Italiano", englishName: "Italian", emoji: "🇮🇹", speechRecognitionLocale: "it-IT" },
    {
      name: "Português",
      englishName: "Portuguese",
      emoji: "🇧🇷",
      speechRecognitionLocale: "pt-BR",
    },
    { name: "日本語", englishName: "Japanese", emoji: "🇯🇵", speechRecognitionLocale: "ja-JP" },
    {
      name: "中文",
      englishName: "Mandarin Chinese",
      emoji: "🇨🇳",
      speechRecognitionLocale: "zh-CN",
    },
    { name: "한국어", englishName: "Korean", emoji: "🇰🇷", speechRecognitionLocale: "ko-KR" },
    { name: "Nederlands", englishName: "Dutch", emoji: "🇳🇱", speechRecognitionLocale: "nl-NL" },
    { name: "Русский", englishName: "Russian", emoji: "🇷🇺", speechRecognitionLocale: "ru-RU" },
    { name: "العربية", englishName: "Arabic", emoji: "🇸🇦", speechRecognitionLocale: "ar-SA" },
    { name: "Polski", englishName: "Polish", emoji: "🇵🇱", speechRecognitionLocale: "pl-PL" },
    { name: "Türkçe", englishName: "Turkish", emoji: "🇹🇷", speechRecognitionLocale: "tr-TR" },
    { name: "Svenska", englishName: "Swedish", emoji: "🇸🇪", speechRecognitionLocale: "sv-SE" },
  ]
  for (const s of seeds) {
    await prisma.language.upsert({
      where: { name: s.name },
      update: {
        englishName: s.englishName,
        emoji: s.emoji,
        speechRecognitionLocale: s.speechRecognitionLocale,
      },
      create: s,
    })
  }
  console.log("Seeded languages.")
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
