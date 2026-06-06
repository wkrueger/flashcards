const GENERATED_FRONT_PREFIX: Record<string, string> = {
  "gen:bigger": "📖 ",
  "gen:meaning": "💡 ",
  "review:never-seen": "🌱 ",
}

// Emoji prefix for the given tags, rendered as a separate element rather than
// concatenated into the markdown source (which would break leading block
// syntax such as `## heading`).
export function generatedTagPrefix(tags: readonly string[]): string {
  return Object.entries(GENERATED_FRONT_PREFIX)
    .filter(([tag]) => tags.includes(tag))
    .map(([, emoji]) => emoji)
    .join("")
}
