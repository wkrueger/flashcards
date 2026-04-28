import { useLayoutEffect, useRef, useState } from "react"
import { ArrowLeft, Moon, Sun, LogOut, MoreVertical } from "lucide-react"
import { useTheme } from "../infra/theme"
import { Button } from "../ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover"
import { Dialog, DialogClose, DialogContent, DialogHeader, DialogTitle } from "../ui/dialog"
import { signOut, useSession } from "../infra/auth-client"
import { cn } from "../lib/utils"

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh w-full">
      <div className="mx-auto flex min-h-dvh max-w-md flex-col bg-background sm:border-x">
        <main className="flex flex-1 flex-col p-3 pb-[max(env(safe-area-inset-bottom),1.25rem)] sm:pt-8">
          {children}
        </main>
      </div>
    </div>
  )
}

export function PageHeader({
  title,
  subtitle,
  onBack,
  actions,
  menuItems,
}: {
  title?: string
  subtitle?: string
  onBack?: () => void
  actions?: React.ReactNode
  menuItems?: React.ReactNode
}) {
  const measureRef = useRef<HTMLSpanElement>(null)
  const pillRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [stacked, setStacked] = useState(false)

  useLayoutEffect(() => {
    const container = containerRef.current
    const measure = measureRef.current
    const pillEl = pillRef.current
    if (!container || !measure || !pillEl) return
    const check = () => {
      const containerWidth = container.clientWidth
      const titleNatural = measure.offsetWidth
      const pillWidth = pillEl.offsetWidth
      const backWidth = onBack ? 40 + 8 : 0
      const gap = 8
      const fits = backWidth + titleNatural + gap + pillWidth <= containerWidth
      setStacked(!fits)
    }
    check()
    const ro = new ResizeObserver(check)
    ro.observe(container)
    ro.observe(pillEl)
    return () => ro.disconnect()
  }, [title, onBack, actions, menuItems])

  return (
    <div
      ref={containerRef}
      className="relative flex flex-wrap items-center gap-x-2 gap-y-1"
      style={{ viewTransitionName: "page-header" }}
    >
      {!stacked && onBack && (
        <Button variant="ghost" size="icon" aria-label="Back" onClick={onBack}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
      )}
      {!stacked && title ? (
        <h1
          className={cn(
            "min-w-0 flex-1 whitespace-nowrap text-base font-semibold",
            !onBack && "pl-3"
          )}
          style={{ viewTransitionName: "page-title" }}
        >
          {title}
        </h1>
      ) : !stacked && subtitle ? (
        <span className="flex-1 text-xs uppercase text-muted-foreground">{subtitle}</span>
      ) : (
        <span className="flex-1" />
      )}
      <div
        ref={pillRef}
        className="flex items-center gap-0 rounded-full border border-border bg-popover p-0.5 text-xs shadow-md shadow-black/10 backdrop-blur-xl backdrop-saturate-150 [&_a]:rounded-full [&_a]:px-1.5 [&_a]:text-xs [&_button]:rounded-full [&_button]:px-1.5 [&_button]:text-xs dark:border-white/10 dark:bg-popover/60"
      >
        {actions}
        <GlobalMenu menuItems={menuItems} />
      </div>
      {stacked && title && (
        <div className="flex w-full items-center gap-2">
          {onBack && (
            <Button variant="ghost" size="icon" aria-label="Back" onClick={onBack}>
              <ArrowLeft className="h-5 w-5" />
            </Button>
          )}
          <h1
            className={cn("min-w-0 flex-1 break-words text-base font-semibold", !onBack && "pl-3")}
            style={{ viewTransitionName: "page-title" }}
          >
            {title}
          </h1>
        </div>
      )}
      {title && (
        <span
          ref={measureRef}
          aria-hidden="true"
          className="pointer-events-none invisible absolute whitespace-nowrap text-base font-semibold"
        >
          {title}
        </span>
      )}
    </div>
  )
}

export function MenuItem({
  icon,
  children,
  destructive,
  onSelect,
  testId,
}: {
  icon?: React.ReactNode
  children: React.ReactNode
  destructive?: boolean
  onSelect?: () => void
  testId?: string
}) {
  return (
    <button
      data-testid={testId}
      className={cn(
        "flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-[15px] font-medium transition-colors",
        destructive
          ? "text-destructive hover:bg-destructive/10 active:bg-destructive/15"
          : "hover:bg-accent/70 active:bg-accent"
      )}
      onClick={onSelect}
    >
      <span>{children}</span>
      {icon}
    </button>
  )
}

function MenuDivider() {
  return <div className="mx-2 my-1 h-px bg-border/60" />
}

function GlobalMenu({ menuItems }: { menuItems?: React.ReactNode }) {
  const { theme, toggle } = useTheme()
  const { data: session } = useSession()
  const [logoutOpen, setLogoutOpen] = useState(false)
  const [loggingOut, setLoggingOut] = useState(false)
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Menu"
          data-testid="global-menu-trigger"
          className="data-[state=open]:bg-[hsl(var(--accent-strong))]"
        >
          <MoreVertical className="h-5 w-5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={8}
        className="w-56 overflow-hidden rounded-2xl border border-border bg-popover p-1.5 shadow-xl shadow-black/10 backdrop-blur-xl backdrop-saturate-150 dark:border-white/10 dark:bg-popover/60"
      >
        {menuItems && (
          <>
            {menuItems}
            <MenuDivider />
          </>
        )}
        <MenuItem
          icon={
            theme === "dark" ? (
              <Sun className="h-[18px] w-[18px]" />
            ) : (
              <Moon className="h-[18px] w-[18px]" />
            )
          }
          onSelect={toggle}
        >
          {theme === "dark" ? "Light theme" : "Dark theme"}
        </MenuItem>
        {session?.user && (
          <>
            <MenuDivider />
            <MenuItem
              icon={<LogOut className="h-[18px] w-[18px]" />}
              destructive
              testId="logout-menu-item"
              onSelect={() => setLogoutOpen(true)}
            >
              Log out
            </MenuItem>
            <MenuDivider />
            <div className="px-3 py-2">
              <p className="truncate text-[15px] font-medium leading-tight">{session.user.name}</p>
              <p className="truncate text-xs text-muted-foreground">{session.user.email}</p>
            </div>
          </>
        )}
      </PopoverContent>
      <Dialog open={logoutOpen} onOpenChange={setLogoutOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Log out?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            You&apos;ll need to sign in again to access your decks.
          </p>
          <div className="mt-4 flex gap-2">
            <DialogClose asChild>
              <Button variant="outline" className="flex-1" disabled={loggingOut}>
                Cancel
              </Button>
            </DialogClose>
            <Button
              variant="destructive"
              className="flex-1"
              disabled={loggingOut}
              onClick={async () => {
                setLoggingOut(true)
                await signOut()
                window.location.href = "/login"
              }}
            >
              {loggingOut ? "Logging out…" : "Log out"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </Popover>
  )
}
