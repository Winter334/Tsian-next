import type {
  ConversationMessageRecord,
  MessageInteractionRequest,
  MessageInteractionResult,
  PlatformActionError,
  PlatformActionRequest,
  PlatformActionResult,
  PlatformContextShell,
  PlayFrontendBridge,
  RuntimeSnapshotShell,
} from "@tsian/contracts"
import type { LocalGameCardRecord } from "../storage/db"
import type {
  InspectDomAction,
  InspectFrontendActionSnapshot,
  InspectFrontendInput,
  InspectFrontendResult,
  InspectFrontendTimelineEntry,
} from "../agent-runtime/workspace-tools"
import { runAgentRuntimeTurn } from "../agent-runtime"
import { resolveTokenBudget } from "../agent-runtime/context-lifecycle"
import { createRuntimeTraceCollector } from "../agent-runtime/trace"
import { mountRemoteIframeFrontend, REMOTE_PLAY_BRIDGE_CHANNEL } from "../bridge/remote-iframe-bridge"
import { resolvePackagedFrontendUrl } from "../package-loader/packaged-frontend"
import {
  generateAssistantReply,
  generateAssistantReplyNative,
  streamAssistantReplyNative,
  type RuntimeChatMessage,
} from "../runtime-host/ai"
import { getBrowserAiConfig } from "../config/ai"
import {
  emitTurnDelta,
  emitTurnRoundEnd,
  emitTurnTool,
  subscribeTurnDelta,
  subscribeTurnRoundEnd,
  subscribeTurnTool,
} from "../streaming-events"
import {
  buildAgentProviderPresetMap,
  getPlatformActiveGameCard,
  resolveAgentModelConfig,
} from "./internal"
import { getBaseBridge } from "./host-state"
import { readAgentContextFromWorkspace } from "./history-turns"
import { createBrowserSkillScriptRunner } from "./browser-skill-script-executor"
import {
  createEmptyRuntimeSnapshot,
  createLocalSaveFromGameCard,
  deleteLocalSave,
  getHistoryForSave,
  getSnapshotForSave,
} from "../storage/saves"
import { listLocalGameCardFrontendFiles } from "../storage/game-cards"
import {
  createRuntimeWorkspaceTransaction,
  listEffectiveWorkspaceFilesForSave,
} from "../storage/workspace"

// ── 单会话串行 ──
// 后一次 inspect 自动 dispose 前一次的隐藏 iframe + 容器,同一时刻只保留一个
// 自检会话,避免资源泄漏。design §2.1 / §13 风险点。
let currentSession: { dispose: () => void } | null = null

let hiddenContainer: HTMLDivElement | null = null
function ensureHiddenContainer(): HTMLDivElement {
  if (hiddenContainer && hiddenContainer.isConnected) {
    return hiddenContainer
  }
  const container = document.createElement("div")
  container.setAttribute("aria-hidden", "true")
  container.style.cssText =
    "position:fixed;width:1024px;height:768px;opacity:0;pointer-events:none;left:-9999px;top:0;z-index:-1"
  document.body.appendChild(container)
  hiddenContainer = container
  return container
}

function disposeCurrentSession(): void {
  if (currentSession) {
    currentSession.dispose()
    currentSession = null
  }
  // 重置 ephemeral 状态:bridge 闭包引用模块级 ephemeralSnapshot,上一次 send
  // 回合会把结果存进去.若不重置,下一次 inspect 新加载的前端调
  // getRuntimeSnapshot() 会拿到上次回合的消息,导致跨调用状态残留(测试发现:
  // send 的消息出现在后续 actions 测试的初始 DOM 里).
  // lastInspectSnapshot(diff 基准)不动——那是故意跨调用保留的(design §9).
  ephemeralSnapshot = createEmptyRuntimeSnapshot()
  ephemeralSaveId = undefined
}

// ── ephemeral save / snapshot 状态 ──
// 专用 bridge 在 drive 前返回空 snapshot,drive 后返回 ephemeral snapshotAfter.
let ephemeralSnapshot: RuntimeSnapshotShell = createEmptyRuntimeSnapshot()
let ephemeralSaveId: string | undefined

// ── session 状态(holder)──
// bridge 通过闭包捕获它,sendMessage 调 runEphemeralTurn 编排 ephemeral 回合.
// runInspectFrontend 在 mount 后若 input.send 则主动驱动 bridge.interaction.sendMessage
// (自检是父窗口驱动,隐藏前端只被动接收流式转发,不发 sendMessage 请求).
interface InspectSessionState {
  card: LocalGameCardRecord
  cardId: string
  timeline: InspectFrontendTimelineEntry[]
  controller: AbortController | null
  /** mount 握手时透出的会话 id,自检发 turn-completed 事件时用它匹配. */
  sessionId: string | null
}

