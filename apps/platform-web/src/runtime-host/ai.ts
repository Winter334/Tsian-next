import {
  getBrowserAiConfig,
  getBrowserEmbeddingConfig,
  type BrowserAiConfig,
  type BrowserEmbeddingConfig,
} from "../config/ai"

export interface AiChatMessage {
  role: "user" | "assistant" | "system"
  content: string
}

export interface GenerateAssistantReplyOptions {
  debugLabel?: string
  config?: BrowserAiConfig | null
}

export interface GenerateEmbeddingOptions {
  debugLabel?: string
  config?: BrowserEmbeddingConfig | null
}

let aiDebugSequence = 0

function buildChatCompletionsUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/chat/completions`
}

function buildEmbeddingsUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/embeddings`
}

function extractAssistantText(payload: unknown): string {
  if (
    typeof payload === "object" &&
    payload !== null &&
    "choices" in payload &&
    Array.isArray(payload.choices) &&
    payload.choices.length > 0
  ) {
    const message = payload.choices[0]?.message
    const content = message?.content

    if (typeof content === "string") {
      return content
    }

    if (Array.isArray(content)) {
      return content
        .map((item) => {
          if (typeof item?.text === "string") {
            return item.text
          }
          return ""
        })
        .join("")
        .trim()
    }
  }

  throw new Error("AI response format is not supported.")
}

export async function generateAssistantReply(
  messages: AiChatMessage[],
  options: GenerateAssistantReplyOptions = {},
): Promise<string> {
  const config = options.config ?? getBrowserAiConfig()

  if (!config) {
    throw new Error(
      "AI config is missing. Please set VITE_AI_BASE_URL, VITE_AI_API_KEY and VITE_AI_MODEL.",
    )
  }

  const requestId = `${options.debugLabel ?? "chat"}-${++aiDebugSequence}`
  const url = buildChatCompletionsUrl(config.baseUrl)

  console.debug(`[Tsian AI ${requestId}] request`, {
    url,
    model: config.model,
    messages,
  })

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      messages,
    }),
  })

  const payload = await response.json().catch(() => null)

  if (!response.ok) {
    console.warn(`[Tsian AI ${requestId}] error`, {
      status: response.status,
      payload,
    })
    const message =
      typeof payload?.error?.message === "string"
        ? payload.error.message
        : `AI request failed with status ${response.status}.`
    throw new Error(message)
  }

  const content = extractAssistantText(payload)

  console.debug(`[Tsian AI ${requestId}] response`, {
    content,
    payload,
  })

  return content
}

function extractEmbeddingVectors(payload: unknown): number[][] {
  if (
    typeof payload === "object" &&
    payload !== null &&
    "data" in payload &&
    Array.isArray(payload.data)
  ) {
    return payload.data
      .map((item) => {
        if (
          typeof item === "object" &&
          item !== null &&
          "embedding" in item &&
          Array.isArray(item.embedding) &&
          item.embedding.every((value: unknown) => typeof value === "number")
        ) {
          return item.embedding as number[]
        }
        return null
      })
      .filter((item): item is number[] => Array.isArray(item))
  }

  throw new Error("Embedding response format is not supported.")
}

export async function generateEmbeddings(
  input: string[],
  options: GenerateEmbeddingOptions = {},
): Promise<number[][]> {
  const config = options.config ?? getBrowserEmbeddingConfig()

  if (!config) {
    throw new Error(
      "Embedding config is missing. Please set VITE_EMBED_MODEL and optional VITE_EMBED_BASE_URL / VITE_EMBED_API_KEY.",
    )
  }

  const requestId = `${options.debugLabel ?? "embed"}-${++aiDebugSequence}`
  const url = buildEmbeddingsUrl(config.baseUrl)

  console.debug(`[Tsian AI ${requestId}] request`, {
    url,
    model: config.model,
    input,
  })

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      input,
    }),
  })

  const payload = await response.json().catch(() => null)

  if (!response.ok) {
    console.warn(`[Tsian AI ${requestId}] error`, {
      status: response.status,
      payload,
    })
    const message =
      typeof payload?.error?.message === "string"
        ? payload.error.message
        : `Embedding request failed with status ${response.status}.`
    throw new Error(message)
  }

  const vectors = extractEmbeddingVectors(payload)

  console.debug(`[Tsian AI ${requestId}] response`, {
    count: vectors.length,
    dimensions: vectors[0]?.length ?? 0,
  })

  return vectors
}
