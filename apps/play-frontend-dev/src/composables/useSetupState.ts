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
  OPENING_PROGRESS_PATH,
  buildOpeningInjection,
  createAttemptId,
  createOpeningControl,
  openingAnswerMarker,
  openingBootstrapMarker,
  openingControlMatchesManifest,
  openingControlMatchesSession,
  openingInputHash,
  openingSession,
  openingSourceIdentity,
  parseOpeningAssistant,
  parseOpeningControl,
  parseOpeningProgress,
  parseOpeningTranscript,
  parseOpeningUser,
  sanitizeOpeningDisplay,
  serializeOpeningControl,
  type CharacterBranch,
  type OpeningAttempt,
  type OpeningInterviewControl,
  type OpeningInterviewStatus,
  type OpeningProgress,
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

async function loadOpeningProgress(tsian: ReturnType<typeof getTsianClient>): Promise<OpeningProgress | null> {
  const file = await tsian.workspace.read(OPENING_PROGRESS_PATH)
  if (!file?.content) return null
  const progress = parseOpeningProgress(safeJsonParse(file.content))
  if (!progress) throw new Error("开局进度文件格式无效。")
  return progress
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
    tsian.workspace.read(`save/agents/${playerTurnAgent}/context.json`),
    directoryContainsFormalData(tsian, "save/entities"),
    directoryContainsFormalData(tsian, "save/scenes"),
    directoryContainsFormalData(tsian, "save/relationships"),
    directoryContainsFormalData(tsian, "save/history/turns"),
  ])
  const understandingData = understanding?.content ? safeJsonParse(understanding.content) : null
  if (!isInitialUnderstandingSummary(understandingData)) return true
  if (understandingContext || playSetupContext || legacyOpeningNarrative || playerContext) return true
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

function validateReadSliceRefs(state: OpeningProgress): void {
  const index = chapterIndex.value
  if (!index) throw new Error("小说章节索引尚未就绪，无法校验访谈阅读范围。")
  const chaptersByRef = new Map(index.chapters.map((chapter) => ["ref" in chapter ? chapter.ref : chapter.path, chapter] as const))
  if (state.readSlices.some((slice) => {
    const chapter = chaptersByRef.get(slice.ref)
    return !chapter || (slice.end !== undefined && typeof chapter.characters === "number" && slice.end > chapter.characters)
  })) {
    throw new Error("访谈回复包含不属于当前小说的阅读引用，已停止继续写入。")
  }
  if (Object.values(state.decisions).some((decision) => decision.evidenceRefs?.some((ref) => !chaptersByRef.has(ref)))) {
    throw new Error("访谈决定包含不属于当前小说的证据引用，已停止继续写入。")
  }
}

function validateTurnState(control: OpeningInterviewControl, state: OpeningProgress, expectedAttemptId: string, expectedRevision: number): void {
  if (state.sessionId !== control.session.id || state.sourceHash !== control.source.hash || state.branch !== control.branch) {
    throw new Error("访谈回复与当前小说会话不匹配，已停止继续写入。")
  }
  if (state.processedAttemptId !== expectedAttemptId || state.revision !== expectedRevision) {
    throw new Error("访谈回复轮次无法确认，请重新读取会话状态。")
  }
  validateReadSliceRefs(state)
}

async function finishResolvedInvocation(
  tsian: ReturnType<typeof getTsianClient>,
  response: string,
  control: OpeningInterviewControl,
  expectedAttemptId: string,
  expectedRevision: number,
): Promise<void> {
  const parsed = parseOpeningAssistant(response)
  if (!parsed) throw new Error("访谈回复缺少可显示内容。")
  const [latestControl, progress] = await Promise.all([
    loadOpeningControl(tsian),
    loadOpeningProgress(tsian),
  ])
  if (!latestControl || !progress) throw new Error("访谈已返回，但权威控制或进度文件缺失。")
  validateTurnState(control, progress, expectedAttemptId, expectedRevision)
  if (latestControl.session.revision !== progress.revision
    || latestControl.session.id !== progress.sessionId
    || latestControl.source.hash !== progress.sourceHash
    || latestControl.branch !== progress.branch) {
    throw new Error("开局控制与权威进度不一致。")
  }

  playSetupStreamingText.value = ""
  rawStreamingText = ""
  playSetupMessages.value.push({
    id: nextDialogId(),
    role: "agent",
    content: parsed.displayContent,
    ...(parsed.choices.length > 0 ? { options: parsed.choices } : {}),
  })

  const summary = await loadSetupSummary(tsian, true)
  if (summary?.status === "complete") {
    playSetupStatus.value = "complete"
    playSetupSummary.value = summary.summary ?? null
    characterBranch.value = control.branch
    setView("opening-confirm")
    statusText.value = "开局已准备完成"
    return
  }
  if (progress.phase === "complete") {
    throw new Error("Agent 已声明完成，但正式开局文件尚未提交。")
  }
  playSetupStatus.value = "ready"
  playSetupError.value = ""
  statusText.value = "等待你的回答"
}

