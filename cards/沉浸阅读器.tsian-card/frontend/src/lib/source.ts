/**
 * lib/source.ts — 小说导入纯文本处理工具。
 *
 * 纯函数：规范化、章节检测、corpus 构建、格式化。所有 DOM/bridge 交互在
 * useSetupState.ts 中处理；长文本导入通过 source-import.worker.ts 调用这里。
 */

// ── workspace 路径常量 ──
export const SOURCE_MANIFEST_PATH = "save/source/manifest.json"
export const CHAPTER_INDEX_PATH = "save/source/chapters.index.json"
export const SOURCE_SHARDS_ROOT = "save/source/shards/"
export const INITIAL_SUMMARY_PATH = "save/playthrough/understanding-summary.json"
export const RUNTIME_PATH = "save/playthrough/runtime.json"
export const FRONTIER_PATH = "save/playthrough/frontier.json"
export const SETUP_SUMMARY_PATH = "save/playthrough/setup-summary.json"
export const CHARACTER_ENTITIES_ROOT = "save/entities/character/"
export const SOURCE_TARGET_SHARD_CHARACTERS = 1_000_000
const NORMALIZATION_VERSION = "novel-source-sharded-v1"
const PSEUDO_CHAPTER_TARGET = 15_000

// ── 类型 ──
export type ImportMode = "paste" | "file"
export type ExtractionMode = "full" | "frontier"
export type ChapterDetection = "heuristic" | "fallback-length"
export type ChapterConfidence = "strong" | "medium" | "weak" | "none"

export interface SourceManifest {
  version: 1
  status: "ready"
  title: string
  sourceFormat: "txt" | "md"
  importMode: ImportMode
  recommendedExtractionMode: ExtractionMode
  chapterDetection: ChapterDetection
  chapterDetectionConfidence: ChapterConfidence
  originalFileName?: string
  importedAt: string
  normalizationVersion: string
  totalCharacters: number
  chapterCount: number
  files: {
    chaptersIndex: string
    chaptersRoot?: string
    shardsRoot?: string
  }
  storage?: {
    kind: "sharded"
    targetShardCharacters: number
  }
}

export interface LegacyChapterIndexEntry {
  title: string
  path: string
  characters?: number
}

export interface ShardedChapterSource {
  kind: "shard"
  shardId: string
  path: string
  start: number
  end: number
}

export interface ShardedChapterIndexEntry {
  index: number
  ref: string
  title: string
  characters: number
  source: ShardedChapterSource
}

export type ChapterIndexEntry = LegacyChapterIndexEntry | ShardedChapterIndexEntry

export interface SourceShardMeta {
  id: string
  path: string
  startChapter: number
  endChapter: number
  characters: number
}

export interface SourceShardFile extends SourceShardMeta {
  content: string
}

export interface SourceStorageDescriptor {
  kind: "sharded"
  targetShardCharacters: number
  shardsRoot: string
}

export interface LegacyChapterIndexFile {
  version: 1
  chapters: ReadonlyArray<LegacyChapterIndexEntry>
}

export interface ShardedChapterIndexFile {
  version: 2
  storage: SourceStorageDescriptor
  shards: ReadonlyArray<SourceShardMeta>
  chapters: ReadonlyArray<ShardedChapterIndexEntry>
}

export type ChapterIndexFile = LegacyChapterIndexFile | ShardedChapterIndexFile

export interface SourceChapter {
  title: string
  path: string
  content: string
  characters: number
}

export interface BuildInput {
  text: string
  title?: string
  fileName?: string
  sourceFormat: "txt" | "md"
  importMode: ImportMode
}

export type SourceImportProgressPhase = "normalizing" | "detecting" | "splitting" | "sharding" | "complete"

export interface BuildSourceCorpusProgress {
  phase: SourceImportProgressPhase
  message: string
  current?: number
  total?: number
}

export type BuildSourceCorpusProgressHandler = (progress: BuildSourceCorpusProgress) => void

export interface BuiltSourceCorpus {
  manifest: SourceManifest
  chapterIndex: ChapterIndexFile
  shards: SourceShardFile[]
}

interface ChapterCandidate {
  lineIndex: number
  offset: number
  title: string
  confidence: Exclude<ChapterConfidence, "none">
  numeric?: number
}

interface ChapterDetectionResult {
  candidates: ChapterCandidate[]
  confidence: ChapterConfidence
}

