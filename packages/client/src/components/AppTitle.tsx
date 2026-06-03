import { cn } from "../Lib/Utils"

export function AppTitle({ className }: { className?: string }) {
  return (
    <h1
      className={cn("app-gradient-text text-center text-5xl", className)}
      style={{
        fontFamily: '"Quicksand", system-ui, sans-serif',
        fontWeight: 700,
        letterSpacing: "-0.01em",
      }}
    >
      flashcards
    </h1>
  )
}
