import { z } from "zod"

export const FIXATION_LEVELS = ["1", "2", "3", "4", "5", "6"] as const
export type FixationLevel = (typeof FIXATION_LEVELS)[number]

export const fixationLevelSchema = z.enum(FIXATION_LEVELS)

const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR

export const COOLDOWN_MS: Record<FixationLevel, number> = {
  "1": 5_000,
  "2": 10 * MIN,
  "3": 12 * HOUR,
  "4": 2 * DAY,
  "5": 7 * DAY,
  "6": 14 * DAY,
}

export const COOLDOWN_LABEL: Record<FixationLevel, string> = {
  "1": "5 s",
  "2": "10 min",
  "3": "12 h",
  "4": "2 days",
  "5": "1 week",
  "6": "2 weeks",
}

export const FIXATION_EMOJI: Record<FixationLevel, string> = {
  "1": "😖",
  "2": "😕",
  "3": "🙂",
  "4": "😀",
  "5": "😎",
  "6": "🤩",
}

export function cooldownFor(level: FixationLevel): number {
  return COOLDOWN_MS[level]
}

export function nextCooldownAt(level: FixationLevel, now = new Date()): Date {
  return new Date(now.getTime() + cooldownFor(level))
}

export function buttonsForPrevious(prev: FixationLevel): FixationLevel[] {
  if (prev === "5" || prev === "6") return ["1", "4", "5", "6"]
  if (prev === "4") return ["1", "3", "4", "5"]
  return ["1", "2", "3", "4"]
}
