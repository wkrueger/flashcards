const GENERATED_FRONT_PREFIX: Record<string, string> = {
  "gen:bigger": "📖 ",
  "gen:meaning": "💡 ",
  "review:never-seen": "🌱 ",
}

export function displayWithGeneratedTagPrefix(text: string, tags: readonly string[]) {
  const prefix = Object.entries(GENERATED_FRONT_PREFIX)
    .filter(([tag]) => tags.includes(tag))
    .map(([, emoji]) => emoji)
    .join("")
  return prefix ? `${prefix}${text}` : text
}

export function displayFrontWithGeneratedTagPrefix(front: string, tags: readonly string[]) {
  return displayWithGeneratedTagPrefix(front, tags)
}
