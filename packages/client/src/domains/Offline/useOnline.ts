import { useEffect, useState } from "react"

// Network status from the browser plus a lightweight reachability probe. `navigator.onLine` only
// tells us the OS thinks it has a link; the probe catches captive portals / a dead backend.
const subscribers = new Set<(online: boolean) => void>()
let current = typeof navigator === "undefined" ? true : navigator.onLine

function setOnline(value: boolean) {
  if (value === current) return
  current = value
  for (const cb of subscribers) cb(value)
}

export async function probeReachable(): Promise<boolean> {
  try {
    // Probe /trpc: it's same-origin wherever the app works (the app already calls it) and is never
    // service-worker cached, so any resolved response — even a 4xx — means the backend is reachable.
    // Only a thrown network error means we're truly offline.
    await fetch("/trpc", { method: "HEAD", cache: "no-store" })
    return true
  } catch {
    return false
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("online", () => {
    setOnline(true)
    void probeReachable().then(setOnline)
  })
  window.addEventListener("offline", () => setOnline(false))
}

export function useOnline(): boolean {
  const [online, setLocal] = useState(current)
  useEffect(() => {
    subscribers.add(setLocal)
    setLocal(current)
    return () => {
      subscribers.delete(setLocal)
    }
  }, [])
  return online
}

export function isOnlineNow(): boolean {
  return current
}
