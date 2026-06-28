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
  }>
}

interface SourceChapter {
  title: string
  path: string
  content: string
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
    return { title: chapter.title, path, content }
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
    chapters: chapters.map(({ title, path }) => ({ title, path })),
  }
  return { manifest, chapterIndex, chapters }
}

async function loadSourceManifest(tsian: TsianApi): Promise<SourceManifest | null> {
  const file = await tsian.workspace.read(SOURCE_MANIFEST_PATH)
  if (!file?.content) return null
  const data = safeJsonParse(file.content)
  return isSourceManifest(data) ? data : null
}

function renderSetupSummary(manifest: SourceManifest): HTMLDivElement {
  const summary = createEl("div", "setup-summary")
  summary.innerHTML = `<b>已导入：</b>${manifest.title}<br>字数：${formatNumber(manifest.totalCharacters)} · 章节：${formatNumber(manifest.chapterCount)} · 策略：${manifest.recommendedExtractionMode === "full" ? "全量抽取" : "渐进抽取"}<br>下一步：开局向导将基于小说内容初始化角色与开局。`
  return summary
}

function setComposerHidden(composer: HTMLElement | null, hidden: boolean): void {
  if (composer) composer.classList.toggle("hidden", hidden)
}

async function readImportInput(fileInput: HTMLInputElement, textarea: HTMLTextAreaElement): Promise<BuildInput> {
  const file = fileInput.files?.[0]
  if (file) {
    return {
      text: await file.text(),
      fileName: file.name,
      sourceFormat: file.name.toLowerCase().endsWith(".md") ? "md" : "txt",
      importMode: "file",
    }
  }
  return {
    text: textarea.value,
    sourceFormat: "txt",
    importMode: "paste",
  }
}

function renderImportGuide(options: RenderSourceImportOptions, existingManifest: SourceManifest | null): void {
  const { tsian, story, composer, setStatus } = options
  setComposerHidden(composer, true)
  story.innerHTML = ""

  const card = createEl("div", "setup-card")
  card.appendChild(createEl("div", "setup-kicker", "Opening Guide · Step 1"))
  card.appendChild(createEl("h1", "setup-title", existingManifest ? "小说已导入" : "导入一部小说"))
  card.appendChild(createEl("p", "setup-copy", existingManifest
    ? "当前存档已拥有 source corpus。若想更换小说，请通过平台新建存档重新开始。"
    : "粘贴短篇或片段，或选择 .txt / .md 长篇文件。导入后会生成章节级 source 文件和章节目录。"))

  if (existingManifest) {
    card.appendChild(renderSetupSummary(existingManifest))
    story.appendChild(card)
    return
  }

  const grid = createEl("div", "setup-grid")
  const titleField = createEl("label", "setup-field")
  titleField.appendChild(createEl("span", "setup-label", "书名（可选）"))
  const titleInput = createEl("input", "setup-input")
  titleInput.type = "text"
  titleInput.placeholder = "未填写时从文件名或首行推断"
  titleField.appendChild(titleInput)

  const fileField = createEl("label", "setup-field")
  fileField.appendChild(createEl("span", "setup-label", "文件导入（长篇）"))
  const fileInput = createEl("input", "setup-file")
  fileInput.type = "file"
  fileInput.accept = ".txt,.md,text/plain,text/markdown"
  fileField.appendChild(fileInput)

  const textField = createEl("label", "setup-field span-2")
  textField.appendChild(createEl("span", "setup-label", "粘贴文本（短篇/片段）"))
  const textarea = createEl("textarea", "setup-textarea")
  textarea.placeholder = "在这里粘贴小说文本……"
  textField.appendChild(textarea)

  grid.appendChild(titleField)
  grid.appendChild(fileField)
  grid.appendChild(textField)
  card.appendChild(grid)

  const actions = createEl("div", "setup-actions")
  const button = createEl("button", "setup-btn", "导入小说")
  button.type = "button"
  const state = createEl("span", "setup-status", "等待导入")
  actions.appendChild(button)
  actions.appendChild(state)
  card.appendChild(actions)
  const error = createEl("div", "setup-error")
  card.appendChild(error)

  const refreshReadyHint = (): void => {
    if (busy) return
    const file = fileInput.files?.[0]
    const pastedLength = textarea.value.trim().length
    if (file) {
      state.textContent = `已选择 ${file.name}，点击“导入小说”开始`
      button.textContent = "导入所选文件"
      return
    }
    if (pastedLength > 0) {
      state.textContent = `已输入 ${formatNumber(pastedLength)} 字，点击“导入小说”开始`
      button.textContent = "导入粘贴文本"
      return
    }
    state.textContent = "等待导入"
    button.textContent = "导入小说"
  }

  fileInput.addEventListener("change", refreshReadyHint)
  textarea.addEventListener("input", refreshReadyHint)

  let busy = false
  button.addEventListener("click", () => {
    if (busy) return
    busy = true
    button.disabled = true
    error.textContent = ""
    void (async () => {
      try {
        state.textContent = "读取文本…"
        const input = await readImportInput(fileInput, textarea)
        input.title = titleInput.value.trim()
        state.textContent = "规范化与章节识别…"
        const corpus = buildSourceCorpus(input.text, input)
        state.textContent = "写入章节…"
        for (const chapter of corpus.chapters) {
          await tsian.workspace.write(chapter.path, chapter.content)
        }
        state.textContent = "写入目录…"
        await tsian.workspace.write(CHAPTER_INDEX_PATH, `${JSON.stringify(corpus.chapterIndex, null, 2)}\n`)
        state.textContent = "写入 manifest…"
        await tsian.workspace.write(SOURCE_MANIFEST_PATH, `${JSON.stringify(corpus.manifest, null, 2)}\n`)
        setStatus("小说已导入", "ready")
        renderImportGuide(options, corpus.manifest)
      } catch (err) {
        const message = err instanceof Error ? err.message : "导入失败"
        error.textContent = message
        state.textContent = "导入失败"
        setStatus(message, "error")
      } finally {
        busy = false
        button.disabled = false
      }
    })()
  })

  story.appendChild(card)
}

export async function initializeSourceImportGuide(options: RenderSourceImportOptions): Promise<boolean> {
  const manifest = await loadSourceManifest(options.tsian)
  if (manifest) {
    renderImportGuide(options, manifest)
    return true
  }
  renderImportGuide(options, null)
  return true
}
