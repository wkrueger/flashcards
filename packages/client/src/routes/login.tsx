import { createFileRoute } from "@tanstack/react-router"
import { LoginPage } from "../domains/auth/login.page"

export const Route = createFileRoute("/login")({
  component: LoginPage,
})
