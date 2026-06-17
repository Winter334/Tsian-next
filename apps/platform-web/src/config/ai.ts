export type BrowserAiProviderKind = "openai-compatible"

export interface BrowserAiModelEntry {
  id: string
  label?: string
}

export interface BrowserAiProviderPreset {
  id: string
  name: string
  kind: BrowserAiProviderKind
  baseUrl: string
  apiKey: string
  defaultModel: string
  fetchedModels: BrowserAiModelEntry[]
  modelsFetchedAt: string
}

export interface BrowserAiConfig {
  providerId?: string
  providerName?: string
  baseUrl: string
  apiKey: string
  model: string
}

export interface BrowserPlatformConfigDraft {
  activeProviderId: string
  providers: BrowserAiProviderPreset[]
}

interface LegacyBrowserAiConfig {
  baseUrl: string
  apiKey: string
  model: string
}

interface StoredBrowserPlatformConfigDraft {
  activeProviderId?: unknown
  providers?: unknown
  chat?: Partial<LegacyBrowserAiConfig>
}

const PLATFORM_CONFIG_STORAGE_KEY = "tsian-platform-config"
const LEGACY_PROVIDER_ID = "local-chat-provider"
const DEFAULT_PROVIDER_NAME = "OpenAI 兼容服务"
const MODEL_FETCH_TIMEOUT_MS = 60_000

function readEnvText(key: string): string {
  const value = import.meta.env[key]
  return typeof value === "string" ? value.trim() : ""
}

