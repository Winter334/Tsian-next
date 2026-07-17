import { getPlatformConfig, savePlatformConfig } from "../platform-config"
import {
  DEFAULT_BROWSER_AI_STREAMING,
  DEFAULT_BROWSER_AI_TOOL_CALL_MODE,
  createDefaultBrowserAiModelParameters,
} from "./defaults"
import {
  cloneModelParameters,
  createBrowserAiModelConfig,
  normalizeBrowserAiProviderBaseUrl,
  normalizeFallbackStrategy,
  normalizeModelConfigs,
  normalizeModelEntries,
  normalizePositiveInteger,
  readStoredText,
  validateBrowserPlatformConfigDraft,
} from "./normalize"
import type {
  BrowserAiConfig,
  BrowserAiModelParameters,
  BrowserAiProviderKind,
  BrowserAiProviderPreset,
  BrowserAiProviderType,
  BrowserEmbeddingConfig,
  BrowserPlatformConfigDraft,
} from "./types"

interface LegacyBrowserAiConfig {
  baseUrl: string
  apiKey: string
  model: string
}

interface StoredBrowserPlatformConfigDraft {
  activeProviderId?: unknown
  providerTypes?: unknown
  // Legacy flat shape (pre provider-type rework). Ignored on load — prototype
  // period allows destructive changes, so old data is not migrated.
  providers?: unknown
  chat?: Partial<LegacyBrowserAiConfig>
  /** 语义检索 embedding 配置(独立段,与 providerTypes 平级). 未配置时默认关. */
  embeddingConfig?: unknown
}

const LEGACY_PROVIDER_ID = "local-chat-provider"
const DEFAULT_PROVIDER_NAME = "OpenAI 兼容服务"

function readEnvText(key: string): string {
  const value = import.meta.env[key]
  return typeof value === "string" ? value.trim() : ""
}