// ── 专用 bridge ──
// 不给隐藏 iframe 用 playFrontendBridge(它 ensureActiveSave + 广播流式到玩家前端 +
// 用模块级 previousTurnController abort 玩家回合).自检 bridge 自己实现接口,
// sendMessage 编排 ephemeral 回合. design §4.
function createInspectionBridge(state: InspectSessionState): PlayFrontendBridge {
  return {
    runtime: {
      async getRuntimeSnapshot() {
        return ephemeralSnapshot
      },
    },
    interaction: {
      async sendMessage(input: MessageInteractionRequest): Promise<MessageInteractionResult> {
        return runEphemeralTurn(input.content, state)
      },
    },
    // 复用 base bridge 的 query(只读,无副作用).design §4.
    query: getBaseBridge().query,
    platform: {
      async getPlatformContext(): Promise<PlatformContextShell> {
        return {
          version: "0.0.0",
          activeFrontendId: state.cardId,
          activeSaveId: ephemeralSaveId,
        }
      },
      async runAction(_request: PlatformActionRequest): Promise<PlatformActionResult> {
        return {
          ok: false,
          error: {
            code: "INSPECT_ACTION_UNAVAILABLE",
            message: "自检会话不执行 platform action。",
          },
        }
      },
    },
    // 不接 debug bridge(自检不需要 ai-debug)
  }
}

function emptyStructure(): InspectFrontendResult["structure"] {
  return {
    domSummary: "",
    computedStyles: [],
    renderedText: "",
    bridgeState: "loading",
  }
}

function emptyDiagnostics(): InspectFrontendResult["diagnostics"] {
  return {
    errors: [],
    console: [],
    resourceFailures: [],
    bridgeHandshake: "pending",
  }
}

/**
 * 助手前端自检工具的 capability 实现。镜像 browser-skill-script-executor 的
 * 工厂模式:返回一个 (input) => Promise<result> 的执行器。
 *
 * 加载复用 resolvePackagedFrontendUrl + mountRemoteIframeFrontend(1:1 镜像
 * PlayView 的 packaged 挂载),采集走父窗口侧观察(same-origin 可读 contentDocument)。
 * 不接受 cardId,内部从 getPlatformActiveGameCard() 取当前卡。design.md 全文。
 */
export function createFrontendInspector(): (
  input: InspectFrontendInput,
) => Promise<InspectFrontendResult> {
  return runInspectFrontend
}

