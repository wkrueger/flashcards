const GENERATED_FRONT_PREFIX: Record<string, string> = {
  "gen:bigger": "📖 ",
  "gen:meaning": "💡 ",
}

export function displayWithGeneratedTagPrefix(text: string, tags: readonly string[]) {
  const tag = Object.keys(GENERATED_FRONT_PREFIX).find((candidate) => tags.includes(candidate))
  return tag ? `${GENERATED_FRONT_PREFIX[tag]}${text}` : text
}

export function displayFrontWithGeneratedTagPrefix(front: string, tags: readonly string[]) {
  return displayWithGeneratedTagPrefix(front, tags)
}
