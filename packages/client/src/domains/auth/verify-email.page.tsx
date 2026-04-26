import { Link, useSearch } from "@tanstack/react-router"

export function VerifyEmailPage() {
  const search = useSearch({ from: "/verify-email" }) as { error?: string }
  const error = search.error

  if (error) {
    return (
      <div className="space-y-3">
        <h1 className="text-xl font-semibold">Verification failed</h1>
        <p className="text-sm text-muted-foreground">
          The verification link is invalid or has expired. Try logging in to request a new one.
        </p>
        <Link to="/login" className="text-sm underline">
          Back to log in
        </Link>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <h1 className="text-xl font-semibold">Email verified</h1>
      <p className="text-sm text-muted-foreground">Your email is now verified. You can log in.</p>
      <Link to="/login" className="text-sm underline">
        Go to log in
      </Link>
    </div>
  )
}
