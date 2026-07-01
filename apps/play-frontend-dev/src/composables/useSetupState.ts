import { ref, readonly } from "vue"
import { useTsian } from "./useTsian"
import {
  SOURCE_MANIFEST_PATH,
  CHAPTER_INDEX_PATH,
  INITIAL_SUMMARY_PATH,
  buildSourceCorpus,
  buildOpeningInitializationPrompt,
  safeJsonParse,
  isSourceManifest,
  isOpeningUnderstandingSummary,
  excerptText,
  type SourceManifest,
  type ChapterIndexFile,
  type OpeningUnderstandingSummary,
  type ImportMode,
} from "../lib/source"

/**
 * useSetupState — 向导响应式状态机（替代 source-import.legacy.ts 闭包 state）。
 *
 * design §3：step/subView/understandingStatus/importData 全部 reactive，
 * 状态变 → Vue 响应式自动渲染（替代 legacy 手动 render() 重建 DOM）。
 *
 * 模块级单例共享（同 useTsian 模式），所有 setup 组件共用同一份状态。
 */

// ── 向导视图类型 ──
export type SetupStep = 1 | 2 | 3 | 4 | 5
export type SetupSubView = "choose" | "paste" | "file" | "review" | "understanding"
export type UnderstandingStatus = "idle" | "running" | "ready" | "failed"

// ── 模块级共享响应式状态 ──
const step = ref<SetupStep>(1)
const subView = ref<SetupSubView>("choose")
const understandingStatus = ref<UnderstandingStatus>("idle")

const manifest = ref<SourceManifest | null>(null)
const chapterIndex = ref<ChapterIndexFile | null>(null)
const selectedChapter = ref(0)
const understandingSummary = ref<OpeningUnderstandingSummary | null>(null)

const busy = ref(false)
const statusText = ref("等待选择导入方式")
const errorText = ref("")

// 初始化状态
const initializing = ref(true)
const initialized = ref(false)

// understanding running 阶段计时
let understandingStartedAt = 0
let stageTimer = 0

// agent 心跳：understanding running 时监听 onAgentActivity（独立通道，
// 不经过 turn-delta/turn-tool，不污染主游玩 stream），递增计数器给
// running 组件"它还活着"的视觉脉冲信号
const agentHeartbeat = ref(0)
let heartbeatUnsub: Array<() => void> = []

function startHeartbeat(): void {
  stopHeartbeat()
  const { tsian } = useTsian()
  heartbeatUnsub = [
    tsian.onAgentActivity(() => {
      if (understandingStatus.value === "running") {
        agentHeartbeat.value++
      }
    }),
  ]
}

function stopHeartbeat(): void {
  for (const unsub of heartbeatUnsub) unsub()
  heartbeatUnsub = []
  agentHeartbeat.value = 0
}

// ── workspace 读写（通过 bridge）──

async function loadSourceManifest(tsian: ReturnType<typeof useTsian>["tsian"]): Promise<SourceManifest | null> {
  const file = await tsian.workspace.read(SOURCE_MANIFEST_PATH)
  if (!file?.content) return null
  const data = safeJsonParse(file.content)
  return isSourceManifest(data) ? data : null
}

