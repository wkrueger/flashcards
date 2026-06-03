import { createFileRoute } from "@tanstack/react-router"
import { SignupPage } from "../domains/Auth/SignupPage"

export const Route = createFileRoute("/signup")({
  component: SignupPage,
})
