// apps/play-frontend-dev/src/main.ts
// Tsian AIRP 游戏前端 — 表现层（开发版）
//
// 从 default-frontend-files.ts app.js 表现层（L371-760）移植为 TS。
// 协议层由 @tsian/play-bridge 提供，本文件只做消息渲染 / 流式 / 过程节点 / 输入。
// 只通过 bridge.call() 和 bridge.on() 与平台交互。
//
// 烛火书卷（Lamplight Codex）风格 —— 见 style.css。

import { marked } from "marked"
import { createBridge } from "@tsian/play-bridge"
import type {
  RemotePlayBridgeEventName,
  RemotePlayBridgeEventPayload,
  RuntimeSnapshotShell,
  ConversationMessageRecord,
  TurnToolOutput,
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

// ════════════════════════════════════════════════════════════════
// 回合状态机（移植自 useAssistantTimeline，原生 JS 版）
// timeline: 过程节点（thought/tool/interim），按发生顺序，带 agentId。
// turnProcessLog: 会话级累积数组，存所有已完成 turn 的过程节点（不持久化，刷新即丢）。
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
const turnProcessLog: { turn: number; nodes: ProcessNode[] }[] = []

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

// 渲染历史消息（from snapshot）
// 过程历史区在前（turnProcessLog 累积的过程节点），正文区在后（snapshot messages）。
// 不再 $story.innerHTML="" 全清——过程区跨 turn 保留（方案 A：仅内存，不持久化）。
function renderMessages(messages: ConversationMessageRecord[]): void {
  if (!$story) return
  clearEmptyState()
  $story.innerHTML = ""
  const inner = document.createElement("div")
  inner.className = "story-inner"
  // 过程历史区：渲染所有已完成 turn 的过程节点
  if (turnProcessLog.length > 0) {
    const historyZone = document.createElement("div")
    historyZone.className = "process-history-zone"
    for (const entry of turnProcessLog) {
      for (const node of entry.nodes) historyZone.appendChild(createProcessNode(node))
    }
    inner.appendChild(historyZone)
  }
  // 正文区：snapshot messages（user/assistant 剧情正文）
  if (!messages || messages.length === 0) {
    const empty = document.createElement("div")
    empty.className = "empty-state"
    empty.innerHTML = '<p class="empty-title">故事尚未开始</p><p class="empty-hint">在下方输入你的行动，开启冒险。</p>'
    inner.appendChild(empty)
  } else {
    for (const m of messages) inner.appendChild(renderMessageEl(m))
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
// 过程节点渲染
// ════════════════════════════════════════════════════════════════

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
function createProcessNode(node: ProcessNode): HTMLDivElement {
  const div = document.createElement("div")
  div.className = "process-node " + node.type + (node.collapsed ? " collapsed" : " expanded")
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
  // 折叠触发器（thought/tool 可折叠；interim 始终展开）
  if (node.type === "thought" || node.type === "tool") {
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

  // 折叠交互
  if (node.type === "thought" || node.type === "tool") {
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
  maybeScrollDown()
}

// 渲染当前 timeline 的过程节点到过程区
function renderProcessNodes(): void {
  if (!currentTurnEls || !turnState) return
  const zone = currentTurnEls.processZone
  zone.innerHTML = ""
  for (const node of turnState.timeline) zone.appendChild(createProcessNode(node))
}

// 流式正文更新
function renderStreaming(): void {
  if (!currentTurnEls || !turnState) return
  currentTurnEls.streamBody.innerHTML = renderMarkdown(turnState.streamingText)
  maybeScrollDown()
}

// finalizeRound：镜像 useAssistantTimeline.onRoundEnd
function finalizeRound(payload: RemotePlayBridgeEventPayload): void {
  if (!turnState) return
  if (!("kind" in payload) || !("round" in payload)) return
  const round = payload.round
  const kind = payload.kind as "thought" | "final"
  const reasoning = turnState.streamingReasoning
  if (kind === "thought") {
    // tool_calls 轮：过渡文本→interim，思维链→thought
    const interimText = turnState.streamingText
    if (interimText.trim()) {
      turnState.timeline.push({ type: "interim", id: "interim-r" + round, round, text: interimText, collapsed: false, agentId: payload.agentId || null })
    }
    if (reasoning.trim()) {
      turnState.timeline.push({ type: "thought", id: "thought-r" + round, round, text: reasoning, collapsed: true, agentId: payload.agentId || null })
    }
  } else {
    // 最终轮（stop）：思维链→thought，streamingText→content
    if (reasoning.trim()) {
      turnState.timeline.push({ type: "thought", id: "thought-r" + round, round, text: reasoning, collapsed: true, agentId: payload.agentId || null })
    }
    turnState.content = turnState.streamingText
  }
  turnState.streamingReasoning = ""
  turnState.streamingText = ""
  renderProcessNodes()
}

// finalizeTurn：回合结束，折叠过程节点并推入会话级 turnProcessLog（内存累积，跨 turn 保留）。
// 不持久化——刷新/重载存档后 turnProcessLog 清空，只剩 snapshot 正文（方案 A）。
function finalizeTurn(): void {
  if (turnState && turnState.timeline.length > 0) {
    for (const node of turnState.timeline) {
      if (node.type === "thought" || node.type === "tool") node.collapsed = true
    }
    turnProcessLog.push({ turn: Number($turnNum?.textContent) || 0, nodes: turnState.timeline })
  }
  turnActive = false
}

// ════════════════════════════════════════════════════════════════
// 事件处理器（注册给协议层）
// ════════════════════════════════════════════════════════════════

function handleEvent(event: RemotePlayBridgeEventName, payload: RemotePlayBridgeEventPayload): void {
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
  // turn-completed 由 onSnapshot 处理（覆盖渲染）
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

// §4 红线：turn-completed.snapshot 到达时用 snapshot 覆盖渲染
function handleSnapshot(snapshot: RuntimeSnapshotShell): void {
  // 先 finalizeTurn：把当前 turn 的过程节点推入 turnProcessLog，
  // 再 renderMessages：渲染过程历史区（含刚推入的本 turn）+ 正文区。
  finalizeTurn()
  if (snapshot && snapshot.state) {
    setTurn(snapshot.state.turn)
    renderMessages(snapshot.state.messages || [])
  }
  setSending(false)
  setStatus("就绪", "ready")
}

function handleReady(sid: string): void {
  setStatus("就绪", "ready")
  if ($send) $send.disabled = false
  if ($input) { $input.disabled = false; $input.focus() }
  // 初始拉取 snapshot
  bridge.call<RuntimeSnapshotShell>("runtime.getRuntimeSnapshot").then((snap) => {
    if (snap && snap.state) {
      setTurn(snap.state.turn)
      renderMessages(snap.state.messages || [])
    }
  }).catch(() => { setStatus("快照加载失败", "error") })
}

// ════════════════════════════════════════════════════════════════
// 发送
// ════════════════════════════════════════════════════════════════

function setSending(v: boolean): void {
  if ($send) $send.disabled = v || !bridge.ready
  if ($input) $input.disabled = v
  if ($stop) $stop.hidden = !v
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
    // turn-completed 事件会触发 handleSnapshot 覆盖渲染
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
  onSnapshot: handleSnapshot,
  onInteractionRequest: handleInteractionRequest,
})
