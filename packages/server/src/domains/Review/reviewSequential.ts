import type { PrismaClient } from "../../generated/prisma/client.js"
import { Prisma } from "../../generated/prisma/client.js"
import type { SequentialMove } from "@cards/shared"

// `id` is the final tiebreak so the ordering is total even when `order` is null
// and `createdAt` ties (e.g. subjects backfilled at the same migration time).
const cardOrderBy: Prisma.CardOrderByWithRelationInput[] = [
  { order: { sort: "asc", nulls: "last" } },
  { createdAt: "asc" },
  { id: "asc" },
]
const subjectOrderBy: Prisma.SubjectOrderByWithRelationInput[] = [
  { order: { sort: "asc", nulls: "last" } },
  { createdAt: "asc" },
  { id: "asc" },
]

export interface SequentialResult {
  card: {
    id: string
    deckId: string
    subjectId: string
    front: string
    back: string
    genTemplate: string | null
    tags: string[]
    subject: {
      id: string
      subject: string
      fixationLevel: string
      firstSeenAt: Date | null
      lastSeenAt: Date | null
    }
  } | null
  isLastInSubject: boolean
  hasPrev: boolean
  atEnd: boolean
}

type SubjectCursor = { id: string; order: number | null; createdAt: Date }

export async function sequentialCard(args: {
  prisma: PrismaClient
  userId: string
  deckId: string
  cardId?: string
  subjectId?: string
  move: SequentialMove
}): Promise<SequentialResult> {
  const { prisma, userId, deckId, cardId, subjectId, move } = args
  const deck = await prisma.deck.findFirst({ where: { id: deckId, userId }, select: { id: true } })
  if (!deck) throw Object.assign(new Error("Deck not found"), { code: "DECK_NOT_FOUND" })

  let targetId: string | null = null
  if (move === "first") {
    targetId = await firstCardId(prisma, userId, deckId)
  } else if (move === "resume") {
    targetId = await resumeCardId(prisma, userId, deckId)
  } else if (move === "current") {
    targetId = cardId ?? (await firstCardId(prisma, userId, deckId))
  } else if (move === "subjectStart") {
    targetId = subjectId
      ? await firstCardOfOwnedSubject(prisma, userId, deckId, subjectId)
      : await firstCardId(prisma, userId, deckId)
  } else if (move === "subjectFirst") {
    targetId = cardId
      ? await subjectFirstCardId(prisma, userId, deckId, cardId)
      : await firstCardId(prisma, userId, deckId)
  } else if (cardId) {
    targetId = await neighborCardId(prisma, userId, deckId, cardId, move)
  } else {
    targetId = await firstCardId(prisma, userId, deckId)
  }

  if (!targetId) {
    return { card: null, isLastInSubject: false, hasPrev: false, atEnd: move === "next" }
  }

  const card = await prisma.card.findFirst({
    where: { id: targetId, deckId, deck: { userId } },
    include: {
      subject: {
        select: {
          id: true,
          subject: true,
          fixationLevel: true,
          firstSeenAt: true,
          lastSeenAt: true,
          order: true,
          createdAt: true,
        },
      },
      cardTags: { include: { tag: true } },
    },
  })
  if (!card) return { card: null, isLastInSubject: false, hasPrev: false, atEnd: false }

  const sibs = await prisma.card.findMany({
    where: { subjectId: card.subjectId },
    orderBy: cardOrderBy,
    select: { id: true },
  })
  const idx = sibs.findIndex((c) => c.id === card.id)
  const isLastInSubject = idx === sibs.length - 1
  const isFirstInSubject = idx === 0
  const hasPrev = isFirstInSubject
    ? (await findAdjacentSubject(
        prisma,
        userId,
        deckId,
        { id: card.subject.id, order: card.subject.order, createdAt: card.subject.createdAt },
        "prev"
      )) !== null
    : true

  const tags = card.cardTags.map((ct) => ct.tag.name).sort()
  return {
    card: {
      id: card.id,
      deckId: card.deckId,
      subjectId: card.subjectId,
      front: card.front,
      back: card.back,
      genTemplate: card.genTemplate,
      tags,
      subject: {
        id: card.subject.id,
        subject: card.subject.subject,
        fixationLevel: card.subject.fixationLevel,
        firstSeenAt: card.subject.firstSeenAt,
        lastSeenAt: card.subject.lastSeenAt,
      },
    },
    isLastInSubject,
    hasPrev,
    atEnd: false,
  }
}

