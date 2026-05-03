import { cac } from "cac"
import { prisma } from "../infra/db.js"
import { runWorkerLoop } from "../infra/worker.js"

const cli = cac("worker")

cli.option("--once", "Run at most one worker iteration and exit.")
cli.help()

const parsed = cli.parse(process.argv, { run: false })
const options = parsed.options as { once?: boolean }

let stopping = false

function stop() {
  stopping = true
}

process.on("SIGINT", stop)
process.on("SIGTERM", stop)

async function main() {
  console.log("[worker] started")
  if (options.once) {
    await runWorkerLoop(prisma, { once: true })
    return
  }

  while (!stopping) {
    await runWorkerLoop(prisma, { once: true })

    if (!stopping) {
      await new Promise((resolve) => setTimeout(resolve, 1_000))
    }
  }
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? (error.stack ?? error.message) : String(error))
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
