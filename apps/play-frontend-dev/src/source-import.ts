import type { TsianApi } from "@tsian/play-bridge"
import {
  animateStepEnter,
  attachCardHover,
  animateEmbers,
  animateStageText,
} from "./anim"

const SOURCE_MANIFEST_PATH = "save/source/manifest.json"
const CHAPTER_INDEX_PATH = "save/source/chapters.index.json"
const CHAPTERS_ROOT = "save/source/chapters/"
const INITIAL_SUMMARY_PATH = "save/playthrough/understanding-summary.json"
const NORMALIZATION_VERSION = "novel-source-v1"
const PSEUDO_CHAPTER_TARGET = 15_000

type ImportMode = "paste" | "file"
type ExtractionMode = "full" | "frontier"
type ChapterDetection = "heuristic" | "fallback-length"
type ChapterConfidence = "strong" | "medium" | "weak" | "none"

interface SourceManifest {
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
    chaptersRoot: string
  }
}

interface ChapterIndexFile {
  version: 1
  chapters: Array<{
    title: string
    path: string
    characters?: number
  }>
}

interface SourceChapter {
  title: string
  path: string
  content: string
  characters: number
}

interface BuildInput {
  text: string
  title?: string
  fileName?: string
  sourceFormat: "txt" | "md"
  importMode: ImportMode
}

interface BuiltSourceCorpus {
  manifest: SourceManifest
  chapterIndex: ChapterIndexFile
  chapters: SourceChapter[]
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

interface RenderSourceImportOptions {
  tsian: TsianApi
  story: HTMLElement
  composer: HTMLElement | null
  setStatus: (text: string, state?: string) => void
}

type ImportStepView = "choose" | "paste" | "file" | "review" | "understanding"
type OpeningUnderstandingStatus = "idle" | "running" | "ready" | "failed"

interface OpeningCandidateCharacter {
  id?: string
  name: string
  brief: string
}

interface OpeningUnderstandingSummary {
  schema?: string
  status: "ready"
  title?: string
  summary: string
  entityCount?: number
  candidateCharacters?: OpeningCandidateCharacter[]
  sourceWindow?: {
    start?: number | null
    end?: number | null
  }
  extractedThrough?: string | null
  committedAt?: string
}

interface ImportGuideState {
  view: ImportStepView
  manifest: SourceManifest | null
  chapterIndex: ChapterIndexFile | null
  selectedChapter: number
  statusText: string
  errorText: string
  busy: boolean
  understandingStatus: OpeningUnderstandingStatus
  understandingSummary: OpeningUnderstandingSummary | null
  understandingStartedAt: number
}

interface SetupActionConfig {
  secondaryLabel?: string
  secondaryDisabled?: boolean
  onSecondary?: () => void
  tertiaryLabel?: string
  tertiaryDisabled?: boolean
  onTertiary?: () => void
  primaryLabel: string
  primaryDisabled?: boolean
  onPrimary?: () => void
  statusText?: string
}

interface ImportInputElements {
  titleInput: HTMLInputElement
  fileInput?: HTMLInputElement
  textarea?: HTMLTextAreaElement
}

function createEl<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag)
  if (className) el.className = className
  if (text !== undefined) el.textContent = text
  return el
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

function isSourceManifest(value: unknown): value is SourceManifest {
  return typeof value === "object"
    && value !== null
    && (value as { status?: unknown }).status === "ready"
}

function isOpeningUnderstandingSummary(value: unknown): value is OpeningUnderstandingSummary {
  return typeof value === "object"
    && value !== null
    && (value as { status?: unknown }).status === "ready"
    && typeof (value as { summary?: unknown }).summary === "string"
}

function formatNumber(num: number): string {
  return new Intl.NumberFormat("zh-CN").format(num || 0)
}

function formatCharacters(num: number): string {
  if (num >= 10_000) {
    const wan = num / 10_000
    return `${wan >= 100 ? Math.round(wan) : wan.toFixed(1)} 万字`
  }
  return `${formatNumber(num)} 字`
}

function formatOptionalCharacters(num: number | undefined): string {
  return typeof num === "number" ? formatCharacters(num) : "—"
}

