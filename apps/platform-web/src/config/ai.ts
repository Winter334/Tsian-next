export type BrowserAiProviderKind = "openai-compatible" | "gemini" | "claude" | "deepseek"

export interface BrowserAiModelEntry {
  id: string
  label?: string
}

export type BrowserAiReasoningEffort = "" | "minimal" | "low" | "medium" | "high" | "xhigh"

/**
 * How the Agent Runtime asks the model to invoke tools.
 * - `native`: API-native function calling (OpenAI `tools`/`tool_calls`,
 *   Gemini `functionDeclarations`/`functionCall`, Claude `tools`/`tool_use`).
 *   Provides structured text/tool-call event boundaries, enabling streaming.
 * - `text`: the legacy `<tsian-tool-call>` text-embedding protocol. Kept as a
 *   manual fallback for endpoints without native tool support (no streaming).
 * No `auto` mode: the user configures this explicitly per model.
 */
export type BrowserAiToolCallMode = "native" | "text"

export interface BrowserAiModelParameters {
  contextWindow: number | null
  maxOutputTokens: number | null
  temperature: number | null
  topP: number | null
  frequencyPenalty: number | null
  presencePenalty: number | null
  reasoningEffort: BrowserAiReasoningEffort
  customRequestParamsText: string
}

/**
 * A single model configuration inside a provider preset. Each model carries
 * its own parameters because different models often need different context
 * windows or sampling settings. The order in `BrowserAiProviderPreset.models`
 * is the fallback order; the first `enabled` model is the primary.
 */
export interface BrowserAiModelConfig {
  id: string
  label?: string
  parameters: BrowserAiModelParameters
  enabled: boolean
  /**
   * Required tool-call mode for this model. Lives on the model (not the preset
   * or parameters) because support varies per model under one endpoint. Missing
   * on stored data → the model is dropped at read time (prototype-period
   * destructive update, no migration); new models default to `text`.
   */
  toolCallMode: BrowserAiToolCallMode
  /**
   * Whether SSE streaming is enabled for this model. Streaming is native-mode
   * only (`toolCallMode === "native"`); text-protocol models force `false`.
   * Lets the player opt out for endpoints that do not support `stream: true`
   * (e.g. some proxies answer 200 + `text/event-stream` but emit an error body).
   * Missing on stored data → defaulted from `toolCallMode` at read time
   * (native → true, text → false); new models inherit the same default.
   */
  streaming: boolean
}

export type BrowserAiFallbackStrategy = "primary-only" | "ordered"

export interface BrowserAiProviderPreset {
  id: string
  name: string
  baseUrl: string
  apiKey: string
  /** Ordered model configs; the first `enabled` entry is the primary model. */
  models: BrowserAiModelConfig[]
  fallbackStrategy: BrowserAiFallbackStrategy
  fetchedModels: BrowserAiModelEntry[]
  modelsFetchedAt: string
}

/**
 * A provider type groups presets by API format/protocol (e.g. OpenAI-compatible,
 * Gemini, Claude). Each type carries its own preset list; preset ids are
 * globally unique so agent `providerPresetId` selection stays unambiguous.
 */
export interface BrowserAiProviderType {
  id: string
  kind: BrowserAiProviderKind
  name: string
  icon?: string
  presets: BrowserAiProviderPreset[]
}

export interface BrowserAiConfig {
  providerId?: string
  providerName?: string
  /** Provider protocol kind, resolved from the owning BrowserAiProviderType. */
  kind: BrowserAiProviderKind
  baseUrl: string
  apiKey: string
  model: string
  parameters: BrowserAiModelParameters
  /** Tool-call mode, resolved from the primary model's `toolCallMode`. */
  toolCallMode: BrowserAiToolCallMode
  /** Streaming enabled, resolved from the primary model's `streaming`. */
  streaming: boolean
  /**
   * Ordered fallback models (id + parameters) following the primary, when the
   * preset uses the "ordered" strategy. Forward-compatible: the runtime only
   * uses the primary `model`/`parameters` this round; fallback execution is a
   * future concern.
   */
  fallbacks?: Array<{ model: string; parameters: BrowserAiModelParameters }>
}

export interface BrowserPlatformConfigDraft {
  activeProviderId: string
  providerTypes: BrowserAiProviderType[]
  /** 语义检索 embedding 配置(独立段,与 chat providerTypes 平级). */
  embeddingConfig: BrowserEmbeddingConfig
}

