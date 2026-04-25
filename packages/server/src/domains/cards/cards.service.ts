import { createHash } from "node:crypto"

export function hashFront(front: string): string {
  return createHash("sha256").update(front).digest("hex")
}
