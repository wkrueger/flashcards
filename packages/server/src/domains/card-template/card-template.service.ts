import { z } from "zod"

const cardTemplateVariant = z.enum(["basic", "bigger", "meaning"])

export const cardTemplatePreviewOutput = z.object({
  cards: z
    .array(
      z.object({
        front: z.string().trim().min(1),
        back: z.string().trim().min(1),
        variant: cardTemplateVariant,
      })
    )
    .min(1)
    .max(5),
})

export function tagsForCardTemplateVariant(variant: z.infer<typeof cardTemplateVariant>) {
  if (variant === "bigger") return ["gen:bigger"]
  if (variant === "meaning") return ["gen:meaning"]
  return []
}
