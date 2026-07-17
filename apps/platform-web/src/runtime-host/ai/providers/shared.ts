import { parseBrowserAiCustomRequestParams, type BrowserAiProviderKind } from "../../../config/ai"

export function putOptionalNumber(
  target: Record<string, unknown>,
  key: string,
  value: number | null,
): void {
  if (typeof value === "number" && Number.isFinite(value)) {
    target[key] = value
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export function enableOpenAiCompatibleStreamUsage(body: Record<string, unknown>, kind: BrowserAiProviderKind): void {
  if (kind !== "openai-compatible") return
  const streamOptions = isRecord(body.stream_options) ? { ...body.stream_options } : {}
  streamOptions.include_usage = true
  body.stream_options = streamOptions
}

export function parseOptionalJsonObjectText(input: string, label: string): Record<string, unknown> | undefined {
  const trimmed = input.trim()
  if (!trimmed) {
    return undefined
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    throw new Error(`${label} must be valid JSON.`)
  }
  if (!isRecord(parsed)) {
    throw new Error(`${label} must be a JSON object.`)
  }
  return parsed
}

export function putOptionalStringArray(
  target: Record<string, unknown>,
  key: string,
  value: string[],
): void {
  const normalized = value.map((item) => item.trim()).filter(Boolean)
  if (normalized.length > 0) {
    target[key] = normalized
  }
}

export function mergeProviderCustomParams(
  body: Record<string, unknown>,
  customRequestParamsText: string,
): Record<string, unknown> {
  return {
    ...parseBrowserAiCustomRequestParams(customRequestParamsText),
    ...body,
  }
}

/**
 * Extract token usage (input/output/total + cache hit/creation) from a provider
 * response payload. Paths differ per provider:
 *
 * - OpenAI / DeepSeek / Claude: usage lives at `payload.usage`.
 * - OpenAI Responses: usage lives at `payload.usage` or
 *   `payload.response.usage` for streaming completed events.
 * - Gemini: usage lives at `payload.usageMetadata` (different key, different
 *   field names). Without this branch Gemini's native API usage is never
 *   extracted — a pre-existing defect this function now fixes.
 *
 * Cache fields (all optional, omitted when the provider doesn't report them):
 * - OpenAI: `usage.prompt_tokens_details.cached_tokens`
 * - OpenAI Responses: `usage.input_tokens_details.cached_tokens`
 * - DeepSeek: `usage.prompt_cache_hit_tokens`
 * - Claude: `usage.cache_read_input_tokens` (+ `cache_creation_input_tokens`)
 * - Gemini: `usageMetadata.cachedContentTokenCount`
 *
 * `kind` is optional for back-compat with any caller that doesn't have it; when
 * omitted, cache fields are not extracted (only input/output/total).
 */
export function extractUsageFromPayload(
  payload: unknown,
  kind?: BrowserAiProviderKind,
): { input?: number; output?: number; total?: number; cached?: number; cacheCreation?: number } | undefined {
  if (typeof payload !== "object" || payload === null) return undefined

  const pickNum = (obj: Record<string, unknown>, key: string): number | undefined => {
    const v = obj[key]
    return typeof v === "number" && Number.isFinite(v) ? v : undefined
  }

  // OpenAI Responses streaming terminal events wrap the final response under
  // `response`; non-streaming responses expose the same usage at top level.
  const response = isRecord(payload) && isRecord(payload.response) ? payload.response : payload
  if (!isRecord(response)) return undefined

  // Gemini: usage lives at payload.usageMetadata with different field names.
  if (kind === "gemini") {
    const um = (payload as { usageMetadata?: unknown }).usageMetadata
    if (typeof um !== "object" || um === null) return undefined
    const u = um as Record<string, unknown>
    const input = pickNum(u, "promptTokenCount")
    const output = pickNum(u, "candidatesTokenCount")
    const total = pickNum(u, "totalTokenCount")
    const cached = pickNum(u, "cachedContentTokenCount")
    if (input === undefined && output === undefined && total === undefined && cached === undefined) {
      return undefined
    }
    return { input, output, total, ...(cached !== undefined ? { cached } : {}) }
  }

  // OpenAI / DeepSeek / Claude: usage at payload.usage.
  const usage = (response as { usage?: unknown }).usage
  if (typeof usage !== "object" || usage === null) return undefined
  const u = usage as Record<string, unknown>

  const input = pickNum(u, "prompt_tokens") ?? pickNum(u, "input_tokens")
  const output = pickNum(u, "completion_tokens") ?? pickNum(u, "output_tokens")
  const total =
    pickNum(u, "total_tokens") ??
    (typeof input === "number" && typeof output === "number" ? input + output : undefined)

  // Cache fields differ per provider kind.
  let cached: number | undefined
  let cacheCreation: number | undefined
  if (kind === "openai-responses") {
    const details = u["input_tokens_details"]
    if (isRecord(details)) {
      cached = pickNum(details, "cached_tokens")
    }
  } else if (kind === "openai-compatible") {
    // OpenAI Chat Completions: nested in prompt_tokens_details.cached_tokens.
    const details = u["prompt_tokens_details"]
    if (isRecord(details)) {
      cached = pickNum(details, "cached_tokens")
    }
  } else if (kind === "deepseek") {
    cached = pickNum(u, "prompt_cache_hit_tokens")
  } else if (kind === "claude") {
    cached = pickNum(u, "cache_read_input_tokens")
    cacheCreation = pickNum(u, "cache_creation_input_tokens")
  }

  if (input === undefined && output === undefined && total === undefined && cached === undefined && cacheCreation === undefined) {
    return undefined
  }
  const result: { input?: number; output?: number; total?: number; cached?: number; cacheCreation?: number } = { input, output, total }
  if (cached !== undefined) result.cached = cached
  if (cacheCreation !== undefined) result.cacheCreation = cacheCreation
  return result
}

export function extractErrorMessage(payload: unknown): string | undefined {
  if (typeof payload !== "object" || payload === null) {
    return undefined
  }

  const error = (payload as { error?: unknown }).error
  if (typeof error !== "object" || error === null) {
    return undefined
  }

  const message = (error as { message?: unknown }).message
  return typeof message === "string" ? message : undefined
}
