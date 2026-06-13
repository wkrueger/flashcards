import { useEffect, useState } from "react"
import { createAuthClient } from "better-auth/react"
import { clearSession, getStoredSession, saveSession } from "../domains/Offline/db"

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

const SESSION_TTL_MS = 30_000
let sessionCache: { promise: Promise<SessionResult>; expiresAt: number } | null = null
let cachedData: SessionData = null
const subscribers = new Set<(data: SessionData) => void>()

function notify(data: SessionData) {
  cachedData = data
  for (const cb of subscribers) cb(data)
}

export function getSessionCached(): Promise<SessionResult> {
  const now = Date.now()
  if (!sessionCache || sessionCache.expiresAt < now) {
    sessionCache = {
      promise: authClient
        .getSession()
        .then((res) => {
          notify(res.data)
          // Persist the last good session so the app can boot offline; drop it once logged out.
          if (res.data) void saveSession(res.data)
          else void clearSession()
          return res
        })
        .catch(async (err) => {
          // Network unreachable: fall back to the stored session so the route guard doesn't
          // bounce an offline user to /login. A real logout clears the store, so this only
          // revives a session that was valid when last online.
          const stored = (await getStoredSession()) as SessionData
          if (stored) {
            notify(stored)
            return { data: stored, error: null } as unknown as SessionResult
          }
          sessionCache = null
          notify(null)
          throw err
        }),
      expiresAt: now + SESSION_TTL_MS,
    }
  }
  return sessionCache.promise
}

export function invalidateSessionCache() {
  sessionCache = null
  void clearSession()
  notify(null)
}

export function useSession(): { data: SessionData; isPending: boolean } {
  const [data, setData] = useState<SessionData>(cachedData)
  const [isPending, setIsPending] = useState(cachedData == null)
  useEffect(() => {
    subscribers.add(setData)
    let cancelled = false
    getSessionCached()
      .then((res) => {
        if (!cancelled) {
          setData(res.data)
          setIsPending(false)
        }
      })
      .catch(() => {
        if (!cancelled) setIsPending(false)
      })
    return () => {
      cancelled = true
      subscribers.delete(setData)
    }
  }, [])
  return { data, isPending }
}
