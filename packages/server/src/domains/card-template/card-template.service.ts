import { z } from "zod"

const PROMPT_LANGUAGE_NAME: Record<string, string> = {
  deutsch: "German",
}

export function promptLanguageName(languageName: string): string {
  return PROMPT_LANGUAGE_NAME[languageName.trim().toLowerCase()] ?? languageName
}

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
