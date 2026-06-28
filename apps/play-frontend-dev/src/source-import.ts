import type { TsianApi } from "@tsian/play-bridge"

const SOURCE_MANIFEST_PATH = "save/source/manifest.json"
const CHAPTER_INDEX_PATH = "save/source/chapters.index.json"
const CHAPTERS_ROOT = "save/source/chapters/"
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

type ImportStepView = "choose" | "paste" | "file" | "review"

interface ImportGuideState {
  view: ImportStepView
  manifest: SourceManifest | null
  chapterIndex: ChapterIndexFile | null
  selectedChapter: number
  statusText: string
  errorText: string
  busy: boolean
}

interface SetupActionConfig {
  secondaryLabel?: string
  secondaryDisabled?: boolean
  onSecondary?: () => void
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

function renderStepRail(): HTMLElement {
  const steps = ["导入小说", "初始理解", "角色设定", "游玩倾向", "开局确认"]
  const rail = createEl("aside", "setup-step-rail")
  rail.appendChild(createEl("div", "setup-rail-title", "流程"))
  const list = createEl("ol", "setup-step-list")
  steps.forEach((step, index) => {
    const item = createEl("li", `setup-step ${index === 0 ? "current" : "locked"}`)
    item.appendChild(createEl("span", "setup-step-num", String(index + 1).padStart(2, "0")))
    const body = createEl("span", "setup-step-body")
    body.appendChild(createEl("span", "setup-step-name", step))
    body.appendChild(createEl("span", "setup-step-state", index === 0 ? "当前步骤" : "待开放"))
    item.appendChild(body)
    list.appendChild(item)
  })
  rail.appendChild(list)
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

function renderSetupShell(title: string, copy: string, content: HTMLElement, actionBar: HTMLElement): HTMLElement {
  const shell = createEl("div", "setup-shell")
  const header = createEl("header", "setup-header")
  header.appendChild(createEl("div", "setup-eyebrow", "Opening Guide"))
  header.appendChild(createEl("div", "setup-header-copy", "正式游玩前的开局准备"))

  const body = createEl("div", "setup-body")
  const workspace = createEl("div", "setup-workspace")
  const stage = createEl("main", "setup-stage")
  const stageHead = createEl("div", "setup-stage-head")
  stageHead.appendChild(createEl("div", "setup-kicker", "Step 01 · 导入小说"))
  stageHead.appendChild(createEl("h2", "setup-stage-title", title))
  stageHead.appendChild(createEl("p", "setup-copy", copy))
  stage.appendChild(stageHead)
  stage.appendChild(content)
  workspace.appendChild(renderStepRail())
  workspace.appendChild(stage)
  body.appendChild(workspace)

  shell.appendChild(header)
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
  fileBox.appendChild(createEl("span", "setup-file-title", "选择 .txt / .md 小说文件"))
  fileBox.appendChild(createEl("span", "setup-file-copy", "选择后点击底部按钮开始导入。"))
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

function renderImportGuide(options: RenderSourceImportOptions, initialManifest: SourceManifest | null, initialIndex: ChapterIndexFile | null): void {
  const { tsian, story, composer, setStatus } = options
  setComposerHidden(composer, true)

  const state: ImportGuideState = {
    view: initialManifest ? "review" : "choose",
    manifest: initialManifest,
    chapterIndex: initialIndex,
    selectedChapter: 0,
    statusText: initialManifest ? "已导入小说" : "等待选择导入方式",
    errorText: "",
    busy: false,
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
      state.statusText = "等待选择导入方式"
      setView("choose")
    }
  }

  function render(): void {
    story.innerHTML = ""
    activeElements = null
    let title = "导入一部小说"
    let copy = "先选择一种导入方式。导入完成后，你可以检查目录和章节开头。"
    let content: HTMLElement
    let actions: SetupActionConfig = {
      primaryLabel: "下一步（后续）",
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
      title = "粘贴小说文本"
      copy = "适合短篇、片段，或先用一小段文本确认开局流程。"
      const rendered = renderPasteInput()
      activeElements = rendered.elements
      content = rendered.content
      actions = {
        secondaryLabel: "更换导入方式",
        secondaryDisabled: state.busy,
        onSecondary: () => setView("choose"),
        primaryLabel: state.busy ? "导入中…" : "导入文本",
        primaryDisabled: state.busy,
        onPrimary: () => startImport("paste"),
        statusText: state.statusText,
      }
    } else if (state.view === "file") {
      title = "导入小说文件"
      copy = "适合完整长篇小说，支持 .txt 和 .md 文件。"
      const rendered = renderFileInput()
      activeElements = rendered.elements
      content = rendered.content
      actions = {
        secondaryLabel: "更换导入方式",
        secondaryDisabled: state.busy,
        onSecondary: () => setView("choose"),
        primaryLabel: state.busy ? "导入中…" : "导入文件",
        primaryDisabled: state.busy,
        onPrimary: () => startImport("file"),
        statusText: state.statusText,
      }
    } else {
      title = "检查切分结果"
      copy = "确认目录和章节开头是否符合预期。开局前可以重新导入。"
      content = renderSplitReview(options, state, render)
      actions = {
        secondaryLabel: "重新导入",
        secondaryDisabled: state.busy,
        onSecondary: confirmReimport,
        primaryLabel: "继续初始化（后续）",
        primaryDisabled: true,
        statusText: state.statusText,
      }
    }

    if (state.errorText) content.appendChild(createEl("div", "setup-error", state.errorText))
    story.appendChild(renderSetupShell(title, copy, content, renderActionBar(actions)))
  }

  render()
}

export async function initializeSourceImportGuide(options: RenderSourceImportOptions): Promise<boolean> {
  const manifest = await loadSourceManifest(options.tsian)
  const chapterIndex = manifest ? await ensureChapterCharacters(options.tsian, await loadChapterIndex(options.tsian)) : null
  renderImportGuide(options, manifest, chapterIndex)
  return true
}
