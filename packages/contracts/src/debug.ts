import type { ContentPart } from "./runtime"

export interface AiChatMessage {
  role: "user" | "assistant" | "system"
  content: string | ContentPart[]
}

export interface AiDebugRecord {
  id: string
  kind: "chat"
  label: string
  model: string
  createdAt: string
  messages?: AiChatMessage[]
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
