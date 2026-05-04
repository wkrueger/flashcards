import { createRootRoute, Outlet } from "@tanstack/react-router"
import { Toaster } from "sonner"
import { AppShell } from "../components/AppShell"

export const Route = createRootRoute({
  component: () => (
    <>
      <AppShell>
        <Outlet />
      </AppShell>
      <Toaster richColors position="bottom-center" />
    </>
  ),
  errorComponent: ({ error }) => {
    console.log("error comp", error)
    return (
      <>
        <AppShell>
          <div className="space-y-2 py-8 text-center">
            <p className="font-medium text-destructive">Something went wrong</p>
            <p className="text-sm text-muted-foreground">
              {error instanceof Error ? error.message : "An unexpected error occurred."}
            </p>
            <button className="text-sm underline" onClick={() => window.location.replace("/")}>
              Go home
            </button>
          </div>
        </AppShell>
        <Toaster richColors position="bottom-center" />
      </>
    )
  },
})
