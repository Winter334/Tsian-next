import { ref, readonly } from "vue"
import { getTsianClient } from "./useTsian"
import type { WorkspaceEntry } from "@tsian/play-bridge"
import {
  SOURCE_MANIFEST_PATH,
  CHAPTER_INDEX_PATH,
  INITIAL_SUMMARY_PATH,
  RUNTIME_PATH,
  SETUP_SUMMARY_PATH,
  CHARACTER_ENTITIES_ROOT,
  buildOpeningInitializationPrompt,
  buildPlaySetupPrompt,
  safeJsonParse,
  isSourceManifest,
  isOpeningUnderstandingSummary,
  isSetupSummary,
  excerptText,
  type SourceManifest,
  type ChapterIndexFile,
  type ChapterIndexEntry,
  type LegacyChapterIndexEntry,
  type ShardedChapterIndexEntry,
  type BuiltSourceCorpus,
  type OpeningUnderstandingSummary,
  type ImportMode,
  type CharacterBranch,
  type SelectedCharacter,
  type OriginalCharacterFormData,
  type CharacterEntity,
  type PlaySetupStatus,
  type DialogMessage,
  type SetupSummary,
} from "../lib/source"
import { buildSourceCorpusInWorker } from "../lib/source-import-worker"
import { loadSourceChapterPreview, type SourceTextCache } from "../lib/source-reader"

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
export type SetupSubView = "choose" | "paste" | "file" | "review" | "understanding" | "character-setup" | "play-setup" | "opening-confirm" | "stub"
export type UnderstandingStatus = "idle" | "running" | "ready" | "failed"
export type CharacterSetupStatus = "selecting" | "confirmed"

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
const sourcePreviewCache: SourceTextCache = new Map()

// ── 角色设定状态（Step 3）──
const characterBranch = ref<CharacterBranch | null>(null)
const selectedCharacter = ref<SelectedCharacter | null>(null)
const characterSetupStatus = ref<CharacterSetupStatus>("selecting")

// ── 游玩设定对话状态（Step 4）──
const playSetupStatus = ref<PlaySetupStatus>("idle")
const playSetupMessages = ref<DialogMessage[]>([])
const playSetupError = ref("")
// 流式文本累积：onAgentInvocation delta 按 invocationId 过滤后追加到这里，
// PlaySetupDialog 在 running 态展示；落定后由 handleAgentResponse 清空。
const playSetupStreamingText = ref("")
let activeInvocationId: string | null = null
let playSetupInvocationSubscribed = false

// ── 开局确认状态（Step 5）──
const playSetupSummary = ref<string | null>(null)

// 初始化状态
const initializing = ref(true)
const initialized = ref(false)

// ── understanding 阶段文案（Step 2）──
// 阶段由 onAgentInvocation 的 tool 事件驱动（单调推进），替代旧的 STAGE_INTERVAL 时间硬切。
// 0 = 观察，1 = 阅读，2 = 整理/写入。
const understandingStage = ref(0)
let understandingActiveInvocationId: string | null = null
let understandingInvocationSubscribed = false

function ensurePlaySetupInvocationSubscription(tsian: ReturnType<typeof getTsianClient>): void {
  if (playSetupInvocationSubscribed) return
  playSetupInvocationSubscribed = true
  tsian.onAgentInvocation((event) => {
    if (!activeInvocationId || event.invocationId !== activeInvocationId) return
    // MVP 只展示编排者（world-architect）的 content delta；
    // delegated agent_call 产生的 delta（agentId !== "world-architect"）过滤掉，
    // 其过程通过 tool 事件（name: "agent_call"）隐含感知。
    if (event.type === "delta" && event.kind === "content" && event.agentId === "world-architect") {
      playSetupStreamingText.value += event.delta
    }
    // completed/failed 由 Promise resolve/reject 驱动，不在此处理。
  })
}