async function neighborCardId(
  prisma: PrismaClient,
  userId: string,
  deckId: string,
  cardId: string,
  direction: "next" | "prev"
): Promise<string | null> {
  const current = await prisma.card.findFirst({
    where: { id: cardId, deckId, deck: { userId } },
    select: {
      id: true,
      subjectId: true,
      subject: { select: { id: true, order: true, createdAt: true } },
    },
  })
  if (!current) return null

  const sibs = await prisma.card.findMany({
    where: { subjectId: current.subjectId },
    orderBy: cardOrderBy,
    select: { id: true },
  })
  const idx = sibs.findIndex((c) => c.id === cardId)

  if (direction === "next") {
    if (idx >= 0 && idx < sibs.length - 1) return sibs[idx + 1]!.id
    const nextSubj = await findAdjacentSubject(prisma, userId, deckId, current.subject, "next")
    if (!nextSubj) return null
    return edgeCardOfSubject(prisma, nextSubj.id, "first")
  }
  if (idx > 0) return sibs[idx - 1]!.id
  const prevSubj = await findAdjacentSubject(prisma, userId, deckId, current.subject, "prev")
  if (!prevSubj) return null
  return edgeCardOfSubject(prisma, prevSubj.id, "last")
}

async function findAdjacentSubject(
  prisma: PrismaClient,
  userId: string,
  deckId: string,
  current: SubjectCursor,
  direction: "next" | "prev"
): Promise<SubjectCursor | null> {
  const base = { userId, deckId }
  const select = { id: true, order: true, createdAt: true }
  const o = current.order
  const c = current.createdAt
  const i = current.id

  if (direction === "next") {
    if (o !== null) {
      const greater = await prisma.subject.findFirst({
        where: {
          ...base,
          OR: [
            { order: { gt: o } },
            { order: o, createdAt: { gt: c } },
            { order: o, createdAt: c, id: { gt: i } },
          ],
        },
        orderBy: [{ order: "asc" }, { createdAt: "asc" }, { id: "asc" }],
        select,
      })
      if (greater) return greater
      return prisma.subject.findFirst({
        where: { ...base, order: null },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select,
      })
    }
    return prisma.subject.findFirst({
      where: {
        ...base,
        order: null,
        OR: [{ createdAt: { gt: c } }, { createdAt: c, id: { gt: i } }],
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select,
    })
  }

  if (o === null) {
    const lesserNull = await prisma.subject.findFirst({
      where: {
        ...base,
        order: null,
        OR: [{ createdAt: { lt: c } }, { createdAt: c, id: { lt: i } }],
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select,
    })
    if (lesserNull) return lesserNull
    return prisma.subject.findFirst({
      where: { ...base, order: { not: null } },
      orderBy: [{ order: "desc" }, { createdAt: "desc" }, { id: "desc" }],
      select,
    })
  }
  return prisma.subject.findFirst({
    where: {
      ...base,
      OR: [
        { order: { lt: o } },
        { order: o, createdAt: { lt: c } },
        { order: o, createdAt: c, id: { lt: i } },
      ],
    },
    orderBy: [{ order: "desc" }, { createdAt: "desc" }, { id: "desc" }],
    select,
  })
}

async function edgeCardOfSubject(
  prisma: PrismaClient,
  subjectId: string,
  edge: "first" | "last"
): Promise<string | null> {
  const orderBy: Prisma.CardOrderByWithRelationInput[] =
    edge === "first"
      ? cardOrderBy
      : [{ order: { sort: "desc", nulls: "first" } }, { createdAt: "desc" }, { id: "desc" }]
  const card = await prisma.card.findFirst({ where: { subjectId }, orderBy, select: { id: true } })
  return card?.id ?? null
}

async function subjectFirstCardId(
  prisma: PrismaClient,
  userId: string,
  deckId: string,
  cardId: string
) {
  const current = await prisma.card.findFirst({
    where: { id: cardId, deckId, deck: { userId } },
    select: { subjectId: true },
  })
  if (!current) return null
  return edgeCardOfSubject(prisma, current.subjectId, "first")
}

async function firstCardOfOwnedSubject(
  prisma: PrismaClient,
  userId: string,
  deckId: string,
  subjectId: string
) {
  const subject = await prisma.subject.findFirst({
    where: { id: subjectId, userId, deckId },
    select: { id: true },
  })
  if (!subject) return null
  return edgeCardOfSubject(prisma, subject.id, "first")
}

async function firstCardId(prisma: PrismaClient, userId: string, deckId: string) {
  const subject = await prisma.subject.findFirst({
    where: { userId, deckId },
    orderBy: subjectOrderBy,
    select: { id: true },
  })
  if (!subject) return null
  return edgeCardOfSubject(prisma, subject.id, "first")
}

async function resumeCardId(prisma: PrismaClient, userId: string, deckId: string) {
  const card = await prisma.card.findFirst({
    where: { deckId, deck: { userId }, lastSeenAt: { not: null } },
    orderBy: { lastSeenAt: "desc" },
    select: { id: true },
  })
  if (card) return card.id
  return firstCardId(prisma, userId, deckId)
}
