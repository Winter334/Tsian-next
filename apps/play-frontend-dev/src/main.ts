// apps/play-frontend-dev/src/main.ts
// Tsian AIRP 游戏前端 — 表现层（开发版）
//
// 从 default-frontend-files.ts app.js 表现层（L371-760）移植为 TS。
// 协议层由 @tsian/play-bridge 提供，本文件只做消息渲染 / 流式 / 过程节点 / 输入。
// 只通过 bridge.call() 和 bridge.on() 与平台交互。
//
// 烛火书卷（Lamplight Codex）风格 —— 见 style.css。

import { marked } from "marked"
import {
  createBridge,
  createSessionHistory,
  parseStoryOptions,
  listCheckpoints,
  restoreCheckpoint,
} from "@tsian/play-bridge"
import type {
  RemotePlayBridgeEventName,
  RemotePlayBridgeEventPayload,
  ConversationMessageRecord,
  SessionHistoryEntry,
  TurnStats,
  TurnToolOutput,
  CheckpointSummary,
} from "@tsian/play-bridge"

// ════════════════════════════════════════════════════════════════
// 桥实例（协议层全部由 @tsian/play-bridge 封装）
// ════════════════════════════════════════════════════════════════

const bridge = createBridge()

// ════════════════════════════════════════════════════════════════
// DOM 引用
// ════════════════════════════════════════════════════════════════

const $status = document.getElementById("status") as HTMLSpanElement | null
const $story = document.getElementById("story") as HTMLElement | null
const $input = document.getElementById("input") as HTMLTextAreaElement | null
const $send = document.getElementById("send") as HTMLButtonElement | null
const $stop = document.getElementById("stop") as HTMLButtonElement | null
const $turnBadge = document.getElementById("turn-badge") as HTMLSpanElement | null
const $turnNum = document.getElementById("turn-num") as HTMLElement | null
const $emptyState = document.getElementById("empty-state") as HTMLDivElement | null
// 视图舞台 / 导航栏 / 检查点视图 / composer（视图切换用）
const $checkpointView = document.getElementById("checkpoint-view") as HTMLElement | null
const $composer = document.querySelector<HTMLDivElement>(".composer")
const $navItems = Array.from(document.querySelectorAll<HTMLButtonElement>(".nav-item"))

// ════════════════════════════════════════════════════════════════
// 回合状态机（移植自 useAssistantTimeline，原生 JS 版）
// timeline: 过程节点（thought/tool/interim），按发生顺序，带 agentId。
// 历史过程节点从 workspace turn 文件读回（createSessionHistory），不再内存累积。
// ════════════════════════════════════════════════════════════════

interface ProcessNode {
  type: "thought" | "tool" | "interim"
  id: string
  round?: number
  name?: string
  status?: "loading" | "running" | "success" | "failed"
  collapsed: boolean
  agentId?: string | null
  text?: string
  output?: TurnToolOutput
}

interface TurnState {
  timeline: ProcessNode[]
  streamingText: string
  streamingReasoning: string
  content: string
  /** 本轮资源消耗统计（耗时 + token），turn-stats 事件到达时填充。 */
  stats?: TurnStats
}

interface TurnEls {
  processZone: HTMLDivElement
  streamEl: HTMLDivElement
  streamBody: HTMLDivElement
}

let turnActive = false
let currentTurnEls: TurnEls | null = null
let turnState: TurnState | null = null
let userPinnedToBottom = true
// 当前 turn 待渲染的剧情选项(turn-options 事件先到,finalizeTurn 时渲染).
// null = 无选项;非空数组 = 有选项待渲染.每次 turn 开始时重置.
let pendingOptions: string[] | null = null

function newTurnState(): TurnState {
  return { timeline: [], streamingText: "", streamingReasoning: "", content: "" }
}

// ════════════════════════════════════════════════════════════════
// 工具函数
// ════════════════════════════════════════════════════════════════

function setStatus(text: string, state?: string): void {
  if (!$status) return
  $status.textContent = text
  if (state) $status.setAttribute("data-state", state)
}

function setTurn(num: number): void {
  if (typeof num === "number" && $turnNum && $turnBadge) {
    $turnNum.textContent = String(num)
    $turnBadge.hidden = false
  }
}

function scrollDown(): void {
  if ($story) $story.scrollTop = $story.scrollHeight
}

function maybeScrollDown(): void {
  if (userPinnedToBottom) scrollDown()
}

if ($story) {
  $story.addEventListener("scroll", () => {
    const dist = $story.scrollHeight - $story.scrollTop - $story.clientHeight
    userPinnedToBottom = dist < 80
  })
}

// ════════════════════════════════════════════════════════════════
// 视图切换（剧情 / 回溯 / 未来…）
// 右侧导航栏切换中间视图舞台；同一时刻一个视图可见，切换不销毁 DOM
// （剧情视图保留滚动位置）。非剧情视图隐藏 composer（输入只属剧情）。
// ════════════════════════════════════════════════════════════════

type ViewId = "story" | "checkpoints"

let currentView: ViewId = "story"

/** 切换视图舞台：显隐对应视图 + 同步导航激活态 + composer 仅剧情视图可见。 */
function switchView(view: ViewId): void {
  if (view === currentView) return
  currentView = view
  if ($story) $story.hidden = view !== "story"
  if ($checkpointView) $checkpointView.hidden = view !== "checkpoints"
  if ($composer) $composer.classList.toggle("hidden", view !== "story")
  for (const btn of $navItems) {
    btn.classList.toggle("active", btn.dataset.view === view)
  }
  if (view === "checkpoints") void loadCheckpointView()
}