function readStoredText(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function getBrowserLocalStorage(): Storage | null {
  if (typeof window !== "undefined" && window.localStorage) {
    return window.localStorage
  }

  if (typeof globalThis !== "undefined" && "localStorage" in globalThis) {
    return (globalThis as { localStorage?: Storage }).localStorage ?? null
  }

  return null
}

function createProviderId(): string {
  const cryptoApi = typeof globalThis !== "undefined" ? globalThis.crypto : undefined
  if (cryptoApi && "randomUUID" in cryptoApi) {
    return cryptoApi.randomUUID()
  }

  return `provider-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function normalizeModelEntries(input: unknown): BrowserAiModelEntry[] {
  if (!Array.isArray(input)) {
    return []
  }

  const seen = new Set<string>()
  const models: BrowserAiModelEntry[] = []

  for (const item of input) {
    const id = typeof item === "string"
      ? item.trim()
      : typeof item === "object" && item !== null
        ? readStoredText((item as { id?: unknown }).id)
        : ""

    if (!id || seen.has(id)) {
      continue
    }

    seen.add(id)
    models.push({ id })
  }

  return models
}

function normalizeProviderPreset(input: unknown, index: number): BrowserAiProviderPreset | null {
  if (typeof input !== "object" || input === null) {
    return null
  }

  const record = input as Record<string, unknown>
  const baseUrl = readStoredText(record.baseUrl)
  const apiKey = readStoredText(record.apiKey)
  const defaultModel = readStoredText(record.defaultModel ?? record.model)
  const id = readStoredText(record.id) || `provider-${index + 1}`
  const name = readStoredText(record.name) || DEFAULT_PROVIDER_NAME

  if (!baseUrl && !apiKey && !defaultModel && !readStoredText(record.name)) {
    return null
  }

  return {
    id,
    name,
    kind: "openai-compatible",
    baseUrl,
    apiKey,
    defaultModel,
    fetchedModels: normalizeModelEntries(record.fetchedModels),
    modelsFetchedAt: readStoredText(record.modelsFetchedAt),
  }
}

function normalizeLegacyChatDraft(input?: Partial<LegacyBrowserAiConfig>): BrowserAiProviderPreset | null {
  const baseUrl = readStoredText(input?.baseUrl)
  const apiKey = readStoredText(input?.apiKey)
  const defaultModel = readStoredText(input?.model)

  if (!baseUrl && !apiKey && !defaultModel) {
    return null
  }

  return {
    id: LEGACY_PROVIDER_ID,
    name: DEFAULT_PROVIDER_NAME,
    kind: "openai-compatible",
    baseUrl,
    apiKey,
    defaultModel,
    fetchedModels: [],
    modelsFetchedAt: "",
  }
}

function readStoredPlatformConfigDraft(): StoredBrowserPlatformConfigDraft {
  const storage = getBrowserLocalStorage()
  if (!storage) {
    return {}
  }

  try {
    const raw = storage.getItem(PLATFORM_CONFIG_STORAGE_KEY)
    if (!raw) {
      return {}
    }

    const parsed = JSON.parse(raw)
    return typeof parsed === "object" && parsed !== null
      ? (parsed as StoredBrowserPlatformConfigDraft)
      : {}
  } catch {
    return {}
  }
}

function writeStoredPlatformConfigDraft(input: BrowserPlatformConfigDraft): void {
  const storage = getBrowserLocalStorage()
  if (!storage) {
    return
  }

  storage.setItem(PLATFORM_CONFIG_STORAGE_KEY, JSON.stringify(input))
}

function normalizePlatformConfigDraft(input: StoredBrowserPlatformConfigDraft): BrowserPlatformConfigDraft {
  const providers = Array.isArray(input.providers)
    ? input.providers
        .map((provider, index) => normalizeProviderPreset(provider, index))
        .filter((provider): provider is BrowserAiProviderPreset => Boolean(provider))
    : []

  if (providers.length === 0) {
    const legacy = normalizeLegacyChatDraft(input.chat)
    if (legacy) {
      providers.push(legacy)
    }
  }

  const storedActiveProviderId = readStoredText(input.activeProviderId)
  const activeProviderId = providers.some((provider) => provider.id === storedActiveProviderId)
    ? storedActiveProviderId
    : providers[0]?.id ?? ""

  return {
    activeProviderId,
    providers,
  }
}

function getEnvAiConfig(): BrowserAiConfig | null {
  const baseUrl = readEnvText("VITE_AI_BASE_URL")
  const apiKey = readEnvText("VITE_AI_API_KEY")
  const model = readEnvText("VITE_AI_MODEL")

  if (!baseUrl || !apiKey || !model) {
    return null
  }

  return {
    providerName: "环境默认",
    baseUrl,
    apiKey,
    model,
  }
}

function resolveProviderConfig(provider: BrowserAiProviderPreset | undefined): BrowserAiConfig | null {
  if (!provider?.baseUrl || !provider.apiKey || !provider.defaultModel) {
    return null
  }

  return {
    providerId: provider.id,
    providerName: provider.name,
    baseUrl: provider.baseUrl,
    apiKey: provider.apiKey,
    model: provider.defaultModel,
  }
}

export function createBrowserAiProviderPreset(
  input: Partial<BrowserAiProviderPreset & { model: string }> = {},
): BrowserAiProviderPreset {
  return {
    id: readStoredText(input.id) || createProviderId(),
    name: readStoredText(input.name) || DEFAULT_PROVIDER_NAME,
    kind: "openai-compatible",
    baseUrl: readStoredText(input.baseUrl),
    apiKey: readStoredText(input.apiKey),
    defaultModel: readStoredText(input.defaultModel ?? input.model),
    fetchedModels: normalizeModelEntries(input.fetchedModels),
    modelsFetchedAt: readStoredText(input.modelsFetchedAt),
  }
}

export function getBrowserAiConfig(): BrowserAiConfig | null {
  const stored = normalizePlatformConfigDraft(readStoredPlatformConfigDraft())
  const activeProvider = stored.providers.find((provider) => provider.id === stored.activeProviderId)
  return resolveProviderConfig(activeProvider) ?? getEnvAiConfig()
}

export function getBrowserPlatformConfigDraft(): BrowserPlatformConfigDraft {
  return normalizePlatformConfigDraft(readStoredPlatformConfigDraft())
}

export function saveBrowserPlatformConfigDraft(input: BrowserPlatformConfigDraft): void {
  writeStoredPlatformConfigDraft(normalizePlatformConfigDraft(input))
}

export function resetBrowserPlatformConfigDraft(): void {
  const storage = getBrowserLocalStorage()
  if (!storage) {
    return
  }

  storage.removeItem(PLATFORM_CONFIG_STORAGE_KEY)
}

export function getBrowserPlatformConfigStorageState(): "ready" | "unavailable" {
  return getBrowserLocalStorage() ? "ready" : "unavailable"
}

function buildModelsUrl(baseUrl: string): string {
  const normalized = baseUrl.trim().replace(/\/+$/, "")
  if (!normalized) {
    throw new Error("请先填写接口地址。")
  }

  return `${normalized}/models`
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
  provider: Pick<BrowserAiProviderPreset, "baseUrl" | "apiKey">,
  options: { signal?: AbortSignal } = {},
): Promise<BrowserAiModelEntry[]> {
  const apiKey = provider.apiKey.trim()
  if (!apiKey) {
    throw new Error("请先填写 API 密钥。")
  }

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
    const response = await fetch(buildModelsUrl(provider.baseUrl), {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      signal: controller.signal,
    })
    const payload = await readJsonPayload(response)

    if (!response.ok) {
      throw new Error(extractErrorMessage(payload) ?? `拉取模型失败，HTTP ${response.status}。`)
    }

    const models = extractModelEntriesFromPayload(payload)
    if (models.length === 0) {
      throw new Error("没有从服务商返回内容中找到可用模型。")
    }

    return models
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
