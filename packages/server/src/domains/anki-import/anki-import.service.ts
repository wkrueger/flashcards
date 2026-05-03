import { TRPCError } from "@trpc/server"
import type { AnkiCardMapping, AnkiImportListItemView } from "@cards/shared"
import { randomSubjectKey } from "../subjects/subjects.service.js"
import {
  ImportCardTypeKind,
  ImportProcessStatus as PrismaImportProcessStatus,
  WorkerJobType,
  type PrismaClient,
} from "../../generated/prisma/client.js"
import { readAnkiArchiveData, mapPreviewCard } from "./anki-import.archive.js"
import { collectMappedRows } from "./anki-import.mapping.js"
import {
  deleteFileIfExists,
  getErrorStatusCode,
  parseJsonArray,
  serializeImportProcess,
  stripMediaAndMarkup,
  type DbClient,
  type SaveConfigurationInput,
} from "./anki-import.shared.js"
import {
  ANKI_IMPORT_UPLOAD_MAX_BYTES,
  handleAnkiImportUpload,
  isSupportedApkgUpload,
} from "./anki-import.upload.js"

export {
  ANKI_IMPORT_UPLOAD_MAX_BYTES,
  getErrorStatusCode,
  handleAnkiImportUpload,
  isSupportedApkgUpload,
  readAnkiArchiveData,
  serializeImportProcess,
  stripMediaAndMarkup,
}

async function assertLanguagesExist(prisma: DbClient, ids: number[]) {
  const uniqueIds = Array.from(new Set(ids))
  if (uniqueIds.length === 0) return

  const found = await prisma.language.count({
    where: { id: { in: uniqueIds } },
  })

  if (found !== uniqueIds.length) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Language not found.",
    })
  }
}

async function findOwnedImportProcess(prisma: PrismaClient, userId: string, processId: string) {
  const process = await prisma.importProcess.findFirst({
    where: { id: processId, userId },
    include: { cardTypes: true },
  })

  if (!process) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Import process not found." })
  }

  return process
}

export async function deleteImportProcess(prisma: PrismaClient, userId: string, processId: string) {
  const process = await findOwnedImportProcess(prisma, userId, processId)
  await deleteFileIfExists(process.storagePath)
  await prisma.importProcess.delete({ where: { id: process.id } })
}

export async function getImportProcessView(
  prisma: PrismaClient,
  userId: string,
  processId: string
) {
  const process = await findOwnedImportProcess(prisma, userId, processId)
  return serializeImportProcess(process)
}

export async function listImportProcesses(
  prisma: PrismaClient,
  userId: string
): Promise<AnkiImportListItemView[]> {
  const processes = await prisma.importProcess.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      status: true,
      filename: true,
      deckName: true,
      importedCardCount: true,
      rowCount: true,
      createdAt: true,
    },
  })

  return processes.map((p) => ({
    id: p.id,
    status: p.status,
    filename: p.filename,
    deckName: p.deckName ?? null,
    importedCardCount: p.importedCardCount,
    rowCount: p.rowCount,
    createdAt: p.createdAt.toISOString(),
  }))
}