/** 导航按钮点击：点当前激活项 = 切回剧情（回溯视图的快捷返回）。 */
for (const btn of $navItems) {
  btn.addEventListener("click", () => {
    if (btn.disabled) return
    const target = btn.dataset.view as ViewId | undefined
    if (!target) return
    if (target === currentView) switchView("story")
    else switchView(target)
  })
}

// Esc 在非剧情视图时切回剧情
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && currentView !== "story") switchView("story")
})

/** turn 进行中时禁用回溯导航（避免回合中途回滚存档）。 */
function setNavCheckpointsEnabled(enabled: boolean): void {
  const btn = $navItems.find((b) => b.dataset.view === "checkpoints")
  if (btn) btn.disabled = !enabled
}

// ════════════════════════════════════════════════════════════════
// 检查点回溯视图
// 卡片列表（host 按新→旧排序）：第 N 回 + 类型徽标 + 相对时间 + 恢复按钮。
// 恢复 = 破坏性操作 → 全局确认弹窗 → restoreCheckpoint → 切回剧情 + 重渲染。
// ════════════════════════════════════════════════════════════════

const REASON_LABEL: Record<CheckpointSummary["reason"], string> = {
  initial: "初始",
  "after-turn": "回合后",
  manual: "手动",
}

/** 把毫秒时间戳格式化成相对时间（如"2 分钟前""3 小时前""昨天"）；同日显时间。 */
function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts
  if (diff < 60_000) return "刚刚"
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86_400_000) return `${Math.floor(diff / 3600_000)} 小时前`
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)} 天前`
  const d = new Date(ts)
  return `${d.getMonth() + 1}-${d.getDate()}`
}

/** 渲染检查点视图：加载中 → 列表/空 → 错误三态。 */
async function loadCheckpointView(): Promise<void> {
  if (!$checkpointView) return
  $checkpointView.innerHTML = ""
  const inner = document.createElement("div")
  inner.className = "checkpoint-inner"
  inner.appendChild(renderCkptState("loading", "载入检查点…", ""))
  $checkpointView.appendChild(inner)
  let checkpoints: CheckpointSummary[]
  try {
    checkpoints = await listCheckpoints(bridge)
  } catch (e) {
    const msg = (e && (e as { message?: string }).message) ? (e as { message: string }).message : "加载检查点失败"
    inner.innerHTML = ""
    inner.appendChild(renderCkptState("error", "加载失败", msg))
    return
  }
  inner.innerHTML = ""
  const head = document.createElement("h2")
  head.className = "ckpt-title"
  head.textContent = "回溯"
  inner.appendChild(head)
  const sub = document.createElement("p")
  sub.className = "ckpt-sub"
  sub.textContent = "恢复到某个检查点将回滚此后所有进度。"
  inner.appendChild(sub)
  if (checkpoints.length === 0) {
    inner.appendChild(renderCkptState("empty", "尚无可回溯的检查点", "开始游戏后将自动生成。"))
    return
  }
  const list = document.createElement("div")
  list.className = "ckpt-list"
  for (const cp of checkpoints) list.appendChild(renderCheckpointCard(cp))
  inner.appendChild(list)
}

/** 渲染检查点视图的状态占位（加载中/空/错误）。 */
function renderCkptState(kind: "loading" | "empty" | "error", title: string, hint: string): HTMLDivElement {
  const div = document.createElement("div")
  div.className = "ckpt-state" + (kind === "error" ? " error" : "")
  const t = document.createElement("p"); t.className = "ckpt-state-title"; t.textContent = title
  const h = document.createElement("p"); h.className = "ckpt-state-hint"; h.textContent = hint
  div.appendChild(t); div.appendChild(h)
  return div
}

/** 渲染单张检查点卡片：第 N 回 + 类型徽标 + 相对时间 + 恢复按钮。 */
function renderCheckpointCard(cp: CheckpointSummary): HTMLDivElement {
  const card = document.createElement("div")
  card.className = "ckpt-card"

  const main = document.createElement("div")
  main.className = "ckpt-main"
  const turn = document.createElement("p")
  turn.className = "ckpt-turn"
  turn.textContent = `第 ${cp.turn} 回`
  main.appendChild(turn)
  const meta = document.createElement("div")
  meta.className = "ckpt-meta"
  const badge = document.createElement("span")
  badge.className = "ckpt-badge " + cp.reason
  badge.textContent = REASON_LABEL[cp.reason]
  meta.appendChild(badge)
  const time = document.createElement("span")
  time.className = "ckpt-time"
  time.textContent = formatRelativeTime(cp.createdAt)
  time.title = new Date(cp.createdAt).toLocaleString()
  meta.appendChild(time)
  if (cp.label) {
    const lab = document.createElement("span")
    lab.className = "ckpt-time"
    lab.textContent = "· " + cp.label
    meta.appendChild(lab)
  }
  main.appendChild(meta)
  card.appendChild(main)

  const restoreBtn = document.createElement("button")
  restoreBtn.type = "button"
  restoreBtn.className = "ckpt-restore"
  restoreBtn.textContent = "恢复"
  restoreBtn.addEventListener("click", () => openRestoreConfirm(cp))
  card.appendChild(restoreBtn)
  return card
}

// ── 恢复确认弹窗（全局遮罩，破坏性操作二次确认）──
let $modalOverlay: HTMLDivElement | null = null

/** 打开恢复确认弹窗：选中检查点 → 确认 → restoreCheckpoint → 切回剧情 + 重渲染。 */
function openRestoreConfirm(cp: CheckpointSummary): void {
  closeRestoreConfirm()
  const overlay = document.createElement("div")
  overlay.className = "modal-overlay"
  overlay.innerHTML = ""
  const modal = document.createElement("div")
  modal.className = "modal"
  const title = document.createElement("p")
  title.className = "modal-title"
  title.textContent = "恢复检查点"
  modal.appendChild(title)
  const body = document.createElement("p")
  body.className = "modal-body"
  body.innerHTML = `将回滚到 <b>第 ${cp.turn} 回</b>（${REASON_LABEL[cp.reason]}）。<br><span class="warn">此后所有进度将丢失，此操作不可撤销。</span>`
  modal.appendChild(body)
  const errorEl = document.createElement("p")
  errorEl.className = "modal-error"
  modal.appendChild(errorEl)
  const actions = document.createElement("div")
  actions.className = "modal-actions"
  const cancelBtn = document.createElement("button")
  cancelBtn.type = "button"
  cancelBtn.className = "modal-btn"
  cancelBtn.textContent = "取消"
  const confirmBtn = document.createElement("button")
  confirmBtn.type = "button"
  confirmBtn.className = "modal-btn danger"
  confirmBtn.textContent = "恢复"
  cancelBtn.addEventListener("click", closeRestoreConfirm)
  const doRestore = async () => {
    confirmBtn.disabled = true
    cancelBtn.disabled = true
    errorEl.textContent = ""
    try {
      await restoreCheckpoint(bridge, cp.id)
      closeRestoreConfirm()
      switchView("story")
      await reloadHistory()
      setStatus(`已回溯到第 ${cp.turn} 回`, "ready")
    } catch (e) {
      confirmBtn.disabled = false
      cancelBtn.disabled = false
      errorEl.textContent = (e && (e as { message?: string }).message) ? (e as { message: string }).message : "恢复失败"
    }
  }
  confirmBtn.addEventListener("click", () => void doRestore())
  actions.appendChild(cancelBtn)
  actions.appendChild(confirmBtn)
  modal.appendChild(actions)
  overlay.appendChild(modal)
  // 点遮罩空白处取消；Esc 取消
  overlay.addEventListener("click", (e) => { if (e.target === overlay) closeRestoreConfirm() })
  overlay.addEventListener("keydown", (e) => { if (e.key === "Escape") closeRestoreConfirm() })
  document.body.appendChild(overlay)
  $modalOverlay = overlay
  confirmBtn.focus()
}

function closeRestoreConfirm(): void {
  if ($modalOverlay) { $modalOverlay.remove(); $modalOverlay = null }
}

/** 从 workspace turn 文件单源重建对话（重载/回溯后复用）。 */
async function reloadHistory(): Promise<void> {
  const history = await createSessionHistory(bridge)
  setTurn(history.turn)
  renderSessionHistory(history.entries)
}

// ════════════════════════════════════════════════════════════════
// markdown 渲染（ESM import marked）
// ════════════════════════════════════════════════════════════════

function renderMarkdown(text: string): string {
  return marked.parse(text, { async: false }) as string
}

// ════════════════════════════════════════════════════════════════
// 消息渲染
// ════════════════════════════════════════════════════════════════

function clearEmptyState(): void {
  if ($emptyState && $emptyState.parentElement) $emptyState.remove()
}

// 从 SessionHistoryEntry[] 重建完整对话（重载/初始渲染用）.
// 每个 turn 的 processNodes + messages 按序排列:过程节点 → 正文(user+assistant).
// 这是单源重建——不再从 snapshot 读渲染数据,过程节点从 workspace turn 文件读回.
function renderSessionHistory(entries: SessionHistoryEntry[]): void {
  if (!$story) return
  clearEmptyState()
  $story.innerHTML = ""
  const inner = document.createElement("div")
  inner.className = "story-inner"
  if (entries.length === 0) {
    const empty = document.createElement("div")
    empty.className = "empty-state"
    empty.innerHTML = '<p class="empty-title">故事尚未开始</p><p class="empty-hint">在下方输入你的行动，开启冒险。</p>'
    inner.appendChild(empty)
  } else {
    for (const entry of entries) {
      // 每个 turn 的正确时间线：user 消息 → 过程节点(thought/interim/tool) → assistant 最终正文
      // 持久化结构里 messages=[user, assistant] + 独立 processNodes 字段，
      // 不能把 processNodes 整个排在 messages 前面（否则工具调用堆在 user 上面）。
      const userMsg = entry.messages.find((m) => m.role === "user")
      const assistantMsgs = entry.messages.filter((m) => m.role !== "user")
      if (userMsg) inner.appendChild(renderMessageEl(userMsg))
      // 过程节点(如果有)
      if (entry.processNodes && entry.processNodes.length > 0) {
        const zone = document.createElement("div")
        zone.className = "process-history-zone"
        for (const el of renderTimeline(entry.processNodes)) zone.appendChild(el)
        inner.appendChild(zone)
      }
      // assistant 正文(最终回复) + token meta 行（重载无耗时数据，只显 token）
      for (const m of assistantMsgs) {
        const el = renderMessageEl(m)
        const tokenText = formatTokenStats(entry.stats)
        if (tokenText) {
          const meta = document.createElement("p")
          meta.className = "turn-meta"
          meta.textContent = `· ${tokenText}`
          const body = el.querySelector(".msg-body")
          if (body) body.appendChild(meta)
        }
        inner.appendChild(el)
      }
    }
  }
  $story.appendChild(inner)
  scrollDown()
}

// 单条消息 → DOM（剧情正文无气泡，用户消息左竖线）
function renderMessageEl(m: ConversationMessageRecord): HTMLDivElement {
  if (m.role === "user") {
    const div = document.createElement("div")
    div.className = "user-msg"
    const role = document.createElement("div"); role.className = "msg-role"; role.textContent = "你"
    const body = document.createElement("div"); body.className = "msg-body"; body.textContent = m.content
    div.appendChild(role); div.appendChild(body)
    return div
  }
  // assistant = 剧情正文
  const div = document.createElement("div")
  div.className = "narrative"
  const role = document.createElement("div"); role.className = "msg-role"; role.textContent = m.role
  const body = document.createElement("div"); body.className = "msg-body prose"
  body.innerHTML = renderMarkdown(m.content || "")
  div.appendChild(role); div.appendChild(body)
  return div
}

// ════════════════════════════════════════════════════════════════
// turn stats meta 行（实时耗时 + token，显示在 assistant 正文末尾）
// ════════════════════════════════════════════════════════════════

// 实时计时器：beginTurn 启动，finalizeTurn 停止。耗时纯前端计，
// token 走 host 的 turn-stats 事件（前端算不了 token）。
let turnTimerId: ReturnType<typeof setInterval> | null = null
let turnStartedAt = 0
/** 当前回合的 meta 元素引用，实时计时器和 finalizeTurn 共用更新。 */
let turnMetaEl: HTMLParagraphElement | null = null

/** 把毫秒格式化成人类可读的耗时（如 "4.2s"、"1.3min"）。 */
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  return `${(ms / 60_000).toFixed(1)}min`
}

/** 把 token 数格式化成紧凑显示（如 "1.2k"、"12k"、"1.3M"）。 */
function formatTokens(n: number): string {
  if (n < 1000) return String(n)
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`
  return `${(n / 1_000_000).toFixed(1)}M`
}

