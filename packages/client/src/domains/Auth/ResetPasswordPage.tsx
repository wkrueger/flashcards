import { useState } from "react"
import { Link, useNavigate, useSearch } from "@tanstack/react-router"
import { resetPassword } from "../../infra/auth-client"
import { Button } from "../../ui/button"
import { Input } from "../../ui/input"
import { Label } from "../../ui/label"

export function ResetPasswordPage() {
  const navigate = useNavigate()
  const search = useSearch({ from: "/reset-password" }) as { token?: string; error?: string }
  const token = search.token
  const linkError = search.error

  const [password, setPassword] = useState("")
  const [confirm, setConfirm] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  if (linkError || !token) {
    return (
      <div className="space-y-3">
        <h1 className="text-xl font-semibold">Reset link invalid</h1>
        <p className="text-sm text-muted-foreground">
          This password reset link is invalid or has expired.
        </p>
        <Link to="/forgot-password" className="text-sm underline">
          Request a new link
        </Link>
      </div>
    )
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (password !== confirm) {
      setError("Passwords do not match")
      return
    }
    setLoading(true)
    setError(null)
    const res = await resetPassword({ newPassword: password, token })
    setLoading(false)
    if (res.error) {
      setError(res.error.message ?? "Reset failed")
      return
    }
    navigate({ to: "/login" })
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <h1 className="text-xl font-semibold">Reset password</h1>
      <div className="space-y-1">
        <Label htmlFor="password">New password</Label>
        <Input
          id="password"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={6}
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="confirm">Confirm password</Label>
        <Input
          id="confirm"
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          required
          minLength={6}
        />
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button type="submit" disabled={loading} className="w-full">
        {loading ? "..." : "Update password"}
      </Button>
    </form>
  )
}