async function invokeOpening(
  control: OpeningInterviewControl,
  input: string,
  expectedAttemptId: string,
  expectedRevision: number,
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
    try {
      const latest = await loadOpeningControl(tsian)
      if (control.attempt) {
        if (!latest || latest.status !== "interviewing" || latest.attempt?.id !== control.attempt.id) {
          throw new Error("无法确认待重试回答仍是当前 attempt。")
        }
        await writeOpeningControl(tsian, { ...latest, attempt: { ...latest.attempt, status: "failed" } })
      }
      playSetupStatus.value = "failed"
      playSetupError.value = invocationMessage
    } catch (persistenceError) {
      playSetupStatus.value = "recovering"
      const persistenceMessage = persistenceError instanceof Error ? persistenceError.message : "失败状态无法写入。"
      playSetupError.value = `${invocationMessage} ${persistenceMessage}`
    }
    return
  } finally {
    activeInvocationId = null
    playSetupStreamingText.value = ""
    rawStreamingText = ""
  }

  try {
    await finishResolvedInvocation(tsian, response, control, expectedAttemptId, expectedRevision)
  } catch (error) {
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
    await invokeOpening(control, openingBootstrapMarker(control.session.id), "start", 1)
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
  if (!current || current.status !== "interviewing" || !manifest.value || !openingControlMatchesManifest(current, manifest.value)) {
    playSetupStatus.value = "recovering"
    playSetupError.value = "当前访谈控制状态无效，无法安全发送。"
    return
  }
  const attempt: OpeningAttempt = {
    id: createAttemptId(),
    input: normalized,
    inputHash: openingInputHash(normalized),
    basedOnRevision: current.session.revision,
    status: "submitted",
    createdAt: new Date().toISOString(),
  }
  const control = { ...current, attempt }
  try {
    await writeOpeningControl(tsian, control)
  } catch (error) {
    showInterviewRecovery(error instanceof Error ? `回答尚未发送：${error.message}` : "回答尚未发送，控制状态写入失败。")
    return
  }
  clearLastOptions()
  playSetupMessages.value.push({ id: nextDialogId(), role: "user", content: normalized })
  await invokeOpening(control, openingAnswerMarker(attempt.id, attempt.input), attempt.id, attempt.basedOnRevision + 1)
}