/**
 * 语义检索 embedding 配置. 独立于 chat provider:chat 的采样/toolCall/
 * streaming 字段对 embedding 全无意义,给它贴合的小结构比硬塞进 chat
 * 大结构更诚实,且 chat 代码零改动零回归.
 *
 * MVP 只支持 openai-compatible 协议(`POST {baseUrl}/embeddings`,Bearer),
 * 无 kind 字段——玩家配置 OpenAI 兼容端点(硅基流动是其一),无需区分协议.
 * 其它协议用到再加.
 *
 * `dimensions` 必填:维度是向量存储 + cosine 的硬约束,填错致静默 bug.
 * 玩家从模型规格查得后明确填入,比"自动探测可能错"更可控.
 */
export interface BrowserEmbeddingConfig {
  enabled: boolean
  baseUrl: string
  apiKey: string
  model: string
  dimensions: number
}

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

const PLATFORM_CONFIG_STORAGE_KEY = "tsian-platform-config"
const LEGACY_PROVIDER_ID = "local-chat-provider"
const DEFAULT_PROVIDER_NAME = "OpenAI 兼容服务"
const MODEL_FETCH_TIMEOUT_MS = 60_000
const PROTECTED_CUSTOM_REQUEST_KEYS = new Set([
  "apikey",
  "authorization",
  "baseurl",
  "headers",
  "messages",
  "model",
])

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

function normalizeNullableNumber(input: unknown): number | null {
  if (input === null || input === undefined || input === "") {
    return null
  }

  const value = typeof input === "number"
    ? input
    : typeof input === "string"
      ? Number(input.trim())
      : Number.NaN

  return Number.isFinite(value) ? value : null
}

function normalizePositiveInteger(input: unknown): number | null {
  const value = normalizeNullableNumber(input)
  if (value === null || value <= 0) {
    return null
  }

  return Math.floor(value)
}

function normalizeReasoningEffort(input: unknown): BrowserAiReasoningEffort {
  if (
    input === "minimal" ||
    input === "low" ||
    input === "medium" ||
    input === "high" ||
    input === "xhigh"
  ) {
    return input
  }

  return ""
}

function normalizeToolCallMode(input: unknown): BrowserAiToolCallMode | null {
  return input === "native" || input === "text" ? input : null
}

/**
 * Normalize a stored `streaming` flag. `true`/`false` pass through; anything
 * else returns `null` so the caller can apply the toolCallMode-derived default
 * (native → true, text → false). Text-protocol models always force `false`
 * regardless of the stored value, since streaming is native-mode only.
 */
function normalizeStreaming(input: unknown, toolCallMode: BrowserAiToolCallMode): boolean {
  if (toolCallMode === "text") {
    return false
  }
  return input === true || input === "true"
}

export function createDefaultBrowserAiModelParameters(): BrowserAiModelParameters {
  return {
    contextWindow: null,
    maxOutputTokens: null,
    temperature: null,
    topP: null,
    frequencyPenalty: null,
    presencePenalty: null,
    reasoningEffort: "",
    customRequestParamsText: "",
  }
}

function normalizeModelParameters(input: unknown): BrowserAiModelParameters {
  if (typeof input !== "object" || input === null) {
    return createDefaultBrowserAiModelParameters()
  }

  const record = input as Record<string, unknown>
  return {
    contextWindow: normalizePositiveInteger(record.contextWindow),
    maxOutputTokens: normalizePositiveInteger(record.maxOutputTokens ?? record.maxTokens),
    temperature: normalizeNullableNumber(record.temperature),
    topP: normalizeNullableNumber(record.topP ?? record.top_p),
    frequencyPenalty: normalizeNullableNumber(record.frequencyPenalty ?? record.frequency_penalty),
    presencePenalty: normalizeNullableNumber(record.presencePenalty ?? record.presence_penalty),
    reasoningEffort: normalizeReasoningEffort(record.reasoningEffort ?? record.reasoning_effort),
    customRequestParamsText: readStoredText(record.customRequestParamsText),
  }
}

function cloneModelParameters(input: BrowserAiModelParameters): BrowserAiModelParameters {
  return {
    ...input,
  }
}

function normalizeModelConfig(input: unknown): BrowserAiModelConfig | null {
  if (typeof input !== "object" || input === null) {
    return null
  }
  const record = input as Record<string, unknown>
  const id = readStoredText(record.id)
  if (!id) {
    return null
  }
  // Prototype-period destructive update: toolCallMode is required and not
  // migrated. A missing/invalid value drops the model so the user must
  // reconfigure it explicitly (no silent default fallback on the read path).
  const toolCallMode = normalizeToolCallMode(record.toolCallMode)
  if (!toolCallMode) {
    return null
  }
  // streaming defaults from toolCallMode when missing/invalid (native → true,
  // text → false); text-protocol models always force false.
  const streaming = normalizeStreaming(record.streaming, toolCallMode)
  return {
    id,
    label: readStoredText(record.label) || undefined,
    parameters: normalizeModelParameters(record.parameters),
    enabled: record.enabled !== false,
    toolCallMode,
    streaming,
  }
}