export async function saveImportConfiguration(prisma: PrismaClient, input: SaveConfigurationInput) {
  const process = await findOwnedImportProcess(prisma, input.userId, input.processId)

  if (process.status !== PrismaImportProcessStatus.AWAITING_CONFIGURATION) {
    throw new TRPCError({
      code: "CONFLICT",
      message: "This import process can no longer be configured.",
    })
  }

  const selectedCount = input.cardTypes.filter((cardType) => cardType.selected).length

  if (selectedCount === 0) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Select at least one card type to import.",
    })
  }

  await assertLanguagesExist(
    prisma,
    [input.deck.defaultFrontLanguageId, input.deck.defaultBackLanguageId].filter(
      (value): value is number => typeof value === "number"
    )
  )

  const processCardTypes = new Map(
    process.cardTypes.map((cardType) => [cardType.modelKey, cardType])
  )
  const selectedRowCount = input.cardTypes
    .filter((cardType) => cardType.selected)
    .reduce((sum, cardType) => sum + (processCardTypes.get(cardType.modelKey)?.rowCount ?? 0), 0)

  await prisma.$transaction(async (tx) => {
    await tx.importProcess.update({
      where: { id: process.id },
      data: {
        deckName: input.deck.name.trim(),
        defaultFrontLanguageId: input.deck.defaultFrontLanguageId ?? null,
        defaultBackLanguageId: input.deck.defaultBackLanguageId ?? null,
        inverseReviewEnabled: input.deck.inverseReviewEnabled ?? false,
        selectedRowCount,
        errorSummary: null,
        errorDetailsJson: null,
      },
    })

    for (const mapping of input.cardTypes) {
      const cardType = processCardTypes.get(mapping.modelKey)

      if (!cardType) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Unknown card type mapping: ${mapping.modelKey}`,
        })
      }

      const fieldNames = parseJsonArray<string>(cardType.fieldNamesJson)
      const subjectField = mapping.selected ? (mapping.subjectField ?? null) : null
      const cardMappings = mapping.selected ? (mapping.cardMappings ?? []) : []

      if (mapping.selected) {
        if (!subjectField || !fieldNames.includes(subjectField)) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Invalid subject field for model ${cardType.modelName}.`,
          })
        }
        if (cardMappings.length === 0) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `No card mappings configured for ${cardType.modelName}.`,
          })
        }
        for (const cm of cardMappings) {
          for (const fieldName of [cm.frontField, cm.backField]) {
            if (!fieldName || !fieldNames.includes(fieldName)) {
              throw new TRPCError({
                code: "BAD_REQUEST",
                message: `Invalid mapping field for model ${cardType.modelName}.`,
              })
            }
          }
        }
      }

      const sampleRows = parseJsonArray<Record<string, string>>(cardType.sampleRowsJson)
      const previewCards =
        mapping.selected && subjectField
          ? sampleRows
              .slice(0, 2)
              .flatMap((sampleRow) =>
                cardMappings.map((cm) =>
                  mapPreviewCard(sampleRow, {
                    subjectField,
                    frontField: cm.frontField,
                    backField: cm.backField,
                  })
                )
              )
              .filter((card) => card.subjectText && card.front && card.back)
              .slice(0, 4)
          : []

      const plugins = mapping.selected ? (mapping.plugins ?? []) : []

      await tx.importCardType.update({
        where: { id: cardType.id },
        data: {
          selected: mapping.selected,
          subjectField,
          cardMappingsJson: JSON.stringify(cardMappings),
          pluginsJson: JSON.stringify(plugins),
          previewCardsJson: JSON.stringify(previewCards),
        },
      })
    }
  })

  return getImportProcessView(prisma, input.userId, process.id)
}

export async function startImportProcess(prisma: PrismaClient, userId: string, processId: string) {
  const process = await findOwnedImportProcess(prisma, userId, processId)

  if (process.status !== PrismaImportProcessStatus.AWAITING_CONFIGURATION) {
    throw new TRPCError({
      code: "CONFLICT",
      message: "This import process cannot be started.",
    })
  }

  if (!process.deckName) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "The new deck configuration is incomplete.",
    })
  }

  const selectedTypes = process.cardTypes.filter((cardType) => cardType.selected)
  if (selectedTypes.length === 0) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Select at least one card type to import.",
    })
  }

  for (const cardType of selectedTypes) {
    if (!cardType.subjectField) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `No subject field configured for ${cardType.modelName}.`,
      })
    }
    const cardMappings = parseJsonArray<AnkiCardMapping>(cardType.cardMappingsJson)
    if (cardMappings.length === 0) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `No card mappings configured for ${cardType.modelName}.`,
      })
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.workerJob.create({
      data: {
        processId: process.id,
        type: WorkerJobType.RUN_ANKI_IMPORT,
      },
    })

    await tx.importProcess.update({
      where: { id: process.id },
      data: {
        status: PrismaImportProcessStatus.VALIDATING,
        errorSummary: null,
        errorDetailsJson: null,
        failedRowCount: 0,
      },
    })
  })

  return getImportProcessView(prisma, userId, process.id)
}

async function failImportProcess(
  prisma: PrismaClient,
  process: { id: string; storagePath: string },
  summary: string,
  details: string[] = [],
  failedRowCount = 0
) {
  await prisma.importProcess.update({
    where: { id: process.id },
    data: {
      status: PrismaImportProcessStatus.FAILED,
      errorSummary: summary,
      errorDetailsJson: JSON.stringify(details),
      failedRowCount,
      completedAt: new Date(),
    },
  })
  await deleteFileIfExists(process.storagePath)
}

export async function runAnalyzeAnkiImportJob(prisma: PrismaClient, processId: string) {
  const process = await prisma.importProcess.findUnique({
    where: { id: processId },
  })

  if (!process) {
    throw new Error(`Import process ${processId} was not found.`)
  }

  const archiveData = await readAnkiArchiveData(process.storagePath)
  const cardTypes = [...archiveData.models.values()].map((model) => {
    const rows = archiveData.rowsByModelKey.get(model.key) ?? []

    return {
      processId: process.id,
      modelKey: model.key,
      modelName: model.name,
      modelKind: model.kind === "CLOZE" ? ImportCardTypeKind.CLOZE : ImportCardTypeKind.BASIC,
      rowCount: rows.length,
      fieldNamesJson: JSON.stringify(model.fieldNames),
      sampleRowsJson: JSON.stringify(rows.slice(0, 2).map((row) => row.values)),
    }
  })

  await prisma.$transaction(async (tx) => {
    await tx.importCardType.deleteMany({ where: { processId: process.id } })

    if (cardTypes.length > 0) {
      await tx.importCardType.createMany({ data: cardTypes })
    }

    await tx.importProcess.update({
      where: { id: process.id },
      data: {
        detectedCollectionFile: archiveData.collectionFile,
        rowCount: [...archiveData.rowsByModelKey.values()].reduce(
          (sum, rows) => sum + rows.length,
          0
        ),
        selectedRowCount: 0,
        importedCardCount: 0,
        failedRowCount: 0,
        errorSummary: null,
        errorDetailsJson: null,
        status: PrismaImportProcessStatus.AWAITING_CONFIGURATION,
      },
    })
  })
}