async function runInspectFrontend(
  input: InspectFrontendInput,
): Promise<InspectFrontendResult> {
  // 延后项参数校验(接口预留,初版不实现,传了报 not-supported).design §2.3 / H2.
  if (input.runtime === "mock") {
    return notSupported("INSPECT_FRONTEND_MOCK_UNSUPPORTED", "自检初版不支持 mock runtime,只支持 real。")
  }
  if (input.screenshot) {
    return notSupported("INSPECT_FRONTEND_SCREENSHOT_UNSUPPORTED", "自检初版不支持 screenshot,由玩家手动截图代替。")
  }

  try {
    // 1. 取 active 卡 + frontend binding. design §3.
    const card = await getPlatformActiveGameCard()
    if (!card) {
      return failed("INSPECT_FRONTEND_NO_ACTIVE_CARD", "当前没有 active 游戏卡,无法自检前端。")
    }
    const frontend = card.manifest.frontend
    if (!frontend || frontend.kind !== "packaged") {
      return failed(
        "INSPECT_FRONTEND_NOT_PACKAGED",
        "自检只支持 packaged 前端(当前卡无前端或为 remote)。",
        { cardId: card.manifest.id, frontendKind: frontend?.kind ?? "none" },
      )
    }

    // 2. 单会话串行:dispose 前一次. design §2.1 / §13.
    disposeCurrentSession()

    // 3. resolve SW 虚拟 URL. design §3.
    const url = await resolvePackagedFrontendUrl({
      gameCardId: card.id,
      entry: frontend.entry,
    })

    // 4. session 状态 + 专用 bridge + 隐藏容器 mount. design §3 / §4.
    const container = ensureHiddenContainer()
    const sessionState: InspectSessionState = {
      card,
      cardId: card.id,
      timeline: [],
      controller: null,
      sessionId: null,
    }
    const bridge = createInspectionBridge(sessionState)
    let bridgeReady = false
    // 采集器:挂在 session 上,onBridgeReady/onLoad 后注入诊断层.
    // design §6:采集走父窗口侧观察(same-origin 可读 contentWindow/contentDocument).
    const collector = createDiagnosticsCollector()

    let mountedIframe: HTMLIFrameElement | null = null
    const dispose = mountRemoteIframeFrontend(container, {
      url,
      bridge,
      sandbox: "allow-scripts allow-same-origin allow-forms",
      title: "Tsian frontend inspection",
      onLoad: () => {
        // onLoad 时 iframe 脚本可能已跑完,但 contentDocument 已可读.
        // 注入诊断层捕获"运行时后续错误 + 控制台后续输出",并采资源 404.
        // 早期错误靠 DOM 空态 + 资源 404 推断(design §6.2 折中).
        const iframe = container.querySelector("iframe")
        if (iframe) {
          mountedIframe = iframe
          injectDiagnosticsCollector(iframe, collector)
        }
      },
      onBridgeReady: () => {
        bridgeReady = true
        // 前端活着且桥通了——可靠信号.确保诊断层已注入(可能 onLoad 先触发).
        if (mountedIframe) {
          injectDiagnosticsCollector(mountedIframe, collector)
        }
      },
      onSessionId: (sid) => {
        sessionState.sessionId = sid
      },
    })
    currentSession = { dispose }

    // 5. 等观测点.坏前端不发 ready 则超时兜底,仍采结构层(design §6.1).
    await waitForBridgeReadyOrTimeout(() => bridgeReady, 5000)

    // 6. 若 send,驱动 ephemeral 回合(父窗口主动调 bridge.interaction.sendMessage).
    // 自检是父窗口驱动:隐藏前端只被动接收 mount 转发的流式事件,不发请求.
    // design §5:runEphemeralTurn 编排 ephemeral save 回合,emit 到总线让 mount
    // 转发给 iframe,同时自检订阅总线采集时间线.
    let timeline: InspectFrontendTimelineEntry[] | undefined
    let sendCompleted = false
    if (input.send && input.wait === "turn-completed") {
      // send 必须等握手真正完成(bridgeReady=true).mount 的流式事件转发
      // (subscribeTurnDelta 等)依赖 acceptedOrigin,它在 hello 握手后才设置.
      // 若超时后硬跑,回合的 delta 事件全被 postEvent 的 acceptedOrigin=null 守卫
      // 吞掉,前端一个 delta 都收不到 → 不创建消息气泡 → domSummary 保持空状态
      // (测试发现:send 后 domSummary 仍是初始空占位).握手没完成就 send 等于白跑.
      if (!bridgeReady) {
        return failed(
          "INSPECT_FRONTEND_BRIDGE_NOT_READY",
          "send 驱动回合需要前端桥握手完成(bridgeReady),但超时内未就绪.无法把流式事件转发给前端,回合不会渲染.请稍后重试或检查前端是否能正常握手.",
        )
      }
      const unsub = subscribeTimeline(sessionState)
      try {
        await bridge.interaction.sendMessage({ content: input.send.message })
      } finally {
        unsub()
      }
      timeline = sessionState.timeline.slice()
      sendCompleted = true
      // 自检绕过了 mount 的 request 处理路径(直接调 bridge.interaction.sendMessage,
      // 没让前端发 sendMessage request),所以 mount 不会 postEvent("turn-completed")
      // ——turn-completed 转发绑在"处理前端 request"的响应路径上.前端收不到
      // turn-completed 就不会调 renderMessages,DOM 保持初始空状态(domSummary 缺
      // 消息气泡的根因).这里自检直接给 iframe postMessage 一个 turn-completed 事件,
      // 带上 mount 握手时透出的 sessionId(与 mount 发的事件格式一致),让前端走自己的
      // 渲染流程(onEvent → renderMessages).
      const iframe = mountedIframe ?? container.querySelector("iframe")
      iframe?.contentWindow?.postMessage(
        {
          channel: REMOTE_PLAY_BRIDGE_CHANNEL,
          kind: "event",
          sessionId: sessionState.sessionId,
          event: "turn-completed",
          payload: { snapshot: ephemeralSnapshot },
        },
        "*",
      )
      // 前端收到 turn-completed 后 renderMessages(同步 DOM 操作),给一帧渲染时间
      // 再采结构层,domSummary 才能抓到消息气泡.
      await microTick()
    } else if (input.send) {
      // wait=bridge-ready(默认)但传了 send:仍驱动回合,但只返回 timeline 不等完成
      // 不符合预期——send 必须 wait=turn-completed 才有意义.返参数错误.
      return failed(
        "INSPECT_FRONTEND_SEND_WAIT_MISMATCH",
        "inspect_frontend 传 send 时 wait 必须为 turn-completed(要等回合跑完才能采时间线)。",
        { wait: input.wait },
      )
    }

    // 7. DOM 交互(actions)+ observeBetween. design §7.
    // same-origin 下 contentDocument.querySelector + dispatchEvent 模拟玩家操作.
    let actionSnapshots: InspectFrontendActionSnapshot[] | undefined
    const iframe = mountedIframe ?? container.querySelector("iframe")
    if (input.actions && input.actions.length > 0 && iframe) {
      const doc = iframe.contentDocument
      if (doc) {
        actionSnapshots = []
        for (let step = 0; step < input.actions.length; step += 1) {
          const action = input.actions[step]!
          applyAction(doc, action)
          if (input.observeBetween) {
            // 每个动作后 await 微 tick 让渲染更新,再采结构层快照. design §7 observeBetween.
            await microTick()
            const snap = collectStructure(doc, bridgeReady)
            actionSnapshots.push({
              step,
              action,
              after: { domSummary: snap.domSummary, bridgeState: snap.bridgeState },
            })
          }
        }
      }
    }

    // 8. refresh:操作后拉最新 snapshot(语义化包装 runtime.getRuntimeSnapshot).
    // design §7 refresh:助手不用知道桥方法名.
    let refreshedSnapshot: RuntimeSnapshotShell | undefined
    if (input.refresh) {
      try {
        refreshedSnapshot = await bridge.runtime.getRuntimeSnapshot()
      } catch {
        // 拉不到不致命,继续返回已有结构层
      }
    }

    // 9. 采集结构层 + 汇总诊断层.
    const structure = iframe
      ? collectStructure(iframe.contentDocument, bridgeReady)
      : emptyStructure()
    // send 或 refresh 后用 snapshot(回合权威结果)覆盖 renderedText.
    // 不依赖 iframe DOM 渲染时序——前端收到 turn-completed 后异步渲染,
    // 50ms microTick 不够稳定(测试发现:时好时坏).snapshot 是回合刚算出的
    // 权威状态,renderedText 从它取保证 send 后一定能看到回合消息.
    // send 后读 ephemeralSnapshot(runEphemeralTurn 已存 snapshotAfter);
    // refresh 后读 refreshedSnapshot(刚拉的).
    const snapshotForRender = sendCompleted ? ephemeralSnapshot : refreshedSnapshot
    if (snapshotForRender && structure) {
      const msgs = snapshotForRender.state.messages
      if (msgs && msgs.length > 0) {
        const lastMsgs = msgs.slice(-3).map((m) => `${m.role}: ${typeof m.content === "string" ? m.content : ""}`).join("\n")
        structure.renderedText = lastMsgs
      }
    }
    const diagnostics = collector.toDiagnostics(bridgeReady)

    // 10. 文件-行号映射(Phase F).design §8:只在有 errors 时算.stack 的 source
    // 是 SW 虚拟路径(含文件名),行号直接用(join 后=源行,因 default-frontend-files
    // 数组每元素一行).映射"文件名 → 源文件 path".
    let fileLineMap: InspectFrontendResult["fileLineMap"] | undefined
    if (diagnostics.errors.length > 0) {
      fileLineMap = await buildFileLineMap(card.id, diagnostics.errors)
    }

    // 11. 复查 diff(Phase G).design §9:模块级保留上次 inspect 的 structure +
    // diagnostics.errors,本次做 diff.单会话串行保证"上次"是同一隐藏会话的前一次.
    const diff = computeDiff(lastInspectSnapshot, { structure, errors: diagnostics.errors })
    lastInspectSnapshot = { structure, errors: diagnostics.errors }

    // 12. 大结果截断 + truncated 标志(Phase H1).design §11:大结果截断标 truncated.
    const MAX_TIMELINE = 200
    const MAX_ACTION_SNAPSHOTS = 50
    let truncated = false
    let truncatedTimeline = timeline
    let truncatedActionSnapshots = actionSnapshots
    if (timeline && timeline.length > MAX_TIMELINE) {
      truncatedTimeline = timeline.slice(0, MAX_TIMELINE)
      truncated = true
    }
    if (actionSnapshots && actionSnapshots.length > MAX_ACTION_SNAPSHOTS) {
      truncatedActionSnapshots = actionSnapshots.slice(0, MAX_ACTION_SNAPSHOTS)
      truncated = true
    }
    // domSummary 超长截断(collectStructure 已限 MAX_DOM_SUMMARY,这里二次保险)
    if (structure.domSummary.length >= MAX_DOM_SUMMARY) {
      structure.domSummary = structure.domSummary.slice(0, MAX_DOM_SUMMARY) + "\n…(truncated)"
      truncated = true
    }

    return {
      ok: true,
      cardId: card.id,
      entry: frontend.entry,
      structure,
      diagnostics,
      ...(truncatedTimeline ? { timeline: truncatedTimeline } : {}),
      ...(truncatedActionSnapshots ? { actionSnapshots: truncatedActionSnapshots } : {}),
      ...(fileLineMap ? { fileLineMap } : {}),
      ...(diff ? { diff } : {}),
      ...(truncated ? { truncated: true } : {}),
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return failed("INSPECT_FRONTEND_FAILED", `自检加载失败:${message}`)
  }
}

// ── 文件-行号映射(Phase F)──
// design §8:stack source(SW 虚拟路径)提取文件名,映射到源 frontend 文件 path.
// 行号直接用(default-frontend-files 数组每元素一行,join 后行号=源行).
async function buildFileLineMap(
  cardId: string,
  errors: InspectFrontendResult["diagnostics"]["errors"],
): Promise<InspectFrontendResult["fileLineMap"] | undefined> {
  const files = await listLocalGameCardFrontendFiles(cardId)
  // 文件名 → 源 path 映射(末段去重,后写的覆盖)
  const nameToSource = new Map<string, string>()
  for (const f of files) {
    const name = f.path.split("/").pop() ?? f.path
    nameToSource.set(name, f.path)
  }
  const map: Record<string, { source: string; line: number }[]> = {}
  for (const err of errors) {
    if (!err.source) continue
    // SW 虚拟路径形如 /__tsian_game_card_frontends/<cardId>/frontend/app.js
    const fileName = err.source.split("/").pop()
    if (!fileName) continue
    const source = nameToSource.get(fileName)
    if (!source || typeof err.line !== "number") continue
    if (!map[fileName]) map[fileName] = []
    map[fileName].push({ source, line: err.line })
  }
  return Object.keys(map).length > 0 ? map : undefined
}

// ── 复查 diff(Phase G)──
// design §9:模块级保留上次 inspect 的 structure + errors,本次做 diff.
interface InspectSnapshot {
  structure: InspectFrontendResult["structure"]
  errors: InspectFrontendResult["diagnostics"]["errors"]
}
let lastInspectSnapshot: InspectSnapshot | null = null

function computeDiff(
  prev: InspectSnapshot | null,
  curr: InspectSnapshot,
): InspectFrontendResult["diff"] | undefined {
  if (!prev) return undefined
  const added: string[] = []
  const removed: string[] = []
  const changed: { path: string; from: string; to: string }[] = []

  // errors:新增/消失
  const prevErrs = new Set(prev.errors.map((e) => e.message))
  const currErrs = new Set(curr.errors.map((e) => e.message))
  for (const msg of currErrs) if (!prevErrs.has(msg)) added.push(`error: ${msg}`)
  for (const msg of prevErrs) if (!currErrs.has(msg)) removed.push(`error: ${msg}`)

  // renderedText 变化
  if (prev.structure.renderedText !== curr.structure.renderedText) {
    changed.push({
      path: "renderedText",
      from: prev.structure.renderedText.slice(0, 200),
      to: curr.structure.renderedText.slice(0, 200),
    })
  }

  // domSummary 文本 diff(新增/移除的行)
  const prevLines = new Set(prev.structure.domSummary.split("\n"))
  const currLines = new Set(curr.structure.domSummary.split("\n"))
  for (const line of currLines) if (!prevLines.has(line) && line.trim()) added.push(`dom: ${line.slice(0, 120)}`)
  for (const line of prevLines) if (!currLines.has(line) && line.trim()) removed.push(`dom: ${line.slice(0, 120)}`)

  if (added.length === 0 && removed.length === 0 && changed.length === 0) return undefined
  return { added, removed, changed }
}

// ── DOM 交互 ──
// design §7:same-origin contentDocument.querySelector + dispatchEvent 模拟玩家操作.
function applyAction(doc: Document, action: InspectDomAction): void {
  const el = doc.querySelector(action.selector)
  if (!el) {
    throw {
      code: "INSPECT_SELECTOR_NOT_FOUND",
      message: `选择器无匹配:${action.selector}`,
    } satisfies PlatformActionError
  }
  switch (action.type) {
    case "click":
      el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))
      break
    case "type": {
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
        el.value = action.text ?? ""
      }
      el.dispatchEvent(new Event("input", { bubbles: true }))
      el.dispatchEvent(new Event("change", { bubbles: true }))
      break
    }
    case "press": {
      const key = action.key ?? "Enter"
      el.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }))
      el.dispatchEvent(new KeyboardEvent("keyup", { key, bubbles: true }))
      break
    }
    case "scroll": {
      const target = el
      target.scrollTop = action.to === "bottom" ? target.scrollHeight : 0
      target.dispatchEvent(new Event("scroll", { bubbles: true }))
      break
    }
  }
}

