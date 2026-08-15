export type BrowserAiProviderKind = "openai-compatible" | "openai-responses" | "gemini" | "claude" | "deepseek"

export interface BrowserAiModelEntry {
  id: string
  label?: string
}

export type BrowserAiReasoningEffort = "" | "minimal" | "low" | "medium" | "high" | "xhigh"

/**
 * How the Agent Runtime asks the model to invoke tools.
 * - `native`: API-native function calling (OpenAI Chat Completions
 *   `tools`/`tool_calls`, OpenAI Responses `tools`/`function_call`, Gemini
 *   `functionDeclarations`/`functionCall`, Claude `tools`/`tool_use`).
 *   Provides structured text/tool-call event boundaries, enabling streaming.
 * - `text`: Text Tool Protocol v2 carried in ordinary chat text. The model
 *   emits `<tsian-tool-calls>` JSON arrays, and the runtime parses them after
 *   each response round. Streaming is supported by accumulating the full text
 *   and parsing protocol blocks post-hoc.
 * No `auto` mode: the user configures this explicitly per model.
 */
export type BrowserAiToolCallMode = "native" | "text"

export const DEFAULT_BROWSER_AI_TOOL_CALL_MODE: BrowserAiToolCallMode = "native"
export const DEFAULT_BROWSER_AI_STREAMING: boolean = true

export interface BrowserAiCommonModelParameters {
  contextWindow: number | null
  maxOutputTokens: number | null
  temperature: number | null
  topP: number | null
}

export interface BrowserOpenAiCompatibleModelParameters {
  frequencyPenalty: number | null
  presencePenalty: number | null
  reasoningEffort: BrowserAiReasoningEffort
  customRequestParamsText: string
}

export interface BrowserOpenAiResponsesModelParameters {
  reasoningEffort: BrowserAiReasoningEffort
  customRequestParamsText: string
}

export interface BrowserDeepSeekModelParameters {
  frequencyPenalty: number | null
  presencePenalty: number | null
  reasoningEffort: BrowserAiReasoningEffort
  customRequestParamsText: string
}

export interface BrowserGeminiModelParameters {
  topK: number | null
  frequencyPenalty: number | null
  presencePenalty: number | null
  stopSequences: string[]
  responseMimeType: string
  responseSchemaText: string
  thinkingBudget: number | null
  includeThoughts: boolean
  customRequestParamsText: string
}

export type BrowserClaudeThinkingMode = "disabled" | "adaptive" | "enabled"
export type BrowserClaudeThinkingDisplay = "summarized" | "omitted"
export type BrowserClaudeServiceTier = "" | "auto" | "standard_only"

export interface BrowserClaudeModelParameters {
  topK: number | null
  stopSequences: string[]
  serviceTier: BrowserClaudeServiceTier
  promptCachingEnabled: boolean
  thinkingMode: BrowserClaudeThinkingMode
  thinkingBudgetTokens: number | null
  thinkingDisplay: BrowserClaudeThinkingDisplay
  customRequestParamsText: string
}

export interface BrowserAiProviderModelParameters {
  openaiCompatible?: BrowserOpenAiCompatibleModelParameters
  openaiResponses?: BrowserOpenAiResponsesModelParameters
  deepseek?: BrowserDeepSeekModelParameters
  gemini?: BrowserGeminiModelParameters
  claude?: BrowserClaudeModelParameters
}

export interface BrowserAiModelParameters {
  common: BrowserAiCommonModelParameters
  provider: BrowserAiProviderModelParameters
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
   * destructive update, no migration); new models default to native.
   */
  toolCallMode: BrowserAiToolCallMode
  /**
   * Whether SSE streaming is enabled for this model. Both native and text
   * tool-call modes support streaming. Lets the player opt out for endpoints
   * that do not support `stream: true` (e.g. some proxies answer 200 +
   * `text/event-stream` but emit an error body). Missing on stored data →
   * false on the read path for compatibility; new models default to streaming.
   * Text-mode streaming uses post-hoc parsing (accumulate buffer, parse at
   * round end) instead of incremental tag-boundary state machines.
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
