import { Prisma } from "../../../generated/prisma/client.js"
import { hashFront, SYSTEM_TAG_OWNER_KEY } from "../../cards/cards.service.js"
import { randomSubjectKey, subjectKeyFor } from "../../subjects/subjects.service.js"
import type { SpreadsheetImportResult } from "../deck-spreadsheet.shared.js"
import { assertNoDuplicateTagNames, type SpreadsheetRow } from "./workbook.js"

export async function applySpreadsheetRows(
  prisma: Prisma.TransactionClient,
  input: {
    userId: string
    deckId: string
    rows: SpreadsheetRow[]
  }
): Promise<SpreadsheetImportResult> {
  const touchedSubjectIds = new Set<string>()
  const seenIds = new Set<string>()
  const subjectOrderByKey = new Map<string, number | null>()
  let createdCardCount = 0
  let updatedCardCount = 0
  let deletedCardCount = 0

  // First subject appearance wins: the order from the first row mentioning a
  // subject is used for every later row of the same subject.
  const resolveSubjectOrder = (name: string, rowOrder: number | null) => {
    const key = subjectKeyFor(name)
    if (!subjectOrderByKey.has(key)) subjectOrderByKey.set(key, rowOrder)
    return subjectOrderByKey.get(key) ?? null
  }

  for (const row of input.rows) {
    const logPrefix = `Row ${row.rowNumber}:`

    if (row.id && seenIds.has(row.id)) {
      throw new Error(`${logPrefix} duplicate card id "${row.id}".`)
    }
    if (row.id) seenIds.add(row.id)

    const isDelete = !!row.id && !row.front && !row.back

    if (isDelete) {
      const card = await prisma.card.findFirst({
        where: { id: row.id, deckId: input.deckId, deck: { userId: input.userId } },
        select: { id: true, subjectId: true },
      })
      if (!card) throw new Error(`${logPrefix} card "${row.id}" was not found in this deck.`)

      touchedSubjectIds.add(card.subjectId)
      await prisma.card.delete({ where: { id: card.id } })
      deletedCardCount += 1
      continue
    }

    if (!row.subjectName) throw new Error(`${logPrefix} subjectName is required.`)
    if (!row.front) throw new Error(`${logPrefix} front is required.`)
    if (!row.back) throw new Error(`${logPrefix} back is required.`)

    const tagIds = await resolveTags(prisma, input.userId, row.tagNames)

    if (!row.id) {
      const subject = await upsertSubjectForImport(
        prisma,
        input.userId,
        input.deckId,
        row.subjectName,
        resolveSubjectOrder(row.subjectName, row.subjectOrder)
      )

      try {
        await prisma.card.create({
          data: {
            deckId: input.deckId,
            subjectId: subject.id,
            front: row.front,
            frontHash: hashFront(row.front),
            back: row.back,
            order: row.cardOrder,
            cardTags: {
              create: tagIds.map((tagId) => ({ tag: { connect: { id: tagId } } })),
            },
          },
        })
      } catch (err) {
        if (isUniqueConstraintError(err)) {
          throw new Error(`${logPrefix} a card with this subject and front already exists.`)
        }
        throw err
      }
      createdCardCount += 1
      continue
    }

    const card = await prisma.card.findFirst({
      where: { id: row.id, deckId: input.deckId, deck: { userId: input.userId } },
      include: {
        subject: { select: { id: true, subject: true } },
        cardTags: { select: { tagId: true } },
      },
    })
    if (!card) throw new Error(`${logPrefix} card "${row.id}" was not found in this deck.`)

    const resolvedSubjectOrder = resolveSubjectOrder(row.subjectName, row.subjectOrder)
    const subject =
      card.subject.subject === row.subjectName
        ? await prisma.subject.update({
            where: { id: card.subjectId },
            data: { order: resolvedSubjectOrder },
            select: { id: true, subject: true },
          })
        : await upsertSubjectForImport(
            prisma,
            input.userId,
            input.deckId,
            row.subjectName,
            resolvedSubjectOrder
          )
    const currentTagIds = card.cardTags.map((cardTag) => cardTag.tagId)
    const subjectChanged = card.subjectId !== subject.id
    const cardFieldsChanged = card.front !== row.front || card.back !== row.back
    const orderChanged = card.order !== row.cardOrder
    const tagIdSet = new Set(tagIds)
    const tagsChanged =
      currentTagIds.length !== tagIds.length || currentTagIds.some((tagId) => !tagIdSet.has(tagId))

    if (!subjectChanged && !cardFieldsChanged && !tagsChanged && !orderChanged) continue

    if (subjectChanged) touchedSubjectIds.add(card.subjectId)

    try {
      await prisma.card.update({
        where: { id: card.id },
        data: {
          subjectId: subject.id,
          front: row.front,
          frontHash: hashFront(row.front),
          back: row.back,
          order: row.cardOrder,
          ...(tagsChanged
            ? {
                cardTags: {
                  deleteMany: {},
                  create: tagIds.map((tagId) => ({ tag: { connect: { id: tagId } } })),
                },
              }
            : {}),
        },
      })
    } catch (err) {
      if (isUniqueConstraintError(err)) {
        throw new Error(`${logPrefix} a card with this subject and front already exists.`)
      }
      throw err
    }

    updatedCardCount += 1
  }

  for (const subjectId of touchedSubjectIds) {
    const cardCount = await prisma.card.count({ where: { subjectId } })
    if (cardCount === 0) {
      await prisma.subject.delete({ where: { id: subjectId } })
    }
  }

  return {
    rowCount: input.rows.length,
    createdCardCount,
    updatedCardCount,
    deletedCardCount,
  }
}

async function upsertSubjectForImport(
  prisma: Prisma.TransactionClient,
  userId: string,
  deckId: string,
  subjectName: string,
  order: number | null
) {
  const subject = subjectName.trim()
  if (!subject) {
    throw new Error("subjectName is required.")
  }

  const subjectKey = subjectKeyFor(subject)
  const existing = await prisma.subject.findUnique({
    where: { deckId_subjectKey: { deckId, subjectKey } },
    select: { id: true },
  })

  if (existing) {
    await prisma.subject.update({ where: { id: existing.id }, data: { order } })
    return existing
  }

  return prisma.subject.create({
    data: {
      userId,
      deckId,
      subject,
      subjectKey,
      randomKey: randomSubjectKey(),
      order,
    },
    select: { id: true },
  })
}

async function resolveTags(prisma: Prisma.TransactionClient, userId: string, tagNames: string[]) {
  const uniqueNames = Array.from(new Set(tagNames))
  if (uniqueNames.length === 0) return []

  const tags = await prisma.tag.findMany({
    where: {
      name: { in: uniqueNames },
      OR: [{ ownerKey: userId }, { ownerKey: SYSTEM_TAG_OWNER_KEY }],
    },
    select: { id: true, name: true },
  })

  assertNoDuplicateTagNames(tags)

  const byName = new Map(tags.map((tag) => [tag.name, tag.id]))
  const missing = uniqueNames.filter((name) => !byName.has(name))
  if (missing.length > 0) {
    throw new Error(`Tag "${missing[0]}" was not found.`)
  }

  return uniqueNames.map((name) => byName.get(name)!)
}

function isUniqueConstraintError(err: unknown) {
  return typeof err === "object" && err !== null && "code" in err && err.code === "P2002"
}
