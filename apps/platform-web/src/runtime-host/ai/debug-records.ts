import type { AiDebugMessageSegment, AiDebugRecord } from "@tsian/contracts"

import { getPlatformConfig } from "../../config/platform-config"
import {
  appendAiDebugRecord,
  readAiDebugRecords,
  AI_DEBUG_RECORDS_KEY,
} from "../../storage/ai-debug-records"
import { localDb } from "../../storage/db"
import { contentImagePartCount, contentToTextPreview } from "./content"
import type { AiChatMessage, RuntimeChatMessage } from "./types"

function inferMessageSegmentLabel(text: string, role: RuntimeChatMessage["role"] | AiChatMessage["role"]): string {
  if (role === "system") return "system.agent"
  if (role === "tool") return "tool.observation"
  if (text.startsWith("Workspace Agent 上下文（元信息）") || text.startsWith("目标 Agent 上下文（元信息）")) return "workspace.meta"
  // contextInjectionsToMessages 产出的注入消息用 `<!-- source: xxx -->` 注释前缀。
  // 覆盖 prelude / runtime / framing 各 position 的注入。
  if (text.startsWith("<!-- source:")) return "workspace.file"
  if (text.startsWith("Workspace 注入 ")) return "workspace.file"
  if (text.startsWith("早期任务摘要：") || text.startsWith("早期剧情摘要：") || text.startsWith("最近对话：") || text.startsWith("最近对话窗口：") || text === "（暂无历史对话）") return "history"
  if (text.startsWith("当前问答轮次：") || text.startsWith("当前回合：")) return "turn.runtime"
  if (text.startsWith("用户本轮提问：") || text.startsWith("玩家本轮输入：")) return "turn.input"
  if (text.startsWith("调用请求：")) return "agent-call.request"
  if (text.startsWith("下面是已激活 Skill")) return "skill.injected"
  if (text.startsWith("Workspace tool observations:")) return "tool.observation"
  if (role === "assistant") return "assistant.response"
  return "message"
}

function segmentStability(label: string): AiDebugMessageSegment["stability"] {
  if (label === "system.agent") return "stable"
  if (label === "history" || label === "assistant.response") return "semi-stable"
  // 注入点重设计后（prelude/runtime/framing 三层）：
  // workspace.meta（Skill Index 等）和 workspace.file（各 contextFile 独立一条）
  // 标 semi-stable——理论可变（agent 写 runtime.json），但希望多数轮次命中前缀缓存。
  // 与 history 同语义。稳定的文件自然命中、动态的单独 miss 互不拖累。
  if (label === "workspace.meta" || label === "workspace.file") return "semi-stable"
  return "dynamic"
}

export function buildDebugMessageSegments(messages: RuntimeChatMessage[] | AiChatMessage[]): AiDebugMessageSegment[] {
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

let aiDebugSequence = 0

export function createAiDebugRequestId(label: string): string {
  return `${label}-${++aiDebugSequence}`
}

/**
 * In-memory write buffer for AI debug records. Pushed records land here
 * synchronously (so same-session reads see them immediately) and are
 * fire-and-forget persisted to Dexie (`storage/ai-debug-records.ts`). Reads
 * always hydrate from Dexie and merge this buffer, so a card-switch clear
 * (which deletes the Dexie key) is naturally reflected on the next read
 * without any cross-layer cache-reset call.
 */
const aiDebugRecordBuffer: AiDebugRecord[] = []

/** 读平台配置 ai.chatTimeoutMs(默认 600000).同步读 cache. */
export function getChatTimeoutMs(): number {
  return getPlatformConfig().ai.chatTimeoutMs
}

export function pushAiDebugRecord(record: AiDebugRecord): void {
  // Sync buffer so same-session reads see the new record immediately, plus
  // fire-and-forget async persist to Dexie (survives refresh, 7-day TTL,
  // cleared on card switch). Diagnostics are non-critical — a failed write
  // is silently dropped; the record still lives in the buffer for this session.
  aiDebugRecordBuffer.unshift(record)
  void appendAiDebugRecord(record).catch(() => { /* ignore: diagnostics persist */ })
}

export function updateAiDebugRecord(id: string, patch: Partial<AiDebugRecord>): void {
  // Update the in-memory buffer entry (source of truth for current session).
  const index = aiDebugRecordBuffer.findIndex((record) => record.id === id)
  if (index < 0) {
    return
  }
  aiDebugRecordBuffer[index] = {
    ...aiDebugRecordBuffer[index],
    ...patch,
  }
  // Persist the patched record (fire-and-forget). Re-read + re-write so the
  // Dexie copy reflects the patch; the buffer is the session source of truth.
  void persistPatchedRecord(id, patch).catch(() => { /* ignore: diagnostics persist */ })
}

/** Best-effort: re-read Dexie, apply patch to the matching record, write back. */
async function persistPatchedRecord(id: string, patch: Partial<AiDebugRecord>): Promise<void> {
  const persisted = await readAiDebugRecords()
  const idx = persisted.findIndex((r) => r.id === id)
  if (idx < 0) return
  persisted[idx] = { ...persisted[idx], ...patch }
  await localDb.meta.put({
    key: AI_DEBUG_RECORDS_KEY,
    value: JSON.stringify(persisted),
  })
}

export async function getAiDebugRecords(): Promise<AiDebugRecord[]> {
  // Always hydrate from Dexie (handles card-switch clear naturally) and merge
  // any buffer records not yet persisted or added this session.
  const persisted = await readAiDebugRecords()
  const persistedIds = new Set(persisted.map((r) => r.id))
  const merged = [
    ...aiDebugRecordBuffer.filter((r) => !persistedIds.has(r.id)),
    ...persisted,
  ]
  return merged.map((record) => ({
    ...record,
    messages: record.messages?.map((message) => ({ ...message })),
    input: record.input ? [...record.input] : undefined,
  }))
}

export function maskSecret(value: string): string {
  if (value.length <= 8) {
    return "***"
  }

  return `${value.slice(0, 4)}...${value.slice(-4)}`
}

export function previewText(value: string, maxLength = 1600): string {
  const normalized = value.trim()
  if (normalized.length <= maxLength) {
    return normalized
  }

  return `${normalized.slice(0, maxLength)}\n...[truncated ${normalized.length - maxLength} chars]`
}

export function logDebugGroup(
  title: string,
  payload: Record<string, unknown>,
): void {
  console.groupCollapsed(title)
  console.debug(payload)
  console.groupEnd()
}