function ensureUnderstandingInvocationSubscription(tsian: ReturnType<typeof getTsianClient>): void {
  if (understandingInvocationSubscribed) return
  understandingInvocationSubscribed = true
  tsian.onAgentInvocation((event) => {
    if (!understandingActiveInvocationId || event.invocationId !== understandingActiveInvocationId) return
    if (event.type === "tool") {
      understandingStage.value = Math.max(understandingStage.value, mapToolToStage(event))
    }
    // completed/failed 由 understandingStatus 驱动，不在此处理。
  })
}

/** 工具事件 → 面向玩家的术式阶段文案（单调推进，不倒退）。 */
function mapToolToStage(event: { name: string; status: string }): number {
  // 只在 success/running 时推进；loading 与 failed 不影响阶段。
  if (event.status !== "success" && event.status !== "running") return understandingStage.value
  const name = event.name
  // write/edit/copy/move/delete（落盘/整理）→ 阶段 2
  if (name === "write" || name === "edit" || name === "copy" || name === "move" || name === "delete") return 2
  // read/list/search/glob/diff/use_skill（观察/阅读）→ 阶段 1
  if (name === "read" || name === "list" || name === "search" || name === "glob" || name === "diff" || name === "use_skill") return 1
  // 未知工具不推进
  return understandingStage.value
}

// ── workspace 读写（通过 bridge）──

async function loadSourceManifest(tsian: ReturnType<typeof getTsianClient>): Promise<SourceManifest | null> {
  const file = await tsian.workspace.read(SOURCE_MANIFEST_PATH)
  if (!file?.content) return null
  const data = safeJsonParse(file.content)
  return isSourceManifest(data) ? data : null
}

