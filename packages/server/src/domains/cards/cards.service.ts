import { createHash } from "node:crypto"

export function hashFront(front: string): string {
  return createHash("sha256").update(front).digest("hex")
}

export function normalizeCardTags(tags: string[]): string[] {
  const seen = new Set<string>()
  const normalized: string[] = []

  for (const tag of tags) {
    const value = tag.trim().toLowerCase()
    if (!value || seen.has(value)) continue
    seen.add(value)
    normalized.push(value)
  }

  return normalized
}
