import type { ContentPart, JsonValue } from "./runtime"

export interface AiChatMessage {
  role: "user" | "assistant" | "system"
  content: string | ContentPart[]
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