/** 把 TurnStats 的 token 部分格式化（如 "1.2k tokens"），无数据返回空。 */
function formatTokenStats(stats: TurnStats | undefined): string {
  if (!stats) return ""
  const tokens = stats.totalTokens ?? stats.inputTokens ?? stats.outputTokens
  if (tokens === undefined) return ""
  return `${formatTokens(tokens)} tokens`
}

/** 创建 stats meta DOM 元素，初始只显示耗时（计时器实时更新）。
 *  token 在 finalizeTurn 时追加（turn-stats 事件到达后）。 */
function createStatsMeta(): HTMLParagraphElement {
  const p = document.createElement("p")
  p.className = "turn-meta"
  p.textContent = "· 0.0s"
  return p
}

/** 更新 meta 元素的文本：耗时 + token（token 有则追加）。 */
function updateStatsMeta(el: HTMLParagraphElement, durationMs: number, tokenText: string): void {
  const parts = [formatDuration(durationMs)]
  if (tokenText) parts.push(tokenText)
  el.textContent = `· ${parts.join(" · ")}`
}

/** 启动实时计时器：每 200ms 更新 meta 元素的耗时显示。 */
function startTurnTimer(): void {
  stopTurnTimer()
  turnStartedAt = Date.now()
  turnTimerId = setInterval(() => {
    if (turnMetaEl) {
      updateStatsMeta(turnMetaEl, Date.now() - turnStartedAt, formatTokenStats(turnState?.stats))
    }
  }, 200)
}

