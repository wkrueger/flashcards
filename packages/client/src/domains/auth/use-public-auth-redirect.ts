import { useEffect } from "react"
import { useNavigate } from "@tanstack/react-router"
import { useSession } from "../../infra/auth-client"

export function usePublicAuthRedirect() {
  const navigate = useNavigate()
  const { data, hasSessionHint, isPending } = useSession()
  const shouldRedirect = !!data?.user || (isPending && hasSessionHint)

  useEffect(() => {
    if (!shouldRedirect) return
    navigate({ to: "/", replace: true })
  }, [navigate, shouldRedirect])

  return shouldRedirect
}
