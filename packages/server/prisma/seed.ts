import { PrismaClient } from "../src/generated/prisma/client.js"
import { createPrismaAdapter } from "../src/infra/prisma-adapter.js"

const prisma = new PrismaClient({ adapter: createPrismaAdapter() })

async function main() {
  const seeds = [
    { name: "English", englishName: "English", emoji: "🇬🇧" },
    { name: "Deutsch", englishName: "German", emoji: "🇩🇪" },
    { name: "Español", englishName: "Spanish", emoji: "🇪🇸" },
    { name: "Français", englishName: "French", emoji: "🇫🇷" },
    { name: "Italiano", englishName: "Italian", emoji: "🇮🇹" },
    { name: "Português", englishName: "Portuguese", emoji: "🇧🇷" },
    { name: "日本語", englishName: "Japanese", emoji: "🇯🇵" },
    { name: "中文", englishName: "Mandarin Chinese", emoji: "🇨🇳" },
    { name: "한국어", englishName: "Korean", emoji: "🇰🇷" },
    { name: "Nederlands", englishName: "Dutch", emoji: "🇳🇱" },
    { name: "Русский", englishName: "Russian", emoji: "🇷🇺" },
    { name: "العربية", englishName: "Arabic", emoji: "🇸🇦" },
    { name: "Polski", englishName: "Polish", emoji: "🇵🇱" },
    { name: "Türkçe", englishName: "Turkish", emoji: "🇹🇷" },
    { name: "Svenska", englishName: "Swedish", emoji: "🇸🇪" },
  ]
  for (const s of seeds) {
    await prisma.language.upsert({
      where: { name: s.name },
      update: { englishName: s.englishName, emoji: s.emoji },
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
