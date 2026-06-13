import { useCallback, useEffect, useState } from "react"
import { listOfflineDecks, markDeckOffline, unmarkDeckOffline } from "./db"
import { refreshSnapshot } from "./sync"
import { useOnline } from "./useOnline"

export interface OfflineDeckControls {
  online: boolean
  isOffline: boolean
  lastUpdatedAt: string | null
  busy: boolean
  enable: () => Promise<void>
  disable: () => Promise<void>
  refresh: () => Promise<void>
}

// Per-deck offline availability for the deck-detail UI: mark/unmark a deck for offline use and pull
// (or refresh) its snapshot. Marking is device-local, so it lives in IndexedDB, not on the server.
export function useOfflineDeck(deckId: string): OfflineDeckControls {
  const online = useOnline()
  const [isOffline, setIsOffline] = useState(false)
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const reload = useCallback(async () => {
    const mark = (await listOfflineDecks()).find((d) => d.deckId === deckId)
    setIsOffline(Boolean(mark))
    setLastUpdatedAt(mark?.lastUpdatedAt ?? null)
  }, [deckId])

  useEffect(() => {
    void reload()
  }, [reload])

  const run = useCallback(
    async (action: () => Promise<void>) => {
      setBusy(true)
      try {
        await action()
      } finally {
        await reload()
        setBusy(false)
      }
    },
    [reload]
  )

  return {
    online,
    isOffline,
    lastUpdatedAt,
    busy,
    enable: () =>
      run(async () => {
        await markDeckOffline(deckId)
        await refreshSnapshot(deckId)
      }),
    disable: () => run(() => unmarkDeckOffline(deckId)),
    refresh: () => run(() => refreshSnapshot(deckId)),
  }
}
