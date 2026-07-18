import type { ContentPart, JsonValue } from "./runtime"

export interface AiChatMessage {
  role: "user" | "assistant" | "system"
  content: string | ContentPart[]
}

export type AiDebugMessageStability = "stable" | "semi-stable" | "dynamic"

/**
 * AI provider kind, mirrored from platform-web `config/ai.ts` `BrowserAiProviderKind`.
 * Inlined here to avoid a contracts → platform-web import cycle. Keep in sync if
 * the platform-web type changes.
 */
export type AiDebugProviderKind = "openai-compatible" | "openai-responses" | "gemini" | "claude" | "deepseek"

export interface AiDebugMessageSegment {
  index: number
  role: "user" | "assistant" | "system" | "tool"
  label: string
  stability: AiDebugMessageStability
  charLength: number
  preview: string
  imagePartCount?: number
}

export interface AiDebugRecord {
  id: string
  kind: "chat"
  label: string
  model: string
  /** Provider kind, used for per-provider cache/token stats. Omitted on old records. */
  providerKind?: AiDebugProviderKind
  createdAt: string
  messages?: AiChatMessage[]
  messageSegments?: AiDebugMessageSegment[]
  input?: string[]
  responseText?: string
  vectorCount?: number
  dimensions?: number
  error?: string
  turn?: number
  usage?: {
    input?: number
    output?: number
    total?: number
    /** Tokens served from the provider prompt cache (cache hit). Omitted when the
     *  provider doesn't report caching or the field is absent. */
    cached?: number
    /** Tokens used to create a cache entry (cache write, e.g. Claude
     *  `cache_creation_input_tokens`). Not a miss — it's the upfront investment
     *  that lets the next turn hit. Omitted when not reported. */
    cacheCreation?: number
  }
}

export type CheckpointRetention = "auto" | "pinned"
export type CheckpointSource = "platform" | "user" | "card" | "agent"

export interface ListCheckpointOptions {
  includeHidden?: boolean
  retention?: CheckpointRetention
  source?: CheckpointSource
  tags?: string[]
}

export interface CreateCheckpointOptions {
  label?: string
  retention?: CheckpointRetention
  source?: CheckpointSource
  tags?: string[]
  visible?: boolean
  metadata?: Record<string, JsonValue>
  /** Compatibility data only; behavior must not switch on closed reason values. */
  reason?: string
}

export interface UpdateCheckpointOptions {
  label?: string
  retention?: CheckpointRetention
  source?: CheckpointSource
  tags?: string[]
  visible?: boolean
  metadata?: Record<string, JsonValue>
  /** Compatibility data only; behavior must not switch on closed reason values. */
  reason?: string
}

export interface OverwriteCheckpointOptions extends CreateCheckpointOptions {}

export interface CheckpointSummary {
  id: string
  turn: number
  label: string
  createdAt: number
  updatedAt?: number
  retention: CheckpointRetention
  source?: CheckpointSource
  tags?: string[]
  visible?: boolean
  metadata?: Record<string, JsonValue>
  messageCount: number
  workspaceFileCount: number
  /** Compatibility data only; behavior must not switch on closed reason values. */
  reason?: string
}