/** 停止计时器，把 meta 元素更新为最终耗时 + token。 */
function stopTurnTimer(): void {
  if (turnTimerId !== null) {
    clearInterval(turnTimerId)
    turnTimerId = null
  }
  if (turnMetaEl) {
    updateStatsMeta(turnMetaEl, Date.now() - turnStartedAt, formatTokenStats(turnState?.stats))
  }
}

// ════════════════════════════════════════════════════════════════
// 过程节点渲染
// ════════════════════════════════════════════════════════════════

// 工具名 → 玩家可读的（动词, 名词, 量词）三元组，用于生成自然语言摘要。
// 量词用于"读取了 N 个文件"这类句子；null 表示不附带计数。
const TOOL_LABEL: Record<string, { verb: string; noun: string; unit: string | null }> = {
  read: { verb: "读取", noun: "文件", unit: "个" },
  list: { verb: "列出", noun: "条目", unit: "项" },
  search: { verb: "搜索", noun: "匹配", unit: "处" },
  glob: { verb: "匹配", noun: "文件", unit: "个" },
  diff: { verb: "比对", noun: "差异", unit: null },
  write: { verb: "写入", noun: "文件", unit: null },
  edit: { verb: "编辑", noun: "文件", unit: null },
  move: { verb: "移动", noun: "文件", unit: null },
  delete: { verb: "删除", noun: "文件", unit: null },
  semantic_search: { verb: "语义检索", noun: "记忆", unit: null },
  use_skill: { verb: "激活", noun: "技能", unit: null },
  run_script: { verb: "执行", noun: "脚本", unit: null },
  inspect_frontend: { verb: "自检", noun: "前端", unit: null },
  ask_user: { verb: "向玩家", noun: "提问", unit: null },
}

/** 从普通工具的 output（JSON.stringify 的结果字符串）里解析出计数。 */
function toolCountFromOutput(name: string, output: TurnToolOutput | undefined): number | null {
  if (typeof output !== "string" || !output) return null
  let parsed: unknown
  try { parsed = JSON.parse(output) } catch { return null }
  if (Array.isArray(parsed)) return parsed.length
  if (parsed && typeof parsed === "object") {
    // search 返回 [{matches:[...]}, ...]，累加 matches 长度
    if (name === "search" && Array.isArray((parsed as Record<string, unknown[]>).files)) {
      let total = 0
      for (const f of (parsed as Record<string, unknown[]>).files) {
        if (f && typeof f === "object" && Array.isArray((f as Record<string, unknown[]>).matches)) {
          total += (f as Record<string, unknown[]>).matches.length
        }
      }
      return total
    }
  }
  return null
}

