import { createAuthClient } from "better-auth/react"

export const authClient = createAuthClient({
  baseURL:
    typeof window !== "undefined"
      ? `${window.location.origin}/api/auth`
      : "http://localhost:5173/api/auth",
})

export const { useSession, signIn, signUp, signOut, sendVerificationEmail, resetPassword } =
  authClient

export const requestPasswordReset = authClient.requestPasswordReset

export const googleSsoEnabled = import.meta.env.VITE_GOOGLE_SSO_ENABLED === "true"
