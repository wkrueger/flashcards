import {
  WorkerJobStatus,
  WorkerJobType,
  type PrismaClient,
  type WorkerJob,
} from "../generated/prisma/client.js"
import {
  handleAnkiImportWorkerJobError,
  runAnalyzeAnkiImportJob,
  runImportAnkiImportJob,
} from "../domains/anki-import/anki-import.service.js"
import {
  handleDeckSpreadsheetImportWorkerJobError,
  runDeckSpreadsheetImportJob,
} from "../domains/deck-spreadsheet/deck-spreadsheet.service/index.js"

const WORKER_POLL_INTERVAL_MS = 1_000

type WorkerJobHandler = {
  run: (prisma: PrismaClient, job: WorkerJob) => Promise<void>
  onError?: (prisma: PrismaClient, job: WorkerJob, message: string) => Promise<void>
}

const workerJobHandlers: Record<WorkerJobType, WorkerJobHandler> = {
  [WorkerJobType.ANALYZE_ANKI_IMPORT]: {
    async run(prisma, job) {
      if (!job.processId) {
        throw new Error("Worker job is missing its process id.")
      }

      await runAnalyzeAnkiImportJob(prisma, job.processId)
    },
    async onError(prisma, job, message) {
      await handleAnkiImportWorkerJobError(prisma, job.processId, message)
    },
  },
  [WorkerJobType.RUN_ANKI_IMPORT]: {
    async run(prisma, job) {
      if (!job.processId) {
        throw new Error("Worker job is missing its process id.")
      }

      await runImportAnkiImportJob(prisma, job.processId)
    },
    async onError(prisma, job, message) {
      await handleAnkiImportWorkerJobError(prisma, job.processId, message)
    },
  },
  [WorkerJobType.RUN_DECK_SPREADSHEET_IMPORT]: {
    async run(prisma, job) {
      await runDeckSpreadsheetImportJob(prisma, job.id)
    },
    async onError(prisma, job, message) {
      await handleDeckSpreadsheetImportWorkerJobError(prisma, job.id, message)
    },
  },
}

async function claimWorkerJob(prisma: PrismaClient) {
  const candidate = await prisma.workerJob.findFirst({
    where: {
      status: WorkerJobStatus.PENDING,
      availableAt: { lte: new Date() },
    },
    orderBy: [{ availableAt: "asc" }, { createdAt: "asc" }],
  })

  if (!candidate) {
    return null
  }

  const claimed = await prisma.workerJob.updateMany({
    where: {
      id: candidate.id,
      status: WorkerJobStatus.PENDING,
    },
    data: {
      status: WorkerJobStatus.RUNNING,
      attempts: { increment: 1 },
      startedAt: new Date(),
    },
  })

  if (claimed.count === 0) {
    return null
  }

  return prisma.workerJob.findUnique({
    where: { id: candidate.id },
  })
}

export async function runNextWorkerJob(prisma: PrismaClient) {
  const job = await claimWorkerJob(prisma)

  if (!job) {
    return false
  }

  const handler = workerJobHandlers[job.type]

  try {
    await handler.run(prisma, job)

    await prisma.workerJob.update({
      where: { id: job.id },
      data: {
        status: WorkerJobStatus.SUCCEEDED,
        finishedAt: new Date(),
        error: null,
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)

    await prisma.workerJob.update({
      where: { id: job.id },
      data: {
        status: WorkerJobStatus.FAILED,
        finishedAt: new Date(),
        error: message,
      },
    })

    await handler.onError?.(prisma, job, message)
  }

  return true
}

export async function runWorkerLoop(prisma: PrismaClient, options?: { once?: boolean }) {
  do {
    const didWork = await runNextWorkerJob(prisma)

    if (options?.once) {
      break
    }

    if (!didWork) {
      await new Promise((resolve) => setTimeout(resolve, WORKER_POLL_INTERVAL_MS))
    }
  } while (true)
}