/** 单个普通工具 → 自然语言摘要句（如"读取了 3 个文件"）。
 *  同名工具合并时传入 count（>1），生成"读取了 3 个文件"而非"读取 1 个文件"。 */
function toolSummarySentence(node: ProcessNode, count: number): string {
  const label = TOOL_LABEL[node.name ?? ""]
  const verb = label?.verb ?? (node.name || "调用")
  const noun = label?.noun ?? "操作"
  if (node.status === "failed") return `${verb}${noun}失败`
  const unit = label?.unit ?? null
  const total = count > 1 ? count : (toolCountFromOutput(node.name ?? "", node.output) ?? 0)
  if (unit && total > 0) {
    return `${verb}了 ${total} ${unit}${noun}`
  }
  // 无量词或无计数：只说动作（如"写入了文件"、"语义检索了记忆"）
  return `${verb}了${noun}`
}

/** 把同 round 连续的普通工具节点合并成一行自然语言摘要。
 *  agent_call 不合并（有玩家可读回应，保留独立折叠节点）。 */
function createToolGroupLine(tools: ProcessNode[]): HTMLDivElement {
  const div = document.createElement("div")
  div.className = "process-node tool tool-group"
  const hasFail = tools.some((t) => t.status === "failed")
  if (hasFail) div.classList.add("failed")
  // agentId 标签取第一个工具的
  const agentId = tools[0]?.agentId
  const head = document.createElement("div"); head.className = "process-head"
  if (agentId) {
    const tag = document.createElement("span"); tag.className = "agent-tag"; tag.textContent = agentId
    head.appendChild(tag)
    const dot = document.createElement("span"); dot.className = "glyph"; dot.textContent = "·"
    head.appendChild(dot)
  }
  const label = document.createElement("span"); label.className = "tool-group-label"
  // 同名工具合并计数，不同名各生成一句，用顿号串起
  const byName = new Map<string, { count: number; node: ProcessNode }>()
  for (const t of tools) {
    const key = t.name ?? "tool"
    const entry = byName.get(key)
    if (entry) { entry.count += 1 } else { byName.set(key, { count: 1, node: t }) }
  }
  const sentences: string[] = []
  for (const [, { count, node }] of byName) {
    sentences.push(toolSummarySentence(node, count))
  }
  label.textContent = sentences.join("、")
  head.appendChild(label)
  div.appendChild(head)
  return div
}

// 提取 agent_call 工具卡片的玩家可读内容（title + response）。
// 普通 tool（output 为 string）返回 null —— 统一不显 output，只显状态。
// agent_call 成功返回 {title, response, failed:false}；失败返回 error.message。
function agentCallDisplay(output: TurnToolOutput | undefined): { title: string; response: string; failed: boolean } | null {
  if (typeof output !== "object" || output === null || output.type !== "agent_call") return null
  return {
    title: (output.targetAgent && (output.targetAgent.title || output.targetAgent.id)) || "agent_call",
    response: output.status === "failed" ? (output.error?.message ?? "agent_call 失败") : (output.response || ""),
    failed: output.status === "failed",
  }
}

// 生成一个过程节点 DOM（thought/tool/interim），带 agentId 标签
// 普通工具不再走此函数渲染（由 createToolGroupLine 合并成一行）；
// agent_call 仍走此函数，保留折叠（收起/展开玩家可读的回应）。
function createProcessNode(node: ProcessNode): HTMLDivElement {
  const div = document.createElement("div")
  // 普通工具不再折叠；thought/agent_call 保留折叠态
  const canCollapse = node.type === "thought" || (node.type === "tool" && agentCallDisplay(node.output))
  div.className = "process-node " + node.type + (canCollapse ? (node.collapsed ? " collapsed" : " expanded") : "")
  if (node.type === "tool" && node.status === "failed") div.classList.add("failed")
  div.dataset.nodeId = node.id

  const head = document.createElement("div"); head.className = "process-head"
  // agentId 标签（agent 分流）
  if (node.agentId) {
    const tag = document.createElement("span"); tag.className = "agent-tag"; tag.textContent = node.agentId
    head.appendChild(tag)
    const dot = document.createElement("span"); dot.className = "glyph"; dot.textContent = "·"
    head.appendChild(dot)
  }
  // 折叠触发器（thought/agent_call 可折叠；普通工具/interim 无）
  if (canCollapse) {
    const toggle = document.createElement("span"); toggle.className = "toggle"; toggle.textContent = "▶"
    head.appendChild(toggle)
  }
  const label = document.createElement("span")
  // agent_call: 显示被调用 agent 的 title（玩家可读）；普通工具显示 name
  if (node.type === "thought") { label.textContent = "思考" }
  else if (node.type === "tool") {
    const ac = agentCallDisplay(node.output)
    label.textContent = ac ? ac.title : (node.name || "tool")
  } else { label.textContent = "" }
  head.appendChild(label)
  // tool 状态图标
  if (node.type === "tool") {
    const st = document.createElement("span"); st.className = "status-icon " + node.status
    st.textContent = node.status === "success" ? "✓" : node.status === "failed" ? "✗" : "▸"
    head.appendChild(st)
  }
  div.appendChild(head)

  // body
  // 普通工具：统一不显 output（仅状态图标，玩家无需看结构化返回）。
  // agent_call：显 response（玩家可读，UI 侧截断）；失败显 error.message。
  // thought/interim：显 text（markdown）。
  const body = document.createElement("div"); body.className = "process-body"
  if (node.type === "tool") {
    const ac = agentCallDisplay(node.output)
    if (ac) { body.textContent = ac.response; if (ac.failed) body.classList.add("failed-text") }
  } else if (node.text) { body.innerHTML = renderMarkdown(node.text) }
  div.appendChild(body)

  // 折叠交互（仅 thought / agent_call）
  if (canCollapse) {
    head.addEventListener("click", () => {
      const collapsed = div.classList.toggle("collapsed")
      div.classList.toggle("expanded", !collapsed)
    })
  }
  return div
}

