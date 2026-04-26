import { ArrowLeft, Moon, Sun, LogOut, MoreVertical } from "lucide-react"
import { useTheme } from "../infra/theme"
import { Button } from "../ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover"
import { signOut, useSession } from "../infra/auth-client"

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh w-full">
      <div className="mx-auto flex min-h-dvh max-w-md flex-col border-x bg-background">
        <main className="flex-1 p-3 sm:pt-8">{children}</main>
      </div>
    </div>
  )
}

export function PageHeader({
  title,
  subtitle,
  onBack,
  actions,
}: {
  title?: string
  subtitle?: string
  onBack?: () => void
  actions?: React.ReactNode
}) {
  return (
    <div className="flex items-center gap-2">
      {onBack && (
        <Button variant="ghost" size="icon" aria-label="Back" onClick={onBack}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
      )}
      {title ? (
        <h1 className="flex-1 text-xl font-semibold">{title}</h1>
      ) : subtitle ? (
        <span className="flex-1 text-xs uppercase text-muted-foreground">{subtitle}</span>
      ) : (
        <span className="flex-1" />
      )}
      <div className="flex items-center gap-0.5 rounded-full border border-white/20 bg-popover/70 p-0.5 shadow-md shadow-black/10 backdrop-blur-xl backdrop-saturate-150 [&_button]:rounded-full dark:border-white/10 dark:bg-popover/60">
        {actions}
        <GlobalMenu />
      </div>
    </div>
  )
}

function GlobalMenu() {
  const { theme, toggle } = useTheme()
  const { data: session } = useSession()
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Menu">
          <MoreVertical className="h-5 w-5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={8}
        className="w-56 overflow-hidden rounded-2xl border border-white/20 bg-popover/70 p-1.5 shadow-xl shadow-black/10 backdrop-blur-xl backdrop-saturate-150 dark:border-white/10 dark:bg-popover/60"
      >
        <button
          className="flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-[15px] font-medium transition-colors hover:bg-accent/70 active:bg-accent"
          onClick={toggle}
        >
          <span>{theme === "dark" ? "Light theme" : "Dark theme"}</span>
          {theme === "dark" ? (
            <Sun className="h-[18px] w-[18px]" />
          ) : (
            <Moon className="h-[18px] w-[18px]" />
          )}
        </button>
        {session?.user && (
          <>
            <div className="mx-2 my-1 h-px bg-border/60" />
            <button
              className="flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-[15px] font-medium text-destructive transition-colors hover:bg-destructive/10 active:bg-destructive/15"
              onClick={() => signOut().then(() => (window.location.href = "/login"))}
            >
              <span>Log out</span>
              <LogOut className="h-[18px] w-[18px]" />
            </button>
          </>
        )}
      </PopoverContent>
    </Popover>
  )
}
