export interface BrowserAiConfig {
  baseUrl: string
  apiKey: string
  model: string
}

export interface BrowserPlatformConfigDraft {
  chat: BrowserAiConfig
}

interface StoredBrowserPlatformConfigDraft {
  chat?: Partial<BrowserAiConfig>
}

const PLATFORM_CONFIG_STORAGE_KEY = "tsian-platform-config"

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

function normalizeBrowserAiDraft(input?: Partial<BrowserAiConfig>): BrowserAiConfig {
  return {
    baseUrl: readStoredText(input?.baseUrl),
    apiKey: readStoredText(input?.apiKey),
    model: readStoredText(input?.model),
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

export function getBrowserPlatformConfigDraft(): BrowserPlatformConfigDraft {
  const stored = readStoredPlatformConfigDraft()
  return {
    chat: normalizeBrowserAiDraft(stored.chat),
  }
}

export function saveBrowserPlatformConfigDraft(input: BrowserPlatformConfigDraft): void {
  writeStoredPlatformConfigDraft({
    chat: normalizeBrowserAiDraft(input.chat),
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