// 按 callId 去重更新 tool 节点
function upsertToolNode(timeline: ProcessNode[], payload: RemotePlayBridgeEventPayload): void {
  if (!("callId" in payload)) return
  const existing = timeline.find((n) => n.type === "tool" && n.id === payload.callId)
  if (existing) {
    existing.status = payload.status
    if (payload.output !== undefined) existing.output = payload.output
    return
  }
  const node: ProcessNode = {
    type: "tool", id: payload.callId, round: payload.round,
    name: payload.name, status: payload.status, collapsed: false,
    agentId: payload.agentId || null,
  }
  if (payload.output !== undefined) node.output = payload.output
  timeline.push(node)
}

// ════════════════════════════════════════════════════════════════
// 回合 DOM 编排
// ════════════════════════════════════════════════════════════════

// 开始一回合：创建过程区 + 流式正文区
function beginTurn(): void {
  if (!$story) return
  clearEmptyState()
  turnActive = true
  turnState = newTurnState()
  pendingOptions = null  // 新 turn 开始,清掉上一轮待渲染选项
  // 确保有 story-inner 容器
  let inner = $story.querySelector(".story-inner") as HTMLDivElement | null
  if (!inner) {
    $story.innerHTML = ""
    inner = document.createElement("div"); inner.className = "story-inner"
    $story.appendChild(inner)
  }
  // 过程区（过程节点按发生顺序追加）
  const processZone = document.createElement("div"); processZone.className = "process-zone"
  inner.appendChild(processZone)
  // 流式正文区
  const streamEl = document.createElement("div"); streamEl.className = "narrative streaming-msg"
  const sbody = document.createElement("div"); sbody.className = "msg-body prose"
  streamEl.appendChild(sbody)
  inner.appendChild(streamEl)
  currentTurnEls = { processZone, streamEl, streamBody: sbody }
  // stats meta 元素：放在正文区，回合进行中实时跳动计时。
  turnMetaEl = createStatsMeta()
  sbody.appendChild(turnMetaEl)
  startTurnTimer()
  maybeScrollDown()
}

// 渲染当前 timeline 的过程节点到过程区
// 同 round 连续的普通工具合并成一行摘要（createToolGroupLine）；
// thought/interim/agent_call 各自独立节点。
function renderProcessNodes(): void {
  if (!currentTurnEls || !turnState) return
  const zone = currentTurnEls.processZone
  zone.innerHTML = ""
  for (const el of renderTimeline(turnState.timeline)) zone.appendChild(el)
}

/** 把 timeline 渲染成 DOM 元素数组：同 round 连续普通工具合并，其余独立。
 *  renderProcessNodes（实时）和 renderSessionHistory（重载）共用此函数。 */
function renderTimeline(timeline: ProcessNode[]): HTMLDivElement[] {
  const result: HTMLDivElement[] = []
  let i = 0
  while (i < timeline.length) {
    const node = timeline[i]
    // 普通工具（非 agent_call）：尝试与后续同 round 连续普通工具合并
    if (node.type === "tool" && !agentCallDisplay(node.output)) {
      const round = node.round
      const group: ProcessNode[] = [node]
      let j = i + 1
      while (j < timeline.length
        && timeline[j].type === "tool"
        && !agentCallDisplay(timeline[j].output)
        && timeline[j].round === round) {
        group.push(timeline[j])
        j += 1
      }
      result.push(createToolGroupLine(group))
      i = j
    } else {
      result.push(createProcessNode(node))
      i += 1
    }
  }
  return result
}

// 流式正文更新
function renderStreaming(): void {
  if (!currentTurnEls || !turnState) return
  currentTurnEls.streamBody.innerHTML = renderMarkdown(turnState.streamingText)
  maybeScrollDown()
}

// finalizeRound：镜像 useAssistantTimeline.onRoundEnd
// 思维链和过渡文本在时间线上先于工具调用产生，但 onRoundEnd 在工具执行完
// 才触发——工具节点已 push 到 timeline。这里把 interim/thought 插到同
// round 工具节点之前，保持与持久化顺序（turn-timeline-collector）一致。
function finalizeRound(payload: RemotePlayBridgeEventPayload): void {
  if (!turnState) return
  if (!("kind" in payload) || !("round" in payload)) return
  const round = payload.round
  const kind = payload.kind as "thought" | "final"
  const reasoning = turnState.streamingReasoning
  const nodesToInsert: ProcessNode[] = []
  if (kind === "thought") {
    // tool_calls 轮：过渡文本→interim，思维链→thought
    const interimText = turnState.streamingText
    if (interimText.trim()) {
      nodesToInsert.push({ type: "interim", id: "interim-r" + round, round, text: interimText, collapsed: false, agentId: payload.agentId || null })
    }
    if (reasoning.trim()) {
      nodesToInsert.push({ type: "thought", id: "thought-r" + round, round, text: reasoning, collapsed: true, agentId: payload.agentId || null })
    }
  } else {
    // 最终轮（stop）：思维链→thought，streamingText→content
    if (reasoning.trim()) {
      nodesToInsert.push({ type: "thought", id: "thought-r" + round, round, text: reasoning, collapsed: true, agentId: payload.agentId || null })
    }
    turnState.content = turnState.streamingText
  }
  if (nodesToInsert.length > 0) {
    const firstToolIdx = turnState.timeline.findIndex(
      (n) => n.type === "tool" && n.round === round,
    )
    if (firstToolIdx >= 0) {
      turnState.timeline.splice(firstToolIdx, 0, ...nodesToInsert)
    } else {
      turnState.timeline.push(...nodesToInsert)
    }
  }
  turnState.streamingReasoning = ""
  turnState.streamingText = ""
  renderProcessNodes()
}