function excerptText(text: string, limit = 1_100): string {
  const cleaned = text
    .replace(/^#\s+.*\n+/, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
  if (cleaned.length <= limit) return cleaned
  return `${cleaned.slice(0, limit).trimEnd()}……`
}

function inferTitle(text: string, fileName?: string): string {
  if (fileName) {
    const title = fileName.replace(/\.(txt|md)$/i, "").trim()
    if (title) return title
  }
  const firstLine = text.split("\n").map((line) => line.trim()).find(Boolean)
  if (!firstLine) return "导入小说"
  return firstLine.length > 40 ? firstLine.slice(0, 40) : firstLine
}

function normalizeNovelText(text: string): string {
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

function isBoundaryLine(lines: string[], index: number): boolean {
  const prev = index <= 0 ? "" : lines[index - 1]?.trim() ?? ""
  const next = index >= lines.length - 1 ? "" : lines[index + 1]?.trim() ?? ""
  return !prev || !next
}

function toAsciiDigits(value: string): string {
  return value.replace(/[０-９]/g, (ch) => String(ch.charCodeAt(0) - 0xFF10))
}

function classifyChapterLine(rawLine: string, lines: string[], index: number): Omit<ChapterCandidate, "lineIndex" | "offset"> | null {
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

  const strongOrMedium = candidates.filter((item) => item.confidence === "strong" || item.confidence === "medium")
  if (strongOrMedium.length >= 2 || (strongOrMedium.length === 1 && strongOrMedium[0]!.offset < 2_000)) {
    return {
      candidates: strongOrMedium,
      confidence: strongOrMedium.some((item) => item.confidence === "strong") ? "strong" : "medium",
    }
  }

  const weak = candidates.filter((item) => item.confidence === "weak" && Number.isFinite(item.numeric))
  let sequential = 0
  for (let index = 1; index < weak.length; index += 1) {
    if (weak[index]!.numeric === weak[index - 1]!.numeric! + 1) sequential += 1
  }
  if (weak.length >= 3 && sequential >= 2) {
    return { candidates: weak, confidence: "weak" }
  }

  return { candidates: [], confidence: "none" }
}

function splitByCandidates(text: string, detected: ChapterDetectionResult): Array<{ title: string; content: string; pseudo: boolean }> {
  return detected.candidates.map((current, index) => {
    const next = detected.candidates[index + 1]
    return {
      title: current.title,
      content: `${text.slice(current.offset, next ? next.offset : text.length).trim()}\n`,
      pseudo: false,
    }
  })
}

function splitPseudoChapters(text: string): Array<{ title: string; content: string; pseudo: boolean }> {
  const paragraphs = text.split(/\n{2,}/)
  const chapters: Array<{ title: string; content: string; pseudo: boolean }> = []
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

function buildSourceCorpus(rawText: string, input: Omit<BuildInput, "text">): BuiltSourceCorpus {
  const normalized = normalizeNovelText(rawText)
  if (!normalized.trim()) {
    throw new Error("导入文本为空。")
  }

  const detected = findChapterCandidates(normalized)
  const useDetected = detected.candidates.length > 0
  const sourceChapters = useDetected ? splitByCandidates(normalized, detected) : splitPseudoChapters(normalized)
  const chapters = sourceChapters.map<SourceChapter>((chapter, index) => {
    const chapterNumber = index + 1
    const id = chapter.pseudo ? `pseudo-chapter-${pad4(chapterNumber)}` : `chapter-${pad4(chapterNumber)}`
    const path = `${CHAPTERS_ROOT}${id}.md`
    const content = chapter.content.trimStart().startsWith("#")
      ? chapter.content
      : `# ${chapter.title}\n\n${chapter.content}`
    return { title: chapter.title, path, content, characters: excerptText(content, Number.MAX_SAFE_INTEGER).length }
  })

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
      chaptersRoot: CHAPTERS_ROOT,
    },
  }
  const chapterIndex: ChapterIndexFile = {
    version: 1,
    chapters: chapters.map(({ title, path, characters }) => ({ title, path, characters })),
  }
  return { manifest, chapterIndex, chapters }
}

async function loadSourceManifest(tsian: TsianApi): Promise<SourceManifest | null> {
  const file = await tsian.workspace.read(SOURCE_MANIFEST_PATH)
  if (!file?.content) return null
  const data = safeJsonParse(file.content)
  return isSourceManifest(data) ? data : null
}

async function loadChapterIndex(tsian: TsianApi): Promise<ChapterIndexFile | null> {
  const file = await tsian.workspace.read(CHAPTER_INDEX_PATH)
  if (!file?.content) return null
  const data = safeJsonParse(file.content)
  if (typeof data !== "object" || data === null || !Array.isArray((data as { chapters?: unknown }).chapters)) {
    return null
  }
  const chapters = (data as { chapters: unknown[] }).chapters.flatMap((chapter) => {
    if (typeof chapter !== "object" || chapter === null) return []
    const item = chapter as { title?: unknown; path?: unknown; characters?: unknown }
    if (typeof item.title !== "string" || typeof item.path !== "string") return []
    return [{
      title: item.title,
      path: item.path,
      ...(typeof item.characters === "number" ? { characters: item.characters } : {}),
    }]
  })
  return { version: 1, chapters }
}

async function loadOpeningUnderstandingSummary(tsian: TsianApi): Promise<OpeningUnderstandingSummary | null> {
  const file = await tsian.workspace.read(INITIAL_SUMMARY_PATH)
  if (!file?.content) return null
  const data = safeJsonParse(file.content)
  return isOpeningUnderstandingSummary(data) ? data : null
}

async function ensureChapterCharacters(tsian: TsianApi, index: ChapterIndexFile | null): Promise<ChapterIndexFile | null> {
  if (!index || index.chapters.every((chapter) => typeof chapter.characters === "number")) return index

  const chapters = await Promise.all(index.chapters.map(async (chapter) => {
    if (typeof chapter.characters === "number") return chapter
    const file = await tsian.workspace.read(chapter.path)
    return {
      ...chapter,
      characters: excerptText(file?.content ?? "", Number.MAX_SAFE_INTEGER).length,
    }
  }))
  const updated = { version: 1 as const, chapters }
  await tsian.workspace.write(CHAPTER_INDEX_PATH, `${JSON.stringify(updated, null, 2)}\n`)
  return updated
}

function setComposerHidden(composer: HTMLElement | null, hidden: boolean): void {
  if (composer) composer.classList.toggle("hidden", hidden)
}

async function readImportInput(mode: ImportMode, elements: ImportInputElements): Promise<BuildInput> {
  if (mode === "file") {
    const file = elements.fileInput?.files?.[0]
    if (!file) throw new Error("请选择要导入的小说文件。")
    return {
      text: await file.text(),
      fileName: file.name,
      sourceFormat: file.name.toLowerCase().endsWith(".md") ? "md" : "txt",
      importMode: "file",
    }
  }
  const text = elements.textarea?.value ?? ""
  if (!text.trim()) throw new Error("请先粘贴小说文本。")
  return {
    text,
    sourceFormat: "txt",
    importMode: "paste",
  }
}

function setupStepIndex(view: ImportStepView): number {
  return view === "understanding" ? 1 : 0
}

function renderStepper(currentIndex: number, completedUntil: number): HTMLElement {
  const steps = ["导入小说", "初始理解", "角色设定", "游玩倾向", "开局确认"]
  const rail = createEl("nav", "setup-stepper")
  // 贯通到屏幕尽头的轨道线（装饰延长，不承载 fill）
  rail.appendChild(createEl("div", "setup-stepper-line"))

  // 节点群居中聚拢，内含精确对应节点位置的 fill 进度线
  const nodes = createEl("ol", "setup-stepper-nodes")
  const fillRatio = steps.length > 1 ? currentIndex / (steps.length - 1) : 0
  const fill = createEl("div", "setup-stepper-fill")
  fill.style.transform = `scaleX(${fillRatio})`
  nodes.appendChild(fill)
  steps.forEach((step, index) => {
    const done = index <= completedUntil
    const current = index === currentIndex
    const statusClass = current ? "current" : done ? "done" : "locked"
    const item = createEl("li", `setup-stepper-node ${statusClass}`)
    const dot = createEl("span", "setup-stepper-dot")
    if (done && !current) {
      const check = createEl("span", "setup-stepper-check", "✓")
      dot.appendChild(check)
    }
    item.appendChild(dot)
    item.appendChild(createEl("span", "setup-stepper-label", step))
    nodes.appendChild(item)
  })
  rail.appendChild(nodes)
  return rail
}

function renderActionBar(config: SetupActionConfig): HTMLElement {
  const bar = createEl("div", "setup-action-bar")
  const left = createEl("div", "setup-action-left")
  const right = createEl("div", "setup-action-right")
  const secondary = createEl("button", "setup-btn secondary", config.secondaryLabel ?? "上一步")
  secondary.type = "button"
  secondary.disabled = config.secondaryDisabled ?? true
  secondary.addEventListener("click", () => config.onSecondary?.())
  left.appendChild(secondary)
  if (config.tertiaryLabel) {
    const tertiary = createEl("button", "setup-btn ghost", config.tertiaryLabel)
    tertiary.type = "button"
    tertiary.disabled = config.tertiaryDisabled ?? false
    tertiary.addEventListener("click", () => config.onTertiary?.())
    left.appendChild(tertiary)
  }
  if (config.statusText) left.appendChild(createEl("span", "setup-status", config.statusText))

  const primary = createEl("button", "setup-btn primary", config.primaryLabel)
  primary.type = "button"
  primary.disabled = config.primaryDisabled ?? false
  primary.addEventListener("click", () => config.onPrimary?.())
  right.appendChild(primary)
  bar.appendChild(left)
  bar.appendChild(right)
  return bar
}

function renderSetupShell(title: string, copy: string, content: HTMLElement, actionBar: HTMLElement, currentStepIndex: number, completedUntil: number): HTMLElement {
  const shell = createEl("div", "setup-shell")

  const body = createEl("div", "setup-body")
  // stepper 破出限宽容器，延长到屏幕尽头
  body.appendChild(renderStepper(currentStepIndex, completedUntil))
  const inner = createEl("div", "setup-inner")

  const stage = createEl("main", "setup-stage")
  const stageHead = createEl("div", "setup-stage-head")
  const stepNames = ["导入小说", "初始理解", "角色设定", "游玩倾向", "开局确认"]
  stageHead.appendChild(createEl("div", "setup-kicker", `Step ${String(currentStepIndex + 1).padStart(2, "0")} · ${stepNames[currentStepIndex] ?? "开局准备"}`))
  // choose 屏不渲染标题/副标题（title 为空即跳过），其余屏保留
  if (title) stageHead.appendChild(createEl("h2", "setup-stage-title", title))
  if (copy) stageHead.appendChild(createEl("p", "setup-copy", copy))
  stage.appendChild(stageHead)
  stage.appendChild(content)
  inner.appendChild(stage)
  body.appendChild(inner)
  shell.appendChild(body)

  const actionWrap = createEl("div", "setup-action-wrap")
  actionWrap.appendChild(actionBar)
  shell.appendChild(actionWrap)
  return shell
}

function renderMethodChoice(setView: (view: ImportStepView) => void): HTMLElement {
  const wrap = createEl("div", "setup-method-grid")
  const paste = createEl("button", "setup-method-card")
  paste.type = "button"
  paste.innerHTML = `<span class="setup-method-mark">贴</span><span class="setup-method-title">粘贴文本</span><span class="setup-method-copy">适合短篇、片段，或先拿一小段故事试试手感。</span>`
  paste.addEventListener("click", () => setView("paste"))

  const file = createEl("button", "setup-method-card")
  file.type = "button"
  file.innerHTML = `<span class="setup-method-mark">卷</span><span class="setup-method-title">导入文件</span><span class="setup-method-copy">适合完整长篇，把整本书放进当前存档。</span>`
  file.addEventListener("click", () => setView("file"))
  attachCardHover(paste)
  attachCardHover(file)
  wrap.appendChild(paste)
  wrap.appendChild(file)
  return wrap
}

function renderTitleField(): HTMLInputElement {
  const titleInput = createEl("input", "setup-input")
  titleInput.type = "text"
  titleInput.placeholder = "书名（可选，留空则自动推断）"
  return titleInput
}

function renderPasteInput(): { content: HTMLElement; elements: ImportInputElements } {
  const wrap = createEl("div", "setup-input-panel")
  const titleInput = renderTitleField()
  const textarea = createEl("textarea", "setup-textarea")
  textarea.placeholder = "在这里粘贴小说文本……"
  wrap.appendChild(titleInput)
  wrap.appendChild(textarea)
  return { content: wrap, elements: { titleInput, textarea } }
}

function renderFileInput(): { content: HTMLElement; elements: ImportInputElements } {
  const wrap = createEl("div", "setup-input-panel")
  const titleInput = renderTitleField()
  const fileBox = createEl("label", "setup-file-drop")
  fileBox.appendChild(createEl("span", "setup-file-title", "拖入或选择 .txt / .md 文件"))
  fileBox.appendChild(createEl("span", "setup-file-copy", "支持拖放，或点击选择。"))
  const fileInput = createEl("input", "setup-file")
  fileInput.type = "file"
  fileInput.accept = ".txt,.md,text/plain,text/markdown"
  fileBox.appendChild(fileInput)
  wrap.appendChild(titleInput)
  wrap.appendChild(fileBox)
  return { content: wrap, elements: { titleInput, fileInput } }
}

async function writeCorpus(tsian: TsianApi, corpus: BuiltSourceCorpus): Promise<void> {
  for (const chapter of corpus.chapters) {
    await tsian.workspace.write(chapter.path, chapter.content)
  }
  await tsian.workspace.write(CHAPTER_INDEX_PATH, `${JSON.stringify(corpus.chapterIndex, null, 2)}\n`)
  await tsian.workspace.write(SOURCE_MANIFEST_PATH, `${JSON.stringify(corpus.manifest, null, 2)}\n`)
}

async function loadChapterPreview(tsian: TsianApi, path: string): Promise<string> {
  const file = await tsian.workspace.read(path)
  return excerptText(file?.content ?? "") || "暂无可预览内容。"
}

function renderSplitReview(options: RenderSourceImportOptions, state: ImportGuideState, render: () => void): HTMLElement {
  const { tsian } = options
  const manifest = state.manifest
  const index = state.chapterIndex
  const wrap = createEl("div", "setup-review")
  if (!manifest) return wrap

  const overview = createEl("div", "setup-overview")
  overview.appendChild(createEl("div", "setup-book-title", manifest.title))
  const stats = createEl("div", "setup-overview-stats")
  stats.appendChild(createEl("span", "setup-stat", `${formatNumber(manifest.chapterCount)} 章`))
  stats.appendChild(createEl("span", "setup-stat", formatCharacters(manifest.totalCharacters)))
  overview.appendChild(stats)
  wrap.appendChild(overview)

  const chapters = index?.chapters ?? []
  const panes = createEl("div", "setup-review-panes")
  const list = createEl("div", "setup-chapter-list")
  const preview = createEl("div", "setup-preview")
  const selected = Math.max(0, Math.min(state.selectedChapter, chapters.length - 1))
  state.selectedChapter = selected

  chapters.forEach((chapter, index) => {
    const item = createEl("button", `setup-chapter-card ${index === selected ? "selected" : ""}`)
    item.type = "button"
    item.appendChild(createEl("span", "setup-chapter-num", String(index + 1).padStart(3, "0")))
    const body = createEl("span", "setup-chapter-main")
    body.appendChild(createEl("span", "setup-chapter-title", chapter.title || `第 ${index + 1} 章`))
    body.appendChild(createEl("span", "setup-chapter-size", formatOptionalCharacters(chapter.characters)))
    item.appendChild(body)
    item.addEventListener("click", () => {
      state.selectedChapter = index
      render()
    })
    list.appendChild(item)
  })

  const activeChapter = chapters[selected]
  preview.appendChild(createEl("div", "setup-preview-kicker", activeChapter ? `预览 · ${String(selected + 1).padStart(3, "0")}` : "预览"))
  preview.appendChild(createEl("h3", "setup-preview-title", activeChapter?.title ?? "暂无章节"))
  const previewBody = createEl("div", "setup-preview-body", activeChapter ? "读取预览中……" : "章节列表为空。")
  preview.appendChild(previewBody)
  if (activeChapter) {
    void loadChapterPreview(tsian, activeChapter.path).then((text) => {
      previewBody.textContent = text
    }).catch(() => {
      previewBody.textContent = "预览读取失败。"
    })
  }

  panes.appendChild(list)
  panes.appendChild(preview)
  wrap.appendChild(panes)
  return wrap
}

function buildOpeningInitializationPrompt(manifest: SourceManifest, index: ChapterIndexFile | null): string {
  const chapterCount = index?.chapters.length ?? manifest.chapterCount
  return [
    "玩家已经完成小说导入并确认切分结果。请作为 world-architect 使用 Skill《小说开局初始化》完成真实开局资料抽取。",
    "",
    "要求：",
    "1. 先 inspect_source_opening 观察导入 source。",
    "2. 再 read_opening_slice 连续阅读开头剧情；是否继续阅读以剧情是否足够支撑开局为准，不要按固定章节数机械停止。",
    "3. 最后 commit_opening_understanding 写入初始理解包、brief、实体、候选原著角色和 frontier。",
    "4. 保持未来剧情 spoiler-safe；只使用开头窗口中读到的内容。",
    "5. 如果提交工具返回校验错误，请按错误修正后重试，直到写入成功或明确失败。",
    "",
    `书名：${manifest.title}`,
    `章节数：${chapterCount}`,
    `文本量：${manifest.totalCharacters} 字`,
    "完成后用中文简短告诉前端已经写入哪些开局资料。",
  ].join("\n")
}

// 初始理解 running 阶段文案，按经过时间推进（粗略对应 skill 三步）
const UNDERSTANDING_STAGES = [
  "正在观察导入结构…",
  "正在阅读开头剧情…",
  "正在整理开局资料…",
  "正在写入…",
]

function currentUnderstandingStage(startedAt: number): number {
  if (!startedAt) return 0
  const elapsed = Date.now() - startedAt
  // 每 12s 推进一阶段，最后阶段停留
  return Math.min(UNDERSTANDING_STAGES.length - 1, Math.floor(elapsed / 12_000))
}

// running 态的持久引用：render 重建 DOM 后重新绑定，定时器借此直接更新文案
// 不触发整体重绘（避免反复入场动画 + GSAP timeline 泄露）。
let runningStageEl: HTMLElement | null = null
let runningEmberTimeline: ReturnType<typeof animateEmbers> | null = null

function renderOpeningUnderstanding(state: ImportGuideState): HTMLElement {
  const wrap = createEl("div", "setup-understanding")

  if (state.understandingStatus === "running") {
    const stageIdx = currentUnderstandingStage(state.understandingStartedAt)
    const card = createEl("div", "setup-understanding-running")
    const embers = createEl("div", "setup-embers")
    embers.appendChild(createEl("span", "setup-ember"))
    embers.appendChild(createEl("span", "setup-ember"))
    embers.appendChild(createEl("span", "setup-ember"))
    card.appendChild(embers)
    const stageEl = createEl("div", "setup-understanding-stage", UNDERSTANDING_STAGES[stageIdx] ?? UNDERSTANDING_STAGES[0]!)
    card.appendChild(stageEl)
    wrap.appendChild(card)
    // 挂载后启动烛火动画 + 记引用供定时器直接更新文案
    requestAnimationFrame(() => {
      runningEmberTimeline?.kill()
      runningEmberTimeline = animateEmbers(embers)
      runningStageEl = stageEl
    })
    return wrap
  }

  if (state.understandingStatus === "failed") {
    wrap.appendChild(createEl("div", "setup-understanding-card failed", "理解未完成。"))
    wrap.appendChild(createEl("p", "setup-understanding-copy", "可重试，或返回重新导入后再来。"))
    return wrap
  }

  const summary = state.understandingSummary
  if (!summary) {
    wrap.appendChild(createEl("div", "setup-understanding-card", "准备开始。"))
    wrap.appendChild(createEl("p", "setup-understanding-copy", "让系统阅读足够的开头剧情，整理出后续要用的资料。"))
    return wrap
  }

  // ready：极简分支入口，不显示 brief / meta
  const branch = createEl("div", "setup-understanding-branch")
  branch.appendChild(createEl("div", "setup-branch-question", "你想以谁的身份走进这个故事？"))
  const cards = createEl("div", "setup-branch-cards")
  const canon = createEl("button", "setup-branch-card")
  canon.type = "button"
  canon.appendChild(createEl("span", "setup-branch-title", "原著角色"))
  canon.appendChild(createEl("span", "setup-branch-copy", "扮演故事里已有的人"))
  canon.addEventListener("click", () => {
    // 第三步角色设定未实现；暂记意图，stepper 不前进
    state.statusText = "角色设定即将开放"
    render()
  })
  const original = createEl("button", "setup-branch-card")
  original.type = "button"
  original.appendChild(createEl("span", "setup-branch-title", "原创角色"))
  original.appendChild(createEl("span", "setup-branch-copy", "创造一个全新的角色"))
  original.addEventListener("click", () => {
    state.statusText = "角色设定即将开放"
    render()
  })
  cards.appendChild(canon)
  cards.appendChild(original)
  attachCardHover(canon)
  attachCardHover(original)
  branch.appendChild(cards)
  wrap.appendChild(branch)
  return wrap
}

function renderImportGuide(options: RenderSourceImportOptions, initialManifest: SourceManifest | null, initialIndex: ChapterIndexFile | null, initialSummary: OpeningUnderstandingSummary | null): void {
  const { tsian, story, composer, setStatus } = options
  setComposerHidden(composer, true)

  const state: ImportGuideState = {
    view: initialSummary ? "understanding" : initialManifest ? "review" : "choose",
    manifest: initialManifest,
    chapterIndex: initialIndex,
    selectedChapter: 0,
    statusText: initialSummary ? "初始理解已完成" : initialManifest ? "已导入小说" : "等待选择导入方式",
    errorText: "",
    busy: false,
    understandingStatus: initialSummary ? "ready" : "idle",
    understandingSummary: initialSummary,
    understandingStartedAt: 0,
  }

  let activeElements: ImportInputElements | null = null

  const setView = (view: ImportStepView): void => {
    state.view = view
    state.errorText = ""
    state.statusText = view === "choose" ? "等待选择导入方式" : state.statusText
    render()
  }

  const startImport = (mode: ImportMode): void => {
    if (!activeElements || state.busy) return
    const elements = activeElements
    state.busy = true
    state.errorText = ""
    state.statusText = "读取文本…"
    void (async () => {
      try {
        const input = await readImportInput(mode, elements)
        input.title = elements.titleInput.value.trim()
        state.statusText = "整理章节…"
        render()
        const corpus = buildSourceCorpus(input.text, input)
        state.statusText = "写入章节…"
        render()
        await writeCorpus(tsian, corpus)
        state.manifest = corpus.manifest
        state.chapterIndex = corpus.chapterIndex
        state.selectedChapter = 0
        state.understandingStatus = "idle"
        state.understandingSummary = null
        state.view = "review"
        state.statusText = "小说已导入"
        setStatus("小说已导入", "ready")
      } catch (err) {
        const message = err instanceof Error ? err.message : "导入失败"
        state.errorText = message
        state.statusText = "导入失败"
        setStatus(message, "error")
      } finally {
        state.busy = false
        render()
      }
    })()
  }

  const confirmReimport = (): void => {
    if (window.confirm("重新导入会覆盖当前小说文本与章节目录。确定要换源吗？")) {
      state.manifest = null
      state.chapterIndex = null
      state.selectedChapter = 0
      state.understandingStatus = "idle"
      state.understandingSummary = null
      state.statusText = "等待选择导入方式"
      setView("choose")
    }
  }

  const startOpeningUnderstanding = (): void => {
    if (!state.manifest || state.busy) return
    state.busy = true
    state.errorText = ""
    state.understandingStatus = "running"
    state.understandingStartedAt = Date.now()
    state.statusText = "理解中…"
    state.view = "understanding"
    render()
    void (async () => {
      // running 期间定时重绘，推进阶段文案（纯视觉，不反映真实进度）
      const stageTimer = window.setInterval(() => {
        if (state.understandingStatus === "running") render()
      }, 3000)
      try {
        const prompt = buildOpeningInitializationPrompt(state.manifest as SourceManifest, state.chapterIndex)
        await tsian.invokeAgent("world-architect", prompt)
        const summary = await loadOpeningUnderstandingSummary(tsian)
        if (!summary) throw new Error("理解未完成，没找到结果。请重试。")
        state.understandingSummary = summary
        state.understandingStatus = "ready"
        state.statusText = "初始理解已完成"
        setStatus("初始理解已完成", "ready")
      } catch (err) {
        const message = err instanceof Error ? err.message : "初始理解失败"
        state.errorText = message
        state.understandingStatus = "failed"
        state.statusText = "初始理解失败"
        setStatus(message, "error")
      } finally {
        window.clearInterval(stageTimer)
        state.busy = false
        render()
      }
    })()
  }

  function render(): void {
    story.innerHTML = ""
    activeElements = null
    let title = ""
    let copy = ""
    let content: HTMLElement
    let actions: SetupActionConfig = {
      primaryLabel: "下一步",
      primaryDisabled: true,
      statusText: state.statusText,
    }

    if (state.view === "choose") {
      content = renderMethodChoice(setView)
      actions = {
        secondaryLabel: "上一步",
        secondaryDisabled: true,
        primaryLabel: "选择导入方式",
        primaryDisabled: true,
        statusText: state.statusText,
      }
    } else if (state.view === "paste") {
      title = "粘贴小说"
      copy = "适合短篇或片段，也可先拿一小段试试。"
      const rendered = renderPasteInput()
      activeElements = rendered.elements
      content = rendered.content
      actions = {
        secondaryLabel: "返回",
        secondaryDisabled: state.busy,
        onSecondary: () => setView("choose"),
        primaryLabel: state.busy ? "导入中…" : "导入",
        primaryDisabled: state.busy,
        onPrimary: () => startImport("paste"),
        statusText: state.statusText,
      }
    } else if (state.view === "file") {
      title = "导入文件"
      copy = "支持 .txt / .md，适合完整长篇。"
      const rendered = renderFileInput()
      activeElements = rendered.elements
      content = rendered.content
      // 真拖放支持：拖入文件时写入 fileInput.files 再走统一导入链
      const dropZone = content.querySelector(".setup-file-drop") as HTMLElement | null
      const fileInput = rendered.elements.fileInput
      if (dropZone && fileInput) {
        dropZone.addEventListener("dragover", (event) => {
          event.preventDefault()
          dropZone.classList.add("dragging")
        })
        dropZone.addEventListener("dragleave", () => dropZone.classList.remove("dragging"))
        dropZone.addEventListener("drop", (event) => {
          event.preventDefault()
          dropZone.classList.remove("dragging")
          const dropped = event.dataTransfer?.files?.[0]
          if (dropped) {
            const transfer = new DataTransfer()
            transfer.items.add(dropped)
            fileInput.files = transfer.files
            startImport("file")
          }
        })
      }
      actions = {
        secondaryLabel: "返回",
        secondaryDisabled: state.busy,
        onSecondary: () => setView("choose"),
        primaryLabel: state.busy ? "导入中…" : "导入",
        primaryDisabled: state.busy,
        onPrimary: () => startImport("file"),
        statusText: state.statusText,
      }
    } else if (state.view === "review") {
      title = "确认目录"
      copy = "检查章节是否符合预期，开局前可重新导入。"
      content = renderSplitReview(options, state, render)
      actions = {
        secondaryLabel: "返回",
        secondaryDisabled: state.busy,
        onSecondary: () => setView("choose"),
        tertiaryLabel: "重新导入",
        tertiaryDisabled: state.busy,
        onTertiary: confirmReimport,
        primaryLabel: state.understandingStatus === "ready" ? "查看理解" : "开始理解",
        primaryDisabled: state.busy || !state.manifest,
        onPrimary: state.understandingStatus === "ready" ? () => setView("understanding") : startOpeningUnderstanding,
        statusText: state.statusText,
      }
    } else {
      title = state.understandingSummary ? "初始理解" : "初始理解"
      copy = "让系统阅读足够的开头剧情，整理出后续要用的资料。"
      content = renderOpeningUnderstanding(state)
      actions = {
        secondaryLabel: "返回目录",
        secondaryDisabled: state.busy,
        onSecondary: () => setView("review"),
        primaryLabel: state.understandingStatus === "ready" ? "下一步" : state.busy ? "理解中…" : "开始理解",
        primaryDisabled: state.busy || state.understandingStatus === "ready" || !state.manifest,
        onPrimary: startOpeningUnderstanding,
        statusText: state.statusText,
      }
    }

    if (state.errorText) content.appendChild(createEl("div", "setup-error", state.errorText))
    const currentStep = setupStepIndex(state.view)
    const completedUntil = state.understandingStatus === "ready" ? 1 : state.manifest ? 0 : -1
    const shell = renderSetupShell(title, copy, content, renderActionBar(actions), currentStep, completedUntil)
    story.appendChild(shell)
    animateStepEnter(shell)
  }

  render()
}

export async function initializeSourceImportGuide(options: RenderSourceImportOptions): Promise<boolean> {
  const manifest = await loadSourceManifest(options.tsian)
  const chapterIndex = manifest ? await ensureChapterCharacters(options.tsian, await loadChapterIndex(options.tsian)) : null
  const summary = manifest ? await loadOpeningUnderstandingSummary(options.tsian) : null
  renderImportGuide(options, manifest, chapterIndex, summary)
  return true
}
