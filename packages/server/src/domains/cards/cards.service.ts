import { createHash } from "node:crypto"
import { TagOwnerType } from "../../generated/prisma/client.js"

export const SYSTEM_TAG_OWNER_KEY = "system"
export const SYSTEM_TAG_NAMES = ["gen:bigger", "gen:meaning"] as const

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

export function tagOwnershipFor(userId: string, name: string) {
  if (SYSTEM_TAG_NAMES.includes(name as (typeof SYSTEM_TAG_NAMES)[number])) {
    return {
      ownerType: TagOwnerType.SYSTEM,
      ownerKey: SYSTEM_TAG_OWNER_KEY,
      userId: null,
    }
  }

  return {
    ownerType: TagOwnerType.USER,
    ownerKey: userId,
    userId,
  }
}
