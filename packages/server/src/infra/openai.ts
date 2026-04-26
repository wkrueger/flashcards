import { TRPCError } from "@trpc/server"

export interface OpenAIStructuredResponseOptions {
  instructions: string
  input: string
  schemaName: string
  schema: Record<string, unknown>
}

function logOpenAI(level: "info" | "error", event: string, meta: Record<string, unknown>) {
  const payload = JSON.stringify({
    component: "openai",
    event,
    ...meta,
  })
  if (level === "error") console.error(payload)
  else console.info(payload)
}

function extractOutputText(response: unknown): string | null {
  if (
    response &&
    typeof response === "object" &&
    "output_text" in response &&
    typeof response.output_text === "string"
  ) {
    return response.output_text
  }

  if (!response || typeof response !== "object" || !("output" in response)) return null
  const output = response.output
  if (!Array.isArray(output)) return null

  for (const item of output) {
    if (!item || typeof item !== "object" || !("content" in item)) continue
    const content = item.content
    if (!Array.isArray(content)) continue
    for (const part of content) {
      if (part && typeof part === "object" && "text" in part && typeof part.text === "string") {
        return part.text
      }
    }
  }

  return null
}

export async function createOpenAIStructuredResponse({
  instructions,
  input,
  schemaName,
  schema,
}: OpenAIStructuredResponseOptions): Promise<unknown> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    logOpenAI("error", "missing_api_key", { schemaName })
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "OPENAI_API_KEY is not configured.",
    })
  }

  const model = process.env.OPENAI_MODEL ?? "gpt-5-mini"
  const startedAt = performance.now()
  logOpenAI("info", "request_started", {
    model,
    schemaName,
    inputLength: input.length,
  })

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      input: [
        { role: "system", content: instructions },
        { role: "user", content: input },
      ],
      text: {
        format: {
          type: "json_schema",
          name: schemaName,
          strict: true,
          schema,
        },
      },
    }),
  })

  const durationMs = Math.round(performance.now() - startedAt)
  const payload = (await response.json().catch(() => null)) as unknown

  if (!response.ok) {
    let message = "OpenAI request failed."
    if (
      payload &&
      typeof payload === "object" &&
      "error" in payload &&
      payload.error &&
      typeof payload.error === "object" &&
      "message" in payload.error &&
      typeof payload.error.message === "string"
    ) {
      message = payload.error.message
    }
    logOpenAI("error", "request_failed", {
      model,
      schemaName,
      status: response.status,
      durationMs,
      message,
    })
    throw new TRPCError({ code: "BAD_GATEWAY", message })
  }

  const outputText = extractOutputText(payload)
  if (!outputText) {
    logOpenAI("error", "missing_output", {
      model,
      schemaName,
      status: response.status,
      durationMs,
    })
    throw new TRPCError({
      code: "BAD_GATEWAY",
      message: "OpenAI response did not include structured output.",
    })
  }

  try {
    const parsed = JSON.parse(outputText) as unknown
    logOpenAI("info", "request_succeeded", {
      model,
      schemaName,
      status: response.status,
      durationMs,
      outputLength: outputText.length,
    })
    return parsed
  } catch {
    logOpenAI("error", "invalid_json", {
      model,
      schemaName,
      status: response.status,
      durationMs,
      outputLength: outputText.length,
    })
    throw new TRPCError({
      code: "BAD_GATEWAY",
      message: "OpenAI response was not valid JSON.",
    })
  }
}
