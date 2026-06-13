import { beforeEach, describe, expect, it } from "vitest"
import { callerFor, makeUser, resetDomain } from "../helpers.js"
import { prisma } from "../../src/infra/db.js"
import {
  pickNextCard,
  sequentialCard,
  type CardRow,
  type DeckMeta,
  type ReviewStore,
  type SequentialMove,
  type SubjectRow,
} from "@cards/shared"
import { PrismaReviewStore } from "../../src/domains/Review/PrismaReviewStore.js"
import { tagOwnershipFor } from "../../src/domains/Cards/cardsService.js"
import { subjectKeyFor } from "../../src/domains/Subjects/subjectsService.js"

// Deterministic PRNG so both stores consume randomness identically given identical data.
function mulberry32(seed: number): () => number {
  let s = seed
  return () => {
    s |= 0
    s = (s + 0x6d2b79f5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// In-memory ReviewStore that mirrors the client's SnapshotReviewStore: it serves the exact rows
// the offline snapshot carries, leaving all ordering to the shared selection logic.
class InMemoryStore implements ReviewStore {
  private readonly subjectsById: Map<string, SubjectRow>
  constructor(
    private readonly deckId: string,
    private readonly deckMeta: DeckMeta,
    private readonly subjects: SubjectRow[],
    private readonly cards: Array<Omit<CardRow, "subject">>
  ) {
    this.subjectsById = new Map(subjects.map((s) => [s.id, s]))
  }
  private toRow(c: Omit<CardRow, "subject">): CardRow | null {
    const subject = this.subjectsById.get(c.subjectId)
    return subject ? { ...c, subject } : null
  }
  private map(cards: Array<Omit<CardRow, "subject">>): CardRow[] {
    return cards.map((c) => this.toRow(c)).filter((c): c is CardRow => c !== null)
  }
  async getDeckMeta(deckId: string) {
    return deckId === this.deckId ? this.deckMeta : null
  }
  async listSubjects(opts: { deckId?: string }) {
    return opts.deckId && opts.deckId !== this.deckId ? [] : this.subjects
  }
  async listCards(opts: { subjectId: string; deckId?: string }) {
    return this.map(
      this.cards.filter(
        (c) => c.subjectId === opts.subjectId && (!opts.deckId || c.deckId === opts.deckId)
      )
    )
  }
  async listCardsByDeck(deckId: string) {
    return deckId === this.deckId ? this.map(this.cards) : []
  }
  async getCard(cardId: string, opts: { deckId?: string }) {
    const card = this.cards.find(
      (c) => c.id === cardId && (!opts.deckId || c.deckId === opts.deckId)
    )
    return card ? this.toRow(card) : null
  }
  async deleteEmptySubjects() {}
}

async function seedDeck(userId: string) {
  const deck = await prisma.deck.create({
    data: { userId, name: "parity", inverseReviewEnabled: true },
  })
  const past = (mins: number) => new Date(Date.now() - mins * 60_000)
  const specs = [
    { text: "alpha", randomKey: 100, cooldown: past(60), seen: past(50), tags: [] as string[] },
    { text: "bravo", randomKey: 900, cooldown: past(40), seen: past(45), tags: ["gen:bigger"] },
    { text: "charlie", randomKey: 500, cooldown: past(30), seen: past(20), tags: [] },
    { text: "delta", randomKey: 300, cooldown: past(80), seen: past(70), tags: [] },
    { text: "echo", randomKey: 1500, cooldown: past(10), seen: past(15), tags: [] },
    { text: "foxtrot", randomKey: 1200, cooldown: past(5), seen: past(8), tags: [] },
  ]
  for (const [i, s] of specs.entries()) {
    const subject = await prisma.subject.create({
      data: {
        deckId: deck.id,
        userId,
        subject: s.text,
        subjectKey: subjectKeyFor(s.text),
        randomKey: s.randomKey,
        cooldownAt: s.cooldown,
        lastSeenAt: s.seen,
        lastSeenShuffle: s.seen,
        firstSeenAt: past(200),
        fixationLevel: String((i % 5) + 1),
      },
    })
    // Two cards per subject to exercise within-subject ordering.
    for (const suffix of ["a", "b"]) {
      const front = `${s.text}-${suffix}`
      await prisma.card.create({
        data: {
          deckId: deck.id,
          subjectId: subject.id,
          front,
          frontHash: front,
          back: `back-${front}`,
          order: suffix === "a" ? 0 : 1,
          cardTags: {
            create: s.tags.map((name) => {
              const o = tagOwnershipFor(userId, name)
              return {
                tag: {
                  connectOrCreate: {
                    where: { ownerKey_name: { ownerKey: o.ownerKey, name } },
                    create: { ownerType: o.ownerType, ownerKey: o.ownerKey, name },
                  },
                },
              }
            }),
          },
        },
      })
    }
  }
  return deck.id
}

async function buildInMemoryStore(userId: string, deckId: string): Promise<InMemoryStore> {
  const snap = await callerFor(userId).offline.snapshot({ deckId })
  return new InMemoryStore(
    deckId,
    {
      inverseReviewEnabled: snap.deck.inverseReviewEnabled,
      inverseReviewStreak: snap.deck.inverseReviewStreak,
    },
    snap.subjects as unknown as SubjectRow[],
    snap.cards as unknown as Array<Omit<CardRow, "subject">>
  )
}

beforeEach(resetDomain)

describe("review selection parity (Prisma store vs in-memory snapshot store)", () => {
  it("produces identical pick sequences for normal, free, and inverse review", async () => {
    const userId = await makeUser()
    const deckId = await seedDeck(userId)
    const prismaStore = new PrismaReviewStore(prisma, userId)
    const memStore = await buildInMemoryStore(userId, deckId)

    for (const mode of ["normal", "free"] as const) {
      const runSequence = async (store: ReviewStore) => {
        const out: string[] = []
        let exclude: string | undefined
        // Fixed seed → identical rng consumption when the data matches.
        const rng = mulberry32(12345)
        const inverseRng = mulberry32(67890)
        for (let i = 0; i < 12; i++) {
          const res = await pickNextCard({
            store,
            userId,
            deckId,
            includeOnCooldown: mode === "free",
            excludeCardId: exclude,
            now: new Date(),
            rng,
            inverseRng,
          })
          if (!res.card) break
          out.push(`${res.card.id}:${res.inverse}`)
          exclude = res.card.id
        }
        return out
      }
      const fromPrisma = await runSequence(prismaStore)
      const fromMem = await runSequence(memStore)
      expect(fromMem).toEqual(fromPrisma)
      expect(fromPrisma.length).toBeGreaterThan(0)
    }
  })

  it("produces identical sequential navigation", async () => {
    const userId = await makeUser()
    const deckId = await seedDeck(userId)
    const prismaStore = new PrismaReviewStore(prisma, userId)
    const memStore = await buildInMemoryStore(userId, deckId)

    const walk = async (store: ReviewStore) => {
      const out: string[] = []
      let cardId: string | undefined
      let move: SequentialMove = "first"
      for (let i = 0; i < 14; i++) {
        const res = await sequentialCard({ store, userId, deckId, cardId, move })
        if (!res.card) break
        out.push(res.card.id)
        cardId = res.card.id
        move = "next"
      }
      return out
    }

    const fromPrisma = await walk(prismaStore)
    const fromMem = await walk(memStore)
    expect(fromMem).toEqual(fromPrisma)
    expect(fromPrisma.length).toBe(12)
  })
})