interface ParsedSourceChapter {
  title: string
  content: string
  pseudo: boolean
}

export interface OpeningCandidateCharacter {
  id?: string
  name: string
  brief: string
  gender?: string
}

// ── 角色设定（Step 3）──

export type CharacterBranch = "canon" | "original"

export interface SelectedCharacter {
  ref: string
  name: string
  brief: string
  gender?: string
}

export interface OriginalCharacterFormData {
  name: string
  brief: string
  gender?: string
  appearance?: string
  personality?: string
  background?: string
}

export interface CharacterEntity {
  id: string
  name: string
  brief: string
  gender?: string
  sourceRefs: string[]
  updatedBy: string
  updatedAt: string
  appearance?: string
  personality?: string
  background?: string
}

export interface OpeningUnderstandingSummary {
  status: "ready"
  title: string
  candidateCharacters: ReadonlyArray<OpeningCandidateCharacter>
}

// ── 游玩设定对话（Step 4）──

export type PlaySetupStatus = "idle" | "running" | "complete" | "failed"

export interface DialogMessage {
  id: string
  role: "agent" | "user"
  content: string
  options?: string[]
}

export interface SetupSummary {
  status: "pending" | "complete"
  summary?: string | null
  committedAt?: string
  enteredPlay?: boolean
}

export function isSetupSummary(value: unknown): value is SetupSummary {
  return typeof value === "object"
    && value !== null
    && ((value as { status?: unknown }).status === "pending" || (value as { status?: unknown }).status === "complete")
}

// ── JSON 安全解析 + 类型守卫 ──

export function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

export function isSourceManifest(value: unknown): value is SourceManifest {
  return typeof value === "object"
    && value !== null
    && (value as { status?: unknown }).status === "ready"
}

export function isOpeningUnderstandingSummary(value: unknown): value is OpeningUnderstandingSummary {
  return typeof value === "object"
    && value !== null
    && (value as { status?: unknown }).status === "ready"
    && typeof (value as { title?: unknown }).title === "string"
    && Array.isArray((value as { candidateCharacters?: unknown }).candidateCharacters)
}

// ── 格式化 ──

export function formatNumber(num: number): string {
  return new Intl.NumberFormat("zh-CN").format(num || 0)
}

export function formatCharacters(num: number): string {
  if (num >= 10_000) {
    const wan = num / 10_000
    return `${wan >= 100 ? Math.round(wan) : wan.toFixed(1)} 万字`
  }
  return `${formatNumber(num)} 字`
}

export function formatOptionalCharacters(num: number | undefined): string {
  return typeof num === "number" ? formatCharacters(num) : "—"
}

export function excerptText(text: string, limit = 1_100): string {
  const cleaned = text
    .replace(/^#\s+.*\n+/, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
  if (cleaned.length <= limit) return cleaned
  return `${cleaned.slice(0, limit).trimEnd()}……`
}

export function inferTitle(text: string, fileName?: string): string {
  if (fileName) {
    const title = fileName.replace(/\.(txt|md)$/i, "").trim()
    if (title) return title
  }
  const firstLine = text.split("\n").map((line) => line.trim()).find(Boolean)
  if (!firstLine) return "导入小说"
  return firstLine.length > 40 ? firstLine.slice(0, 40) : firstLine
}

// ── 文本规范化 ──

export function normalizeNovelText(text: string): string {
  const normalized = String(text || "")
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, ""))
    .join("\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim()
  return normalized ? `${normalized}\n` : ""
}

// ── 章节检测 ──

function isBoundaryLine(lines: string[], index: number): boolean {
  const prev = index <= 0 ? "" : lines[index - 1]?.trim() ?? ""
  const next = index >= lines.length - 1 ? "" : lines[index + 1]?.trim() ?? ""
  return !prev || !next
}

function toAsciiDigits(value: string): string {
  return value.replace(/[０-９]/g, (ch) => String(ch.charCodeAt(0) - 0xFF10))
}

