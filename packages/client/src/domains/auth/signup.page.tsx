import { useState } from "react"
import { Link } from "@tanstack/react-router"
import { authClient, googleSsoEnabled, signUp } from "../../infra/auth-client"
import { Button } from "../../ui/button"
import { Input } from "../../ui/input"
import { Label } from "../../ui/label"

export function SignupPage() {
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [submittedEmail, setSubmittedEmail] = useState<string | null>(null)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    const res = await signUp.email({ name, email, password, callbackURL: "/" })
    setLoading(false)
    if (res.error) {
      setError(res.error.message ?? "Signup failed")
      return
    }
    setSubmittedEmail(email)
  }

  async function onGoogle() {
    await authClient.signIn.social({ provider: "google", callbackURL: "/" })
  }

  if (submittedEmail) {
    return (
      <div className="space-y-3">
        <h1 className="text-xl font-semibold">Check your email</h1>
        <p className="text-sm text-muted-foreground">
          We sent a verification link to <strong>{submittedEmail}</strong>. Click the link to
          activate your account, then log in.
        </p>
        <Link to="/login" className="text-sm underline">
          Back to log in
        </Link>
      </div>
    )
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <h1 className="text-xl font-semibold">Sign up</h1>
      <div className="space-y-1">
        <Label htmlFor="name">Name</Label>
        <Input id="name" value={name} onChange={(e) => setName(e.target.value)} required />
      </div>
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
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={6}
        />
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button type="submit" disabled={loading} className="w-full">
        {loading ? "..." : "Sign up"}
      </Button>
      {googleSsoEnabled && (
        <Button type="button" variant="outline" className="w-full" onClick={onGoogle}>
          Continue with Google
        </Button>
      )}
      <p className="text-sm text-muted-foreground">
        Have an account?{" "}
        <Link to="/login" className="underline">
          Log in
        </Link>
      </p>
    </form>
  )
}
