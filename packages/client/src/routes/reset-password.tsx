import { createFileRoute } from "@tanstack/react-router"
import { ResetPasswordPage } from "../domains/Auth/ResetPasswordPage"

type Search = { token?: string; error?: string }

export const Route = createFileRoute("/reset-password")({
  component: ResetPasswordPage,
  validateSearch: (s: Record<string, unknown>): Search => ({
    token: typeof s.token === "string" ? s.token : undefined,
    error: typeof s.error === "string" ? s.error : undefined,
  }),
})