function createProviderId(): string {
  const cryptoApi = typeof globalThis !== "undefined" ? globalThis.crypto : undefined
  if (cryptoApi && "randomUUID" in cryptoApi) {
    return cryptoApi.randomUUID()
  }

  return `provider-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function normalizeProviderPreset(input: unknown, index: number): BrowserAiProviderPreset | null {
  if (typeof input !== "object" || input === null) {
    return null
  }

  const record = input as Record<string, unknown>
  const baseUrl = normalizeBrowserAiProviderBaseUrl(readStoredText(record.baseUrl))
  const apiKey = readStoredText(record.apiKey)
  const legacyDefaultModel = readStoredText(record.defaultModel ?? record.model)
  const id = readStoredText(record.id) || `provider-${index + 1}`
  const name = readStoredText(record.name) || DEFAULT_PROVIDER_NAME

  if (!baseUrl && !apiKey && !legacyDefaultModel && !readStoredText(record.name)) {
    return null
  }

  const models = normalizeModelConfigs(record.models)

  return {
    id,
    name,
    baseUrl,
    apiKey,
    models,
    fallbackStrategy: normalizeFallbackStrategy(record.fallbackStrategy),
    fetchedModels: normalizeModelEntries(record.fetchedModels),
    modelsFetchedAt: readStoredText(record.modelsFetchedAt),
  }
}

/** Built-in provider kinds the UI can create a type for. */

export const PROVIDER_TYPE_KINDS: Array<{
  kind: BrowserAiProviderKind
  name: string
  /** Whether this kind's runtime call path is implemented. */
  available: boolean
}> = [
  { kind: "openai-compatible", name: "OpenAI 兼容", available: true },
  { kind: "openai-responses", name: "OpenAI Responses", available: true },
  { kind: "gemini", name: "Gemini", available: true },
  { kind: "claude", name: "Claude", available: true },
  { kind: "deepseek", name: "DeepSeek", available: true },
]

/**
 * User-facing hint shown under the reasoning-effort Select in the model config
 * UI. The effort value is sent as the OpenAI-style `reasoning_effort` field for
 * every provider kind (a convenience shortcut); providers that don't support
 * it should be left on "do not send" and configured via custom request params.
 */
export function reasoningEffortHintForKind(kind: BrowserAiProviderKind): string {
  if (kind === "openai-responses") {
    return "以 reasoning.effort 字段发送；请确保你的 API 支持该参数，不支持时选「不发送」并通过自定义请求参数手动指定。"
  }
  return "以 reasoning_effort 字段发送；请确保你的 API 支持该参数，不支持时选「不发送」并通过自定义请求参数手动指定。"
}

function normalizeProviderType(input: unknown, index: number): BrowserAiProviderType | null {
  if (typeof input !== "object" || input === null) {
    return null
  }
  const record = input as Record<string, unknown>
  const kind = record.kind
  if (
    kind !== "openai-compatible" &&
    kind !== "openai-responses" &&
    kind !== "gemini" &&
    kind !== "claude" &&
    kind !== "deepseek"
  ) {
    return null
  }
  const id = readStoredText(record.id) || kind
  const presets = Array.isArray(record.presets)
    ? record.presets
        .map((preset, presetIndex) => normalizeProviderPreset(preset, presetIndex))
        .filter((preset): preset is BrowserAiProviderPreset => Boolean(preset))
    : []
  return {
    id,
    kind,
    name: readStoredText(record.name) || (PROVIDER_TYPE_KINDS.find((entry) => entry.kind === kind)?.name ?? "未命名类型"),
    icon: readStoredText(record.icon) || undefined,
    presets,
  }
}

function normalizeProviderTypes(input: unknown): BrowserAiProviderType[] {
  const seenIds = new Set<string>()
  const types: BrowserAiProviderType[] = []
  if (Array.isArray(input)) {
    for (const item of input) {
      const type = normalizeProviderType(item, types.length)
      if (!type || seenIds.has(type.id)) {
        continue
      }
      seenIds.add(type.id)
      types.push(type)
    }
  }
  // Built-in provider types are resident: the sidebar always lists every kind
  // in PROVIDER_TYPE_KINDS. Dedupe by kind so a stored custom-id type of the
  // same kind is not duplicated.
  const seenKinds = new Set(types.map((type) => type.kind))
  for (const entry of PROVIDER_TYPE_KINDS) {
    if (seenKinds.has(entry.kind)) {
      continue
    }
    types.push({ id: entry.kind, kind: entry.kind, name: entry.name, presets: [] })
    seenIds.add(entry.kind)
  }
  return types
}

function createDefaultEmbeddingConfig(): BrowserEmbeddingConfig {
  return {
    enabled: false,
    baseUrl: "",
    apiKey: "",
    model: "",
    dimensions: 0,
  }
}

/** 规范化存储的 embeddingConfig;缺失/损坏字段回退默认值. */
function normalizeEmbeddingConfig(input: unknown): BrowserEmbeddingConfig {
  if (typeof input !== "object" || input === null) {
    return createDefaultEmbeddingConfig()
  }
  const record = input as Record<string, unknown>
  const dimensions = normalizePositiveInteger(record.dimensions)
  return {
    enabled: record.enabled === true,
    baseUrl: readStoredText(record.baseUrl),
    apiKey: readStoredText(record.apiKey),
    model: readStoredText(record.model),
    dimensions: dimensions ?? 0,
  }
}

/**
 * 解析生效的 embedding 配置. 严格:enabled && baseUrl && apiKey && model &&
 * dimensions(正整数)全满足才返回,否则 null. null = 索引不生长(能力链关闭).
 * 调用方(embedding-client/search/commit enqueue)据此决定是否调 API.
 */
export function resolveEmbeddingConfig(): BrowserEmbeddingConfig | null {
  const config = getEmbeddingConfig()
  if (!config.enabled) {
    return null
  }
  if (!config.baseUrl || !config.apiKey || !config.model || config.dimensions <= 0) {
    return null
  }
  return config
}

function normalizeLegacyChatDraft(input?: Partial<LegacyBrowserAiConfig>): BrowserAiProviderPreset | null {
  const baseUrl = normalizeBrowserAiProviderBaseUrl(readStoredText(input?.baseUrl))
  const apiKey = readStoredText(input?.apiKey)
  const defaultModel = readStoredText(input?.model)

  if (!baseUrl && !apiKey && !defaultModel) {
    return null
  }

  return {
    id: LEGACY_PROVIDER_ID,
    name: DEFAULT_PROVIDER_NAME,
    baseUrl,
    apiKey,
    models: defaultModel
      ? [createBrowserAiModelConfig({ id: defaultModel })]
      : [],
    fallbackStrategy: "primary-only",
    fetchedModels: [],
    modelsFetchedAt: "",
  }
}

/**
 * 从平台配置 cache 读 draft（同步）。platform-config 的 preheat 已把文件内容
 * merge 进 cache；这里再过一次 normalizePlatformConfigDraft 做深度规范化
 * （providerTypes 内部结构等），防御手动编辑配置文件导致的不规范——幂等，
 * 已规范化的值不变。
 */

function readCachedPlatformConfigDraft(): BrowserPlatformConfigDraft {
  return normalizePlatformConfigDraft(getPlatformConfig().provider as StoredBrowserPlatformConfigDraft)
}

function normalizePlatformConfigDraft(input: StoredBrowserPlatformConfigDraft): BrowserPlatformConfigDraft {
  // Prototype period: the old flat `providers` shape is not migrated. Only the
  // new `providerTypes` structure is read; missing data yields an empty config.
  const providerTypes = normalizeProviderTypes(input.providerTypes)

  // Collect every preset id across types for active-id validation.
  const allPresetIds: string[] = []
  for (const type of providerTypes) {
    for (const preset of type.presets) {
      allPresetIds.push(preset.id)
    }
  }

  const storedActiveProviderId = readStoredText(input.activeProviderId)
  const activeProviderId = allPresetIds.includes(storedActiveProviderId)
    ? storedActiveProviderId
    : allPresetIds[0] ?? ""

  return {
    activeProviderId,
    providerTypes,
    embeddingConfig: normalizeEmbeddingConfig(input.embeddingConfig),
  }
}

/** Flatten every preset across all provider types (preset ids are globally unique). */
function allPresets(types: BrowserAiProviderType[]): BrowserAiProviderPreset[] {
  const result: BrowserAiProviderPreset[] = []
  for (const type of types) {
    result.push(...type.presets)
  }
  return result
}

function findPresetById(types: BrowserAiProviderType[], presetId: string): BrowserAiProviderPreset | undefined {
  for (const type of types) {
    const preset = type.presets.find((item) => item.id === presetId)
    if (preset) {
      return preset
    }
  }
  return undefined
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
    kind: "openai-compatible",
    baseUrl: normalizeBrowserAiProviderBaseUrl(baseUrl),
    apiKey,
    model,
    parameters: createDefaultBrowserAiModelParameters(),
    toolCallMode: DEFAULT_BROWSER_AI_TOOL_CALL_MODE,
    streaming: DEFAULT_BROWSER_AI_STREAMING,
  }
}

function resolveProviderConfig(
  provider: BrowserAiProviderPreset | undefined,
  kind: BrowserAiProviderKind = "openai-compatible",
  /**
   * Optional explicit model id to use as primary instead of the preset
   * strategy (first enabled). Only the desktop assistant passes this
   * (user-selected model from the header sub-dropdown); runtime agents
   * keep the default strategy. When the id doesn't match any model,
   * falls back to the strategy (graceful, no error).
   */
  primaryModelId?: string,
): BrowserAiConfig | null {
  if (!provider?.baseUrl || !provider.apiKey) {
    return null
  }

  // Primary = explicit modelId (if provided and found), else first enabled,
  // else the first model entry as a last resort.
  const explicit =
    primaryModelId
      ? provider.models.find((model) => model.id === primaryModelId)
      : undefined
  const primary =
    explicit
    ?? provider.models.find((model) => model.enabled)
    ?? provider.models[0]
  if (!primary) {
    return null
  }

  // Ordered-strategy fallbacks: enabled models after the primary. Forward-
  // compatible only; the runtime uses `primary` this round.
  const fallbacks =
    provider.fallbackStrategy === "ordered"
      ? provider.models
          .filter((model) => model.enabled && model.id !== primary.id)
          .map((model) => ({ model: model.id, parameters: cloneModelParameters(model.parameters) }))
      : undefined

  return {
    providerId: provider.id,
    providerName: provider.name,
    kind,
    baseUrl: normalizeBrowserAiProviderBaseUrl(provider.baseUrl),
    apiKey: provider.apiKey,
    model: primary.id,
    parameters: cloneModelParameters(primary.parameters),
    toolCallMode: primary.toolCallMode,
    streaming: primary.streaming,
    ...(fallbacks && fallbacks.length > 0 ? { fallbacks } : {}),
  }
}

/** Locate a preset and the kind of its owning type, in one pass. */
function findPresetAndKind(
  types: BrowserAiProviderType[],
  presetId: string,
): { preset: BrowserAiProviderPreset | undefined; kind: BrowserAiProviderKind } {
  for (const type of types) {
    const preset = type.presets.find((item) => item.id === presetId)
    if (preset) {
      return { preset, kind: type.kind }
    }
  }
  return { preset: undefined, kind: "openai-compatible" }
}

export function createBrowserAiProviderPreset(
  input: Partial<Omit<BrowserAiProviderPreset, "parameters"> & {
    model: string
    defaultModel: string
    parameters: BrowserAiModelParameters
  }> = {},
): BrowserAiProviderPreset {
  let models = normalizeModelConfigs(input.models)
  if (models.length === 0) {
    const seedModel = readStoredText(input.defaultModel ?? input.model)
    if (seedModel) {
      models = [
        createBrowserAiModelConfig({ id: seedModel }),
      ]
    }
  }

  return {
    id: readStoredText(input.id) || createProviderId(),
    name: readStoredText(input.name) || DEFAULT_PROVIDER_NAME,
    baseUrl: normalizeBrowserAiProviderBaseUrl(readStoredText(input.baseUrl)),
    apiKey: readStoredText(input.apiKey),
    models,
    fallbackStrategy: normalizeFallbackStrategy(input.fallbackStrategy),
    fetchedModels: normalizeModelEntries(input.fetchedModels),
    modelsFetchedAt: readStoredText(input.modelsFetchedAt),
  }
}

export function createBrowserAiProviderType(kind: BrowserAiProviderKind): BrowserAiProviderType {
  const known = PROVIDER_TYPE_KINDS.find((entry) => entry.kind === kind)
  return {
    id: kind,
    kind,
    name: known?.name ?? "未命名类型",
    presets: [],
  }
}

export function getBrowserAiConfig(): BrowserAiConfig | null {
  const stored = readCachedPlatformConfigDraft()
  const { preset, kind } = findPresetAndKind(stored.providerTypes, stored.activeProviderId)
  return resolveProviderConfig(preset, kind) ?? getEnvAiConfig()
}

export function resolveBrowserAiConfigFromProviderPreset(
  provider: BrowserAiProviderPreset | null | undefined,
  kind: BrowserAiProviderKind,
  primaryModelId?: string | null,
): BrowserAiConfig | null {
  return resolveProviderConfig(provider ?? undefined, kind, primaryModelId?.trim() || undefined)
}

/**
 * Resolve a runtime AI config for a specific provider preset id.
 * Returns null when the preset is missing or incomplete so callers can
 * fall back to the platform-global active provider.
 */
export function resolveBrowserAiConfigForProviderId(providerId: string): BrowserAiConfig | null {
  const normalized = providerId.trim()
  if (!normalized) {
    return null
  }

  const stored = readCachedPlatformConfigDraft()
  const { preset, kind } = findPresetAndKind(stored.providerTypes, normalized)
  return resolveProviderConfig(preset, kind)
}

/**
 * Resolve a BrowserAiConfig with an explicit model id as primary (desktop
 * assistant header sub-dropdown). When modelId is empty or not found in the
 * preset, falls back to the preset strategy (first enabled) — graceful, no
 * error. Runtime agents don't use this; they keep resolveBrowserAiConfigForProviderId.
 */
export function resolveBrowserAiConfigForModel(
  providerId: string,
  modelId: string | null | undefined,
): BrowserAiConfig | null {
  const normalizedProvider = providerId.trim()
  if (!normalizedProvider) {
    return null
  }
  const stored = readCachedPlatformConfigDraft()
  const { preset, kind } = findPresetAndKind(stored.providerTypes, normalizedProvider)
  return resolveProviderConfig(preset, kind, modelId?.trim() || undefined)
}

/**
 * List a preset's model entries (id, label, contextWindow) for UI selectors.
 * Used by the desktop assistant header sub-dropdown to let the user pick a
 * specific model within a provider preset (runtime agents keep the preset
 * strategy and don't call this). Returns empty for unknown/empty preset id.
 */
export function getBrowserAiProviderPresetModels(
  providerId: string,
): Array<{ id: string; label: string; contextWindow: number | null }> {
  const normalized = providerId.trim()
  if (!normalized) {
    return []
  }
  const stored = readCachedPlatformConfigDraft()
  const { preset } = findPresetAndKind(stored.providerTypes, normalized)
  if (!preset) {
    return []
  }
  return preset.models.map((m) => ({
    id: m.id,
    label: m.label || m.id,
    contextWindow: m.parameters.common.contextWindow ?? null,
  }))
}

/**
 * List saved provider presets with id and name only (no credentials).
 * Flattened across all provider types; used by Studio/Assistant UI to populate
 * the per-Agent provider dropdown. Preset ids are globally unique.
 */
export function listBrowserAiProviderPresetOptions(): Array<{ id: string; name: string }> {
  const stored = readCachedPlatformConfigDraft()
  return allPresets(stored.providerTypes).map((provider) => ({
    id: provider.id,
    name: provider.name || "未命名服务商",
  }))
}

export function getBrowserPlatformConfigDraft(): BrowserPlatformConfigDraft {
  return readCachedPlatformConfigDraft()
}

export async function saveBrowserPlatformConfigDraft(input: BrowserPlatformConfigDraft): Promise<void> {
  validateBrowserPlatformConfigDraft(input)
  const normalized = normalizePlatformConfigDraft(input)
  validateBrowserPlatformConfigDraft(normalized)
  await savePlatformConfig({ ...getPlatformConfig(), provider: normalized })
}

/**
 * Persist the draft without validation. Used by auto-save so in-progress
 * (possibly incomplete) edits are not lost; validation is enforced at runtime
 * resolve time instead (`resolveProviderConfig` returns null for incomplete
 * presets, falling back to env defaults).
 */
export async function saveBrowserPlatformConfigDraftLenient(input: BrowserPlatformConfigDraft): Promise<void> {
  const normalized = normalizePlatformConfigDraft(input)
  await savePlatformConfig({ ...getPlatformConfig(), provider: normalized })
}

export async function resetBrowserPlatformConfigDraft(): Promise<void> {
  await savePlatformConfig({
    ...getPlatformConfig(),
    provider: {
      activeProviderId: "",
      providerTypes: [],
      embeddingConfig: { enabled: false, baseUrl: "", apiKey: "", model: "", dimensions: 0 },
    },
  })
}

export function getBrowserPlatformConfigStorageState(): "ready" | "unavailable" {
  // 配置文件后端无"不可用"状态（Dexie 总可用），始终 ready。
  return "ready"
}

/**
 * 读 embeddingConfig(独立段). 总是返回规范化值(未配置时返回默认 disabled),
 * 不做"配全才生效"判断——生效判断用 `resolveEmbeddingConfig`.
 * 与 chat providerTypes 同属配置文件的 provider 段,但读写独立:这里 read-modify-
 * write 整个 provider,避免两段互相覆盖.
 */
export function getEmbeddingConfig(): BrowserEmbeddingConfig {
  return readCachedPlatformConfigDraft().embeddingConfig
}

/**
 * 写 embeddingConfig(独立段). read-modify-write 整个 provider:保留 chat
 * providerTypes 不动,只替换 embeddingConfig 段. lenient(不跑 chat 校验),
 * 因为玩家可能只配了 embedding 没配 chat;embedding 生效靠 resolveEmbeddingConfig
 * 的严格判断,不靠这里的校验.
 */
export async function saveEmbeddingConfig(config: BrowserEmbeddingConfig): Promise<void> {
  const current = readCachedPlatformConfigDraft()
  const draft: BrowserPlatformConfigDraft = {
    activeProviderId: current.activeProviderId,
    providerTypes: current.providerTypes,
    embeddingConfig: normalizeEmbeddingConfig(config),
  }
  await savePlatformConfig({ ...getPlatformConfig(), provider: draft })
}