async function loadChapterIndex(tsian: ReturnType<typeof getTsianClient>): Promise<ChapterIndexFile | null> {
  const file = await tsian.workspace.read(CHAPTER_INDEX_PATH)
  if (!file?.content) return null
  const data = safeJsonParse(file.content)
  if (!isRecord(data) || !Array.isArray(data.chapters)) {
    return null
  }

  if (data.version === 2) {
    const chapters = data.chapters.flatMap((chapter): ShardedChapterIndexEntry[] => {
      if (!isRecord(chapter) || !isRecord(chapter.source)) return []
      const source = chapter.source
      if (source.kind !== "shard"
        || typeof source.shardId !== "string"
        || typeof source.path !== "string"
        || typeof source.start !== "number"
        || typeof source.end !== "number"
      ) {
        return []
      }
      const index = typeof chapter.index === "number" ? chapter.index : 0
      if (index <= 0 || typeof chapter.title !== "string") return []
      return [{
        index,
        ref: typeof chapter.ref === "string" && chapter.ref.trim() ? chapter.ref : `source:chapter-${String(index).padStart(4, "0")}`,
        title: chapter.title,
        characters: typeof chapter.characters === "number" ? chapter.characters : Math.max(0, source.end - source.start),
        source: {
          kind: "shard",
          shardId: source.shardId,
          path: source.path,
          start: source.start,
          end: source.end,
        },
      }]
    })
    const shards = Array.isArray(data.shards)
      ? data.shards.flatMap((shard) => {
        if (!isRecord(shard)
          || typeof shard.id !== "string"
          || typeof shard.path !== "string"
          || typeof shard.startChapter !== "number"
          || typeof shard.endChapter !== "number"
          || typeof shard.characters !== "number"
        ) {
          return []
        }
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
    if (!isRecord(chapter)) return []
    if (typeof chapter.title !== "string" || typeof chapter.path !== "string") return []
    return [{
      title: chapter.title,
      path: chapter.path,
      ...(typeof chapter.characters === "number" ? { characters: chapter.characters } : {}),
    }]
  })
  return { version: 1, chapters }
}

async function loadUnderstandingSummary(tsian: ReturnType<typeof getTsianClient>): Promise<OpeningUnderstandingSummary | null> {
  const file = await tsian.workspace.read(INITIAL_SUMMARY_PATH)
  if (!file?.content) return null
  const data = safeJsonParse(file.content)
  return isOpeningUnderstandingSummary(data) ? data : null
}

async function ensureChapterCharacters(
  tsian: ReturnType<typeof getTsianClient>,
  index: ChapterIndexFile | null,
): Promise<ChapterIndexFile | null> {
  if (!index || index.version === 2 || index.chapters.every((ch) => typeof ch.characters === "number")) return index

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
  tsian: ReturnType<typeof getTsianClient>,
  corpus: BuiltSourceCorpus,
  onProgress?: (current: number, total: number) => void,
  onIndexWrite?: () => void,
): Promise<void> {
  const total = corpus.shards.length
  for (let index = 0; index < corpus.shards.length; index += 1) {
    const shard = corpus.shards[index]!
    await tsian.workspace.write(shard.path, shard.content)
    onProgress?.(index + 1, total)
  }
  onIndexWrite?.()
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

/** 推进到指定步骤。step1-2 有真实视图，step3 角色设定有独立子屏，
 *  step4 游玩设定对话，step5 开局确认过渡入口。 */
function goToStep(target: SetupStep): void {
  if (target <= 1) {
    setView("choose")
    return
  }
  if (target === 2) {
    // 回到 understanding：已有 ready 状态则直接进，否则回 review
    if (understandingStatus.value === "ready") {
      subView.value = "understanding"
      step.value = 2
    } else {
      setView("review")
    }
    return
  }
  if (target === 3) {
    // Step 3 角色设定：已有确认角色则进确认屏，否则进选择/表单
    subView.value = "character-setup"
    step.value = 3
    errorText.value = ""
    return
  }
  if (target === 4) {
    // Step 4 游玩设定对话：仅在从未开始时自动启动，已有消息则恢复
    subView.value = "play-setup"
    step.value = 4
    errorText.value = ""
    if (playSetupStatus.value === "idle" && playSetupMessages.value.length === 0) {
      void startPlaySetupDialog()
    } else if (playSetupStatus.value === "failed") {
      // 失败状态回来时恢复为 idle，让玩家可以重试
      playSetupStatus.value = "idle"
    }
    return
  }
  // Step 5 开局确认：设定卡片过渡入口，enterPlay 触发翻转
  subView.value = "opening-confirm"
  step.value = 5
  errorText.value = ""
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
    statusText.value = "写入源文本 0/" + corpus.shards.length + "…"
    await writeCorpus(tsian, corpus, (current, total) => {
      statusText.value = `写入源文本 ${current}/${total}…`
    }, () => {
      statusText.value = "写入索引…"
    })
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
    sourcePreviewCache.clear()
    selectedChapter.value = 0
    understandingStatus.value = "idle"
    understandingSummary.value = null
    statusText.value = "等待选择导入方式"
    setView("choose")
  }
}

async function startOpeningUnderstanding(): Promise<void> {
  if (!manifest.value || busy.value) return
  const tsian = getTsianClient()
  busy.value = true
  errorText.value = ""
  understandingStatus.value = "running"
  understandingStage.value = 0
  setView("understanding")

  // 事件驱动阶段文案：订阅 onAgentInvocation tool 事件，按 invocationId 过滤后映射成 STAGES。
  const invocationId = `understanding-${Date.now().toString(36)}`
  understandingActiveInvocationId = invocationId
  ensureUnderstandingInvocationSubscription(tsian)

  try {
    const prompt = buildOpeningInitializationPrompt(manifest.value, chapterIndex.value)
    const result = await tsian.invokeAgent("world-architect", prompt, {
      invocationId,
      purpose: "opening-understanding",
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
    understandingActiveInvocationId = null
    busy.value = false
  }
}

async function loadChapterPreview(chapter: ChapterIndexEntry): Promise<string> {
  const tsian = getTsianClient()
  return loadSourceChapterPreview(tsian, chapter, sourcePreviewCache)
}

// ── 角色设定操作（Step 3）──

/** Step 2 末尾选择分支后调用，存储分支并推进到 Step 3。 */
function setCharacterBranch(branch: CharacterBranch): void {
  characterBranch.value = branch
  characterSetupStatus.value = "selecting"
  selectedCharacter.value = null
  goToStep(3)
}

/** 返回分支选择（回到 Step 2 understanding ready 视图）。 */
function backToBranchChoice(): void {
  characterBranch.value = null
  selectedCharacter.value = null
  characterSetupStatus.value = "selecting"
  if (understandingStatus.value === "ready") {
    subView.value = "understanding"
    step.value = 2
  }
}

/** 确认原著角色选择。写入 runtime.json 的 protagonistRef。 */
async function confirmCanonCharacter(candidate: { id?: string; name: string; brief: string; gender?: string }): Promise<void> {
  if (busy.value) return
  const tsian = getTsianClient()
  busy.value = true
  errorText.value = ""
  try {
    const ref = candidate.id || `character:${candidate.name}`
    const charInfo: SelectedCharacter = { ref, name: candidate.name, brief: candidate.brief, ...(candidate.gender ? { gender: candidate.gender } : {}) }
    await writePlayerCharacter(tsian, ref, candidate.name)
    selectedCharacter.value = charInfo
    characterSetupStatus.value = "confirmed"
    statusText.value = `已选定角色：${candidate.name}`
  } catch (err) {
    errorText.value = err instanceof Error ? err.message : "确认角色失败"
  } finally {
    busy.value = false
  }
}

/** 确认原创角色。创建实体文件 + 写入 runtime.json。 */
async function confirmOriginalCharacter(form: OriginalCharacterFormData): Promise<void> {
  if (busy.value) return
  const tsian = getTsianClient()
  busy.value = true
  errorText.value = ""
  try {
    const localId = await ensureUniqueLocalId(tsian, form.name)
    const ref = `character:${localId}`
    const now = new Date().toISOString()
    const entity: CharacterEntity = {
      id: ref,
      name: form.name,
      brief: form.brief,
      sourceRefs: [],
      updatedBy: "player-setup",
      updatedAt: now,
    }
    if (form.gender?.trim()) entity.gender = form.gender.trim()
    if (form.appearance?.trim()) entity.appearance = form.appearance.trim()
    if (form.personality?.trim()) entity.personality = form.personality.trim()
    if (form.background?.trim()) entity.background = form.background.trim()

    await tsian.workspace.write(
      `${CHARACTER_ENTITIES_ROOT}${localId}.json`,
      `${JSON.stringify(entity, null, 2)}\n`,
    )
    await writePlayerCharacter(tsian, ref, form.name)
    selectedCharacter.value = { ref, name: form.name, brief: form.brief, ...(form.gender?.trim() ? { gender: form.gender.trim() } : {}) }
    characterSetupStatus.value = "confirmed"
    statusText.value = `已创建角色：${form.name}`
  } catch (err) {
    errorText.value = err instanceof Error ? err.message : "创建角色失败"
  } finally {
    busy.value = false
  }
}

/** 返回修改角色（从确认屏回到选择/表单）。 */
function resetCharacterSetup(): void {
  selectedCharacter.value = null
  characterSetupStatus.value = "selecting"
}

/** read-modify-write runtime.json 的 protagonistRef 字段。 */
async function writePlayerCharacter(
  tsian: ReturnType<typeof getTsianClient>,
  ref: string,
  name: string,
): Promise<void> {
  const file = await tsian.workspace.read(RUNTIME_PATH)
  const runtime = file?.content ? safeJsonParse(file.content) : null
  if (!runtime || typeof runtime !== "object") {
    throw new Error("runtime.json 不存在或格式无效")
  }
  const updated = {
    ...runtime,
    protagonistRef: { ref, name },
  }
  await tsian.workspace.write(RUNTIME_PATH, `${JSON.stringify(updated, null, 2)}\n`)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

interface ProjectedAssistantMessage {
  content: string
  displayContent?: string
  projections?: Record<string, unknown>
}

async function projectAssistantMessage(
  tsian: ReturnType<typeof getTsianClient>,
  content: string,
): Promise<ProjectedAssistantMessage> {
  const result = await tsian.runAction("reply-project", { text: content })
  if (isRecord(result) && result.ok === false) {
    const error = isRecord(result.error) ? result.error : null
    throw new Error(typeof error?.message === "string" ? error.message : "reply projection failed")
  }
  const projected = isRecord(result) && isRecord(result.item) ? result.item : result
  if (isRecord(projected) && typeof projected.content === "string") {
    return {
      content: projected.content,
      ...(typeof projected.displayContent === "string" ? { displayContent: projected.displayContent } : {}),
      ...(isRecord(projected.projections) ? { projections: projected.projections } : {}),
    }
  }
  return { content }
}

function displayAssistantContent(item: ProjectedAssistantMessage): string {
  return item.displayContent ?? item.content
}

function projectedChoices(item: ProjectedAssistantMessage): string[] {
  const choices = item.projections?.choices
  return Array.isArray(choices) ? choices.filter((choice): choice is string => typeof choice === "string") : []
}

/** 兼容 workspace.list 的数组形态与旧 list result 对象形态。 */
function normalizeWorkspaceListEntries(listResult: unknown): WorkspaceEntry[] {
  const rawEntries = Array.isArray(listResult)
    ? listResult
    : isRecord(listResult) && Array.isArray(listResult.entries)
      ? listResult.entries
      : null

  if (!rawEntries) {
    throw new Error("workspace.list 返回格式无效")
  }

  return rawEntries.map((entry, index) => {
    if (!isRecord(entry) || typeof entry.path !== "string") {
      throw new Error(`workspace.list 返回条目格式无效：entries[${index}].path`)
    }
    if (typeof entry.name !== "string") {
      throw new Error(`workspace.list 返回条目格式无效：entries[${index}].name`)
    }
    if (entry.kind !== "file" && entry.kind !== "directory") {
      throw new Error(`workspace.list 返回条目格式无效：entries[${index}].kind`)
    }
    return {
      path: entry.path,
      name: entry.name,
      kind: entry.kind,
      ...(typeof entry.updatedAt === "number" ? { updatedAt: entry.updatedAt } : {}),
      ...(typeof entry.size === "number" ? { size: entry.size } : {}),
      ...(typeof entry.childCount === "number" ? { childCount: entry.childCount } : {}),
    }
  })
}

/** 生成唯一 localId：original-<name>，冲突加序号后缀。 */
async function ensureUniqueLocalId(
  tsian: ReturnType<typeof getTsianClient>,
  name: string,
): Promise<string> {
  const base = `original-${name}`
  const listResult = await tsian.workspace.list(CHARACTER_ENTITIES_ROOT)
  const existing = new Set(
    normalizeWorkspaceListEntries(listResult).map((f) => f.path.split("/").pop()?.replace(/\.json$/, "") ?? ""),
  )
  if (!existing.has(base)) return base
  for (let i = 2; i < 100; i++) {
    const candidate = `${base}-${i}`
    if (!existing.has(candidate)) return candidate
  }
  return `${base}-${Date.now()}`
}

/** 读取 runtime.json 的 protagonistRef，用于重载恢复。 */
async function loadPlayerCharacter(
  tsian: ReturnType<typeof getTsianClient>,
): Promise<SelectedCharacter | null> {
  const file = await tsian.workspace.read(RUNTIME_PATH)
  if (!file?.content) return null
  const runtime = safeJsonParse(file.content)
  if (!runtime || typeof runtime !== "object") return null
  const protagonist = (runtime as Record<string, unknown>).protagonistRef
  if (!protagonist || typeof protagonist !== "object") return null
  const ref = (protagonist as Record<string, unknown>).ref
  const name = (protagonist as Record<string, unknown>).name
  if (typeof ref !== "string" || typeof name !== "string") return null
  // brief + gender 从实体文件读取
  const localId = ref.startsWith("character:") ? ref.slice("character:".length) : ref
  const entityFile = await tsian.workspace.read(`${CHARACTER_ENTITIES_ROOT}${localId}.json`)
  if (entityFile?.content) {
    const entity = safeJsonParse(entityFile.content)
    if (entity && typeof entity === "object") {
      const brief = (entity as Record<string, unknown>).brief
      const gender = (entity as Record<string, unknown>).gender
      if (typeof brief === "string") {
        return { ref, name, brief, ...(typeof gender === "string" ? { gender } : {}) }
      }
    }
  }
  return { ref, name, brief: "" }
}

// ── 游玩设定对话操作（Step 4）──

let dialogMessageSeq = 0
function nextDialogId(): string {
  dialogMessageSeq += 1
  return `dialog-${dialogMessageSeq}`
}

/** 读取 setup-summary.json 判断完成态。 */
async function loadSetupSummary(
  tsian: ReturnType<typeof getTsianClient>,
): Promise<SetupSummary | null> {
  const file = await tsian.workspace.read(SETUP_SUMMARY_PATH)
  if (!file?.content) return null
  const data = safeJsonParse(file.content)
  return isSetupSummary(data) ? data : null
}

/** 从 context-play-setup.json 重建对话消息列表（刷新/返回后恢复）。
 *  context slot 文件存的是 AgentContextSnapshot，recentTurns 是 agent 侧
 *  user/assistant 交替记录。正常访谈场景不会触发压缩（token 远低于阈值），
 *  recentTurns 是完整的。 */
const PLAY_SETUP_CONTEXT_PATH = "save/agents/world-architect/context-play-setup.json"

async function restorePlaySetupMessages(
  tsian: ReturnType<typeof getTsianClient>,
): Promise<boolean> {
  const file = await tsian.workspace.read(PLAY_SETUP_CONTEXT_PATH)
  if (!file?.content) return false
  const data = safeJsonParse(file.content)
  if (!data || typeof data !== "object") return false
  const recentTurns = (data as Record<string, unknown>).recentTurns
  if (!Array.isArray(recentTurns) || recentTurns.length === 0) return false

  const restored: DialogMessage[] = []
  for (const entry of recentTurns) {
    if (typeof entry !== "object" || entry === null) continue
    const role = (entry as Record<string, unknown>).role
    const content = (entry as Record<string, unknown>).content
    if (typeof role !== "string" || typeof content !== "string") continue

    if (role === "user") {
      restored.push({ id: nextDialogId(), role: "user", content })
    } else if (role === "assistant") {
      const projected = await projectAssistantMessage(tsian, content)
      const choices = projectedChoices(projected)
      // 最后一条 agent 消息保留 choices（玩家可能还没选），
      // 更早的 agent 消息选项已过期，不恢复
      const isLast = restored.filter((m) => m.role === "agent").length
        === recentTurns.filter((e) => typeof e === "object" && e !== null
          && (e as Record<string, unknown>).role === "assistant").length - 1
      restored.push({
        id: nextDialogId(),
        role: "agent",
        content: displayAssistantContent(projected),
        ...(isLast && choices.length > 0 ? { options: choices } : {}),
      })
    }
  }

  if (restored.length === 0) return false
  playSetupMessages.value = restored
  return true
}

/** 构造初始 prompt 并发起第一次 invokeAgent，激活 agent + skill。 */
async function startPlaySetupDialog(): Promise<void> {
  if (playSetupStatus.value === "running" || playSetupStatus.value === "complete") return
  const tsian = getTsianClient()

  // 检查是否已完成（重载恢复）
  const summary = await loadSetupSummary(tsian)
  if (summary?.status === "complete") {
    playSetupStatus.value = "complete"
    playSetupSummary.value = summary.summary ?? null
    return
  }

  // 尝试从 context slot 恢复已有对话（刷新/返回后回来）
  if (playSetupMessages.value.length === 0) {
    const restored = await restorePlaySetupMessages(tsian)
    if (restored) {
      // 已有对话历史，恢复为 idle 等待玩家继续，不重新发起
      playSetupStatus.value = "idle"
      return
    }
  }

  // 构造初始 prompt：需要小说标题 + 玩家角色信息
  const title = understandingSummary.value?.title ?? manifest.value?.title ?? "导入小说"
  const character = selectedCharacter.value
    ? { ref: selectedCharacter.value.ref, name: selectedCharacter.value.name }
    : null
  const prompt = buildPlaySetupPrompt(title, character)

  playSetupStatus.value = "running"
  playSetupError.value = ""
  // 流式接入：生成 invocationId，订阅 onAgentInvocation delta，清空累积文本。
  const invocationId = `play-setup-${Date.now().toString(36)}`
  activeInvocationId = invocationId
  playSetupStreamingText.value = ""
  ensurePlaySetupInvocationSubscription(tsian)

  try {
    const result = await tsian.invokeAgent("world-architect", prompt, {
      invocationId,
      purpose: "opening-play-setup",
      contextSlot: "play-setup",
      persist: true,
    })
    handleAgentResponse(result.response)
  } catch (err) {
    playSetupStatus.value = "failed"
    playSetupError.value = err instanceof Error ? err.message : "对话启动失败"
  } finally {
    playSetupStreamingText.value = ""
    activeInvocationId = null
  }
}

/** 玩家发送消息（选项点击或自由输入）→ 下一轮 invokeAgent。 */
async function sendPlaySetupMessage(input: string): Promise<void> {
  if (playSetupStatus.value === "running" || playSetupStatus.value === "complete") return
  const tsian = getTsianClient()

  // 清除最后一条 agent 消息的选项（已选中，不再显示）
  const msgs = playSetupMessages.value
  for (let i = msgs.length - 1; i >= 0; i--) {
    const msg = msgs[i]
    if (msg?.role === "agent" && msg.options && msg.options.length > 0) {
      msgs[i] = { ...msg, options: undefined }
      break
    }
  }

  // push user message
  playSetupMessages.value.push({ id: nextDialogId(), role: "user", content: input })

  playSetupStatus.value = "running"
  playSetupError.value = ""
  // 流式接入：新一轮调用，生成新 invocationId + 清空累积文本。
  const invocationId = `play-setup-${Date.now().toString(36)}`
  activeInvocationId = invocationId
  playSetupStreamingText.value = ""
  ensurePlaySetupInvocationSubscription(tsian)

  try {
    const result = await tsian.invokeAgent("world-architect", input, {
      invocationId,
      purpose: "opening-play-setup",
      contextSlot: "play-setup",
      persist: true,
    })
    handleAgentResponse(result.response)
  } catch (err) {
    playSetupStatus.value = "failed"
    playSetupError.value = err instanceof Error ? err.message : "对话失败，请重试"
  } finally {
    playSetupStreamingText.value = ""
    activeInvocationId = null
  }
}

/** 处理 agent 返回的 response：使用平台投影提取 display text + choices，push agent message，检查完成态。 */
async function handleAgentResponse(response: string): Promise<void> {
  const tsian = getTsianClient()
  const projected = await projectAssistantMessage(tsian, response)
  const choices = projectedChoices(projected)
  // 落定：把完整文本 push 成 NarrativeMessage 落定消息，并清空流式累积。
  // 流式和落定是两套渲染——这里切到落定消息后，流式块不再展示。
  playSetupStreamingText.value = ""
  activeInvocationId = null
  playSetupMessages.value.push({
    id: nextDialogId(),
    role: "agent",
    content: displayAssistantContent(projected),
    ...(choices.length > 0 ? { options: choices } : {}),
  })

  // 检查 setup-summary 是否 complete
  const summary = await loadSetupSummary(tsian)
  if (summary?.status === "complete") {
    playSetupStatus.value = "complete"
    playSetupSummary.value = summary.summary ?? null
  } else {
    playSetupStatus.value = "idle"
  }
}

/** 重置对话状态。 */
function resetPlaySetupDialog(): void {
  playSetupStatus.value = "idle"
  playSetupMessages.value = []
  playSetupError.value = ""
  playSetupStreamingText.value = ""
  activeInvocationId = null
}

/** 重试（从 failed 恢复）。 */
async function retryPlaySetupDialog(): Promise<void> {
  playSetupError.value = ""
  // 如果有消息则重发最后一条 user 消息，否则重新启动
  const lastUserMsg = [...playSetupMessages.value].reverse().find((m) => m.role === "user")
  if (lastUserMsg) {
    // 移除最后一条 agent 消息（如果有的话）
    const lastIdx = playSetupMessages.value.length - 1
    if (lastIdx >= 0 && playSetupMessages.value[lastIdx]?.role === "agent") {
      playSetupMessages.value.splice(lastIdx, 1)
    }
    await sendPlaySetupMessage(lastUserMsg.content)
  } else {
    playSetupMessages.value = []
    await startPlaySetupDialog()
  }
}

// ── 初始化：从 workspace 加载已有数据 ──

async function initialize(): Promise<void> {
  if (initialized.value) return
  const tsian = getTsianClient()

  try {
    const existingManifest = await loadSourceManifest(tsian)
    if (existingManifest) {
      manifest.value = existingManifest
      chapterIndex.value = await ensureChapterCharacters(tsian, await loadChapterIndex(tsian))
      const summary = await loadUnderstandingSummary(tsian)
      if (summary) {
        understandingSummary.value = summary
        understandingStatus.value = "ready"
        // 检查是否已有 protagonistRef（重载恢复）
        const existingCharacter = await loadPlayerCharacter(tsian)
        if (existingCharacter) {
          selectedCharacter.value = existingCharacter
          characterSetupStatus.value = "confirmed"
          characterBranch.value = existingCharacter.ref.startsWith("character:original-") ? "original" : "canon"
          // 检查 setup-summary 是否完成（Step 4 重载恢复）
          const setupSummary = await loadSetupSummary(tsian)
          if (setupSummary?.status === "complete") {
            playSetupStatus.value = "complete"
            playSetupSummary.value = setupSummary.summary ?? null
            subView.value = "opening-confirm"
            step.value = 5
            statusText.value = "游玩设定已完成"
          } else {
            subView.value = "character-setup"
            step.value = 3
            statusText.value = `已选定角色：${existingCharacter.name}`
          }
        } else {
          subView.value = "understanding"
          step.value = 2
          statusText.value = "初始理解已完成"
        }
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
    understandingStage: readonly(understandingStage),
    characterBranch: readonly(characterBranch),
    selectedCharacter: readonly(selectedCharacter),
    characterSetupStatus: readonly(characterSetupStatus),
    playSetupStatus: readonly(playSetupStatus),
    playSetupMessages: readonly(playSetupMessages),
    playSetupError: readonly(playSetupError),
    playSetupStreamingText: readonly(playSetupStreamingText),
    playSetupSummary: readonly(playSetupSummary),

    // 可写状态（组件需直接改的）
    selectedChapterWritable: selectedChapter,

    // 操作方法
    initialize,
    setView,
    goToStep,
    startImport,
    confirmReimport,
    startOpeningUnderstanding,
    loadChapterPreview,
    setCharacterBranch,
    backToBranchChoice,
    confirmCanonCharacter,
    confirmOriginalCharacter,
    resetCharacterSetup,
    startPlaySetupDialog,
    sendPlaySetupMessage,
    resetPlaySetupDialog,
    retryPlaySetupDialog,
  }
}
