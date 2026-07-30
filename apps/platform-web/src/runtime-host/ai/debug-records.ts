import { getPlatformConfig } from "../../config/platform-config"
import { contentImagePartCount, contentToTextPreview } from "./content"
import type { AiChatMessage, RuntimeChatMessage } from "./types"

interface DebugMessageSegment {
  index: number
  role: "user" | "assistant" | "system" | "tool"
  label: string
  stability: "stable" | "semi-stable" | "dynamic"
  charLength: number
  preview: string
  imagePartCount?: number
}

function inferMessageSegmentLabel(text: string, role: RuntimeChatMessage["role"] | AiChatMessage["role"]): string {
  if (role === "system") return "system.agent"
  if (role === "tool") return "tool.observation"
  if (text.startsWith("Workspace Agent 上下文（元信息）") || text.startsWith("目标 Agent 上下文（元信息）")) return "workspace.meta"
  if (text.startsWith("<!-- source:") || text.startsWith("Workspace 注入 ")) return "workspace.file"
  if (text.startsWith("早期任务摘要：") || text.startsWith("早期剧情摘要：") || text.startsWith("最近对话：") || text.startsWith("最近对话窗口：") || text === "（暂无历史对话）") return "history"
  if (text.startsWith("当前问答轮次：") || text.startsWith("当前回合：")) return "turn.runtime"
  if (text.startsWith("用户本轮提问：") || text.startsWith("玩家本轮输入：")) return "turn.input"
  if (text.startsWith("调用请求：")) return "agent-call.request"
  if (text.startsWith("下面是已激活 Skill")) return "skill.injected"
  if (text.startsWith("Workspace tool observations:")) return "tool.observation"
  if (role === "assistant") return "assistant.response"
  return "message"
}

function segmentStability(label: string): DebugMessageSegment["stability"] {
  if (label === "system.agent") return "stable"
  if (label === "history" || label === "assistant.response" || label === "workspace.meta" || label === "workspace.file") {
    return "semi-stable"
  }
  return "dynamic"
}

export function buildDebugMessageSegments(messages: RuntimeChatMessage[] | AiChatMessage[]): DebugMessageSegment[] {
  return messages.map((message, index) => {
    const text = message.role === "tool"
      ? `[tool:${message.toolCallId}] ${message.content}`
      : contentToTextPreview(message.content)
    const label = inferMessageSegmentLabel(text, message.role)
    const imagePartCount = message.role === "tool" ? 0 : contentImagePartCount(message.content)
    return {
      index,
      role: message.role,
      label,
      stability: segmentStability(label),
      charLength: text.length,
      preview: previewText(text, 180),
      ...(imagePartCount > 0 ? { imagePartCount } : {}),
    }
  })
}

export function getChatTimeoutMs(): number {
  return getPlatformConfig().ai.chatTimeoutMs
}

export function maskSecret(value: string): string {
  if (value.length <= 8) return "***"
  return `${value.slice(0, 4)}...${value.slice(-4)}`
}

export function previewText(value: string, maxLength = 1600): string {
  const normalized = value.trim()
  if (normalized.length <= maxLength) return normalized
  return `${normalized.slice(0, maxLength)}\n...[truncated ${normalized.length - maxLength} chars]`
}

export function logDebugGroup(title: string, payload: Record<string, unknown>): void {
  console.groupCollapsed(title)
  console.debug(payload)
  console.groupEnd()
}