function microTick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 50))
}

// 订阅 streaming-events 总线采集时间线(turn-delta/round-end/tool).
// mount 函数已订阅同一总线转发给 iframe,这里并存订阅互不干扰(Set 订阅).
// design §4 末段 + §12.
function subscribeTimeline(state: InspectSessionState): () => void {
  const unsubDelta = subscribeTurnDelta((agentId, delta, turn, round, kind) => {
    state.timeline.push({
      t: Date.now(),
      event: "turn-delta",
      payload: { agentId, delta, turn, round, kind },
    })
  })
  const unsubRoundEnd = subscribeTurnRoundEnd((agentId, turn, round, kind) => {
    state.timeline.push({
      t: Date.now(),
      event: "turn-round-end",
      payload: { agentId, turn, round, kind },
    })
  })
  const unsubTool = subscribeTurnTool((agentId, turn, round, callId, name, status, output) => {
    state.timeline.push({
      t: Date.now(),
      event: "turn-tool",
      payload: { agentId, turn, round, callId, name, status, ...(output !== undefined ? { output } : {}) },
    })
  })
  return () => {
    unsubDelta()
    unsubRoundEnd()
    unsubTool()
  }
}

// ── ephemeral save 回合编排(send,本任务最复杂段)──
// 1:1 镜像 platform-host/index.ts:692-828 的 sendMessage 数据组装,但:
//   - save 用 createLocalSaveFromGameCard(不设 active、不 emit savesChanged)
//   - workspace files 用 listEffectiveWorkspaceFilesForSave(save.id, card)
//   - abort 用自己的 controller(不复用模块级 previousTurnController,不干扰玩家回合)
//   - 不调 commitSuccessfulRuntimeTurnForSave(staged 写随 save 删除丢弃)
//   - 跑完即 deleteLocalSave(不碰 active 指针、不刷新列表 UI)
// design §5 + "能力组装 checklist"(implement.md).
async function runEphemeralTurn(
  content: string,
  state: InspectSessionState,
): Promise<MessageInteractionResult> {
  const card = state.card
  // 1. 建 ephemeral save(不设 active、不 emit savesChanged).design §5 步骤1.
  const save = await createLocalSaveFromGameCard(card)
  ephemeralSaveId = save.id
  try {
    // 2. 组装数据(镜像 index.ts:694-731).
    const snapshotBefore = cloneSnapshot(await getSnapshotForSave(save.id))
    const historyBefore = await getHistoryForSave(save.id)
    const nextTurn = snapshotBefore.state.turn + 1
    const trace = createRuntimeTraceCollector(nextTurn)

    // 3. 自己的 abort controller(不复用模块级 previousTurnController).
    const controller = new AbortController()
    state.controller = controller

    const workspaceTransaction = createRuntimeWorkspaceTransaction(
      await listEffectiveWorkspaceFilesForSave(save.id, card),
    )
    const activeWorkspaceTransaction = workspaceTransaction
    const providerPresetMap = buildAgentProviderPresetMap(
      activeWorkspaceTransaction.workspaceFiles,
    )
    const agentContext = readAgentContextFromWorkspace(
      activeWorkspaceTransaction.workspaceFiles,
      save.id,
    )
    const masterConfig = resolveAgentModelConfig("master", providerPresetMap)
    const contextTokenBudget = resolveTokenBudget(
      masterConfig?.parameters.contextWindow ?? null,
    )

    // 4. 跑回合(capabilities 照 index.ts:751-827 接全).
    const result = await runAgentRuntimeTurn(
      {
        agentId: "master",
        userInput: content,
        recentHistory: historyBefore,
        snapshot: snapshotBefore,
        workspaceFiles: workspaceTransaction.workspaceFiles,
        signal: controller.signal,
        agentContext: agentContext ?? undefined,
        contextTokenBudget,
        compressionMode: "narrative",
        // emit 到总线让 mount 转发给隐藏 iframe(和 index.ts:747-749 一样),
        // subscribeTimeline 已订阅同一总线采集时间线.onDelta 回调是 4 参数(无 turn),
        // emitTurnDelta 是 5 参数,这里把 nextTurn 注入(同 index.ts:747 写法).
        onDelta: (agentId, delta, round, kind) =>
          emitTurnDelta(agentId, delta, nextTurn, round, kind),
        onRoundEnd: (agentId, round, finishReason) =>
          emitTurnRoundEnd(agentId, nextTurn, round, finishReasonToKind(finishReason)),
        onTool: (agentId, round, callId, name, status, output) =>
          emitTurnTool(agentId, nextTurn, round, callId, name, status, output),
      },
      {
        callModel(messages, options) {
          const agentConfig = resolveAgentModelConfig(options.agentId, providerPresetMap)
          return generateAssistantReply(messages, {
            debugLabel: options.debugLabel,
            signal: options.signal,
            ...(agentConfig ? { config: agentConfig } : {}),
          })
        },
        async callModelNative(messages, options, tools) {
          const agentConfig = resolveAgentModelConfig(options.agentId, providerPresetMap)
          const streamingEnabled = agentConfig
            ? agentConfig.streaming
            : getBrowserAiConfig()?.streaming ?? false
          if (!options.onDelta || !streamingEnabled) {
            return generateAssistantReplyNative(messages as RuntimeChatMessage[], {
              debugLabel: options.debugLabel,
              signal: options.signal,
              tools,
              ...(agentConfig ? { config: agentConfig } : {}),
            })
          }
          return streamAssistantReplyNative(messages as RuntimeChatMessage[], {
            debugLabel: options.debugLabel,
            signal: options.signal,
            tools,
            onDelta: options.onDelta
              ? (delta, round, kind) => options.onDelta!(options.agentId ?? "master", delta, round, kind)
              : undefined,
            round: options.round,
            ...(agentConfig ? { config: agentConfig } : {}),
          })
        },
        toolCallMode: resolveAgentModelConfig("master", providerPresetMap)?.toolCallMode
          ?? getBrowserAiConfig()?.toolCallMode
          ?? "text",
        runBrowserScript: createBrowserSkillScriptRunner({
          workspaceTransaction: activeWorkspaceTransaction,
          signal: controller.signal,
          emitTrace: trace.emit,
        }),
        workspaceMutations: {
          write: (writeInput) => {
            if (writeInput.scope === "platform-meta") {
              return activeWorkspaceTransaction.writePlatformFile({
                path: writeInput.path,
                content: writeInput.content,
                ...(writeInput.data ? { data: writeInput.data } : {}),
              })
            }
            if (writeInput.scope !== "save-runtime") {
              throw new Error("Runtime Agent turns can only stage save-runtime workspace writes.")
            }
            return activeWorkspaceTransaction.write({
              path: writeInput.path,
              content: writeInput.content,
              ...(writeInput.data ? { data: writeInput.data } : {}),
            })
          },
          delete: (deleteInput) => {
            if (deleteInput.scope !== "save-runtime") {
              throw new Error("Runtime Agent turns can only stage save-runtime workspace deletes.")
            }
            return {
              scope: deleteInput.scope,
              ...activeWorkspaceTransaction.delete(deleteInput.path),
            }
          },
        },
        emitTrace: trace.emit,
      },
    )

    // 5. 算 snapshotAfter(镜像 index.ts:834-840,但不 commit).
    const nextHistory: ConversationMessageRecord[] = [
      ...historyBefore,
      { role: "user", content },
      { role: "assistant", content: result.replyText },
    ]
    const snapshotAfter = snapshotWithTurnAndMessages(
      snapshotBefore,
      nextTurn,
      nextHistory,
    )
    state.timeline.push({
      t: Date.now(),
      event: "turn-completed",
      payload: { snapshot: snapshotAfter },
    })
    ephemeralSnapshot = snapshotAfter // 让 bridge.getRuntimeSnapshot 返回最新

    return { snapshot: snapshotAfter }
  } finally {
    // 6. 删 ephemeral save(不 commit、不碰 active 指针).design §5 步骤7.
    await deleteLocalSave(save.id)
    ephemeralSaveId = undefined
    state.controller = null
  }
}

