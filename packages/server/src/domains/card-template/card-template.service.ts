import { z } from "zod"

export const cardTemplatePreviewOutput = z.object({
  cards: z
    .array(
      z.object({
        front: z.string().trim().min(1),
        back: z.string().trim().min(1),
      })
    )
    .min(1)
    .max(5),
})