function normalizeModelConfigs(input: unknown): BrowserAiModelConfig[] {
  if (!Array.isArray(input)) {
    return []
  }
  const seen = new Set<string>()
  const models: BrowserAiModelConfig[] = []
  for (const item of input) {
    const config = normalizeModelConfig(item)
    if (!config || seen.has(config.id)) {
      continue
    }
    seen.add(config.id)
    models.push(config)
  }
  return models
}

function cloneModelConfig(input: BrowserAiModelConfig): BrowserAiModelConfig {
  return {
    ...input,
    parameters: cloneModelParameters(input.parameters),
  }
}

function normalizeFallbackStrategy(input: unknown): BrowserAiFallbackStrategy {
  return input === "ordered" ? "ordered" : "primary-only"
}

export function createBrowserAiModelConfig(
  input: Partial<BrowserAiModelConfig & { model: string }> = {},
): BrowserAiModelConfig {
  const id = readStoredText(input.id ?? input.model)
  // New models default to the conservative text protocol; an explicit
  // native/text input is honored.
  const toolCallMode = normalizeToolCallMode(input.toolCallMode) ?? "text"
  return {
    id,
    label: readStoredText(input.label) || undefined,
    parameters: normalizeModelParameters(input.parameters),
    enabled: input.enabled !== false,
    toolCallMode,
    // Streaming defaults from toolCallMode: native → true, text → false.
    // An explicit boolean input is honored for native; text always forces false.
    streaming: normalizeStreaming(input.streaming, toolCallMode),
  }
}

