import { PrismaClient } from "../src/generated/prisma/client.js"

const prisma = new PrismaClient()

async function main() {
  const seeds = [
    { name: "English", emoji: "🇬🇧" },
    { name: "Deutsch", emoji: "🇩🇪" },
  ]
  for (const s of seeds) {
    await prisma.language.upsert({
      where: { name: s.name },
      update: { emoji: s.emoji },
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
