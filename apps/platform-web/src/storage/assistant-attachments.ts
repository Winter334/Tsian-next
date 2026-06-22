import type { AttachmentRef } from "@tsian/contracts"
import { localDb, type LocalAssistantAttachmentRecord } from "./db"
import { listAssistantSessions } from "./assistant-conversations"

/** MIME 前缀判断:图片类附件走多模态,其他按文本处理. */
function isImageMime(mimeType: string): boolean {
  return mimeType.startsWith("image/")
}

/** 文本类 MIME 白名单:这些文件内容可提取为文本注入消息. */
const TEXT_MIME_PREFIXES = [
  "text/",
  "application/json",
  "application/xml",
  "application/yaml",
  "application/x-yaml",
  "application/x-ndjson",
]

function isTextMime(mimeType: string): boolean {
  return TEXT_MIME_PREFIXES.some(
    (prefix) => mimeType === prefix || mimeType.startsWith(prefix),
  )
}

/** 识别附件种类: image 走多模态, text 走文本注入, 其他视为 text(降级). */
function classifyAttachmentKind(
  mimeType: string,
): "image" | "text" {
  if (isImageMime(mimeType)) return "image"
  return "text"
}

/** 生成确定性附件 id. */
function createAttachmentId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID()
  }
  return `att-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

/** VFS temp 路径: temp/<sessionId>/<filename>. */
export function attachmentPath(sessionId: string, name: string): string {
  // 清理文件名中的路径分隔符,防止越权
  const safeName = name.replace(/[/\\]/g, "_")
  return `temp/${sessionId}/${safeName}`
}

/**
 * 保存附件到 Dexie,返回引用元数据. Blob 本体存表,消息记录只存 ref.
 * mimeType 优先用 File.type,为空时从文件名推断.
 */
export async function saveAssistantAttachment(
  sessionId: string,
  file: File,
): Promise<AttachmentRef> {
  const id = createAttachmentId()
  const mimeType = file.type || "application/octet-stream"
  const kind = classifyAttachmentKind(mimeType)
  const path = attachmentPath(sessionId, file.name)
  const record: LocalAssistantAttachmentRecord = {
    id,
    sessionId,
    path,
    name: file.name,
    mimeType,
    kind,
    data: file,
    size: file.size,
    createdAt: Date.now(),
  }
  await localDb.assistantAttachments.put(record)
  return {
    path,
    name: file.name,
    mimeType,
    size: file.size,
    kind,
  }
}

/** 按 VFS path 取附件 Blob. */
export async function getAssistantAttachmentBlob(
  path: string,
): Promise<Blob | undefined> {
  const records = await localDb.assistantAttachments
    .where("path")
    .equals(path)
    .toArray()
  return records[0]?.data
}

/** 按 VFS path 取附件记录(含 mimeType 等). */
export async function getAssistantAttachmentRecord(
  path: string,
): Promise<LocalAssistantAttachmentRecord | undefined> {
  const records = await localDb.assistantAttachments
    .where("path")
    .equals(path)
    .toArray()
  return records[0]
}

/** 取图片附件的 base64 数据(发给 LLM 多模态用). */
export async function getAssistantAttachmentBase64(
  path: string,
): Promise<{ data: string; mimeType: string } | undefined> {
  const record = await getAssistantAttachmentRecord(path)
  if (!record) return undefined
  const base64 = await blobToBase64(record.data)
  return { data: base64, mimeType: record.mimeType }
}

/** 取文本附件的内容字符串(注入消息文本用). */
export async function readTextAttachment(
  path: string,
): Promise<string | undefined> {
  const record = await getAssistantAttachmentRecord(path)
  if (!record) return undefined
  return record.data.text()
}

/** 列出某会话的所有附件(用于 VFS temp/ 目录组装). */
export async function listAttachmentsBySession(
  sessionId: string,
): Promise<LocalAssistantAttachmentRecord[]> {
  return localDb.assistantAttachments
    .where("sessionId")
    .equals(sessionId)
    .toArray()
}

/** 列出所有附件(用于启动时清理孤儿). */
export async function listAllAttachments(): Promise<LocalAssistantAttachmentRecord[]> {
  return localDb.assistantAttachments.toArray()
}

/** 删除某会话的所有附件(会话删除时调用). */
export async function deleteAttachmentsBySession(
  sessionId: string,
): Promise<void> {
  await localDb.assistantAttachments
    .where("sessionId")
    .equals(sessionId)
    .delete()
}

/** 删除单个附件(按 path). */
export async function deleteAttachmentByPath(path: string): Promise<void> {
  const record = await getAssistantAttachmentRecord(path)
  if (record) {
    await localDb.assistantAttachments.delete(record.id)
  }
}

/** 清理孤儿附件:超过 maxAgeDays 且不属于任何现存会话的附件. */
export async function cleanupOrphanAttachments(maxAgeDays = 7): Promise<void> {
  const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000
  const all = await listAllAttachments()
  const localSessions = await listAssistantSessions("local")
  const cardSessions = await listAssistantSessions("card")
  const liveSessionIds = new Set([
    ...localSessions.map((s) => s.id),
    ...cardSessions.map((s) => s.id),
  ])
  const orphans = all.filter(
    (record) =>
      record.createdAt < cutoff && !liveSessionIds.has(record.sessionId),
  )
  if (orphans.length > 0) {
    await localDb.assistantAttachments.bulkDelete(orphans.map((r) => r.id))
  }
}

/** Blob 转 base64 字符串(不带 data URL prefix). */
export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result
      if (typeof result !== "string") {
        reject(new Error("FileReader did not produce a string"))
        return
      }
      // 去掉 data:<mime>;base64, 前缀,只保留 base64 数据
      const commaIndex = result.indexOf(",")
      resolve(commaIndex >= 0 ? result.slice(commaIndex + 1) : result)
    }
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

/** 判断 MIME 是否为图片(导出供其他模块使用). */
export { isImageMime, isTextMime }
