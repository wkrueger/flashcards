import { useState } from "react"
import { Link, useNavigate } from "@tanstack/react-router"
import {
  authClient,
  googleSsoEnabled,
  sendVerificationEmail,
  signIn,
} from "../../infra/auth-client"
import { Button } from "../../ui/button"
import { Input } from "../../ui/input"
import { Label } from "../../ui/label"

export function LoginPage() {
  const navigate = useNavigate()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [unverified, setUnverified] = useState(false)
  const [resent, setResent] = useState(false)
  const [loading, setLoading] = useState(false)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    setUnverified(false)
    setResent(false)
    const res = await signIn.email({ email, password })
    setLoading(false)
    if (res.error) {
      const code = res.error.code ?? ""
      if (code === "EMAIL_NOT_VERIFIED" || res.error.status === 403) {
        setUnverified(true)
        setError("Please verify your email before logging in.")
      } else {
        setError(res.error.message ?? "Login failed")
      }
      return
    }
    navigate({ to: "/" })
  }

  async function onResend() {
    setResent(false)
    await sendVerificationEmail({ email, callbackURL: "/" })
    setResent(true)
  }

  async function onGoogle() {
    await authClient.signIn.social({ provider: "google", callbackURL: "/" })
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <h1 className="text-xl font-semibold">Log in</h1>
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
      <div className="space-y-1">
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={6}
        />
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {unverified && (
        <div className="space-y-1">
          <Button type="button" variant="outline" className="w-full" onClick={onResend}>
            Resend verification email
          </Button>
          {resent && <p className="text-sm text-muted-foreground">Verification email sent.</p>}
        </div>
      )}
      <Button type="submit" disabled={loading} className="w-full">
        {loading ? "..." : "Log in"}
      </Button>
      {googleSsoEnabled && (
        <Button type="button" variant="outline" className="w-full" onClick={onGoogle}>
          Continue with Google
        </Button>
      )}
      <p className="text-sm text-muted-foreground">
        <Link to="/forgot-password" className="underline">
          Forgot password?
        </Link>
      </p>
      <p className="text-sm text-muted-foreground">
        No account?{" "}
        <Link to="/signup" className="underline">
          Sign up
        </Link>
      </p>
    </form>
  )
}
