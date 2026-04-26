import { createFileRoute } from "@tanstack/react-router"
import { VerifyEmailPage } from "../domains/auth/verify-email.page"

type Search = { error?: string }

export const Route = createFileRoute("/verify-email")({
  component: VerifyEmailPage,
  validateSearch: (s: Record<string, unknown>): Search => ({
    error: typeof s.error === "string" ? s.error : undefined,
  }),
})
