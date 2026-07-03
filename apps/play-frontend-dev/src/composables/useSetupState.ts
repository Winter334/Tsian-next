import { ref, readonly } from "vue"
import { useTsian } from "./useTsian"
import { parseStoryOptions } from "@tsian/play-bridge"
import {
  SOURCE_MANIFEST_PATH,
  CHAPTER_INDEX_PATH,
  INITIAL_SUMMARY_PATH,
  RUNTIME_PATH,
  SETUP_SUMMARY_PATH,
  CHARACTER_ENTITIES_ROOT,
  buildSourceCorpus,
  buildOpeningInitializationPrompt,
  buildPlaySetupPrompt,
  safeJsonParse,
  isSourceManifest,
  isOpeningUnderstandingSummary,
  isSetupSummary,
  excerptText,
  type SourceManifest,
  type ChapterIndexFile,
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

// ── 角色设定状态（Step 3）──
const characterBranch = ref<CharacterBranch | null>(null)
const selectedCharacter = ref<SelectedCharacter | null>(null)
const characterSetupStatus = ref<CharacterSetupStatus>("selecting")

// ── 游玩设定对话状态（Step 4）──
const playSetupStatus = ref<PlaySetupStatus>("idle")
const playSetupMessages = ref<DialogMessage[]>([])
const playSetupError = ref("")
const playSetupHeartbeat = ref(0)
let playSetupHeartbeatUnsub: Array<() => void> = []

// ── 开局确认状态（Step 5）──
const playSetupSummary = ref<string | null>(null)

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

/** 确认原著角色选择。写入 runtime.json 的 player.character。 */
async function confirmCanonCharacter(candidate: { id?: string; name: string; brief: string; gender?: string }): Promise<void> {
  if (busy.value) return
  const { tsian } = useTsian()
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
  const { tsian } = useTsian()
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

/** read-modify-write runtime.json 的 player.character 字段。 */
async function writePlayerCharacter(
  tsian: ReturnType<typeof useTsian>["tsian"],
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
    player: {
      ...(runtime as Record<string, unknown>).player as Record<string, unknown> | undefined,
      character: { ref, name },
    },
  }
  await tsian.workspace.write(RUNTIME_PATH, `${JSON.stringify(updated, null, 2)}\n`)
}

/** 生成唯一 localId：original-<name>，冲突加序号后缀。 */
async function ensureUniqueLocalId(
  tsian: ReturnType<typeof useTsian>["tsian"],
  name: string,
): Promise<string> {
  const base = `original-${name}`
  const listResult = await tsian.workspace.list(CHARACTER_ENTITIES_ROOT)
  const existing = new Set(
    listResult.map((f) => f.path.split("/").pop()?.replace(/\.json$/, "") ?? ""),
  )
  if (!existing.has(base)) return base
  for (let i = 2; i < 100; i++) {
    const candidate = `${base}-${i}`
    if (!existing.has(candidate)) return candidate
  }
  return `${base}-${Date.now()}`
}

/** 读取 runtime.json 的 player.character，用于重载恢复。 */
async function loadPlayerCharacter(
  tsian: ReturnType<typeof useTsian>["tsian"],
): Promise<SelectedCharacter | null> {
  const file = await tsian.workspace.read(RUNTIME_PATH)
  if (!file?.content) return null
  const runtime = safeJsonParse(file.content)
  if (!runtime || typeof runtime !== "object") return null
  const player = (runtime as Record<string, unknown>).player
  if (!player || typeof player !== "object") return null
  const character = (player as Record<string, unknown>).character
  if (!character || typeof character !== "object") return null
  const ref = (character as Record<string, unknown>).ref
  const name = (character as Record<string, unknown>).name
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

/** 启动 play-setup 心跳监听（独立于 understanding 的心跳）。 */
function startPlaySetupHeartbeat(): void {
  stopPlaySetupHeartbeat()
  const { tsian } = useTsian()
  playSetupHeartbeatUnsub = [
    tsian.onAgentActivity(() => {
      if (playSetupStatus.value === "running") {
        playSetupHeartbeat.value++
      }
    }),
  ]
}

function stopPlaySetupHeartbeat(): void {
  for (const unsub of playSetupHeartbeatUnsub) unsub()
  playSetupHeartbeatUnsub = []
  playSetupHeartbeat.value = 0
}

/** 读取 setup-summary.json 判断完成态。 */
async function loadSetupSummary(
  tsian: ReturnType<typeof useTsian>["tsian"],
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
  tsian: ReturnType<typeof useTsian>["tsian"],
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
      const parsed = parseStoryOptions(content)
      // 最后一条 agent 消息保留 options（玩家可能还没选），
      // 更早的 agent 消息选项已过期，不恢复
      const isLast = restored.filter((m) => m.role === "agent").length
        === recentTurns.filter((e) => typeof e === "object" && e !== null
          && (e as Record<string, unknown>).role === "assistant").length - 1
      restored.push({
        id: nextDialogId(),
        role: "agent",
        content: parsed.cleanText,
        ...(isLast && parsed.options.length > 0 ? { options: parsed.options } : {}),
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
  const { tsian } = useTsian()

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
  startPlaySetupHeartbeat()

  try {
    const result = await tsian.invokeAgent("world-architect", prompt, {
      contextSlot: "play-setup",
      persist: true,
    })
    handleAgentResponse(result.response)
  } catch (err) {
    playSetupStatus.value = "failed"
    playSetupError.value = err instanceof Error ? err.message : "对话启动失败"
  } finally {
    stopPlaySetupHeartbeat()
  }
}

/** 玩家发送消息（选项点击或自由输入）→ 下一轮 invokeAgent。 */
async function sendPlaySetupMessage(input: string): Promise<void> {
  if (playSetupStatus.value === "running" || playSetupStatus.value === "complete") return
  const { tsian } = useTsian()

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
  startPlaySetupHeartbeat()

  try {
    const result = await tsian.invokeAgent("world-architect", input, {
      contextSlot: "play-setup",
      persist: true,
    })
    handleAgentResponse(result.response)
  } catch (err) {
    playSetupStatus.value = "failed"
    playSetupError.value = err instanceof Error ? err.message : "对话失败，请重试"
  } finally {
    stopPlaySetupHeartbeat()
  }
}

/** 处理 agent 返回的 response：parseStoryOptions 提取 cleanText + options，push agent message，检查完成态。 */
async function handleAgentResponse(response: string): Promise<void> {
  const { tsian } = useTsian()
  const parsed = parseStoryOptions(response)
  playSetupMessages.value.push({
    id: nextDialogId(),
    role: "agent",
    content: parsed.cleanText,
    ...(parsed.options.length > 0 ? { options: parsed.options } : {}),
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
  stopPlaySetupHeartbeat()
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
        // 检查是否已有 player.character（重载恢复）
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
    agentHeartbeat: readonly(agentHeartbeat),
    characterBranch: readonly(characterBranch),
    selectedCharacter: readonly(selectedCharacter),
    characterSetupStatus: readonly(characterSetupStatus),
    playSetupStatus: readonly(playSetupStatus),
    playSetupMessages: readonly(playSetupMessages),
    playSetupError: readonly(playSetupError),
    playSetupHeartbeat: readonly(playSetupHeartbeat),
    playSetupSummary: readonly(playSetupSummary),

    // 非响应式值（组件按需读取）
    get understandingStartedAt() { return understandingStartedAt },

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