function cloneSnapshot(snapshot: RuntimeSnapshotShell): RuntimeSnapshotShell {
  return JSON.parse(JSON.stringify(snapshot)) as RuntimeSnapshotShell
}

function snapshotWithTurnAndMessages(
  snapshot: RuntimeSnapshotShell,
  turn: number,
  messages: ConversationMessageRecord[],
): RuntimeSnapshotShell {
  return {
    ...snapshot,
    state: {
      ...snapshot.state,
      turn,
      messages,
      globals: snapshot.state.globals ?? {},
    },
  }
}

function finishReasonToKind(finishReason: "stop" | "tool_calls"): "thought" | "final" {
  return finishReason === "tool_calls" ? "thought" : "final"
}

function waitForBridgeReadyOrTimeout(
  isReady: () => boolean,
  timeoutMs: number,
): Promise<void> {
  return new Promise((resolve) => {
    const start = Date.now()
    function check() {
      if (isReady() || Date.now() - start >= timeoutMs) {
        resolve()
        return
      }
      setTimeout(check, 100)
    }
    check()
  })
}

function notSupported(code: string, message: string): InspectFrontendResult {
  return {
    ok: false,
    cardId: "",
    entry: "",
    structure: emptyStructure(),
    diagnostics: emptyDiagnostics(),
    error: { code, message },
  }
}