async function loadChapterIndex(tsian: ReturnType<typeof useTsian>["tsian"]): Promise<ChapterIndexFile | null> {
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

async function loadUnderstandingSummary(tsian: ReturnType<typeof useTsian>["tsian"]): Promise<OpeningUnderstandingSummary | null> {
  const file = await tsian.workspace.read(INITIAL_SUMMARY_PATH)
  if (!file?.content) return null
  const data = safeJsonParse(file.content)
  return isOpeningUnderstandingSummary(data) ? data : null
}

async function ensureChapterCharacters(
  tsian: ReturnType<typeof useTsian>["tsian"],
  index: ChapterIndexFile | null,
): Promise<ChapterIndexFile | null> {
  if (!index || index.chapters.every((ch) => typeof ch.characters === "number")) return index

  const chapters = await Promise.all(
    index.chapters.map(async (ch) => {
      if (typeof ch.characters === "number") return ch
      const file = await tsian.workspace.read(ch.path)
      return {
        ...ch,
        characters: excerptText(file?.content ?? "", Number.MAX_SAFE_INTEGER).length,
      }
    }),
  )
  const updated = { version: 1 as const, chapters }
  await tsian.workspace.write(CHAPTER_INDEX_PATH, `${JSON.stringify(updated, null, 2)}\n`)
  return updated
}

async function writeCorpus(
  tsian: ReturnType<typeof useTsian>["tsian"],
  corpus: { manifest: SourceManifest; chapterIndex: ChapterIndexFile; chapters: Array<{ path: string; content: string }> },
): Promise<void> {
  for (const ch of corpus.chapters) {
    await tsian.workspace.write(ch.path, ch.content)
  }
  await tsian.workspace.write(CHAPTER_INDEX_PATH, `${JSON.stringify(corpus.chapterIndex, null, 2)}\n`)
  await tsian.workspace.write(SOURCE_MANIFEST_PATH, `${JSON.stringify(corpus.manifest, null, 2)}\n`)
}

// ── 状态操作 ──

function setView(view: SetupSubView): void {
  subView.value = view
  errorText.value = ""
  if (view === "choose") statusText.value = "等待选择导入方式"
  // step 推进：understanding → step 2，其余 step1 子屏 → step 1
  step.value = view === "understanding" ? 2 : 1
}

async function startImport(
  mode: ImportMode,
  input: { text: string; title: string; fileName?: string },
): Promise<void> {
  if (busy.value) return
  const { tsian } = useTsian()
  busy.value = true
  errorText.value = ""
  statusText.value = "读取文本…"

  try {
    const sourceFormat = mode === "file" && input.fileName?.toLowerCase().endsWith(".md") ? "md" : "txt"
    statusText.value = "整理章节…"
    const corpus = buildSourceCorpus(input.text, {
      title: input.title || undefined,
      fileName: input.fileName,
      sourceFormat,
      importMode: mode,
    })
    statusText.value = "写入章节…"
    await writeCorpus(tsian, corpus)
    manifest.value = corpus.manifest
    chapterIndex.value = corpus.chapterIndex
    selectedChapter.value = 0
    understandingStatus.value = "idle"
    understandingSummary.value = null
    setView("review")
    statusText.value = "小说已导入"
  } catch (err) {
    const message = err instanceof Error ? err.message : "导入失败"
    errorText.value = message
    statusText.value = "导入失败"
  } finally {
    busy.value = false
  }
}

function confirmReimport(): void {
  if (window.confirm("重新导入会覆盖当前小说文本与章节目录。确定要换源吗？")) {
    manifest.value = null
    chapterIndex.value = null
    selectedChapter.value = 0
    understandingStatus.value = "idle"
    understandingSummary.value = null
    statusText.value = "等待选择导入方式"
    setView("choose")
  }
}

async function startOpeningUnderstanding(): Promise<void> {
  if (!manifest.value || busy.value) return
  const { tsian } = useTsian()
  busy.value = true
  errorText.value = ""
  understandingStatus.value = "running"
  understandingStartedAt = Date.now()
  agentHeartbeat.value = 0
  setView("understanding")

  // 启动 agent 心跳监听（不污染主游玩 stream）
  startHeartbeat()

  try {
    const prompt = buildOpeningInitializationPrompt(manifest.value, chapterIndex.value)
    const result = await tsian.invokeAgent("world-architect", prompt, {
      contextSlot: "understanding",
      persist: false,
    })
    const summary = await loadUnderstandingSummary(tsian)
    if (!summary) {
      // agent 已返回但 summary 文件未找到——可能是平台侧写入失败。
      // 用 agent 的回复文本作为错误信息，比"理解未完成"更准确。
      throw new Error(result.response || "理解完成但写入存档失败，请重试。")
    }
    understandingSummary.value = summary
    understandingStatus.value = "ready"
  } catch (err) {
    const message = err instanceof Error ? err.message : "初始理解失败"
    errorText.value = message
    understandingStatus.value = "failed"
  } finally {
    stopHeartbeat()
    busy.value = false
  }
}

async function loadChapterPreview(path: string): Promise<string> {
  const { tsian } = useTsian()
  const file = await tsian.workspace.read(path)
  return excerptText(file?.content ?? "") || "暂无可预览内容。"
}

// ── 初始化：从 workspace 加载已有数据 ──

async function initialize(): Promise<void> {
  if (initialized.value) return
  const { tsian } = useTsian()

  try {
    const existingManifest = await loadSourceManifest(tsian)
    if (existingManifest) {
      manifest.value = existingManifest
      chapterIndex.value = await ensureChapterCharacters(tsian, await loadChapterIndex(tsian))
      const summary = await loadUnderstandingSummary(tsian)
      if (summary) {
        understandingSummary.value = summary
        understandingStatus.value = "ready"
        subView.value = "understanding"
        step.value = 2
        statusText.value = "初始理解已完成"
      } else {
        subView.value = "review"
        step.value = 1
        statusText.value = "已导入小说"
      }
    } else {
      subView.value = "choose"
      step.value = 1
    }
  } catch {
    // workspace 读取失败（bridge 未 ready 等）→ 默认 choose
    subView.value = "choose"
    step.value = 1
  } finally {
    initializing.value = false
    initialized.value = true
  }
}

// ── composable 入口 ──

export function useSetupState() {
  return {
    // 响应式状态（只读视图）
    step: readonly(step),
    subView: readonly(subView),
    understandingStatus: readonly(understandingStatus),
    manifest: readonly(manifest),
    chapterIndex: readonly(chapterIndex),
    selectedChapter: readonly(selectedChapter),
    understandingSummary: readonly(understandingSummary),
    busy: readonly(busy),
    statusText: readonly(statusText),
    errorText: readonly(errorText),
    initializing: readonly(initializing),
    initialized: readonly(initialized),
    agentHeartbeat: readonly(agentHeartbeat),

    // 非响应式值（组件按需读取）
    get understandingStartedAt() { return understandingStartedAt },

    // 可写状态（组件需直接改的）
    selectedChapterWritable: selectedChapter,

    // 操作方法
    initialize,
    setView,
    startImport,
    confirmReimport,
    startOpeningUnderstanding,
    loadChapterPreview,
  }
}
