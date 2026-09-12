import type { InjectionMessage, TsianApi } from "@tsian/play-bridge"
import type { ChapterIndexFile, SourceManifest } from "./source"

const BOOKMARK = "save/agents/storyteller/source-bookmark.json"
type Reader = Pick<TsianApi["workspace"], "read">
interface Position { startIndex: number; offset: number }
export interface SourceExcerpt {
  title: string
  chapters: { index: number; title: string; offset: number; endOffset: number; totalCharacters: number }[]
  text: string
  truncated: boolean
  next: Position | null
}

/** Card-local source preparation. No business schema enters the platform injector. */
export async function readStorySource(workspace: Reader, position?: Position, maxCharacters = 8000): Promise<SourceExcerpt> {
  async function read(path: string): Promise<string> {
    const file = await workspace.read(path, "effective")
    if (!file) throw new Error("相关原著材料缺失，请检查小说导入。")
    return file.content
  }
  const manifest = JSON.parse(await read("save/source/manifest.json")) as SourceManifest
  const index = JSON.parse(await read("save/source/chapters.index.json")) as ChapterIndexFile
  if (manifest.status !== "ready" || !index.chapters?.length) throw new Error("原著尚未准备好。")
  if (!position) {
    const file = await workspace.read(BOOKMARK, "effective")
    const bookmark = file ? JSON.parse(file.content) : null
    position = bookmark?.importedAt === manifest.importedAt ? { startIndex: bookmark.startIndex, offset: bookmark.offset } : { startIndex: 1, offset: 0 }
  }
  if (!Number.isSafeInteger(position.startIndex) || position.startIndex < 1 || position.startIndex > index.chapters.length || !Number.isSafeInteger(position.offset) || position.offset < 0
    || !Number.isSafeInteger(maxCharacters) || maxCharacters < 500 || maxCharacters > 12000) throw new Error("原著阅读位置或长度无效。")
  let remaining = maxCharacters, next: Position | null = null
  const chapters: SourceExcerpt["chapters"] = [], parts: string[] = [], cache = new Map<string, string>()
  for (let i = position.startIndex - 1; i < index.chapters.length; i++) {
    const chapter = index.chapters[i]!
    const path = "source" in chapter ? chapter.source.path : chapter.path
    if (!path.startsWith("save/source/") || /[\\\0]/.test(path) || path.split("/").some(part => part === "." || part === "..")) throw new Error("原著章节路径无效。")
    let body = cache.get(path)
    if (body === undefined) { body = await read(path); cache.set(path, body) }
    if ("source" in chapter) body = body.slice(chapter.source.start, chapter.source.end)
    const offset = i === position.startIndex - 1 ? position.offset : 0
    if (offset > body.length) throw new Error("章内位置超过本章长度。")
    const text = body.slice(offset, offset + remaining), endOffset = offset + text.length
    chapters.push({ index: i + 1, title: chapter.title, offset, endOffset, totalCharacters: body.length })
    parts.push(`# ${chapter.title}\n${text}`)
    remaining -= text.length
    next = endOffset < body.length ? { startIndex: i + 1, offset: endOffset } : i + 1 < index.chapters.length ? { startIndex: i + 2, offset: 0 } : null
    if (!remaining || chapters.length >= 20) break
  }
  return { title: manifest.title, chapters, text: parts.join("\n\n"), truncated: next !== null, next }
}

export async function buildStorySourceMaterial(workspace: Reader): Promise<InjectionMessage[]> {
  const excerpt = await readStorySource(workspace)
  const rules = await workspace.read("save/schema/world.json", "effective")
  return [{ role: "user", position: "before-input", content: "# 原著参考（检索书签附近的连续原文）\n这是作者参考，不是本局既成历史。结合玩家输入和本局历史自然推进，不强制回原著；人物认知与揭示时机不得超出其经历。需要其他章节或截断后的内容时使用‘原著阅读’定位/补读，并用 remember:true 记下适合当前创作的阅读起点。\n" + JSON.stringify(excerpt)
    + (rules ? "\n# 世界语义规则\n" + rules.content : "") }]
}