function failed(
  code: string,
  message: string,
  details?: unknown,
): InspectFrontendResult {
  return {
    ok: false,
    cardId: "",
    entry: "",
    structure: emptyStructure(),
    diagnostics: emptyDiagnostics(),
    error: details === undefined ? { code, message } : { code, message, details },
  }
}

// ── 诊断层采集 ──
// design §6.2:在 iframe contentWindow 上劫持 onerror/unhandledrejection/console,
// 采 performance entries + 资源 error.要在脚本运行前注入才能捕获早期错误,但
// mount 函数不暴露 beforeLoad 钩子,故 onLoad 后注入(捕获后续错误 + 后续控制台),
// 早期错误靠 DOM 空态 + 资源 404 推断.

interface DiagnosticsCollector {
  errors: InspectFrontendResult["diagnostics"]["errors"]
  console: InspectFrontendResult["diagnostics"]["console"]
  resourceFailures: InspectFrontendResult["diagnostics"]["resourceFailures"]
  injected: boolean
  toDiagnostics(bridgeReady: boolean): InspectFrontendResult["diagnostics"]
}

function createDiagnosticsCollector(): DiagnosticsCollector {
  return {
    errors: [],
    console: [],
    resourceFailures: [],
    injected: false,
    toDiagnostics(bridgeReady) {
      return {
        errors: this.errors.slice(0, 50),
        console: this.console.slice(0, 100),
        resourceFailures: this.resourceFailures.slice(0, 50),
        bridgeHandshake: bridgeReady ? "ready" : "timeout",
      }
    },
  }
}