export async function runImportAnkiImportJob(prisma: PrismaClient, processId: string) {
  const process = await prisma.importProcess.findUnique({
    where: { id: processId },
    include: { cardTypes: true },
  })

  if (!process) {
    throw new Error(`Import process ${processId} was not found.`)
  }

  if (!process.deckName) {
    await failImportProcess(prisma, process, "The deck configuration is incomplete.")
    return
  }

  const selectedCardTypes = process.cardTypes.filter((cardType) => cardType.selected)
  if (selectedCardTypes.length === 0) {
    await failImportProcess(prisma, process, "No card types were selected for import.")
    return
  }

  const languageIds = [process.defaultFrontLanguageId, process.defaultBackLanguageId].filter(
    (value): value is number => typeof value === "number"
  )

  const [existingDeck, languageCount, archiveData] = await Promise.all([
    prisma.deck.findFirst({
      where: {
        userId: process.userId,
        name: process.deckName,
      },
      select: { id: true },
    }),
    prisma.language.count({
      where: { id: { in: Array.from(new Set(languageIds)) } },
    }),
    readAnkiArchiveData(process.storagePath),
  ])

  if (existingDeck) {
    await failImportProcess(prisma, process, "A deck with that name already exists.", [
      "Choose another deck name and upload the file again.",
    ])
    return
  }

  if (languageCount !== Array.from(new Set(languageIds)).length) {
    await failImportProcess(prisma, process, "One of the selected deck languages no longer exists.")
    return
  }

  const mappedRows = collectMappedRows({
    archiveData,
    cardTypes: selectedCardTypes,
  })

  if (mappedRows.failedRowCount > 0) {
    await failImportProcess(
      prisma,
      process,
      "Import validation failed.",
      mappedRows.sampleErrors,
      mappedRows.failedRowCount
    )
    return
  }

  await prisma.importProcess.update({
    where: { id: process.id },
    data: {
      status: PrismaImportProcessStatus.IMPORTING,
      failedRowCount: 0,
      errorSummary: null,
      errorDetailsJson: null,
    },
  })

  const importResult = await prisma.$transaction(async (tx) => {
    const deck = await tx.deck.create({
      data: {
        name: process.deckName!,
        userId: process.userId,
        defaultFrontLanguageId: process.defaultFrontLanguageId ?? null,
        defaultBackLanguageId: process.defaultBackLanguageId ?? null,
        inverseReviewEnabled: process.inverseReviewEnabled ?? false,
      },
    })

    const subjectCache = new Map<string, string>()

    for (const row of mappedRows.rows) {
      let subjectId = subjectCache.get(row.subjectKey)

      if (!subjectId) {
        const subject = await tx.subject.upsert({
          where: {
            deckId_subjectKey: {
              deckId: deck.id,
              subjectKey: row.subjectKey,
            },
          },
          update: {},
          create: {
            userId: process.userId,
            deckId: deck.id,
            subject: row.subjectText,
            subjectKey: row.subjectKey,
            randomKey: randomSubjectKey(),
          },
        })

        subjectId = subject.id
        subjectCache.set(row.subjectKey, subject.id)
      }

      await tx.card.create({
        data: {
          deckId: deck.id,
          subjectId,
          front: row.front,
          frontHash: row.frontHash,
          back: row.back,
          genTemplate: null,
        },
      })
    }

    return {
      deckId: deck.id,
      importedCardCount: mappedRows.rows.length,
    }
  })

  await prisma.importProcess.update({
    where: { id: process.id },
    data: {
      status: PrismaImportProcessStatus.SUCCEEDED,
      createdDeckId: importResult.deckId,
      importedCardCount: importResult.importedCardCount,
      failedRowCount: 0,
      errorSummary: null,
      errorDetailsJson: null,
      completedAt: new Date(),
    },
  })

  await deleteFileIfExists(process.storagePath)
}

export async function handleAnkiImportWorkerJobError(
  prisma: PrismaClient,
  processId: string | null,
  message: string
) {
  if (!processId) {
    return
  }

  const process = await prisma.importProcess.findUnique({
    where: { id: processId },
    select: { id: true, status: true, storagePath: true },
  })

  if (process && process.status !== PrismaImportProcessStatus.SUCCEEDED) {
    await failImportProcess(prisma, process, message)
  }
}
