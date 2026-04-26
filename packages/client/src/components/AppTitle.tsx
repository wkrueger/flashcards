import { cn } from "../lib/utils"

export function AppTitle({ className }: { className?: string }) {
  return (
    <h1
      className={cn("text-center text-5xl", className)}
      style={{
        fontFamily: '"Quicksand", system-ui, sans-serif',
        fontWeight: 700,
        letterSpacing: "-0.01em",
        backgroundImage: "linear-gradient(120deg, #a7f3d0 0%, #34d399 45%, #047857 100%)",
        WebkitBackgroundClip: "text",
        backgroundClip: "text",
        color: "transparent",
        WebkitTextFillColor: "transparent",
      }}
    >
      flashcards
    </h1>
  )
}
