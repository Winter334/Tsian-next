import { readonly, ref } from "vue"
import { getTsianClient } from "./useTsian"
import {
  CHAPTER_INDEX_PATH,
  FRONTIER_PATH,
  INITIAL_SUMMARY_PATH,
  RUNTIME_PATH,
  SETUP_SUMMARY_PATH,
  SOURCE_MANIFEST_PATH,
  excerptText,
  isSetupSummary,
  isSourceManifest,
  safeJsonParse,
  type BuiltSourceCorpus,
  type ChapterIndexEntry,
  type ChapterIndexFile,
  type DialogMessage,
  type ImportMode,
  type LegacyChapterIndexEntry,
  type SetupSummary,
  type ShardedChapterIndexEntry,
  type SourceManifest,
} from "../lib/source"
import { buildSourceCorpusInWorker } from "../lib/source-import-worker"
import { loadSourceChapterPreview, type SourceTextCache } from "../lib/source-reader"
import {
  OPENING_CONTROL_PATH,
  buildOpeningInjection,
  createOpeningControl,
  openingAnswerMarker,
  openingBootstrapMarker,
  openingControlMatchesManifest,
  openingControlMatchesSession,
  openingSession,
  openingSourceIdentity,
  parseOpeningAssistant,
  parseOpeningControl,
  parseOpeningTranscript,
  parseOpeningUser,
  sanitizeOpeningDisplay,
  serializeOpeningControl,
  type CharacterBranch,
  type OpeningInterviewControl,
  type OpeningInterviewStatus,
} from "../lib/opening-interview"

export type SetupStep = 1 | 2 | 3
export type SetupSubView =
  | "choose"
  | "paste"
  | "file"
  | "review"
  | "branch-choice"
  | "opening-interview"
  | "opening-confirm"
  | "legacy-state"
  | "fatal-state"

const step = ref<SetupStep>(1)
const subView = ref<SetupSubView>("choose")
const manifest = ref<SourceManifest | null>(null)
const chapterIndex = ref<ChapterIndexFile | null>(null)
const selectedChapter = ref(0)
const busy = ref(false)
const statusText = ref("等待选择导入方式")
const errorText = ref("")
const sourcePreviewCache: SourceTextCache = new Map()

const characterBranch = ref<CharacterBranch | null>(null)
const playSetupStatus = ref<OpeningInterviewStatus>("idle")
const playSetupMessages = ref<DialogMessage[]>([])
const playSetupError = ref("")
const playSetupStreamingText = ref("")
const playSetupSummary = ref<string | null>(null)

const initializing = ref(true)
const initialized = ref(false)
let activeInvocationId: string | null = null
let invocationSubscribed = false
let rawStreamingText = ""
let dialogMessageSeq = 0
let openingStartPending = false
let pendingOpeningInput: string | null = null

const LEGACY_OPENING_PROGRESS_PATH = "save/playthrough/opening-progress.json"