// finalizeTurn：回合结束,过程节点原地晋升为历史(不重建 DOM,不全清覆盖).
// 折叠 thought/tool 节点(过程完成,保留可展开回看);interim 始终展开.
// 流式正文区变为正式正文区(去掉 streaming-msg class).不再推入内存数组——
// 重载时从 workspace turn 文件读回(createSessionHistory).
//
// 剧情选项:turn-options 事件先到时已缓存到 pendingOptions.此处:
//  1. 用 parseStoryOptions 剥离本地流式累积的选项块(事件流传的是原始 replyText),
//     重写 streamBody 为干净正文(去掉 [[选项]]...[[/选项]] 标记);
//  2. 若 pendingOptions 非空,在正文下方渲染选项按钮(玩家点选 = 填输入框发送 = 新 turn).
function finalizeTurn(): void {
  if (turnState && turnState.timeline.length > 0) {
    for (const node of turnState.timeline) {
      // 折叠 thought 和 agent_call（有玩家可读回应，收起保留可展开回看）；
      // 普通工具不再折叠（已合并成一行摘要，无 body 可收）。
      if (node.type === "thought" || (node.type === "tool" && agentCallDisplay(node.output))) node.collapsed = true
    }
    // 重渲染过程节点(折叠态)
    renderProcessNodes()
  }
  // 停止实时计时器
  stopTurnTimer()
  // 流式正文区 → 正式正文区,剥离本地选项块显示干净正文
  if (currentTurnEls?.streamBody && turnState) {
    const { cleanText } = parseStoryOptions(turnState.content)
    currentTurnEls.streamBody.innerHTML = renderMarkdown(cleanText)
    // innerHTML 重写后 turnMetaEl 已失效，重建并追加到正文末尾
    turnMetaEl = createStatsMeta()
    updateStatsMeta(turnMetaEl, Date.now() - turnStartedAt, formatTokenStats(turnState.stats))
    currentTurnEls.streamBody.appendChild(turnMetaEl)
  }
  if (currentTurnEls?.streamEl) {
    currentTurnEls.streamEl.classList.remove("streaming-msg")
  }
  // 渲染剧情选项按钮(若有)
  if (pendingOptions && pendingOptions.length > 0 && currentTurnEls?.streamEl?.parentElement) {
    const opts = pendingOptions
    pendingOptions = null
    const optZone = document.createElement("div")
    optZone.className = "story-options"
    for (const opt of opts) {
      const btn = document.createElement("button")
      btn.type = "button"
      btn.className = "story-option"
      btn.textContent = opt
      btn.addEventListener("click", () => {
        if (!$input || turnActive) return
        $input.value = opt
        $input.style.height = "auto"
        void sendMessage()
      })
      optZone.appendChild(btn)
    }
    currentTurnEls.streamEl.parentElement.appendChild(optZone)
    maybeScrollDown()
  }
  pendingOptions = null
  turnActive = false
}

// ════════════════════════════════════════════════════════════════
// 事件处理器（注册给协议层）
// ════════════════════════════════════════════════════════════════

async function handleEvent(event: RemotePlayBridgeEventName, payload: RemotePlayBridgeEventPayload): Promise<void> {
  if (!turnActive || !turnState) return  // 回合未开始忽略（兜底）
  if (event === "turn-delta") {
    if (!("kind" in payload) || !("delta" in payload)) return
    if (payload.kind === "reasoning") {
      turnState.streamingReasoning += payload.delta || ""
    } else {
      turnState.streamingText += payload.delta || ""
      renderStreaming()
    }
    return
  }
  if (event === "turn-tool") {
    upsertToolNode(turnState.timeline, payload)
    renderProcessNodes()
    maybeScrollDown()
    return
  }
  if (event === "turn-round-end") {
    finalizeRound(payload)
    return
  }
  if (event === "turn-stats") {
    // turn-stats 在 turn-completed 之前到达（host 收尾阶段先 emit stats 再 emit 信号）。
    // 缓存到 turnState，finalizeTurn 时渲染到正文末尾。
    if (!turnState) return
    if (!("stats" in payload)) return
    turnState.stats = payload.stats
    return
  }
  if (event === "turn-completed") {
    // turn-completed 是纯信号(无 payload)：finalizeTurn + reloadHistory 取最新 turn 号 + 历史.
    finalizeTurn()
    await reloadHistory()
    setSending(false)
    setStatus("就绪", "ready")
    return
  }
}

