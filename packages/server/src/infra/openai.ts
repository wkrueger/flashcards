import { TRPCError } from "@trpc/server"
import OpenAI from "openai"

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

  const model = process.env.OPENAI_MODEL ?? "gpt-5.4"
  const startedAt = performance.now()
  const client = new OpenAI({ apiKey })
  logOpenAI("info", "request_started", {
    model,
    schemaName,
    inputLength: input.length,
  })

  try {
    const response = await client.responses.create({
      model,
      input: [
        { role: "system", content: instructions },
        { role: "user", content: input },
      ],
      text: {
        format: {
          type: "json_schema",
          name: schemaName,
          strict: false,
          schema,
        },
      },
    })

    const durationMs = Math.round(performance.now() - startedAt)
    const outputText = extractOutputText(response)
    if (!outputText) {
      logOpenAI("error", "missing_output", {
        model,
        schemaName,
        durationMs,
        requestId: response._request_id,
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
        durationMs,
        outputLength: outputText.length,
        requestId: response._request_id,
      })
      return parsed
    } catch {
      logOpenAI("error", "invalid_json", {
        model,
        schemaName,
        durationMs,
        outputLength: outputText.length,
        requestId: response._request_id,
      })
      throw new TRPCError({
        code: "BAD_GATEWAY",
        message: "OpenAI response was not valid JSON.",
      })
    }
  } catch (error) {
    if (error instanceof TRPCError) throw error

    const durationMs = Math.round(performance.now() - startedAt)
    let message = "OpenAI request failed."
    let status: number | undefined
    let requestId: string | undefined

    if (error instanceof OpenAI.APIError) {
      message = error.message
      status = error.status
      requestId = error.requestID ?? undefined
    } else if (error instanceof Error) {
      message = error.message
    }

    logOpenAI("error", "request_failed", {
      model,
      schemaName,
      durationMs,
      message,
      requestId,
      status,
    })
    throw new TRPCError({ code: "BAD_GATEWAY", message })
  }
}