function nextDialogId(): string {
  dialogMessageSeq += 1
  return `opening-dialog-${dialogMessageSeq}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function ensureInvocationSubscription(tsian: ReturnType<typeof getTsianClient>): void {
  if (invocationSubscribed) return
  invocationSubscribed = true
  tsian.onAgentInvocation((event) => {
    if (!activeInvocationId || event.invocationId !== activeInvocationId) return
    if (event.type === "delta" && event.kind === "content" && event.agentId === "world-architect") {
      rawStreamingText += event.delta
      playSetupStreamingText.value = sanitizeOpeningDisplay(rawStreamingText)
    }
  })
}

async function loadSourceManifest(tsian: ReturnType<typeof getTsianClient>): Promise<SourceManifest | null> {
  const file = await tsian.workspace.read(SOURCE_MANIFEST_PATH)
  if (!file) return null
  if (!file.content) throw new Error("小说来源清单为空。")
  const data = safeJsonParse(file.content)
  if (isRecord(data) && data.status === "pending" && data.importedAt === null && data.chapterCount === 0) return null
  if (!isSourceManifest(data)) throw new Error("小说来源清单格式无效。")
  return data
}

async function loadChapterIndex(tsian: ReturnType<typeof getTsianClient>): Promise<ChapterIndexFile | null> {
  const file = await tsian.workspace.read(CHAPTER_INDEX_PATH)
  if (!file?.content) throw new Error("小说章节索引缺失。")
  const data = safeJsonParse(file.content)
  if (!isRecord(data) || !Array.isArray(data.chapters)) throw new Error("小说章节索引格式无效。")

  if (data.version === 2) {
    const chapters = data.chapters.flatMap((chapter): ShardedChapterIndexEntry[] => {
      if (!isRecord(chapter) || !isRecord(chapter.source)) return []
      const source = chapter.source
      if (source.kind !== "shard" || typeof source.shardId !== "string" || typeof source.path !== "string"
        || typeof source.start !== "number" || typeof source.end !== "number") return []
      const index = typeof chapter.index === "number" ? chapter.index : 0
      if (index <= 0 || typeof chapter.title !== "string") return []
      return [{
        index,
        ref: typeof chapter.ref === "string" && chapter.ref.trim() ? chapter.ref : `source:chapter-${String(index).padStart(4, "0")}`,
        title: chapter.title,
        characters: typeof chapter.characters === "number" ? chapter.characters : Math.max(0, source.end - source.start),
        source: { kind: "shard", shardId: source.shardId, path: source.path, start: source.start, end: source.end },
      }]
    })
    if (chapters.length !== data.chapters.length) throw new Error("小说章节索引包含无效章节。")
    const shards = Array.isArray(data.shards)
      ? data.shards.flatMap((shard) => {
        if (!isRecord(shard) || typeof shard.id !== "string" || typeof shard.path !== "string"
          || typeof shard.startChapter !== "number" || typeof shard.endChapter !== "number"
          || typeof shard.characters !== "number") return []
        return [{ id: shard.id, path: shard.path, startChapter: shard.startChapter, endChapter: shard.endChapter, characters: shard.characters }]
      })
      : []
    const rawStorage = isRecord(data.storage) ? data.storage : {}
    return {
      version: 2,
      storage: {
        kind: "sharded",
        targetShardCharacters: typeof rawStorage.targetShardCharacters === "number" ? rawStorage.targetShardCharacters : 1_000_000,
        shardsRoot: typeof rawStorage.shardsRoot === "string" ? rawStorage.shardsRoot : "save/source/shards/",
      },
      shards,
      chapters,
    }
  }

  const chapters = data.chapters.flatMap((chapter): LegacyChapterIndexEntry[] => {
    if (!isRecord(chapter) || typeof chapter.title !== "string" || typeof chapter.path !== "string") return []
    return [{ title: chapter.title, path: chapter.path, ...(typeof chapter.characters === "number" ? { characters: chapter.characters } : {}) }]
  })
  if (chapters.length !== data.chapters.length) throw new Error("小说章节索引包含无效章节。")
  return { version: 1, chapters }
}

async function ensureChapterCharacters(
  tsian: ReturnType<typeof getTsianClient>,
  index: ChapterIndexFile | null,
): Promise<ChapterIndexFile | null> {
  if (!index || index.version === 2 || index.chapters.every((chapter) => typeof chapter.characters === "number")) return index
  const chapters = await Promise.all(index.chapters.map(async (chapter) => {
    if (typeof chapter.characters === "number") return chapter
    const file = await tsian.workspace.read(chapter.path)
    return { ...chapter, characters: excerptText(file?.content ?? "", Number.MAX_SAFE_INTEGER).length }
  }))
  const updated = { version: 1 as const, chapters }
  await tsian.workspace.write(CHAPTER_INDEX_PATH, `${JSON.stringify(updated, null, 2)}\n`)
  return updated
}

async function writeCorpus(
  tsian: ReturnType<typeof getTsianClient>,
  corpus: BuiltSourceCorpus,
  onProgress?: (current: number, total: number) => void,
  onIndexWrite?: () => void,
): Promise<void> {
  for (let index = 0; index < corpus.shards.length; index += 1) {
    const shard = corpus.shards[index]!
    await tsian.workspace.write(shard.path, shard.content)
    onProgress?.(index + 1, corpus.shards.length)
  }
  onIndexWrite?.()
  await tsian.workspace.write(CHAPTER_INDEX_PATH, `${JSON.stringify(corpus.chapterIndex, null, 2)}\n`)
  await tsian.workspace.write(SOURCE_MANIFEST_PATH, `${JSON.stringify(corpus.manifest, null, 2)}\n`)
}

async function loadSetupSummary(tsian: ReturnType<typeof getTsianClient>, required = false): Promise<SetupSummary | null> {
  const file = await tsian.workspace.read(SETUP_SUMMARY_PATH)
  if (!file?.content) {
    if (required) throw new Error("开局完成状态文件缺失。")
    return null
  }
  const data = safeJsonParse(file.content)
  if (!isSetupSummary(data)) throw new Error("开局完成状态文件格式无效。")
  return data
}

async function loadOpeningControl(tsian: ReturnType<typeof getTsianClient>): Promise<OpeningInterviewControl | null> {
  const file = await tsian.workspace.read(OPENING_CONTROL_PATH)
  if (!file) return null
  if (!file.content) throw new Error("开局访谈控制文件为空。")
  const control = parseOpeningControl(safeJsonParse(file.content))
  if (!control) throw new Error("开局访谈控制文件格式无效。")
  return control
}

async function writeOpeningControl(tsian: ReturnType<typeof getTsianClient>, control: OpeningInterviewControl): Promise<void> {
  await tsian.workspace.write(OPENING_CONTROL_PATH, serializeOpeningControl(control))
}

function hasOnlyKeys(value: Record<string, unknown>, keys: string[]): boolean {
  const expected = new Set(keys)
  return Object.keys(value).length === expected.size && Object.keys(value).every((key) => expected.has(key))
}

function isInitialPendingRuntime(value: unknown): boolean {
  return isRecord(value)
    && hasOnlyKeys(value, ["turn", "worldTime", "plotOrder", "location", "weather", "activeSceneRefs", "protagonistRef", "extensions", "updatedAtTurn", "updatedBy"])
    && value.turn === 0
    && value.worldTime === ""
    && value.plotOrder === 1
    && value.location === null
    && value.weather === ""
    && Array.isArray(value.activeSceneRefs) && value.activeSceneRefs.length === 0
    && value.protagonistRef === null
    && isRecord(value.extensions) && Object.keys(value.extensions).length === 0
    && value.updatedAtTurn === 0
    && value.updatedBy === null
}

function isInitialPendingFrontier(value: unknown): boolean {
  if (!isRecord(value) || !hasOnlyKeys(value, ["sourceWindow", "extractedThrough", "timeline", "notes"])) return false
  if (!isRecord(value.sourceWindow) || !hasOnlyKeys(value.sourceWindow, ["start", "end"])) return false
  if (value.sourceWindow.start !== null || value.sourceWindow.end !== null || value.extractedThrough !== null) return false
  if (typeof value.notes !== "string" || !Array.isArray(value.timeline) || value.timeline.length !== 1) return false
  const anchor = value.timeline[0]
  return isRecord(anchor)
    && hasOnlyKeys(anchor, ["kind", "order", "chapter", "time", "label"])
    && anchor.kind === "source"
    && anchor.order === 1
    && anchor.chapter === 1
    && anchor.time === "元年"
    && anchor.label === "开局"
}

function isInitialUnderstandingSummary(value: unknown): boolean {
  return isRecord(value)
    && value.status === "pending"
    && value.title === null
    && Array.isArray(value.candidateCharacters)
    && value.candidateCharacters.length === 0
}

async function directoryContainsFormalData(tsian: ReturnType<typeof getTsianClient>, path: string): Promise<boolean> {
  const entries = await tsian.workspace.list(path)
  return entries.some((entry) => entry.name !== "README.md" && entry.name !== ".keep")
}

async function hasLegacyOpeningState(tsian: ReturnType<typeof getTsianClient>): Promise<boolean> {
  const entrypoints = await tsian.card.entrypoints()
  const playerTurnAgent = entrypoints.playerTurn
  if (typeof playerTurnAgent !== "string" || !playerTurnAgent.trim()) {
    throw new Error("当前卡缺少正式玩家回合入口。")
  }
  const [
    understanding,
    understandingContext,
    playSetupContext,
    runtimeFile,
    frontierFile,
    legacyOpeningNarrative,
    legacyOpeningProgress,
    openingControlFile,
    playerContext,
    entityData,
    sceneData,
    relationshipData,
    turnData,
  ] = await Promise.all([
    tsian.workspace.read(INITIAL_SUMMARY_PATH),
    tsian.workspace.read("save/agents/world-architect/context-understanding.json"),
    tsian.workspace.read("save/agents/world-architect/context-play-setup.json"),
    tsian.workspace.read(RUNTIME_PATH),
    tsian.workspace.read(FRONTIER_PATH),
    tsian.workspace.read("save/playthrough/opening-narrative.json"),
    tsian.workspace.read(LEGACY_OPENING_PROGRESS_PATH),
    tsian.workspace.read(OPENING_CONTROL_PATH),
    tsian.workspace.read(`save/agents/${playerTurnAgent}/context.json`),
    directoryContainsFormalData(tsian, "save/entities"),
    directoryContainsFormalData(tsian, "save/scenes"),
    directoryContainsFormalData(tsian, "save/relationships"),
    directoryContainsFormalData(tsian, "save/history/turns"),
  ])
  const understandingData = understanding?.content ? safeJsonParse(understanding.content) : null
  if (!isInitialUnderstandingSummary(understandingData)) return true
  if (understandingContext || playSetupContext || legacyOpeningNarrative || legacyOpeningProgress || playerContext) return true
  if (openingControlFile?.content && !parseOpeningControl(safeJsonParse(openingControlFile.content))) return true
  if (entityData || sceneData || relationshipData || turnData) return true
  const runtime = runtimeFile?.content ? safeJsonParse(runtimeFile.content) : null
  const frontier = frontierFile?.content ? safeJsonParse(frontierFile.content) : null
  return !isInitialPendingRuntime(runtime) || !isInitialPendingFrontier(frontier)
}

function showFatalState(message: string): void {
  playSetupStatus.value = "recovering"
  playSetupError.value = message
  setView("fatal-state")
}

function showInterviewRecovery(message: string): void {
  playSetupStatus.value = "recovering"
  playSetupError.value = message
  setView("opening-interview")
}

function setView(view: SetupSubView): void {
  subView.value = view
  errorText.value = ""
  if (view === "choose" || view === "paste" || view === "file" || view === "review") step.value = 1
  else if (view === "opening-confirm") step.value = 3
  else step.value = 2
  if (view === "choose") statusText.value = "等待选择导入方式"
}

function goToStep(target: SetupStep): void {
  if (target === 1) setView(manifest.value ? "review" : "choose")
  else if (target === 2) setView(playSetupMessages.value.length > 0 ? "opening-interview" : "branch-choice")
  else setView("opening-confirm")
}

async function startImport(
  mode: ImportMode,
  input: { text: string; title: string; fileName?: string },
): Promise<void> {
  if (busy.value) return
  const tsian = getTsianClient()
  busy.value = true
  errorText.value = ""
  sourcePreviewCache.clear()
  statusText.value = "读取文本…"
  try {
    const sourceFormat = mode === "file" && input.fileName?.toLowerCase().endsWith(".md") ? "md" : "txt"
    const corpus = await buildSourceCorpusInWorker({
      text: input.text,
      title: input.title || undefined,
      fileName: input.fileName,
      sourceFormat,
      importMode: mode,
    }, (progress) => {
      statusText.value = progress.total && progress.current !== undefined
        ? `${progress.message.replace(/…$/, "")} ${progress.current}/${progress.total}…`
        : progress.message
    })
    statusText.value = `写入源文本 0/${corpus.shards.length}…`
    await writeCorpus(tsian, corpus, (current, total) => {
      statusText.value = `写入源文本 ${current}/${total}…`
    }, () => {
      statusText.value = "写入索引…"
    })
    manifest.value = corpus.manifest
    chapterIndex.value = corpus.chapterIndex
    selectedChapter.value = 0
    resetOpeningMemory()
    setView("review")
    statusText.value = "小说已导入"
  } catch (error) {
    errorText.value = error instanceof Error ? error.message : "导入失败"
    statusText.value = "导入失败"
  } finally {
    busy.value = false
  }
}

function confirmReimport(): void {
  if (!window.confirm("重新导入会覆盖当前小说文本与章节目录。确定要换源吗？")) return
  manifest.value = null
  chapterIndex.value = null
  selectedChapter.value = 0
  sourcePreviewCache.clear()
  resetOpeningMemory()
  statusText.value = "等待选择导入方式"
  setView("choose")
}

async function loadChapterPreview(chapter: ChapterIndexEntry): Promise<string> {
  return loadSourceChapterPreview(getTsianClient(), chapter, sourcePreviewCache)
}

async function showBranchChoice(): Promise<void> {
  if (!manifest.value) return
  const tsian = getTsianClient()
  try {
    if (await hasLegacyOpeningState(tsian)) {
      playSetupError.value = "检测到测试期旧开局进度。请创建新存档后重新导入小说。"
      setView("legacy-state")
      return
    }
    setView("branch-choice")
    statusText.value = "选择本局角色类型"
  } catch (error) {
    showFatalState(error instanceof Error ? `无法确认开局存档状态：${error.message}` : "无法确认开局存档状态。")
  }
}

async function finishResolvedInvocation(
  tsian: ReturnType<typeof getTsianClient>,
  response: string,
  control: OpeningInterviewControl,
): Promise<void> {
  const parsed = parseOpeningAssistant(response)
  if (!parsed) throw new Error("访谈回复缺少可显示内容。")

  playSetupStreamingText.value = ""
  rawStreamingText = ""
  pendingOpeningInput = null
  playSetupMessages.value.push({
    id: nextDialogId(),
    role: "agent",
    content: parsed.displayContent,
    ...(parsed.choices.length > 0 ? { options: parsed.choices } : {}),
  })

  const summary = await loadSetupSummary(tsian)
  if (summary?.status === "complete") {
    playSetupStatus.value = "complete"
    playSetupSummary.value = summary.summary ?? null
    characterBranch.value = control.branch
    setView("opening-confirm")
    statusText.value = "开局已准备完成"
    return
  }
  playSetupStatus.value = "ready"
  playSetupError.value = ""
  statusText.value = "等待你的回答"
}

async function invokeOpening(
  control: OpeningInterviewControl,
  input: string,
): Promise<void> {
  const tsian = getTsianClient()
  playSetupStatus.value = "running"
  playSetupError.value = ""
  rawStreamingText = ""
  playSetupStreamingText.value = ""
  const invocationId = `opening-interview-${Date.now().toString(36)}`
  activeInvocationId = invocationId
  ensureInvocationSubscription(tsian)

  let response: string
  try {
    const result = await tsian.invokeAgent("world-architect", input, {
      invocationId,
      purpose: "opening-interview",
      contextSlot: control.session.slot,
      persist: true,
      transcript: { mode: "full", audience: "player" },
      injection: [{ role: "user", position: "before-input", content: buildOpeningInjection(control) }],
    })
    response = result.response
  } catch (error) {
    const invocationMessage = error instanceof Error ? error.message : "访谈调用失败，请重试。"
    playSetupStatus.value = "failed"
    playSetupError.value = invocationMessage
    return
  } finally {
    activeInvocationId = null
    playSetupStreamingText.value = ""
    rawStreamingText = ""
  }

  try {
    await finishResolvedInvocation(tsian, response, control)
  } catch (error) {
    pendingOpeningInput = null
    playSetupStatus.value = "recovering"
    playSetupError.value = error instanceof Error ? error.message : "访谈已提交，但界面恢复失败。"
  }
}

async function startOpeningInterview(branch: CharacterBranch): Promise<void> {
  if (!manifest.value || playSetupStatus.value === "running" || openingStartPending) return
  openingStartPending = true
  const tsian = getTsianClient()
  try {
    if (await hasLegacyOpeningState(tsian)) {
      playSetupError.value = "检测到测试期旧开局进度。请创建新存档后重新导入小说。"
      setView("legacy-state")
      return
    }
    const control = createOpeningControl(manifest.value, branch)
    await writeOpeningControl(tsian, control)
    characterBranch.value = branch
    playSetupMessages.value = []
    setView("opening-interview")
    statusText.value = "正在准备第一次问题…"
    await invokeOpening(control, openingBootstrapMarker(control.session.id))
  } catch (error) {
    showFatalState(error instanceof Error ? `无法安全启动开局访谈：${error.message}` : "无法安全启动开局访谈。")
  } finally {
    openingStartPending = false
  }
}

function clearLastOptions(): void {
  for (let index = playSetupMessages.value.length - 1; index >= 0; index -= 1) {
    const message = playSetupMessages.value[index]
    if (message?.role === "agent" && message.options?.length) {
      playSetupMessages.value[index] = { ...message, options: undefined }
      return
    }
  }
}

async function sendPlaySetupMessage(input: string): Promise<void> {
  const normalized = input.trim()
  if (!normalized || playSetupStatus.value !== "ready") return
  playSetupStatus.value = "running"
  playSetupError.value = ""
  const tsian = getTsianClient()
  let current: OpeningInterviewControl | null
  try {
    current = await loadOpeningControl(tsian)
  } catch (error) {
    showInterviewRecovery(error instanceof Error ? error.message : "无法读取当前访谈状态。")
    return
  }
  if (!current || !manifest.value || !openingControlMatchesManifest(current, manifest.value)) {
    playSetupStatus.value = "recovering"
    playSetupError.value = "当前访谈控制状态无效，无法安全发送。"
    return
  }
  clearLastOptions()
  playSetupMessages.value.push({ id: nextDialogId(), role: "user", content: normalized })
  pendingOpeningInput = normalized
  await invokeOpening(current, openingAnswerMarker(normalized))
}

async function retryPlaySetupDialog(): Promise<void> {
  if (playSetupStatus.value === "running") return
  const previousStatus = playSetupStatus.value
  playSetupStatus.value = "running"
  playSetupError.value = ""
  const tsian = getTsianClient()
  try {
    const summary = await loadSetupSummary(tsian, true)
    if (summary?.status === "complete") {
      playSetupStatus.value = "complete"
      playSetupSummary.value = summary.summary ?? null
      setView("opening-confirm")
      statusText.value = "开局已准备完成"
      return
    }
    const control = await loadOpeningControl(tsian)
    if (!control) {
      showInterviewRecovery("无法读取当前访谈状态。")
      return
    }
    if (previousStatus === "recovering") {
      await restoreOpeningInterviewV2(tsian, manifest.value)
      return
    }
    if (pendingOpeningInput) {
      await invokeOpening(control, openingAnswerMarker(pendingOpeningInput))
      return
    }
    const restored = await restoreOpeningInterviewV2(tsian, manifest.value)
    if (!restored || playSetupMessages.value.length === 0) {
      await invokeOpening(control, openingBootstrapMarker(control.session.id))
    }
  } catch (error) {
    showInterviewRecovery(error instanceof Error ? error.message : "重新检查访谈状态失败。")
  }
}

async function restoreOpeningInterviewV2(
  tsian: ReturnType<typeof getTsianClient>,
  currentManifest: SourceManifest | null,
): Promise<boolean> {
  if (!currentManifest) return false
  const identity = openingSourceIdentity(currentManifest)
  const session = openingSession(identity)
  const [control, transcriptFile, summary] = await Promise.all([
    loadOpeningControl(tsian),
    tsian.workspace.read(session.transcriptPath),
    loadSetupSummary(tsian),
  ])
  if (!control && !transcriptFile) return false
  if (!control || !openingControlMatchesSession(control, currentManifest)) {
    showInterviewRecovery("访谈控制文件与当前小说会话不一致，请使用新存档重新开始。")
    return true
  }
  characterBranch.value = control.branch
  if (!transcriptFile?.content) {
    setView("opening-interview")
    playSetupStatus.value = "failed"
    playSetupError.value = "第一次访谈尚未完成，可以原地重试。"
    return true
  }
  const entries = parseOpeningTranscript(safeJsonParse(transcriptFile.content), session.slot)
  if (!entries) {
    showInterviewRecovery("玩家会话记录格式无效，请使用新存档重新开始。")
    return true
  }
  const parsedUsers = entries.map((entry) => parseOpeningUser(entry.request))
  if (parsedUsers.some((user) => !user)
    || parsedUsers.some((user) => user?.kind === "start" && user.sessionId !== session.id)) {
    showInterviewRecovery("玩家会话 transcript 包含无法识别的输入。")
    return true
  }
  const messages: DialogMessage[] = []
  for (const entry of entries) {
    const user = parseOpeningUser(entry.request)
    if (!user) return true
    if (user.kind === "answer") {
      messages.push({ id: nextDialogId(), role: "user", content: user.content })
    }
    const parsed = parseOpeningAssistant(entry.assistant.content, entry.assistant.projections)
    const displayContent = entry.assistant.displayContent?.trim() || parsed?.displayContent
    if (!displayContent) {
      showInterviewRecovery("玩家会话 transcript 包含无法显示的回复。")
      return true
    }
    messages.push({
      id: nextDialogId(),
      role: "agent",
      content: displayContent,
      ...(parsed?.choices.length ? { options: parsed.choices } : {}),
    })
  }
  for (let index = 0; index < messages.length - 1; index += 1) {
    if (messages[index]?.role === "agent" && messages[index]?.options) {
      messages[index] = { ...messages[index]!, options: undefined }
    }
  }
  playSetupMessages.value = messages
  setView(summary?.status === "complete" ? "opening-confirm" : "opening-interview")
  if (summary?.status === "complete") {
    playSetupStatus.value = "complete"
    playSetupSummary.value = summary.summary ?? null
    statusText.value = "开局已准备完成"
    return true
  }
  pendingOpeningInput = null
  playSetupStatus.value = "ready"
  playSetupError.value = ""
  statusText.value = "访谈已恢复"
  return true
}

function resetOpeningMemory(): void {
  characterBranch.value = null
  playSetupStatus.value = "idle"
  playSetupMessages.value = []
  playSetupError.value = ""
  playSetupStreamingText.value = ""
  playSetupSummary.value = null
  activeInvocationId = null
  rawStreamingText = ""
  pendingOpeningInput = null
}

async function initialize(): Promise<void> {
  if (initialized.value) return
  const tsian = getTsianClient()
  try {
    await tsian.waitForReady()
    const setupSummary = await loadSetupSummary(tsian, true)
    if (setupSummary?.status === "complete") {
      playSetupStatus.value = "complete"
      playSetupSummary.value = setupSummary.summary ?? null
      try {
        manifest.value = await loadSourceManifest(tsian)
      } catch {
        // 完成信号优先；旧完成存档缺少有效来源清单时仍允许进入确认屏。
        manifest.value = null
      }
      setView("opening-confirm")
      statusText.value = "开局已准备完成"
      return
    }
    const existingManifest = await loadSourceManifest(tsian)
    if (!existingManifest) {
      if (await hasLegacyOpeningState(tsian)) {
        playSetupError.value = "检测到测试期旧开局进度。请创建新存档后重新导入小说。"
        setView("legacy-state")
        return
      }
      setView("choose")
      return
    }
    manifest.value = existingManifest
    const loadedChapterIndex = await ensureChapterCharacters(tsian, await loadChapterIndex(tsian))
    if (!loadedChapterIndex || loadedChapterIndex.chapters.length !== existingManifest.chapterCount) {
      throw new Error("小说来源清单与章节索引数量不一致。")
    }
    chapterIndex.value = loadedChapterIndex
    if (await hasLegacyOpeningState(tsian)) {
      playSetupError.value = "检测到测试期旧开局进度。请创建新存档后重新导入小说。"
      setView("legacy-state")
      return
    }
    if (await restoreOpeningInterviewV2(tsian, existingManifest)) return
    setView("review")
    statusText.value = "已导入小说"
  } catch (error) {
    showFatalState(error instanceof Error ? `无法读取开局状态：${error.message}` : "无法读取开局状态。")
  } finally {
    initializing.value = false
    initialized.value = true
  }
}

export function useSetupState() {
  return {
    step: readonly(step),
    subView: readonly(subView),
    manifest: readonly(manifest),
    chapterIndex: readonly(chapterIndex),
    selectedChapter: readonly(selectedChapter),
    selectedChapterWritable: selectedChapter,
    busy: readonly(busy),
    statusText: readonly(statusText),
    errorText: readonly(errorText),
    initializing: readonly(initializing),
    initialized: readonly(initialized),
    characterBranch: readonly(characterBranch),
    playSetupStatus: readonly(playSetupStatus),
    playSetupMessages: readonly(playSetupMessages),
    playSetupError: readonly(playSetupError),
    playSetupStreamingText: readonly(playSetupStreamingText),
    playSetupSummary: readonly(playSetupSummary),
    initialize,
    setView,
    goToStep,
    startImport,
    confirmReimport,
    loadChapterPreview,
    showBranchChoice,
    startOpeningInterview,
    sendPlaySetupMessage,
    retryPlaySetupDialog,
  }
}
