import { createFileRoute } from "@tanstack/react-router"
import { ForgotPasswordPage } from "../domains/Auth/ForgotPasswordPage"

export const Route = createFileRoute("/forgot-password")({
  component: ForgotPasswordPage,
})
