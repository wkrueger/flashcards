import { ArrowLeft, Moon, Sun, LogOut, MoreVertical } from "lucide-react"
import { useTheme } from "../infra/theme"
import { Button } from "../ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover"
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
  return (
    <div className="flex items-center gap-2" style={{ viewTransitionName: "page-header" }}>
      {onBack && (
        <Button variant="ghost" size="icon" aria-label="Back" onClick={onBack}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
      )}
      {title ? (
        <h1
          className="flex-1 text-xl font-semibold"
          style={{ viewTransitionName: "page-title" }}
        >
          {title}
        </h1>
      ) : subtitle ? (
        <span className="flex-1 text-xs uppercase text-muted-foreground">{subtitle}</span>
      ) : (
        <span className="flex-1" />
      )}
      <div className="flex items-center gap-0.5 rounded-full border border-white/20 bg-popover/70 p-0.5 shadow-md shadow-black/10 backdrop-blur-xl backdrop-saturate-150 [&_button]:rounded-full dark:border-white/10 dark:bg-popover/60">
        {actions}
        <GlobalMenu menuItems={menuItems} />
      </div>
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
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Menu" data-testid="global-menu-trigger">
          <MoreVertical className="h-5 w-5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={8}
        className="w-56 overflow-hidden rounded-2xl border border-white/20 bg-popover/70 p-1.5 shadow-xl shadow-black/10 backdrop-blur-xl backdrop-saturate-150 dark:border-white/10 dark:bg-popover/60"
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
              onSelect={() => signOut().then(() => (window.location.href = "/login"))}
            >
              Log out
            </MenuItem>
          </>
        )}
      </PopoverContent>
    </Popover>
  )
}