async function retryPlaySetupDialog(): Promise<void> {
  if (playSetupStatus.value === "running") return
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
    let control = await loadOpeningControl(tsian)
    if (!control || control.status !== "interviewing") {
      showInterviewRecovery("无法读取当前访谈状态。")
      return
    }
    if (control.attempt) {
      await restoreOpeningInterviewV2(tsian, manifest.value)
      control = await loadOpeningControl(tsian)
      if (!control || control.status !== "interviewing") {
        showInterviewRecovery("重新检查后无法确认当前访谈状态。")
        return
      }
      if (!control.attempt) return
      const submitted = { ...control, attempt: { ...control.attempt, status: "submitted" as const } }
      await writeOpeningControl(tsian, submitted)
      await invokeOpening(
        submitted,
        openingAnswerMarker(submitted.attempt.id, submitted.attempt.input),
        submitted.attempt.id,
        submitted.attempt.basedOnRevision + 1,
      )
      return
    }
    if (control.session.revision === 0) {
      await invokeOpening(control, openingBootstrapMarker(control.session.id), "start", 1)
      return
    }
    await restoreOpeningInterviewV2(tsian, manifest.value)
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
  const [control, progress, transcriptFile, summary] = await Promise.all([
    loadOpeningControl(tsian),
    loadOpeningProgress(tsian),
    tsian.workspace.read(session.transcriptPath),
    loadSetupSummary(tsian),
  ])
  if (!control && !progress && !transcriptFile) return false
  if (!control || !openingControlMatchesSession(control, currentManifest)) {
    showInterviewRecovery("访谈控制文件与当前小说会话不一致，请使用新存档重新开始。")
    return true
  }
  characterBranch.value = control.branch
  if (!progress) {
    setView("opening-interview")
    playSetupStatus.value = control.session.revision === 0 ? "failed" : "recovering"
    playSetupError.value = control.session.revision === 0
      ? "第一次访谈尚未完成，可以原地重试。"
      : "权威开局进度缺失，请使用新存档重新开始。"
    return true
  }
  validateTurnState(control, progress, progress.processedAttemptId, progress.revision)
  if (control.session.revision !== progress.revision) {
    showInterviewRecovery("开局控制 revision 与权威进度冲突。")
    return true
  }
  if (!transcriptFile?.content) {
    showInterviewRecovery("玩家会话 transcript 缺失，无法恢复完整访谈。")
    return true
  }
  const entries = parseOpeningTranscript(safeJsonParse(transcriptFile.content), session.slot)
  if (!entries) {
    showInterviewRecovery("玩家会话 transcript 与权威进度不一致。")
    return true
  }
  const parsedUsers = entries.map((entry) => parseOpeningUser(entry.request))
  if (parsedUsers.some((user) => !user)
    || parsedUsers.some((user) => user?.kind === "start" && user.sessionId !== session.id)) {
    showInterviewRecovery("玩家会话 transcript 包含无法识别的输入。")
    return true
  }
  const processedEntryIndex = parsedUsers.reduce((latest, user, index) => {
    const matches = user?.kind === "start"
      ? progress.processedAttemptId === "start"
      : user?.attemptId === progress.processedAttemptId
    return matches ? index : latest
  }, -1)
  if (processedEntryIndex < 0) {
    showInterviewRecovery("玩家会话 transcript 缺少权威进度对应的 attempt。")
    return true
  }
  // Retries append transcript entries with the same logical attempt. Rebuild
  // one player exchange per attempt, choosing its latest accepted archive row,
  // and ignore later rows not covered by authoritative progress.
  const latestAcceptedByAttempt = new Map<string, (typeof entries)[number]>()
  for (let index = 0; index <= processedEntryIndex; index += 1) {
    const user = parsedUsers[index]!
    const key = user.kind === "start" ? `start:${user.sessionId}` : `answer:${user.attemptId}`
    latestAcceptedByAttempt.set(key, entries[index]!)
  }
  const acceptedEntries = Array.from(latestAcceptedByAttempt.values())
    .sort((left, right) => left.sequence - right.sequence)
  const messages: DialogMessage[] = []
  for (const entry of acceptedEntries) {
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
  setView(progress.phase === "complete" || control.status === "complete" ? "opening-confirm" : "opening-interview")
  if (progress.phase === "complete" || control.status === "complete") {
    if (progress.phase !== "complete" || control.status !== "complete" || summary?.status !== "complete") {
      showInterviewRecovery("开局完成信号不一致。")
      return true
    }
    playSetupStatus.value = "complete"
    playSetupSummary.value = summary.summary ?? null
    statusText.value = "开局已准备完成"
    return true
  }
  if (control.attempt) {
    const pendingAlreadyShown = acceptedEntries.some((entry) => {
      const user = parseOpeningUser(entry.request)
      return user?.kind === "answer" && user.attemptId === control.attempt?.id
    })
    if (!pendingAlreadyShown) {
      playSetupMessages.value.push({ id: nextDialogId(), role: "user", content: control.attempt.input })
    }
    playSetupStatus.value = "recovering"
    playSetupError.value = "上一条回答的提交结果尚未确认；可重新检查或使用同一回答重试。"
  } else {
    playSetupStatus.value = "ready"
    playSetupError.value = ""
  }
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
    if (await restoreOpeningInterviewV2(tsian, existingManifest)) return
    if (await hasLegacyOpeningState(tsian)) {
      playSetupError.value = "检测到测试期旧开局进度。请创建新存档后重新导入小说。"
      setView("legacy-state")
      return
    }
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
