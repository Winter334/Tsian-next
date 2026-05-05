export interface BrowserAiConfig {
  baseUrl: string
  apiKey: string
  model: string
}

export interface BrowserEmbeddingConfig {
  baseUrl: string
  apiKey: string
  model: string
}

export interface BrowserPlatformConfigDraft {
  chat: BrowserAiConfig
  retrieval: BrowserAiConfig
  embedding: BrowserEmbeddingConfig
  retrievalSettings: BrowserRetrievalSettings
}

interface StoredBrowserPlatformConfigDraft {
  chat?: Partial<BrowserAiConfig>
  retrieval?: Partial<BrowserAiConfig>
  embedding?: Partial<BrowserEmbeddingConfig>
  retrievalSettings?: Partial<BrowserRetrievalSettings>
}

export interface BrowserRetrievalSettings {
  aiEnhanced: boolean
  recentMessageLimit: number
  maxCandidates: number
  maxCatalogInjected: number
  minCatalogEventScore: number
  baseSeedEventLimit: number
  complexSeedEventLimit: number
  complexEntityThreshold: number
  maxChainNeighborsPerSeed: number
  maxInjectedEvents: number
  minSeedScore: number
  bridgeEntityLimit: number
  minBridgeEntityScore: number
  semanticEventLimit: number
  semanticArchiveLimit: number
  semanticScoreThreshold: number
}

export const DEFAULT_BROWSER_RETRIEVAL_SETTINGS: BrowserRetrievalSettings = {
  aiEnhanced: false,
  recentMessageLimit: 6,
  maxCandidates: 12,
  maxCatalogInjected: 2,
  minCatalogEventScore: 20,
  baseSeedEventLimit: 2,
  complexSeedEventLimit: 3,
  complexEntityThreshold: 6,
  maxChainNeighborsPerSeed: 1,
  maxInjectedEvents: 8,
  minSeedScore: 3,
  bridgeEntityLimit: 6,
  minBridgeEntityScore: 2,
  semanticEventLimit: 3,
  semanticArchiveLimit: 4,
  semanticScoreThreshold: 0.72,
}

const PLATFORM_CONFIG_STORAGE_KEY = "tsian-platform-config"

function readEnvText(key: string): string {
  const value = import.meta.env[key]
  return typeof value === "string" ? value.trim() : ""
}

function readEnvInteger(key: string, fallback: number): number {
  const value = Number.parseInt(readEnvText(key), 10)
  return Number.isFinite(value) && value >= 0 ? value : fallback
}

function readEnvNumber(key: string, fallback: number): number {
  const value = Number.parseFloat(readEnvText(key))
  return Number.isFinite(value) && value >= 0 ? value : fallback
}

function readEnvBoolean(key: string, fallback: boolean): boolean {
  const value = readEnvText(key).toLowerCase()
  if (["1", "true", "yes", "on"].includes(value)) {
    return true
  }
  if (["0", "false", "no", "off"].includes(value)) {
    return false
  }
  return fallback
}

function readStoredText(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function readStoredInteger(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.trunc(value)
    : fallback
}

function readStoredNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : fallback
}

function readStoredBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback
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