function classifyChapterLine(
  rawLine: string,
  lines: string[],
  index: number,
): Omit<ChapterCandidate, "lineIndex" | "offset"> | null {
  const line = rawLine.trim().replace(/^#+\s*/, "")
  if (!line || line.length > 60) return null

  const strong = /^(第[零〇一二两三四五六七八九十百千万0-9０-９]+\s*[章节回卷集部幕节篇](?:\s+.*)?|Chapter\s+[0-9IVXLCDM]+(?:\s+.*)?)$/i
  if (strong.test(line)) {
    return { title: line, confidence: "strong" }
  }

  const medium = /^(序章|序幕|楔子|引子|后记|尾声|番外(?:[零〇一二两三四五六七八九十百千万0-9０-９]+)?|第[零〇一二两三四五六七八九十百千万0-9０-９]+卷(?:\s+.*)?|卷[零〇一二两三四五六七八九十百千万0-9０-９]+(?:\s+.*)?|正文\s+第[零〇一二两三四五六七八九十百千万0-9０-９]+\s*[章节回卷集部幕节篇].*)$/
  if (medium.test(line) && isBoundaryLine(lines, index) && !/[。？！]$/.test(line)) {
    return { title: line, confidence: "medium" }
  }

  const weak = /^([0-9０-９]{1,4})[、.．\s]+(.{0,50})$/
  const weakMatch = line.match(weak)
  if (weakMatch && isBoundaryLine(lines, index) && !/[。？！"”’』」]$/.test(line)) {
    return {
      title: line,
      confidence: "weak",
      numeric: Number(toAsciiDigits(weakMatch[1] ?? "")),
    }
  }

  return null
}

function findChapterCandidates(text: string): ChapterDetectionResult {
  const lines = text.split("\n")
  const offsets: number[] = []
  let offset = 0
  for (const line of lines) {
    offsets.push(offset)
    offset += line.length + 1
  }

  const candidates: ChapterCandidate[] = []
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const found = classifyChapterLine(lines[lineIndex] ?? "", lines, lineIndex)
    if (found) {
      candidates.push({
        lineIndex,
        offset: offsets[lineIndex] ?? 0,
        ...found,
      })
    }
  }

  const strongOrMedium = candidates.filter(
    (item) => item.confidence === "strong" || item.confidence === "medium",
  )
  if (strongOrMedium.length >= 2 || (strongOrMedium.length === 1 && strongOrMedium[0]!.offset < 2_000)) {
    return {
      candidates: strongOrMedium,
      confidence: strongOrMedium.some((item) => item.confidence === "strong") ? "strong" : "medium",
    }
  }

  const weak = candidates.filter(
    (item) => item.confidence === "weak" && Number.isFinite(item.numeric),
  )
  let sequential = 0
  for (let index = 1; index < weak.length; index += 1) {
    if (weak[index]!.numeric === weak[index - 1]!.numeric! + 1) sequential += 1
  }
  if (weak.length >= 3 && sequential >= 2) {
    return { candidates: weak, confidence: "weak" }
  }

  return { candidates: [], confidence: "none" }
}

function splitByCandidates(
  text: string,
  detected: ChapterDetectionResult,
): ParsedSourceChapter[] {
  return detected.candidates.map((current, index) => {
    const next = detected.candidates[index + 1]
    return {
      title: current.title,
      content: `${text.slice(current.offset, next ? next.offset : text.length).trim()}\n`,
      pseudo: false,
    }
  })
}

function splitPseudoChapters(
  text: string,
): ParsedSourceChapter[] {
  const paragraphs = text.split(/\n{2,}/)
  const chapters: ParsedSourceChapter[] = []
  let current: string[] = []
  let size = 0

  const flush = (): void => {
    if (current.length === 0) return
    chapters.push({
      title: `片段 ${chapters.length + 1}`,
      content: `${current.join("\n\n").trim()}\n`,
      pseudo: true,
    })
    current = []
    size = 0
  }

  for (const para of paragraphs) {
    const textPara = para.trim()
    if (!textPara) continue
    if (size > 0 && size + textPara.length > PSEUDO_CHAPTER_TARGET) flush()
    if (textPara.length > PSEUDO_CHAPTER_TARGET * 1.5) {
      for (let start = 0; start < textPara.length; start += PSEUDO_CHAPTER_TARGET) {
        flush()
        chapters.push({
          title: `片段 ${chapters.length + 1}`,
          content: `${textPara.slice(start, start + PSEUDO_CHAPTER_TARGET).trim()}\n`,
          pseudo: true,
        })
      }
      continue
    }
    current.push(textPara)
    size += textPara.length
  }

  flush()
  return chapters.length > 0 ? chapters : [{ title: "片段 1", content: text, pseudo: true }]
}

function pad4(num: number): string {
  return String(num).padStart(4, "0")
}

function chapterRef(chapterNumber: number): string {
  return `source:chapter-${pad4(chapterNumber)}`
}

function shardId(shardNumber: number): string {
  return `source-shard-${pad4(shardNumber)}`
}

function formatChapterMarkdown(chapter: ParsedSourceChapter): string {
  return chapter.content.trimStart().startsWith("#")
    ? chapter.content
    : `# ${chapter.title}\n\n${chapter.content}`
}

function buildShardedCorpusFiles(
  sourceChapters: ParsedSourceChapter[],
  onProgress?: BuildSourceCorpusProgressHandler,
): { shards: SourceShardFile[]; chapters: ShardedChapterIndexEntry[]; shardMetas: SourceShardMeta[] } {
  const shards: SourceShardFile[] = []
  const chapters: ShardedChapterIndexEntry[] = []
  let currentParts: string[] = []
  let currentLength = 0
  let currentStartChapter = 0
  let currentEndChapter = 0
  let currentShardId = ""
  let currentShardPath = ""

  const ensureShard = (chapterNumber: number): void => {
    if (currentParts.length > 0) return
    currentStartChapter = chapterNumber
    currentEndChapter = chapterNumber
    currentShardId = shardId(shards.length + 1)
    currentShardPath = `${SOURCE_SHARDS_ROOT}${currentShardId}.md`
  }

  const flush = (): void => {
    if (currentParts.length === 0) return
    const content = currentParts.join("")
    shards.push({
      id: currentShardId,
      path: currentShardPath,
      startChapter: currentStartChapter,
      endChapter: currentEndChapter,
      characters: content.length,
      content,
    })
    onProgress?.({
      phase: "sharding",
      message: `构建分片 ${shards.length}…`,
      current: shards.length,
    })
    currentParts = []
    currentLength = 0
    currentStartChapter = 0
    currentEndChapter = 0
    currentShardId = ""
    currentShardPath = ""
  }

  sourceChapters.forEach((chapter, index) => {
    const chapterNumber = index + 1
    const content = formatChapterMarkdown(chapter)
    const separatorLength = currentParts.length > 0 ? 2 : 0
    if (currentParts.length > 0 && currentLength + separatorLength + content.length > SOURCE_TARGET_SHARD_CHARACTERS) {
      flush()
    }

    ensureShard(chapterNumber)
    currentEndChapter = chapterNumber

    const separator = currentParts.length > 0 ? "\n\n" : ""
    const start = currentLength + separator.length
    if (separator) {
      currentParts.push(separator)
      currentLength += separator.length
    }
    currentParts.push(content)
    currentLength += content.length
    const end = currentLength

    chapters.push({
      index: chapterNumber,
      ref: chapterRef(chapterNumber),
      title: chapter.title,
      characters: excerptText(content, Number.MAX_SAFE_INTEGER).length,
      source: {
        kind: "shard",
        shardId: currentShardId,
        path: currentShardPath,
        start,
        end,
      },
    })

    if ((chapterNumber % 100) === 0) {
      onProgress?.({
        phase: "sharding",
        message: `构建分片 ${shards.length + 1}…`,
        current: chapterNumber,
        total: sourceChapters.length,
      })
    }

    if (content.length >= SOURCE_TARGET_SHARD_CHARACTERS) {
      flush()
    }
  })

  flush()

  onProgress?.({
    phase: "sharding",
    message: `构建分片 ${shards.length}/${shards.length}…`,
    current: shards.length,
    total: shards.length,
  })

  const shardMetas = shards.map(({ content: _content, ...meta }) => meta)
  return { shards, chapters, shardMetas }
}

// ── corpus 构建 ──

export function buildSourceCorpus(
  rawText: string,
  input: Omit<BuildInput, "text">,
  onProgress?: BuildSourceCorpusProgressHandler,
): BuiltSourceCorpus {
  onProgress?.({ phase: "normalizing", message: "整理文本…" })
  const normalized = normalizeNovelText(rawText)
  if (!normalized.trim()) {
    throw new Error("导入文本为空。")
  }

  onProgress?.({ phase: "detecting", message: "识别章节…" })
  const detected = findChapterCandidates(normalized)
  const useDetected = detected.candidates.length > 0
  onProgress?.({ phase: "splitting", message: useDetected ? "切分章节…" : "按长度切分片段…" })
  const sourceChapters = useDetected
    ? splitByCandidates(normalized, detected)
    : splitPseudoChapters(normalized)
  onProgress?.({ phase: "sharding", message: "构建分片…", current: 0 })
  const { shards, chapters, shardMetas } = buildShardedCorpusFiles(sourceChapters, onProgress)

  const manifest: SourceManifest = {
    version: 1,
    status: "ready",
    title: input.title || inferTitle(normalized, input.fileName),
    sourceFormat: input.sourceFormat,
    importMode: input.importMode,
    recommendedExtractionMode: input.importMode === "paste" ? "full" : "frontier",
    chapterDetection: useDetected ? "heuristic" : "fallback-length",
    chapterDetectionConfidence: detected.confidence,
    ...(input.fileName ? { originalFileName: input.fileName } : {}),
    importedAt: new Date().toISOString(),
    normalizationVersion: NORMALIZATION_VERSION,
    totalCharacters: normalized.length,
    chapterCount: chapters.length,
    files: {
      chaptersIndex: CHAPTER_INDEX_PATH,
      shardsRoot: SOURCE_SHARDS_ROOT,
    },
    storage: {
      kind: "sharded",
      targetShardCharacters: SOURCE_TARGET_SHARD_CHARACTERS,
    },
  }
  const chapterIndex: ShardedChapterIndexFile = {
    version: 2,
    storage: {
      kind: "sharded",
      targetShardCharacters: SOURCE_TARGET_SHARD_CHARACTERS,
      shardsRoot: SOURCE_SHARDS_ROOT,
    },
    shards: shardMetas,
    chapters,
  }
  onProgress?.({ phase: "complete", message: "源文本处理完成", current: shards.length, total: shards.length })
  return { manifest, chapterIndex, shards }
}

export function buildPlaySetupPrompt(
  title: string,
  character: { ref: string; name: string } | null,
): string {
  const isOriginal = character?.ref.startsWith("original-") ?? false
  const characterDesc = character
    ? `${character.name}（${isOriginal ? "原创角色" : "原著角色"}，ref: ${character.ref}）`
    : "未设定"
  return [
    "玩家已完成小说导入、初始理解和角色设定，现在进入游玩设定对话阶段。",
    "请作为 world-architect 使用 Skill《游玩设定》引导玩家补充本局特别设定，确认后落盘并生成开局正文。",
    "",
    `书名：${title}`,
    `玩家角色：${characterDesc}`,
    "现在请开始第一轮对话，向玩家介绍本阶段并引导其说出需求。",
  ].join("\n")
}

// ── prompt 构建（Step 7 用，先放此供 useSetupState 引用）──

export function buildOpeningInitializationPrompt(
  manifest: SourceManifest,
  index: ChapterIndexFile | null,
): string {
  const chapterCount = index?.chapters.length ?? manifest.chapterCount
  return [
    "玩家已经完成小说导入并确认切分结果。请作为 world-architect 使用 Skill《开局建模》完成真实开局资料抽取与初始世界建模。",
    "",
    "要求：",
    "1. 用 `inspect_source_opening` 和 `read_opening_slice` 读源文本；用 `commit_*` 脚本写入开局产物，按 Skill《开局建模》的步骤执行。",
    "2. 连续阅读开头剧情；是否继续阅读以剧情是否足够支撑开局为准。",
    "3. 建模顺序：`commit_entities` 先写实体；再 `commit_scenes_and_relationships` 写场景与关系；再 `commit_runtime_and_frontier` 写 runtime 与 frontier。",
    "4. 无依赖的 commit 脚本可在一轮内同时调用。例如 `commit_understanding_summary` 与 `commit_runtime_and_frontier` 互不依赖，可并行发出工具调用，框架串行执行后一并返回。",
    "5. 保持未来剧情 spoiler-safe；只使用开头窗口中读到的内容。",
    "6. 如果写入遇到格式或校验错误，请按错误修正后重试，直到写入成功或明确失败。",
    "",
    `书名：${manifest.title}`,
    `章节数：${chapterCount}`,
    `文本量：${manifest.totalCharacters} 字`,
    "完成后用中文简短告诉前端已经写入哪些开局资料。",
  ].join("\n")
}