// ── ask_user 交互请求渲染 ──
// AI 向玩家提问，给出选项（玩家也可自定义回答）。
// 前端决定怎么渲染——平台只传结构化数据，表现层自由呈现。
function handleInteractionRequest(
  requestId: string,
  question: string,
  options?: string[],
  allowCustom?: boolean,
): void {
  if (!$story) return
  clearEmptyState()
  let inner = $story.querySelector(".story-inner") as HTMLDivElement | null
  if (!inner) {
    inner = document.createElement("div"); inner.className = "story-inner"
    $story.appendChild(inner)
  }

  const panel = document.createElement("div")
  panel.className = "ask-panel"
  panel.dataset.requestId = requestId

  const q = document.createElement("div")
  q.className = "ask-question prose"
  q.innerHTML = renderMarkdown(question)
  panel.appendChild(q)

  // 选项按钮
  if (options && options.length > 0) {
    const optList = document.createElement("div")
    optList.className = "ask-options"
    for (const opt of options) {
      const btn = document.createElement("button")
      btn.type = "button"
      btn.className = "ask-option"
      btn.textContent = opt
      btn.addEventListener("click", () => {
        void bridge.respondInteraction(requestId, opt)
        removeAskPanel(panel)
      })
      optList.appendChild(btn)
    }
    panel.appendChild(optList)
  }

  // 自定义输入（allowCustom 默认 true：无 options 或显式允许时显示）
  const showCustom = allowCustom !== false
  if (showCustom) {
    const inputRow = document.createElement("div")
    inputRow.className = "ask-custom-row"
    const input = document.createElement("input")
    input.type = "text"
    input.className = "ask-custom-input"
    input.placeholder = "输入你的回答…（Enter 确认）"
    const submit = document.createElement("button")
    submit.type = "button"
    submit.className = "ask-custom-submit"
    submit.textContent = "确认"
    const doSubmit = () => {
      const val = input.value.trim()
      if (!val) return
      void bridge.respondInteraction(requestId, val)
      removeAskPanel(panel)
    }
    submit.addEventListener("click", doSubmit)
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); doSubmit() }
    })
    inputRow.appendChild(input)
    inputRow.appendChild(submit)
    panel.appendChild(inputRow)
  }

  inner.appendChild(panel)
  scrollDown()
  // 聚焦自定义输入或第一个选项
  const firstFocusable = panel.querySelector<HTMLElement>("input, button.ask-option")
  firstFocusable?.focus()
}

function removeAskPanel(panel: HTMLElement): void {
  panel.remove()
}


function handleReady(sid: string): void {
  setStatus("就绪", "ready")
  if ($send) $send.disabled = false
  if ($input) { $input.disabled = false; $input.focus() }
  // 回溯导航在 bridge ready 后可用
  setNavCheckpointsEnabled(true)
  // 从 workspace turn 文件单源重建完整对话(正文 + 过程节点).
  reloadHistory().catch(() => { setStatus("历史加载失败", "error") })
}

// ════════════════════════════════════════════════════════════════
// 发送
// ════════════════════════════════════════════════════════════════

function setSending(v: boolean): void {
  // 发送/停止同一位置切换：发送中显示停止按钮，空闲显示发送按钮。
  if ($send) { $send.hidden = v; $send.disabled = v || !bridge.ready }
  if ($stop) $stop.hidden = !v
  if ($input) $input.disabled = v
  // 回合进行中禁用回溯导航，避免回合中途回滚存档
  setNavCheckpointsEnabled(!v)
  if (!v && $input) $input.focus()
}

async function sendMessage(): Promise<void> {
  if (!$input || !$story) return
  const content = $input.value.trim()
  if (!content || !bridge.sessionId || turnActive) return
  $input.value = ""
  $input.style.height = "auto"
  setSending(true)
  setStatus("回合进行中…", "busy")
  // 先把用户消息渲染出来
  clearEmptyState()
  let inner = $story.querySelector(".story-inner") as HTMLDivElement | null
  if (!inner) {
    inner = document.createElement("div"); inner.className = "story-inner"
    $story.appendChild(inner)
  }
  inner.appendChild(renderMessageEl({ role: "user", content }))
  scrollDown()
  // 开始回合 DOM 编排
  beginTurn()
  try {
    await bridge.call("interaction.sendMessage", { content })
    // turn-completed 事件会触发 finalizeTurn + reloadHistory
  } catch (e) {
    finalizeTurn()
    setSending(false)
    const msg = (e && (e as { message?: string }).message) ? (e as { message: string }).message : "发送失败"
    setStatus(msg, "error")
    // 错误时清掉空流式区
    if (currentTurnEls && currentTurnEls.streamEl && turnState && !turnState.content) {
      currentTurnEls.streamEl.remove()
    }
  }
}

// ════════════════════════════════════════════════════════════════
// 输入交互
// ════════════════════════════════════════════════════════════════

function autoGrow(): void {
  if (!$input) return
  $input.style.height = "auto"
  const h = $input.scrollHeight
  $input.style.height = h <= 160 ? h + "px" : "160px"
}

if ($send) $send.addEventListener("click", sendMessage)
if ($stop) $stop.addEventListener("click", () => {
  // 停止生成：本前端无直接 abort 桥方法，占位（后续接线）
  // 当前依赖 turn-completed 自然结束
})
if ($input) {
  $input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage() }
  })
  $input.addEventListener("input", autoGrow)
}

// ════════════════════════════════════════════════════════════════
// 注册协议层回调
// ════════════════════════════════════════════════════════════════

bridge.on({
  onReady: handleReady,
  onEvent: handleEvent,
  onInteractionRequest: handleInteractionRequest,
  onTurnOptions: (_turn, options) => {
    // turn-options 先于 turn-completed 到达:缓存选项,finalizeTurn 时渲染按钮.
    pendingOptions = options.length > 0 ? options : null
  },
})
