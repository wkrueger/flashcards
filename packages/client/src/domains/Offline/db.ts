import { openDB, type DBSchema, type IDBPDatabase } from "idb"
import type { LocalReviewResult, OfflineReviewItem, SubjectRow } from "@cards/shared"

// Deck config + selection-relevant subject/card data needed to review a deck with no network.
// Dates are revived from the wire (no tRPC transformer, so they arrive as ISO strings) and stored
// as real Date objects — IndexedDB persists them natively via structured clone.

export interface SnapshotDeck {
  id: string
  name: string
  sequentialEnabled: boolean
  speechRecognitionEnabled: boolean
  speechRecognitionLocale: string | null
  inverseReviewEnabled: boolean
  inverseReviewStreak: number
}

export interface SnapshotCard {
  id: string
  deckId: string
  subjectId: string
  front: string
  back: string
  genTemplate: string | null
  order: number | null
  createdAt: Date
  lastSeenAt: Date | null
  tags: string[]
}

export interface StoredSnapshot {
  deckId: string
  fetchedAt: string
  deck: SnapshotDeck
  subjects: SubjectRow[]
  cards: SnapshotCard[]
}

export interface OfflineDeckMark {
  deckId: string
  lastUpdatedAt: string | null
}

export interface OutboxItem extends OfflineReviewItem {
  deckId: string
}

export interface StoredOutboxItem extends OutboxItem {
  key: number
}

interface CardsDB extends DBSchema {
  offlineDecks: { key: string; value: OfflineDeckMark }
  snapshots: { key: string; value: StoredSnapshot }
  outbox: { key: number; value: OutboxItem }
  session: { key: string; value: unknown }
}

const DB_NAME = "cards-offline"
const DB_VERSION = 1
const SESSION_KEY = "current"

let dbPromise: Promise<IDBPDatabase<CardsDB>> | null = null

function getDb(): Promise<IDBPDatabase<CardsDB>> {
  if (!dbPromise) {
    dbPromise = openDB<CardsDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        db.createObjectStore("offlineDecks", { keyPath: "deckId" })
        db.createObjectStore("snapshots", { keyPath: "deckId" })
        db.createObjectStore("outbox", { autoIncrement: true })
        db.createObjectStore("session")
      },
    })
  }
  return dbPromise
}

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value)
}

function toDateOrNull(value: Date | string | null): Date | null {
  return value == null ? null : toDate(value)
}

type DateLike = Date | string
type RawSubject = Omit<
  SubjectRow,
  "firstSeenAt" | "lastSeenAt" | "lastSeenShuffle" | "cooldownAt" | "createdAt"
> & {
  firstSeenAt: DateLike | null
  lastSeenAt: DateLike | null
  lastSeenShuffle: DateLike | null
  cooldownAt: DateLike
  createdAt: DateLike
}
type RawCard = Omit<SnapshotCard, "createdAt" | "lastSeenAt"> & {
  createdAt: DateLike
  lastSeenAt: DateLike | null
}
export interface RawSnapshot {
  fetchedAt: string
  deck: SnapshotDeck
  subjects: RawSubject[]
  cards: RawCard[]
}

// Convert a raw `offline.snapshot` response (Dates as strings over the wire) into a StoredSnapshot.
export function reviveSnapshot(raw: RawSnapshot): StoredSnapshot {
  return {
    deckId: raw.deck.id,
    fetchedAt: raw.fetchedAt,
    deck: raw.deck,
    subjects: raw.subjects.map((s) => ({
      ...s,
      firstSeenAt: toDateOrNull(s.firstSeenAt),
      lastSeenAt: toDateOrNull(s.lastSeenAt),
      lastSeenShuffle: toDateOrNull(s.lastSeenShuffle),
      cooldownAt: toDate(s.cooldownAt),
      createdAt: toDate(s.createdAt),
    })),
    cards: raw.cards.map((c) => ({
      ...c,
      createdAt: toDate(c.createdAt),
      lastSeenAt: toDateOrNull(c.lastSeenAt),
    })),
  }
}

