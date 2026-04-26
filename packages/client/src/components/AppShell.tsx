import { Moon, Sun, LogOut } from "lucide-react"
import { useTheme } from "../infra/theme"
import { Button } from "../ui/button"
import { signOut, useSession } from "../infra/auth-client"

export function AppShell({ children }: { children: React.ReactNode }) {
  const { theme, toggle } = useTheme()
  const { data: session } = useSession()
  return (
    <div className="min-h-screen w-full">
      <div className="mx-auto flex min-h-screen max-w-md flex-col border-x bg-background">
        <header className="flex items-center justify-between border-b p-3">
          <div />
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" onClick={toggle} aria-label="Toggle theme">
              {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </Button>
            {session?.user && (
              <Button
                variant="ghost"
                size="icon"
                aria-label="Log out"
                onClick={() => signOut().then(() => (window.location.href = "/login"))}
              >
                <LogOut className="h-4 w-4" />
              </Button>
            )}
          </div>
        </header>
        <main className="flex-1 p-3">{children}</main>
      </div>
    </div>
  )
}