const MAX_ERROR_STACK = 2000
const MAX_CONSOLE_ARG = 500

function injectDiagnosticsCollector(
  iframe: HTMLIFrameElement,
  collector: DiagnosticsCollector,
): void {
  if (collector.injected) return
  const win = iframe.contentWindow as (Window & typeof globalThis) | null
  const doc = iframe.contentDocument
  if (!win || !doc) return
  collector.injected = true

  function pushError(message: string, stack?: string, source?: string, line?: number, col?: number) {
    collector.errors.push({
      message,
      ...(stack ? { stack: stack.slice(0, MAX_ERROR_STACK) } : {}),
      ...(source ? { source } : {}),
      ...(typeof line === "number" ? { line } : {}),
      ...(typeof col === "number" ? { col } : {}),
    })
  }

  // 劫持 onerror / unhandledrejection
  win.addEventListener("error", (event: ErrorEvent) => {
    pushError(
      event.message || String(event),
      event.error?.stack,
      event.filename,
      event.lineno,
      event.colno,
    )
  })
  win.addEventListener("unhandledrejection", (event: PromiseRejectionEvent) => {
    const reason = event.reason
    pushError(
      reason instanceof Error ? reason.message : String(reason),
      reason instanceof Error ? reason.stack : undefined,
    )
  })

  // 劫持 console(保留原行为 + 采集).用 const cw 固化非空 narrowing,
  // 让 TS 在 wrapConsole 闭包里信任 win 仍非 null(闭包不信任可变 binding 的 narrowing).
  const cw = win
  const origConsole = {
    error: cw.console.error.bind(cw.console),
    warn: cw.console.warn.bind(cw.console),
    log: cw.console.log.bind(cw.console),
  }
  function wrapConsole(level: "error" | "warn" | "log", orig: (...args: unknown[]) => void) {
    cw.console[level] = (...args: unknown[]) => {
      collector.console.push({
        level,
        args: args.map((a) => stringifyConsoleArg(a)),
      })
      orig(...args)
    }
  }
  wrapConsole("error", origConsole.error)
  wrapConsole("warn", origConsole.warn)
  wrapConsole("log", origConsole.log)

  // 资源加载失败:捕获 error 事件冒泡(img/script/link 等)
  doc.addEventListener("error", (event: Event) => {
    const target = event.target
    if (target instanceof HTMLElement) {
      const url =
        target instanceof HTMLScriptElement ? target.src
        : target instanceof HTMLLinkElement ? target.href
        : target instanceof HTMLImageElement ? target.src
        : undefined
      if (url) {
        collector.resourceFailures.push({
          url,
          reason: "资源加载失败(元素 error 事件)。",
        })
      }
    }
  }, true)

  // 采 performance entries 里的失败请求
  try {
    const entries = win.performance.getEntriesByType("resource") as PerformanceResourceTiming[]
    for (const entry of entries) {
      // initiatorType 不为 "" 且 transferSize=0 且非 304/cached 通常意味着失败
      if (entry.transferSize === 0 && entry.decodedBodySize === 0 && entry.duration > 0) {
        // 0 transferSize 也可能是 cache hit,但 packaged SW 资源一般非 cache,
        // 结合 decodedBodySize=0 更可能是 404/失败.记下供助手判断.
        collector.resourceFailures.push({
          url: entry.name,
          reason: "performance entry 显示 transferSize=0(decodedBodySize=0,疑似 404 或加载失败)。",
        })
      }
    }
  } catch {
    // performance API 不可读时忽略
  }
}

