import type { ConversationMessageRecord } from "@tsian/contracts"
import { localDb } from "./db"
import { assistantContextPath, deleteLocalAssistantFile } from "./local-assistant-files"
import { deleteAttachmentsBySession } from "./assistant-attachments"
import { getPlatformConfig } from "../config/platform-config"

export type AssistantMode = "local" | "card"

export interface AssistantSessionSummary {
  id: string
  mode: AssistantMode
  title: string
  createdAt: number
  updatedAt: number
}

const LIST_KEY_PREFIX = "assistant-session-list:"
const ACTIVE_KEY_PREFIX = "assistant-active:"
const MESSAGES_KEY_PREFIX = "assistant-session:"
/** Per-session last input-token usage for the context-window ring (single number). */
const CONTEXT_USED_KEY_PREFIX = "assistant-context-used:"
/** Per-session last scroll position of the conversation list (single number). */
const SCROLL_TOP_KEY_PREFIX = "assistant-scroll-top:"
/** Legacy single-conversation key from the first persistence slice. */
const LEGACY_CONVERSATION_KEY_PREFIX = "assistant-conversation:"

/** 读平台配置 assistant.maxStoredMessages(默认 200).同步读 cache. */
function getMaxStoredMessages(): number {
  return getPlatformConfig().assistant.maxStoredMessages
}

function listKey(mode: AssistantMode): string {
  return `${LIST_KEY_PREFIX}${mode}`
}

function activeKey(mode: AssistantMode): string {
  return `${ACTIVE_KEY_PREFIX}${mode}`
}

function messagesKey(id: string): string {
  return `${MESSAGES_KEY_PREFIX}${id}`
}

function contextUsedKey(id: string): string {
  return `${CONTEXT_USED_KEY_PREFIX}${id}`
}

function scrollTopKey(id: string): string {
  return `${SCROLL_TOP_KEY_PREFIX}${id}`
}

function legacyKey(mode: AssistantMode): string {
  return `${LEGACY_CONVERSATION_KEY_PREFIX}${mode}`
}

