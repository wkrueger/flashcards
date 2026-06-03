import { useState } from "react"
import { Link } from "@tanstack/react-router"
import { requestPasswordReset } from "../../infra/authClient"
import { Button } from "../../ui/Button"
import { Input } from "../../ui/Input"
import { Label } from "../../ui/Label"

export function ForgotPasswordPage() {
  const [email, setEmail] = useState("")
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    await requestPasswordReset({ email, redirectTo: "/reset-password" })
    setLoading(false)
    setDone(true)
  }

  if (done) {
    return (
      <div className="space-y-3">
        <h1 className="text-xl font-semibold">Check your email</h1>
        <p className="text-sm text-muted-foreground">
          If an account exists for <strong>{email}</strong>, we&apos;ve sent a password reset link.
        </p>
        <Link to="/login" className="text-sm underline">
          Back to log in
        </Link>
      </div>
    )
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <h1 className="text-xl font-semibold">Forgot password</h1>
      <div className="space-y-1">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
      </div>
      <Button type="submit" disabled={loading} className="w-full">
        {loading ? "..." : "Send reset link"}
      </Button>
      <p className="text-sm text-muted-foreground">
        <Link to="/login" className="underline">
          Back to log in
        </Link>
      </p>
    </form>
  )
}