function stringifyConsoleArg(value: unknown): string {
  if (typeof value === "string") return value.slice(0, MAX_CONSOLE_ARG)
  if (value instanceof Error) return value.message.slice(0, MAX_CONSOLE_ARG)
  try {
    return JSON.stringify(value, undefined, 0)?.slice(0, MAX_CONSOLE_ARG) ?? String(value)
  } catch {
    return String(value).slice(0, MAX_CONSOLE_ARG)
  }
}

// ── 结构层采集 ──
// design §6.3:DOM 序列化裁剪(限深、跳空、截属性)+ computed style(CSS vars + 关键容器)
// + 渲染文本提取 + bridgeState.

const MAX_DOM_DEPTH = 8
const MAX_DOM_TEXT = 200
const MAX_ATTR_VALUE = 120
const MAX_DOM_SUMMARY = 8000
const KEY_SELECTORS = ["#messages", "#message-list", ".messages", "#status", "#input", "#send", "#turn", ".msg", "[data-messages]"]

function collectStructure(
  doc: Document | null,
  bridgeReady: boolean,
): InspectFrontendResult["structure"] {
  if (!doc || !doc.body) {
    return {
      domSummary: "(contentDocument 不可读或 body 为空)",
      computedStyles: [],
      renderedText: "",
      bridgeState: bridgeReady ? "ready" : "loading",
    }
  }
  const domSummary = serializeDom(doc.body, 0).slice(0, MAX_DOM_SUMMARY)
  const computedStyles = collectKeyComputedStyles(doc)
  const renderedText = extractRenderedText(doc)
  return {
    domSummary,
    computedStyles,
    renderedText,
    bridgeState: bridgeReady ? "ready" : "loading",
  }
}

function serializeDom(node: Node, depth: number): string {
  if (depth > MAX_DOM_DEPTH) return ""
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent?.trim() ?? ""
    return text ? text.slice(0, MAX_DOM_TEXT) : ""
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return ""
  const el = node as Element
  const tag = el.tagName.toLowerCase()
  // 跳过 script/style 内容(噪声)
  if (tag === "script" || tag === "style" || tag === "link") {
    return `<${tag} />`
  }
  const attrs: string[] = []
  for (const attr of Array.from(el.attributes)) {
    const val = attr.value.length > MAX_ATTR_VALUE
      ? attr.value.slice(0, MAX_ATTR_VALUE) + "…"
      : attr.value
    attrs.push(`${attr.name}="${val}"`)
  }
  // input/textarea/select 的 value 是 JS 属性,不反映为 DOM attribute,
  // 不会出现在上面的 attributes 遍历里.显式读 .value 注入为 __value,
  // 让助手能看到 type 操作后的实际输入内容(测试发现2).
  if (
    el instanceof HTMLInputElement
    || el instanceof HTMLTextAreaElement
    || el instanceof HTMLSelectElement
  ) {
    const v = el.value
    if (v) {
      const val = v.length > MAX_ATTR_VALUE ? v.slice(0, MAX_ATTR_VALUE) + "…" : v
      attrs.push(`__value="${val}"`)
    }
  }
  const attrStr = attrs.length ? " " + attrs.join(" ") : ""
  const children = Array.from(el.childNodes)
  const parts: string[] = []
  for (const child of children) {
    const s = serializeDom(child, depth + 1)
    if (s) parts.push(s)
  }
  const indent = "  ".repeat(depth)
  if (parts.length === 0) {
    return `${indent}<${tag}${attrStr} />`
  }
  if (parts.length === 1 && !parts[0]!.startsWith("<")) {
    // 单文本子节点:内联
    return `${indent}<${tag}${attrStr}>${parts[0]}</${tag}>`
  }
  return `${indent}<${tag}${attrStr}>\n${parts.map((p) => p).join("\n")}\n${indent}</${tag}>`
}

function collectKeyComputedStyles(doc: Document): Record<string, string>[] {
  const result: Record<string, string>[] = []
  // :root CSS 变量
  const root = doc.documentElement
  const rootStyle = doc.defaultView?.getComputedStyle(root)
  if (rootStyle) {
    const vars: Record<string, string> = { selector: ":root" }
    // 采常见 CSS 变量名(无法枚举所有自定义属性,采已知前缀)
    for (const name of ["--bg", "--fg", "--accent", "--void", "--surface", "--primary", "--font-size"]) {
      const val = rootStyle.getPropertyValue(name)
      if (val) vars[name] = val.trim()
    }
    if (Object.keys(vars).length > 1) result.push(vars)
  }
  // 关键容器
  for (const sel of KEY_SELECTORS) {
    const el = doc.querySelector(sel)
    if (el) {
      const style = doc.defaultView?.getComputedStyle(el)
      if (style) {
        result.push({
          selector: sel,
          display: style.display,
          visibility: style.visibility,
          color: style.color,
          backgroundColor: style.backgroundColor,
          width: style.width,
          height: style.height,
        })
      }
    }
  }
  return result
}

function extractRenderedText(doc: Document): string {
  // 采消息区文本:优先 KEY_SELECTORS 里的消息容器,回退 body 文本
  for (const sel of ["#messages", "#message-list", ".messages", "[data-messages]"]) {
    const el = doc.querySelector(sel)
    if (el) {
      const text = el.textContent?.trim()
      if (text) return text.slice(0, 4000)
    }
  }
  const bodyText = doc.body.textContent?.trim()
  return bodyText ? bodyText.slice(0, 4000) : ""
}