function emptyBrowserAiConfig(): BrowserAiConfig {
  return {
    baseUrl: "",
    apiKey: "",
    model: "",
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

function writeStoredPlatformConfigDraft(input: StoredBrowserPlatformConfigDraft): void {
  const storage = getBrowserLocalStorage()
  if (!storage) {
    return
  }

  storage.setItem(PLATFORM_CONFIG_STORAGE_KEY, JSON.stringify(input))
}

function normalizeBrowserAiDraft(input?: Partial<BrowserAiConfig>): BrowserAiConfig {
  return {
    baseUrl: readStoredText(input?.baseUrl),
    apiKey: readStoredText(input?.apiKey),
    model: readStoredText(input?.model),
  }
}

function normalizeBrowserRetrievalSettings(
  input: Partial<BrowserRetrievalSettings> | undefined,
  fallback: BrowserRetrievalSettings,
): BrowserRetrievalSettings {
  return {
    aiEnhanced: readStoredBoolean(input?.aiEnhanced, fallback.aiEnhanced),
    recentMessageLimit: readStoredInteger(input?.recentMessageLimit, fallback.recentMessageLimit),
    maxCandidates: readStoredInteger(input?.maxCandidates, fallback.maxCandidates),
    maxCatalogInjected: readStoredInteger(input?.maxCatalogInjected, fallback.maxCatalogInjected),
    minCatalogEventScore: readStoredInteger(
      input?.minCatalogEventScore,
      fallback.minCatalogEventScore,
    ),
    baseSeedEventLimit: readStoredInteger(input?.baseSeedEventLimit, fallback.baseSeedEventLimit),
    complexSeedEventLimit: readStoredInteger(
      input?.complexSeedEventLimit,
      fallback.complexSeedEventLimit,
    ),
    complexEntityThreshold: readStoredInteger(
      input?.complexEntityThreshold,
      fallback.complexEntityThreshold,
    ),
    maxChainNeighborsPerSeed: readStoredInteger(
      input?.maxChainNeighborsPerSeed,
      fallback.maxChainNeighborsPerSeed,
    ),
    maxInjectedEvents: readStoredInteger(input?.maxInjectedEvents, fallback.maxInjectedEvents),
    minSeedScore: readStoredInteger(input?.minSeedScore, fallback.minSeedScore),
    bridgeEntityLimit: readStoredInteger(input?.bridgeEntityLimit, fallback.bridgeEntityLimit),
    minBridgeEntityScore: readStoredInteger(
      input?.minBridgeEntityScore,
      fallback.minBridgeEntityScore,
    ),
    semanticEventLimit: readStoredInteger(input?.semanticEventLimit, fallback.semanticEventLimit),
    semanticArchiveLimit: readStoredInteger(
      input?.semanticArchiveLimit,
      fallback.semanticArchiveLimit,
    ),
    semanticScoreThreshold: readStoredNumber(
      input?.semanticScoreThreshold,
      fallback.semanticScoreThreshold,
    ),
  }
}

function readEnvRetrievalSettings(): BrowserRetrievalSettings {
  const defaults = DEFAULT_BROWSER_RETRIEVAL_SETTINGS
  return {
    aiEnhanced: readEnvBoolean("VITE_RETRIEVAL_AI_ENHANCED", defaults.aiEnhanced),
    recentMessageLimit: readEnvInteger(
      "VITE_RETRIEVAL_RECENT_MESSAGE_LIMIT",
      defaults.recentMessageLimit,
    ),
    maxCandidates: readEnvInteger("VITE_RETRIEVAL_MAX_CANDIDATES", defaults.maxCandidates),
    maxCatalogInjected: readEnvInteger(
      "VITE_RETRIEVAL_MAX_CATALOG_INJECTED",
      defaults.maxCatalogInjected,
    ),
    minCatalogEventScore: readEnvInteger(
      "VITE_RETRIEVAL_MIN_CATALOG_EVENT_SCORE",
      defaults.minCatalogEventScore,
    ),
    baseSeedEventLimit: readEnvInteger(
      "VITE_RETRIEVAL_BASE_SEED_EVENT_LIMIT",
      defaults.baseSeedEventLimit,
    ),
    complexSeedEventLimit: readEnvInteger(
      "VITE_RETRIEVAL_COMPLEX_SEED_EVENT_LIMIT",
      defaults.complexSeedEventLimit,
    ),
    complexEntityThreshold: readEnvInteger(
      "VITE_RETRIEVAL_COMPLEX_ENTITY_THRESHOLD",
      defaults.complexEntityThreshold,
    ),
    maxChainNeighborsPerSeed: readEnvInteger(
      "VITE_RETRIEVAL_MAX_CHAIN_NEIGHBORS_PER_SEED",
      defaults.maxChainNeighborsPerSeed,
    ),
    maxInjectedEvents: readEnvInteger(
      "VITE_RETRIEVAL_MAX_INJECTED_EVENTS",
      defaults.maxInjectedEvents,
    ),
    minSeedScore: readEnvInteger("VITE_RETRIEVAL_MIN_SEED_SCORE", defaults.minSeedScore),
    bridgeEntityLimit: readEnvInteger(
      "VITE_RETRIEVAL_BRIDGE_ENTITY_LIMIT",
      defaults.bridgeEntityLimit,
    ),
    minBridgeEntityScore: readEnvInteger(
      "VITE_RETRIEVAL_MIN_BRIDGE_ENTITY_SCORE",
      defaults.minBridgeEntityScore,
    ),
    semanticEventLimit: readEnvInteger(
      "VITE_RETRIEVAL_SEMANTIC_EVENT_LIMIT",
      defaults.semanticEventLimit,
    ),
    semanticArchiveLimit: readEnvInteger(
      "VITE_RETRIEVAL_SEMANTIC_ARCHIVE_LIMIT",
      defaults.semanticArchiveLimit,
    ),
    semanticScoreThreshold: readEnvNumber(
      "VITE_RETRIEVAL_SEMANTIC_SCORE_THRESHOLD",
      defaults.semanticScoreThreshold,
    ),
  }
}

export function getBrowserAiConfig(): BrowserAiConfig | null {
  const stored = readStoredPlatformConfigDraft()
  const chat = normalizeBrowserAiDraft(stored.chat)
  const baseUrl = chat.baseUrl || readEnvText("VITE_AI_BASE_URL")
  const apiKey = chat.apiKey || readEnvText("VITE_AI_API_KEY")
  const model = chat.model || readEnvText("VITE_AI_MODEL")

  if (!baseUrl || !apiKey || !model) {
    return null
  }

  return {
    baseUrl,
    apiKey,
    model,
  }
}

export function getBrowserRetrievalConfig(): BrowserAiConfig | null {
  const stored = readStoredPlatformConfigDraft()
  const retrieval = normalizeBrowserAiDraft(stored.retrieval)
  const main = getBrowserAiConfig()
  const baseUrl =
    retrieval.baseUrl || readEnvText("VITE_RETRIEVAL_BASE_URL") || main?.baseUrl || ""
  const apiKey =
    retrieval.apiKey || readEnvText("VITE_RETRIEVAL_API_KEY") || main?.apiKey || ""
  const model = retrieval.model || readEnvText("VITE_RETRIEVAL_MODEL") || main?.model || ""

  if (!baseUrl || !apiKey || !model) {
    return null
  }

  return {
    baseUrl,
    apiKey,
    model,
  }
}

export function getBrowserEmbeddingConfig(): BrowserEmbeddingConfig | null {
  const stored = readStoredPlatformConfigDraft()
  const embedding = normalizeBrowserAiDraft(stored.embedding)
  const main = getBrowserAiConfig()
  const baseUrl =
    embedding.baseUrl || readEnvText("VITE_EMBED_BASE_URL") || main?.baseUrl || ""
  const apiKey =
    embedding.apiKey || readEnvText("VITE_EMBED_API_KEY") || main?.apiKey || ""
  const model = embedding.model || readEnvText("VITE_EMBED_MODEL")

  if (!baseUrl || !apiKey || !model) {
    return null
  }

  return {
    baseUrl,
    apiKey,
    model,
  }
}

export function getBrowserRetrievalSettings(): BrowserRetrievalSettings {
  const envSettings = readEnvRetrievalSettings()
  const stored = readStoredPlatformConfigDraft()
  return normalizeBrowserRetrievalSettings(stored.retrievalSettings, envSettings)
}

export function getBrowserPlatformConfigDraft(): BrowserPlatformConfigDraft {
  const stored = readStoredPlatformConfigDraft()
  return {
    chat: normalizeBrowserAiDraft(stored.chat),
    retrieval: normalizeBrowserAiDraft(stored.retrieval),
    embedding: normalizeBrowserAiDraft(stored.embedding),
    retrievalSettings: normalizeBrowserRetrievalSettings(
      stored.retrievalSettings,
      getBrowserRetrievalSettings(),
    ),
  }
}

export function saveBrowserPlatformConfigDraft(input: BrowserPlatformConfigDraft): void {
  // 平台设置当前只做浏览器本地覆盖，不改环境变量，不引入额外后端。
  writeStoredPlatformConfigDraft({
    chat: normalizeBrowserAiDraft(input.chat),
    retrieval: normalizeBrowserAiDraft(input.retrieval),
    embedding: normalizeBrowserAiDraft(input.embedding),
    retrievalSettings: normalizeBrowserRetrievalSettings(
      input.retrievalSettings,
      DEFAULT_BROWSER_RETRIEVAL_SETTINGS,
    ),
  })
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