function normalizeProviderPreset(input: unknown, index: number): BrowserAiProviderPreset | null {
  if (typeof input !== "object" || input === null) {
    return null
  }

  const record = input as Record<string, unknown>
  const baseUrl = readStoredText(record.baseUrl)
  const apiKey = readStoredText(record.apiKey)
  const legacyDefaultModel = readStoredText(record.defaultModel ?? record.model)
  const id = readStoredText(record.id) || `provider-${index + 1}`
  const name = readStoredText(record.name) || DEFAULT_PROVIDER_NAME

  if (!baseUrl && !apiKey && !legacyDefaultModel && !readStoredText(record.name)) {
    return null
  }

  // Prefer the new `models` array. Fall back to migrating the legacy flat
  // `defaultModel` + top-level `parameters` into a single-model config so
  // already-saved presets upgrade without data loss.
  let models = normalizeModelConfigs(record.models)
  if (models.length === 0 && legacyDefaultModel) {
    models = [
      {
        id: legacyDefaultModel,
        parameters: normalizeModelParameters(record.parameters),
        enabled: true,
        toolCallMode: "text",
        streaming: false,
      },
    ]
  }

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
export function reasoningEffortHintForKind(_kind: BrowserAiProviderKind): string {
  return "以 reasoning_effort 字段发送；请确保你的 API 支持该参数，不支持时选「不发送」并通过自定义请求参数手动指定。"
}

function normalizeProviderType(input: unknown, index: number): BrowserAiProviderType | null {
  if (typeof input !== "object" || input === null) {
    return null
  }
  const record = input as Record<string, unknown>
  const kind = record.kind
  if (kind !== "openai-compatible" && kind !== "gemini" && kind !== "claude" && kind !== "deepseek") {
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
  const baseUrl = readStoredText(input?.baseUrl)
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
      ? [{ id: defaultModel, parameters: createDefaultBrowserAiModelParameters(), enabled: true, toolCallMode: "text", streaming: false }]
      : [],
    fallbackStrategy: "primary-only",
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
    baseUrl,
    apiKey,
    model,
    parameters: createDefaultBrowserAiModelParameters(),
    toolCallMode: "text",
    streaming: false,
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
    baseUrl: provider.baseUrl,
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
    /** Legacy flat parameters, migrated into a single-model config when no `models` are supplied. */
    parameters: BrowserAiModelParameters
  }> = {},
): BrowserAiProviderPreset {
  // Seed models from the new `models` field; fall back to a single-model
  // config derived from a legacy `defaultModel`/`model` seed.
  let models = normalizeModelConfigs(input.models)
  if (models.length === 0) {
    const seedModel = readStoredText(input.defaultModel ?? input.model)
    if (seedModel) {
      models = [
        {
          id: seedModel,
          parameters: normalizeModelParameters(input.parameters),
          enabled: true,
          toolCallMode: "text",
          streaming: false,
        },
      ]
    }
  }

  return {
    id: readStoredText(input.id) || createProviderId(),
    name: readStoredText(input.name) || DEFAULT_PROVIDER_NAME,
    baseUrl: readStoredText(input.baseUrl),
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
  const stored = normalizePlatformConfigDraft(readStoredPlatformConfigDraft())
  const { preset, kind } = findPresetAndKind(stored.providerTypes, stored.activeProviderId)
  return resolveProviderConfig(preset, kind) ?? getEnvAiConfig()
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

  const stored = normalizePlatformConfigDraft(readStoredPlatformConfigDraft())
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
  const stored = normalizePlatformConfigDraft(readStoredPlatformConfigDraft())
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
  const stored = normalizePlatformConfigDraft(readStoredPlatformConfigDraft())
  const { preset } = findPresetAndKind(stored.providerTypes, normalized)
  if (!preset) {
    return []
  }
  return preset.models.map((m) => ({
    id: m.id,
    label: m.label || m.id,
    contextWindow: m.parameters.contextWindow ?? null,
  }))
}

/**
 * List saved provider presets with id and name only (no credentials).
 * Flattened across all provider types; used by Studio/Assistant UI to populate
 * the per-Agent provider dropdown. Preset ids are globally unique.
 */
export function listBrowserAiProviderPresetOptions(): Array<{ id: string; name: string }> {
  const stored = normalizePlatformConfigDraft(readStoredPlatformConfigDraft())
  return allPresets(stored.providerTypes).map((provider) => ({
    id: provider.id,
    name: provider.name || "未命名服务商",
  }))
}

export function getBrowserPlatformConfigDraft(): BrowserPlatformConfigDraft {
  return normalizePlatformConfigDraft(readStoredPlatformConfigDraft())
}

export function saveBrowserPlatformConfigDraft(input: BrowserPlatformConfigDraft): void {
  validateBrowserPlatformConfigDraft(input)
  const normalized = normalizePlatformConfigDraft(input)
  validateBrowserPlatformConfigDraft(normalized)
  writeStoredPlatformConfigDraft(normalized)
}

/**
 * Persist the draft without validation. Used by auto-save so in-progress
 * (possibly incomplete) edits are not lost; validation is enforced at runtime
 * resolve time instead (`resolveProviderConfig` returns null for incomplete
 * presets, falling back to env defaults).
 */
export function saveBrowserPlatformConfigDraftLenient(input: BrowserPlatformConfigDraft): void {
  const normalized = normalizePlatformConfigDraft(input)
  writeStoredPlatformConfigDraft(normalized)
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

/**
 * 读 embeddingConfig(独立段). 总是返回规范化值(未配置时返回默认 disabled),
 * 不做"配全才生效"判断——生效判断用 `resolveEmbeddingConfig`.
 * 与 chat providerTypes 同属一个 localStorage key,但读写独立:这里 read-modify-
 * write 整个 draft,避免两段互相覆盖.
 */
export function getEmbeddingConfig(): BrowserEmbeddingConfig {
  return normalizePlatformConfigDraft(readStoredPlatformConfigDraft()).embeddingConfig
}

/**
 * 写 embeddingConfig(独立段). read-modify-write 整个 draft:保留 chat
 * providerTypes 不动,只替换 embeddingConfig 段. lenient(不跑 chat 校验),
 * 因为玩家可能只配了 embedding 没配 chat;embedding 生效靠 resolveEmbeddingConfig
 * 的严格判断,不靠这里的校验.
 */
export function saveEmbeddingConfig(config: BrowserEmbeddingConfig): void {
  const stored = readStoredPlatformConfigDraft()
  stored.embeddingConfig = config
  // 走 normalize 但绕过 chat 校验:直接写规范化后的 draft.
  const draft: BrowserPlatformConfigDraft = {
    activeProviderId: readStoredText(stored.activeProviderId),
    providerTypes: normalizeProviderTypes(stored.providerTypes),
    embeddingConfig: normalizeEmbeddingConfig(config),
  }
  writeStoredPlatformConfigDraft(draft)
}

function isPlainJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export function parseBrowserAiCustomRequestParams(input: string): Record<string, unknown> {
  const trimmed = input.trim()
  if (!trimmed) {
    return {}
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    throw new Error("自定义请求参数必须是有效的 JSON 对象。")
  }

  if (!isPlainJsonObject(parsed)) {
    throw new Error("自定义请求参数必须是 JSON 对象，不能是数组或其它类型。")
  }

  for (const key of Object.keys(parsed)) {
    if (PROTECTED_CUSTOM_REQUEST_KEYS.has(key.toLowerCase())) {
      throw new Error(`自定义请求参数不能覆盖运行时字段：${key}`)
    }
  }

  return parsed
}

function assertIntegerParameter(value: number | null, label: string): void {
  if (value === null) {
    return
  }
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${label} 必须是大于 0 的整数。`)
  }
}

function assertRangeParameter(
  value: number | null,
  label: string,
  min: number,
  max: number,
): void {
  if (value === null) {
    return
  }
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${label} 必须在 ${min} 到 ${max} 之间。`)
  }
}

export function validateBrowserAiModelParameters(parameters: BrowserAiModelParameters): void {
  assertIntegerParameter(parameters.contextWindow, "上下文窗口")
  assertIntegerParameter(parameters.maxOutputTokens, "最大输出 token")
  assertRangeParameter(parameters.temperature, "温度", 0, 2)
  assertRangeParameter(parameters.topP, "top_p", 0, 2)
  assertRangeParameter(parameters.frequencyPenalty, "频率惩罚", -2, 2)
  assertRangeParameter(parameters.presencePenalty, "存在惩罚", -2, 2)

  if (!["", "minimal", "low", "medium", "high", "xhigh"].includes(parameters.reasoningEffort)) {
    throw new Error("推理程度只能是最低/低/中/高/最高或留空。")
  }

  parseBrowserAiCustomRequestParams(parameters.customRequestParamsText)
}

export function validateBrowserPlatformConfigDraft(input: BrowserPlatformConfigDraft): void {
  for (const type of input.providerTypes) {
    for (const provider of type.presets) {
      if (!Array.isArray(provider.models) || provider.models.length === 0) {
        throw new Error("服务商预设至少需要一个模型配置。")
      }
      for (const model of provider.models) {
        if (!model.parameters) {
          throw new Error("模型参数缺失。")
        }
        if (model.toolCallMode !== "native" && model.toolCallMode !== "text") {
          throw new Error("工具调用模式必须是「原生」或「文本」。")
        }
        // Streaming is native-mode only; text-protocol models cannot stream.
        if (model.toolCallMode === "text" && model.streaming === true) {
          throw new Error("文本工具调用模式不支持流式输出，请先切换为原生模式。")
        }
        validateBrowserAiModelParameters(model.parameters)
      }
    }
  }
}

function buildModelsUrl(baseUrl: string): string {
  const normalized = baseUrl.trim().replace(/\/+$/, "")
  if (!normalized) {
    throw new Error("请先填写接口地址。")
  }

  return `${normalized}/models`
}

/** Build the model-list endpoint URL for a given provider kind. */
function buildModelsUrlForKind(baseUrl: string, kind: BrowserAiProviderKind): string {
  const normalized = baseUrl.trim().replace(/\/+$/, "")
  if (!normalized) {
    throw new Error("请先填写接口地址。")
  }
  if (kind === "gemini") {
    // Gemini v1beta listModels; the API key goes in the query string.
    return `${normalized}/models`
  }
  if (kind === "claude") {
    return `${normalized}/models`
  }
  return `${normalized}/models`
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

/**
 * Extract model entries from a model-list response, accounting for per-kind
 * response shapes. Gemini returns `{ models: [{ name: "models/gemini-..." }] }`;
 * OpenAI/Claude return `{ data: [{ id }] }` or a bare array.
 */
function extractModelEntriesForKind(payload: unknown, kind: BrowserAiProviderKind): BrowserAiModelEntry[] {
  if (kind === "gemini") {
    const models = typeof payload === "object" && payload !== null
      ? (payload as { models?: unknown }).models
      : undefined
    if (!Array.isArray(models)) {
      return []
    }
    const seen = new Set<string>()
    const result: BrowserAiModelEntry[] = []
    for (const item of models) {
      if (typeof item !== "object" || item === null) {
        continue
      }
      const rawName = readStoredText((item as { name?: unknown }).name)
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
    const response = await fetch(buildModelsUrlForKind(provider.baseUrl, kind), {
      method: "GET",
      headers: buildProviderHeadersForKind(kind, apiKey),
      signal: controller.signal,
    })
    const payload = await readJsonPayload(response)

    if (!response.ok) {
      throw new Error(extractErrorMessage(payload) ?? `拉取模型失败，HTTP ${response.status}。`)
    }

    const models = extractModelEntriesForKind(payload, kind)
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
