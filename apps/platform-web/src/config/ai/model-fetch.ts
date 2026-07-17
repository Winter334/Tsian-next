import {
  normalizeBrowserAiProviderBaseUrl,
  normalizeModelEntries,
  readStoredText,
} from "./normalize"
import type {
  BrowserAiModelEntry,
  BrowserAiProviderKind,
  BrowserAiProviderPreset,
} from "./types"

const MODEL_FETCH_TIMEOUT_MS = 60_000
const MODEL_FETCH_MAX_PAGES = 10

function buildModelsUrlForKind(baseUrl: string, kind: BrowserAiProviderKind, pageToken?: string): string {
  const normalized = normalizeBrowserAiProviderBaseUrl(baseUrl)
  if (!normalized) {
    throw new Error("请先填写接口地址。")
  }
  const url = new URL(`${normalized}/models`)
  if (kind === "gemini") {
    url.searchParams.set("pageSize", "1000")
    if (pageToken) {
      url.searchParams.set("pageToken", pageToken)
    }
  }
  return url.toString()
}

/** Auth + metadata headers for a model-list / chat request, per kind. */
function buildProviderHeadersForKind(
  kind: BrowserAiProviderKind,
  apiKey: string,
  extra: Record<string, string> = {},
): Record<string, string> {
  if (kind === "gemini") {
    return { "x-goog-api-key": apiKey, ...extra }
  }
  if (kind === "claude") {
    return { "x-api-key": apiKey, "anthropic-version": "2023-06-01", ...extra }
  }
  return { Authorization: `Bearer ${apiKey}`, ...extra }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function extractGeminiNextPageToken(payload: unknown): string {
  return isRecord(payload) && typeof payload.nextPageToken === "string"
    ? payload.nextPageToken.trim()
    : ""
}

/**
 * Extract model entries from a model-list response, accounting for per-kind
 * response shapes. Gemini returns `{ models: [{ name: "models/gemini-..." }] }`;
 * OpenAI/Claude return `{ data: [{ id }] }` or a bare array.
 */
function extractModelEntriesForKind(payload: unknown, kind: BrowserAiProviderKind): BrowserAiModelEntry[] {
  if (kind === "gemini") {
    const models = isRecord(payload) ? payload.models : undefined
    if (!Array.isArray(models)) {
      return []
    }
    const seen = new Set<string>()
    const result: BrowserAiModelEntry[] = []
    for (const item of models) {
      if (!isRecord(item)) {
        continue
      }
      const supportedMethods = item.supportedGenerationMethods
      if (Array.isArray(supportedMethods) && !supportedMethods.includes("generateContent")) {
        continue
      }
      const rawName = readStoredText(item.name)
      // Gemini names look like "models/gemini-1.5-flash"; strip the prefix.
      const id = rawName.replace(/^models\//, "").trim()
      if (!id || seen.has(id)) {
        continue
      }
      seen.add(id)
      result.push({ id })
    }
    return result
  }
  return extractModelEntriesFromPayload(payload)
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError"
}

async function readJsonPayload(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch (error) {
    if (isAbortError(error)) {
      throw error
    }
    return null
  }
}

function extractErrorMessage(payload: unknown): string | undefined {
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

function extractModelEntriesFromPayload(payload: unknown): BrowserAiModelEntry[] {
  const source = typeof payload === "object" && payload !== null && Array.isArray((payload as { data?: unknown }).data)
    ? (payload as { data: unknown[] }).data
    : payload

  return normalizeModelEntries(source)
}

export async function fetchBrowserAiProviderModels(
  provider: Pick<BrowserAiProviderPreset, "baseUrl" | "apiKey"> & { kind?: BrowserAiProviderKind },
  options: { signal?: AbortSignal } = {},
): Promise<BrowserAiModelEntry[]> {
  const apiKey = provider.apiKey.trim()
  if (!apiKey) {
    throw new Error("请先填写 API 密钥。")
  }
  const kind: BrowserAiProviderKind = provider.kind ?? "openai-compatible"

  const controller = new AbortController()
  const abortFromParent = () => {
    controller.abort(options.signal?.reason)
  }

  if (options.signal?.aborted) {
    abortFromParent()
  } else {
    options.signal?.addEventListener("abort", abortFromParent, { once: true })
  }

  const timeoutId = setTimeout(() => {
    controller.abort(new Error("拉取模型超时，请检查接口地址或网络。"))
  }, MODEL_FETCH_TIMEOUT_MS)

  try {
    const allModels: BrowserAiModelEntry[] = []
    const seen = new Set<string>()
    let pageToken = ""

    for (let page = 0; page < MODEL_FETCH_MAX_PAGES; page += 1) {
      const response = await fetch(buildModelsUrlForKind(provider.baseUrl, kind, pageToken), {
        method: "GET",
        headers: buildProviderHeadersForKind(kind, apiKey),
        signal: controller.signal,
      })
      const payload = await readJsonPayload(response)

      if (!response.ok) {
        throw new Error(extractErrorMessage(payload) ?? `拉取模型失败，HTTP ${response.status}。`)
      }

      for (const model of extractModelEntriesForKind(payload, kind)) {
        if (seen.has(model.id)) {
          continue
        }
        seen.add(model.id)
        allModels.push(model)
      }

      if (kind !== "gemini") {
        break
      }
      pageToken = extractGeminiNextPageToken(payload)
      if (!pageToken) {
        break
      }
    }

    if (allModels.length === 0) {
      throw new Error("没有从服务商返回内容中找到可用模型。")
    }

    return allModels
  } catch (error) {
    if (controller.signal.aborted && !options.signal?.aborted) {
      throw new Error("拉取模型超时，请检查接口地址或网络。")
    }
    throw error
  } finally {
    clearTimeout(timeoutId)
    options.signal?.removeEventListener("abort", abortFromParent)
  }
}
