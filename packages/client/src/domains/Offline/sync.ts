import { useEffect } from "react"
import { trpcClient } from "../../infra/trpc"
import { deleteOutboxItems, getOutbox, listOfflineDecks, reviveSnapshot, saveSnapshot } from "./db"
import { isOnlineNow, useOnline } from "./useOnline"

let syncing = false

// Push every queued review to the server (replayed in completedAt order there), then drop them
// from the outbox. Skipped items (card deleted online) are also dropped — there's nothing to retry.
export async function flushOutbox(): Promise<number> {
  const items = await getOutbox()
  if (items.length === 0) return 0
  const res = await trpcClient.offline.syncReviews.mutate({
    reviews: items.map(({ deckId: _deckId, key: _key, ...review }) => review),
  })
  await deleteOutboxItems(items.map((i) => i.key))
  return res.synced
}

export async function refreshSnapshot(deckId: string): Promise<void> {
  const raw = await trpcClient.offline.snapshot.query({ deckId })
  await saveSnapshot(reviveSnapshot(raw))
}

export async function refreshAllOfflineSnapshots(): Promise<void> {
  const decks = await listOfflineDecks()
  await Promise.allSettled(decks.map((d) => refreshSnapshot(d.deckId)))
}

// Flush queued reviews first (so the refreshed snapshots reflect them), then re-pull snapshots.
export async function syncOffline(): Promise<void> {
  if (syncing || !isOnlineNow()) return
  syncing = true
  try {
    await flushOutbox()
    await refreshAllOfflineSnapshots()
  } finally {
    syncing = false
  }
}

// Runs a sync whenever connectivity returns (and once on mount when already online).
export function useOfflineSync(): void {
  const online = useOnline()
  useEffect(() => {
    if (online) void syncOffline().catch(() => {})
  }, [online])
}