export async function saveSnapshot(snapshot: StoredSnapshot): Promise<void> {
  const db = await getDb()
  const tx = db.transaction(["snapshots", "offlineDecks"], "readwrite")
  await tx.objectStore("snapshots").put(snapshot)
  await tx
    .objectStore("offlineDecks")
    .put({ deckId: snapshot.deckId, lastUpdatedAt: snapshot.fetchedAt })
  await tx.done
}

export async function getSnapshot(deckId: string): Promise<StoredSnapshot | undefined> {
  return (await getDb()).get("snapshots", deckId)
}

export async function markDeckOffline(deckId: string): Promise<void> {
  const db = await getDb()
  if (await db.get("offlineDecks", deckId)) return
  await db.put("offlineDecks", { deckId, lastUpdatedAt: null })
}

export async function unmarkDeckOffline(deckId: string): Promise<void> {
  const db = await getDb()
  const tx = db.transaction(["offlineDecks", "snapshots"], "readwrite")
  await tx.objectStore("offlineDecks").delete(deckId)
  await tx.objectStore("snapshots").delete(deckId)
  await tx.done
}

export async function listOfflineDecks(): Promise<OfflineDeckMark[]> {
  return (await getDb()).getAll("offlineDecks")
}

export async function isDeckOffline(deckId: string): Promise<boolean> {
  return Boolean(await (await getDb()).get("offlineDecks", deckId))
}

export async function enqueueReview(item: OutboxItem): Promise<void> {
  await (await getDb()).add("outbox", item)
}

export async function getOutbox(): Promise<StoredOutboxItem[]> {
  const db = await getDb()
  const tx = db.transaction("outbox", "readonly")
  const items: StoredOutboxItem[] = []
  let cursor = await tx.store.openCursor()
  while (cursor) {
    items.push({ ...cursor.value, key: cursor.key })
    cursor = await cursor.continue()
  }
  return items
}

export async function deleteOutboxItems(keys: number[]): Promise<void> {
  const db = await getDb()
  const tx = db.transaction("outbox", "readwrite")
  for (const key of keys) await tx.store.delete(key)
  await tx.done
}

export async function saveSession(session: unknown): Promise<void> {
  await (await getDb()).put("session", session, SESSION_KEY)
}

export async function getStoredSession(): Promise<unknown> {
  return (await getDb()).get("session", SESSION_KEY)
}

export async function clearSession(): Promise<void> {
  await (await getDb()).delete("session", SESSION_KEY)
}

// Apply a locally-computed review effect to the stored snapshot so the next offline pick sees the
// updated cooldown/streak. The raw review stays queued in the outbox for authoritative server sync.
export async function applyLocalReviewToSnapshot(
  deckId: string,
  cardId: string,
  result: LocalReviewResult
): Promise<void> {
  const snapshot = await getSnapshot(deckId)
  if (!snapshot) return
  snapshot.subjects = snapshot.subjects.map((s) =>
    s.id === result.subject.id ? result.subject : s
  )
  snapshot.cards = snapshot.cards.map((c) =>
    c.id === cardId ? { ...c, lastSeenAt: result.cardLastSeenAt } : c
  )
  snapshot.deck.inverseReviewStreak = result.deckStreak
  await saveSnapshot(snapshot)
}

// Mark a card seen locally (sequential "advance" with no grade) — mirrors the server's advanceCard,
// which only touches Card.lastSeenAt.
export async function touchCardInSnapshot(
  deckId: string,
  cardId: string,
  lastSeenAt: Date
): Promise<void> {
  const snapshot = await getSnapshot(deckId)
  if (!snapshot) return
  snapshot.cards = snapshot.cards.map((c) => (c.id === cardId ? { ...c, lastSeenAt } : c))
  await saveSnapshot(snapshot)
}
