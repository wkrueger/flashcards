import { createFileRoute } from "@tanstack/react-router"
import { LoginPage } from "../domains/Auth/LoginPage"

export const Route = createFileRoute("/login")({
  component: LoginPage,
})
