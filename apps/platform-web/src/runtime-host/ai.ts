import type { AiChatMessage, AiDebugRecord } from "@tsian/contracts"

import {
  getBrowserAiConfig,
  getBrowserEmbeddingConfig,
  type BrowserAiConfig,
  type BrowserEmbeddingConfig,
} from "../config/ai"

// B1：调试类型已迁到 @tsian/contracts；此处 re-export 保持原 API
export type { AiChatMessage, AiDebugRecord }

export interface GenerateAssistantReplyOptions {
  debugLabel?: string
  config?: BrowserAiConfig | null
  /**
   * 可选 AbortSignal：透传给 fetch，工作流引擎触发 abort 时可中断在途请求。
   * 仅在请求阶段生效；进入"补丁应用阶段"后由调度器忽略 abort（design.md §13.1）。
   */
  signal?: AbortSignal
}

export interface GenerateEmbeddingOptions {
  debugLabel?: string
  config?: BrowserEmbeddingConfig | null
}

let aiDebugSequence = 0
const aiDebugRecords: AiDebugRecord[] = []
const MAX_AI_DEBUG_RECORDS = 20

function pushAiDebugRecord(record: AiDebugRecord): void {
  aiDebugRecords.unshift(record)
  aiDebugRecords.splice(MAX_AI_DEBUG_RECORDS)
}

function updateAiDebugRecord(id: string, patch: Partial<AiDebugRecord>): void {
  const index = aiDebugRecords.findIndex((record) => record.id === id)
  if (index < 0) {
    return
  }

  aiDebugRecords[index] = {
    ...aiDebugRecords[index],
    ...patch,
  }
}

export function getAiDebugRecords(): AiDebugRecord[] {
  return aiDebugRecords.map((record) => ({
    ...record,
    messages: record.messages?.map((message) => ({ ...message })),
    input: record.input ? [...record.input] : undefined,
  }))
}

function maskSecret(value: string): string {
  if (value.length <= 8) {
    return "***"
  }

  return `${value.slice(0, 4)}…${value.slice(-4)}`
}

function previewText(value: string, maxLength = 1600): string {
  const normalized = value.trim()
  if (normalized.length <= maxLength) {
    return normalized
  }

  return `${normalized.slice(0, maxLength)}\n…[已截断 ${normalized.length - maxLength} 字]`
}

function logDebugGroup(
  title: string,
  payload: Record<string, unknown>,
): void {
  console.groupCollapsed(title)
  console.debug(payload)
  console.groupEnd()
}

function buildChatCompletionsUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/chat/completions`
}

function buildEmbeddingsUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/embeddings`
}

/**
 * B3 / D11：从上游 API 响应解析 token usage。
 *
 * 兼容两种主流字段命名：
 *   - OpenAI 兼容（chat/completions, embeddings）: `usage.prompt_tokens / completion_tokens / total_tokens`
 *   - Anthropic 风格：`usage.input_tokens / output_tokens`
 *
 * 解析不到就返回 undefined，**不估算、不伪造**（fail loud 不适用于"上游字段缺失"，
 * 这是正常容错）。
 */
function extractUsageFromPayload(
  payload: unknown,
): { input?: number; output?: number; total?: number } | undefined {
  if (typeof payload !== "object" || payload === null) return undefined
  const usage = (payload as { usage?: unknown }).usage
  if (typeof usage !== "object" || usage === null) return undefined

  const u = usage as Record<string, unknown>
  const pickNum = (key: string): number | undefined => {
    const v = u[key]
    return typeof v === "number" && Number.isFinite(v) ? v : undefined
  }

  const input = pickNum("prompt_tokens") ?? pickNum("input_tokens")
  const output = pickNum("completion_tokens") ?? pickNum("output_tokens")
  const total =
    pickNum("total_tokens") ??
    (typeof input === "number" && typeof output === "number" ? input + output : undefined)

  if (input === undefined && output === undefined && total === undefined) {
    return undefined
  }
  return { input, output, total }
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
  pushAiDebugRecord({
    id: requestId,
    kind: "chat",
    label: options.debugLabel ?? "chat",
    model: config.model,
    createdAt: new Date().toISOString(),
    messages: messages.map((message) => ({ ...message })),
  })

  logDebugGroup(`[Tsian AI ${requestId}] 请求`, {
    url,
    model: config.model,
    apiKey: maskSecret(config.apiKey),
    messages: messages.map((message, index) => ({
      index,
      role: message.role,
      content: previewText(message.content),
    })),
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
    signal: options.signal,
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
    updateAiDebugRecord(requestId, { error: message })
    throw new Error(message)
  }

  const content = extractAssistantText(payload)
  const usage = extractUsageFromPayload(payload)
  updateAiDebugRecord(requestId, { responseText: content, usage })

  logDebugGroup(`[Tsian AI ${requestId}] 响应`, {
    content: previewText(content, 2400),
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
  pushAiDebugRecord({
    id: requestId,
    kind: "embedding",
    label: options.debugLabel ?? "embed",
    model: config.model,
    createdAt: new Date().toISOString(),
    input: [...input],
  })

  logDebugGroup(`[Tsian Embedding ${requestId}] 请求`, {
    url,
    model: config.model,
    apiKey: maskSecret(config.apiKey),
    inputCount: input.length,
    input: input.map((item, index) => ({
      index,
      content: previewText(item, 500),
    })),
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
    updateAiDebugRecord(requestId, { error: message })
    throw new Error(message)
  }

  const vectors = extractEmbeddingVectors(payload)
  const usage = extractUsageFromPayload(payload)
  updateAiDebugRecord(requestId, {
    vectorCount: vectors.length,
    dimensions: vectors[0]?.length ?? 0,
    usage,
  })

  logDebugGroup(`[Tsian Embedding ${requestId}] 响应`, {
    count: vectors.length,
    dimensions: vectors[0]?.length ?? 0,
  })

  return vectors
}
