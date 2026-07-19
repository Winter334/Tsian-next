import type { ChapterIndexEntry } from "./source"
import { excerptText } from "./source"

interface WorkspaceReadResult {
  content?: string
}

interface SourceReaderClient {
  workspace: {
    read(path: string): Promise<WorkspaceReadResult | null | undefined>
  }
}

export type SourceTextCache = Map<string, string>

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function shardedSourceFor(chapter: ChapterIndexEntry): { path: string; start: number; end: number } | null {
  const source = isRecord(chapter) ? (chapter as Record<string, unknown>).source : null
  if (!isRecord(source) || source.kind !== "shard") return null
  if (typeof source.path !== "string" || typeof source.start !== "number" || typeof source.end !== "number") return null
  return { path: source.path, start: source.start, end: source.end }
}

async function readWorkspaceText(tsian: SourceReaderClient, path: string): Promise<string> {
  const file = await tsian.workspace.read(path)
  return file?.content ?? ""
}

async function readCachedText(tsian: SourceReaderClient, path: string, cache: SourceTextCache): Promise<string> {
  const cached = cache.get(path)
  if (cached !== undefined) return cached
  const content = await readWorkspaceText(tsian, path)
  cache.set(path, content)
  return content
}

export async function readSourceChapter(
  tsian: SourceReaderClient,
  chapter: ChapterIndexEntry,
  cache: SourceTextCache = new Map(),
): Promise<string> {
  const source = shardedSourceFor(chapter)
  if (source) {
    const shard = await readCachedText(tsian, source.path, cache)
    return shard.slice(source.start, source.end)
  }

  const legacyPath = "path" in chapter ? chapter.path : undefined
  if (typeof legacyPath === "string" && legacyPath.trim()) {
    return readWorkspaceText(tsian, legacyPath)
  }

  throw new Error("章节索引缺少可读取的 source 引用。")
}

export async function loadSourceChapterPreview(
  tsian: SourceReaderClient,
  chapter: ChapterIndexEntry,
  cache: SourceTextCache = new Map(),
): Promise<string> {
  const content = await readSourceChapter(tsian, chapter, cache)
  return excerptText(content) || "暂无可预览内容。"
}
