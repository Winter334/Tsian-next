import type { ContentPart } from "./runtime"

export interface AiChatMessage {
  role: "user" | "assistant" | "system"
  content: string | ContentPart[]
}

export type AiDebugMessageStability = "stable" | "semi-stable" | "dynamic"

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
  }
}

export interface CheckpointSummary {
  id: string
  turn: number
  label: string
  reason: "initial" | "after-turn" | "manual"
  createdAt: number
  messageCount: number
  workspaceFileCount: number
}
