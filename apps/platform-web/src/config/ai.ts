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

function readEnvText(key: string): string {
  const value = import.meta.env[key]
  return typeof value === "string" ? value.trim() : ""
}

export function getBrowserAiConfig(): BrowserAiConfig | null {
  const baseUrl = readEnvText("VITE_AI_BASE_URL")
  const apiKey = readEnvText("VITE_AI_API_KEY")
  const model = readEnvText("VITE_AI_MODEL")

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
  const main = getBrowserAiConfig()
  const baseUrl = readEnvText("VITE_RETRIEVAL_BASE_URL") || main?.baseUrl || ""
  const apiKey = readEnvText("VITE_RETRIEVAL_API_KEY") || main?.apiKey || ""
  const model = readEnvText("VITE_RETRIEVAL_MODEL") || main?.model || ""

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
  const main = getBrowserAiConfig()
  const baseUrl = readEnvText("VITE_EMBED_BASE_URL") || main?.baseUrl || ""
  const apiKey = readEnvText("VITE_EMBED_API_KEY") || main?.apiKey || ""
  const model = readEnvText("VITE_EMBED_MODEL")

  if (!baseUrl || !apiKey || !model) {
    return null
  }

  return {
    baseUrl,
    apiKey,
    model,
  }
}