function createSessionId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID()
  }
  return `asst-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function normalizeMessages(
  messages: ConversationMessageRecord[] | undefined,
): ConversationMessageRecord[] {
  if (!Array.isArray(messages)) {
    return []
  }
  return messages.flatMap((item) => {
    if (typeof item?.role === "string" && typeof item.content === "string") {
      // 保留 attachments 字段(附件引用元数据);非数组或缺失时省略.
      const attachments = Array.isArray(item.attachments) ? { attachments: item.attachments } : {}
      // 保留 toolCalls 字段(助手工具调用跨 turn 保留,agent 层用);
      // 非数组或缺失时省略.
      const toolCalls = Array.isArray(item.toolCalls) ? { toolCalls: item.toolCalls } : {}
      // 保留 timeline 字段(thought/tool/interim 按发生顺序,UI 层重建 timeline);
      // 非数组或缺失时省略.
      const timeline = Array.isArray(item.timeline) ? { timeline: item.timeline } : {}
      return { role: item.role, content: item.content, ...attachments, ...toolCalls, ...timeline }
    }
    return []
  })
}

function deriveTitle(messages: ConversationMessageRecord[]): string {
  const firstUser = messages.find((msg) => msg.role === "user")
  if (!firstUser) {
    return "新会话"
  }
  const text = firstUser.content.replace(/\s+/g, " ").trim()
  return text.length > 24 ? `${text.slice(0, 24)}…` : text
}

async function readSessionList(mode: AssistantMode): Promise<AssistantSessionSummary[]> {
  const record = await localDb.meta.get(listKey(mode))
  if (!record?.value) {
    return []
  }
  try {
    const parsed = JSON.parse(record.value) as AssistantSessionSummary[]
    if (!Array.isArray(parsed)) {
      return []
    }
    return parsed.filter(
      (entry): entry is AssistantSessionSummary =>
        typeof entry?.id === "string" && typeof entry?.mode === "string",
    )
  } catch {
    return []
  }
}

async function writeSessionList(
  mode: AssistantMode,
  sessions: AssistantSessionSummary[],
): Promise<void> {
  await localDb.meta.put({
    key: listKey(mode),
    value: JSON.stringify(sessions),
  })
}

/**
 * One-time migration from the legacy single-conversation key to the multi-session
 * model. Runs when a mode has no sessions yet but a legacy conversation exists.
 */
async function migrateLegacyConversation(mode: AssistantMode): Promise<void> {
  const legacy = await localDb.meta.get(legacyKey(mode))
  if (!legacy?.value) {
    return
  }
  let messages: ConversationMessageRecord[] = []
  try {
    const parsed = JSON.parse(legacy.value) as ConversationMessageRecord[]
    messages = normalizeMessages(parsed)
  } catch {
    messages = []
  }
  const now = Date.now()
  const session: AssistantSessionSummary = {
    id: createSessionId(),
    mode,
    title: deriveTitle(messages),
    createdAt: now,
    updatedAt: now,
  }
  await localDb.meta.put({
    key: messagesKey(session.id),
    value: JSON.stringify(messages.slice(-getMaxStoredMessages())),
  })
  await writeSessionList(mode, [session])
  await setActiveAssistantSessionId(mode, session.id)
  await localDb.meta.delete(legacyKey(mode))
}

export async function listAssistantSessions(
  mode: AssistantMode,
): Promise<AssistantSessionSummary[]> {
  const sessions = await readSessionList(mode)
  if (sessions.length === 0) {
    await migrateLegacyConversation(mode)
    return readSessionList(mode)
  }
  return sessions.sort((a, b) => b.updatedAt - a.updatedAt)
}

export async function getActiveAssistantSessionId(
  mode: AssistantMode,
): Promise<string | null> {
  const record = await localDb.meta.get(activeKey(mode))
  return record?.value ?? null
}

export async function setActiveAssistantSessionId(
  mode: AssistantMode,
  id: string | null,
): Promise<void> {
  const normalized = id?.trim()
  if (!normalized) {
    await localDb.meta.delete(activeKey(mode))
    return
  }
  await localDb.meta.put({ key: activeKey(mode), value: normalized })
}

export async function createAssistantSession(
  mode: AssistantMode,
): Promise<AssistantSessionSummary> {
  const now = Date.now()
  const session: AssistantSessionSummary = {
    id: createSessionId(),
    mode,
    title: "新会话",
    createdAt: now,
    updatedAt: now,
  }
  await localDb.meta.put({ key: messagesKey(session.id), value: "[]" })
  const sessions = await readSessionList(mode)
  sessions.unshift(session)
  await writeSessionList(mode, sessions)
  await setActiveAssistantSessionId(mode, session.id)
  return session
}

export async function getAssistantSessionMessages(
  id: string,
): Promise<ConversationMessageRecord[]> {
  const record = await localDb.meta.get(messagesKey(id))
  if (!record?.value) {
    return []
  }
  try {
    return normalizeMessages(JSON.parse(record.value)).slice(-getMaxStoredMessages())
  } catch {
    return []
  }
}

/**
 * Persist the last input-token usage for a session's context-window ring.
 * Lightweight single number; written after each successful reply so a reloaded
 * session restores the ring instead of resetting to 0.
 */
export async function saveContextUsed(id: string, value: number): Promise<void> {
  await localDb.meta.put({ key: contextUsedKey(id), value: String(value) })
}

/**
 * Read the last persisted input-token usage for a session. Returns 0 when no
 * record exists (fresh session or pre-persistence legacy session).
 */
export async function loadContextUsed(id: string): Promise<number> {
  const record = await localDb.meta.get(contextUsedKey(id))
  if (!record?.value) {
    return 0
  }
  const parsed = Number(record.value)
  return Number.isFinite(parsed) ? parsed : 0
}

/**
 * Persist the conversation list's last scroll position for a session. Lets the
 * view restore it after a focus switch (browsers async-reset scrollTop on
 * inactive/occluded scroll containers). Fire-and-forget from a rAF-throttled
 * scroll handler; a missed final write is harmless (next scroll re-syncs).
 */
export async function saveScrollTop(id: string, value: number): Promise<void> {
  await localDb.meta.put({ key: scrollTopKey(id), value: String(value) })
}

/**
 * Read the last persisted scroll position for a session. Returns 0 when no
 * record exists.
 */
export async function loadScrollTop(id: string): Promise<number> {
  const record = await localDb.meta.get(scrollTopKey(id))
  if (!record?.value) {
    return 0
  }
  const parsed = Number(record.value)
  return Number.isFinite(parsed) ? parsed : 0
}

export interface SaveAssistantSessionMessagesOptions {
  /**
   * Whether to bump the session's `updatedAt` timestamp and re-sort the list.
   * Defaults to `true` (a real conversation update). Pass `false` for silent
   * persistence such as switching away from a session, so mere selection does
   * not reorder the sidebar.
   */
  touch?: boolean
}

export async function saveAssistantSessionMessages(
  mode: AssistantMode,
  id: string,
  messages: ConversationMessageRecord[],
  options: SaveAssistantSessionMessagesOptions = {},
): Promise<void> {
  const touch = options.touch ?? true
  const trimmed = normalizeMessages(messages).slice(-getMaxStoredMessages())
  await localDb.meta.put({
    key: messagesKey(id),
    value: JSON.stringify(trimmed),
  })
  // Refresh the session summary timestamp/title.
  const sessions = await readSessionList(mode)
  const index = sessions.findIndex((entry) => entry.id === id)
  if (index >= 0) {
    const existing = sessions[index]
    const title = deriveTitle(trimmed)
    // Keep a manually renamed title unless it's still the placeholder.
    const shouldUpdateTitle =
      existing.title === "新会话" || title !== "新会话"
    sessions[index] = {
      ...existing,
      title: shouldUpdateTitle ? title : existing.title,
      updatedAt: touch ? Date.now() : existing.updatedAt,
    }
    await writeSessionList(mode, sessions)
  }
}

export async function renameAssistantSession(
  mode: AssistantMode,
  id: string,
  title: string,
): Promise<void> {
  const sessions = await readSessionList(mode)
  const index = sessions.findIndex((entry) => entry.id === id)
  if (index < 0) {
    return
  }
  const next = title.trim()
  sessions[index] = {
    ...sessions[index],
    title: next || "未命名会话",
    updatedAt: Date.now(),
  }
  await writeSessionList(mode, sessions)
}

export async function deleteAssistantSession(
  mode: AssistantMode,
  id: string,
): Promise<void> {
  const sessions = (await readSessionList(mode)).filter((entry) => entry.id !== id)
  await writeSessionList(mode, sessions)
  await localDb.meta.delete(messagesKey(id))
  await localDb.meta.delete(contextUsedKey(id))
  await localDb.meta.delete(scrollTopKey(id))
  // 连带清理该会话的 agent 上下文快照(虚拟文件),防孤儿残留(design 06-20-assistant-context-persistence §3.6).
  // deleteLocalAssistantFile 内部已 catch,不会阻塞会话删除.
  await deleteLocalAssistantFile(assistantContextPath(id))
  // 连带清理该会话的附件 Blob(temp/ 虚拟文件),防孤儿残留.
  await deleteAttachmentsBySession(id)
  const activeId = await getActiveAssistantSessionId(mode)
  if (activeId === id) {
    await setActiveAssistantSessionId(
      mode,
      sessions[0]?.id ?? null,
    )
  }
}

export async function ensureAssistantSession(
  mode: AssistantMode,
): Promise<AssistantSessionSummary> {
  const sessions = await listAssistantSessions(mode)
  const activeId = await getActiveAssistantSessionId(mode)
  const active = sessions.find((entry) => entry.id === activeId)
  if (active) {
    return active
  }
  if (sessions[0]) {
    await setActiveAssistantSessionId(mode, sessions[0].id)
    return sessions[0]
  }
  return createAssistantSession(mode)
}
