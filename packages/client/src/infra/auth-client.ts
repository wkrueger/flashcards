import { useEffect, useState } from "react"
import { createAuthClient } from "better-auth/react"

export const authClient = createAuthClient({
  baseURL:
    typeof window !== "undefined"
      ? `${window.location.origin}/api/auth`
      : "http://localhost:5173/api/auth",
})

export const { signIn, signUp, signOut, sendVerificationEmail, resetPassword } = authClient

export const requestPasswordReset = authClient.requestPasswordReset

export const googleSsoEnabled = import.meta.env.VITE_GOOGLE_SSO_ENABLED === "true"

type SessionResult = Awaited<ReturnType<typeof authClient.getSession>>
type SessionData = SessionResult["data"]
type SessionSnapshot = {
  data: SessionData
  hasSessionHint: boolean
  isPending: boolean
}

const SESSION_TTL_MS = 30_000
const SESSION_HINT_KEY = "cards.session.has-auth"
let sessionCache: { promise: Promise<SessionResult>; expiresAt: number } | null = null
let sessionSnapshot: SessionSnapshot = {
  data: null,
  hasSessionHint: readSessionHint(),
  isPending: true,
}
const subscribers = new Set<(snapshot: SessionSnapshot) => void>()

function readSessionHint() {
  if (typeof window === "undefined") return false
  return window.localStorage.getItem(SESSION_HINT_KEY) === "1"
}

function writeSessionHint(hasSessionHint: boolean) {
  if (typeof window === "undefined") return
  if (hasSessionHint) {
    window.localStorage.setItem(SESSION_HINT_KEY, "1")
    return
  }
  window.localStorage.removeItem(SESSION_HINT_KEY)
}

function notify(nextSnapshot: SessionSnapshot) {
  sessionSnapshot = nextSnapshot
  writeSessionHint(nextSnapshot.hasSessionHint)
  for (const cb of subscribers) cb(nextSnapshot)
}

function resolveSession(data: SessionData) {
  notify({
    data,
    hasSessionHint: !!data?.user,
    isPending: false,
  })
}

export function getSessionCached(): Promise<SessionResult> {
  const now = Date.now()
  if (!sessionCache || sessionCache.expiresAt < now) {
    sessionCache = {
      promise: authClient
        .getSession()
        .then((res) => {
          resolveSession(res.data)
          return res
        })
        .catch((err) => {
          sessionCache = null
          notify({
            data: null,
            hasSessionHint: false,
            isPending: false,
          })
          throw err
        }),
      expiresAt: now + SESSION_TTL_MS,
    }
  }
  return sessionCache.promise
}

export function primeSessionRefresh(hasSessionHint = true) {
  sessionCache = null
  notify({
    data: null,
    hasSessionHint,
    isPending: true,
  })
}

export function invalidateSessionCache() {
  sessionCache = null
  notify({
    data: null,
    hasSessionHint: false,
    isPending: false,
  })
}

export function useSession(): SessionSnapshot {
  const [snapshot, setSnapshot] = useState(sessionSnapshot)

  useEffect(() => {
    subscribers.add(setSnapshot)
    let cancelled = false
    getSessionCached()
      .then((res) => {
        if (!cancelled) resolveSession(res.data)
      })
      .catch(() => {})
    return () => {
      cancelled = true
      subscribers.delete(setSnapshot)
    }
  }, [])

  return snapshot
}
