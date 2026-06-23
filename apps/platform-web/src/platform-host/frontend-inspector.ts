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

    // 7. DOM 交互(actions)+ observeBetween. design §3.
    // same-origin 下 contentDocument.querySelector + dispatchEvent 模拟玩家操作.
    // auto-waiting(默认开):每个 action 前等元素出现且可操作,超时报 INSPECT_WAIT_TIMEOUT.
    let actionSnapshots: InspectFrontendActionSnapshot[] | undefined
    const iframe = mountedIframe ?? container.querySelector("iframe")
    if (input.actions && input.actions.length > 0 && iframe) {
      const doc = iframe.contentDocument
      if (doc) {
        actionSnapshots = []
        for (let step = 0; step < input.actions.length; step += 1) {
          const action = input.actions[step]!
          if (input.autoWait !== false) {
            const actionable = await waitForActionable(doc, action.selector, ACTION_WAIT_TIMEOUT_MS)
            if (!actionable) {
              // 诊断:超时时带上元素是否存在 + 是否 HTMLElement,帮定位是 selector 没匹配
              // 还是 isActionable 判否.
              const probeEl = doc.querySelector(action.selector)
              const diag = probeEl
                ? {
                    found: true,
                    tag: probeEl.tagName.toLowerCase(),
                    hasDisabledAttr: probeEl.hasAttribute("disabled"),
                    hasHiddenAttr: probeEl.hasAttribute("hidden"),
                    ariaHidden: probeEl.getAttribute("aria-hidden"),
                    inlineDisplay: (probeEl as HTMLElement).style.display || undefined,
                  }
                : { found: false }
              return failed(
                "INSPECT_WAIT_TIMEOUT",
                `等待选择器可操作超时:${action.selector}`,
                { selector: action.selector, timeoutMs: ACTION_WAIT_TIMEOUT_MS, step, diag },
              )
            }
          }
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
// design §3:same-origin contentDocument.querySelector + dispatchEvent 模拟玩家操作.
// action 集见 InspectDomActionType;每个 case 校验目标元素类型,不匹配抛结构化错误.
//
// 跨 realm 注意:el 来自 iframe 的 document,其原型链是 iframe window 的 HTML*Element,
// 而本文件跑在父窗口 — el instanceof HTMLInputElement(父窗口的)会因跨 realm 返 false!
// 用 tagName + 属性 duck-typing 代替 instanceof.
function applyAction(doc: Document, action: InspectDomAction): void {
  const el = doc.querySelector(action.selector)
  if (!el) {
    throw {
      code: "INSPECT_SELECTOR_NOT_FOUND",
      message: `选择器无匹配:${action.selector}`,
    } satisfies PlatformActionError
  }
  const tag = el.tagName.toLowerCase()
  // duck-type helpers(跨 realm 安全):用 tagName + 属性存在性判断元素类型.
  const isInput = tag === "input"
  const isTextarea = tag === "textarea"
  const isSelect = tag === "select"
  const isFormField = isInput || isTextarea || isSelect
  switch (action.type) {
    case "click":
      el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))
      break
    case "type": {
      if (isFormField) {
        ;(el as HTMLInputElement).value = action.text ?? ""
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
      const target = el as HTMLElement
      target.scrollTop = action.to === "bottom" ? target.scrollHeight : 0
      target.dispatchEvent(new Event("scroll", { bubbles: true }))
      break
    }
    case "selectOption": {
      if (!isSelect) {
        throw {
          code: "INSPECT_NOT_SELECT",
          message: `selectOption 目标不是 <select>:${action.selector}`,
        } satisfies PlatformActionError
      }
      const select = el as HTMLSelectElement
      if (action.value !== undefined && action.value !== "") {
        select.value = action.value
      } else if (action.label !== undefined && action.label !== "") {
        const opt = Array.from(select.options).find((o) => o.textContent?.trim() === action.label)
        if (!opt) {
          throw {
            code: "INSPECT_OPTION_NOT_FOUND",
            message: `option 文本无匹配:${action.label}`,
          } satisfies PlatformActionError
        }
        select.value = opt.value
      } else {
        throw {
          code: "INSPECT_SELECT_NO_VALUE",
          message: "selectOption 需 value 或 label 参数",
        } satisfies PlatformActionError
      }
      el.dispatchEvent(new Event("input", { bubbles: true }))
      el.dispatchEvent(new Event("change", { bubbles: true }))
      break
    }
    case "check": {
      if (!isInput) {
        throw {
          code: "INSPECT_NOT_CHECKABLE",
          message: `check 目标不是 checkbox/radio:${action.selector}`,
        } satisfies PlatformActionError
      }
      const input = el as HTMLInputElement
      if (input.type !== "checkbox" && input.type !== "radio") {
        throw {
          code: "INSPECT_NOT_CHECKABLE",
          message: `check 目标不是 checkbox/radio:${action.selector}`,
        } satisfies PlatformActionError
      }
      input.checked = action.checked !== false // 默认 true,false=取消勾选
      el.dispatchEvent(new Event("input", { bubbles: true }))
      el.dispatchEvent(new Event("change", { bubbles: true }))
      break
    }
    case "fill": {
      if (isInput || isTextarea) {
        ;(el as HTMLInputElement).value = action.text ?? "" // 清空后填入(区别 type 的追加)
      } else if (typeof (el as HTMLElement).isContentEditable === "boolean" && (el as HTMLElement).isContentEditable) {
        ;(el as HTMLElement).textContent = action.text ?? ""
      } else {
        throw {
          code: "INSPECT_NOT_FILLABLE",
          message: `fill 目标不可填(input/textarea/contenteditable):${action.selector}`,
        } satisfies PlatformActionError
      }
      el.dispatchEvent(new Event("input", { bubbles: true }))
      el.dispatchEvent(new Event("change", { bubbles: true }))
      break
    }
    case "hover": {
      el.dispatchEvent(new MouseEvent("mouseover", { bubbles: true, cancelable: true }))
      el.dispatchEvent(new MouseEvent("mouseenter", { bubbles: false, cancelable: true }))
      break
    }
    case "focus": {
      // HTMLElement duck-type:focus() 存在即可(所有 HTMLElement 都有).
      if (typeof (el as HTMLElement).focus !== "function") {
        throw {
          code: "INSPECT_NOT_FOCUSABLE",
          message: `focus 目标不可聚焦:${action.selector}`,
        } satisfies PlatformActionError
      }
      ;(el as HTMLElement).focus()
      el.dispatchEvent(new Event("focus", { bubbles: true }))
      el.dispatchEvent(new Event("focusin", { bubbles: true }))
      break
    }
  }
}

// ── auto-waiting ──
// design §3.1:action 前等元素出现且可见(存在 + 非 display:none/visibility:hidden/aria-hidden).
// 不等 enabled — 自检场景助手可能要操作/观测初始 disabled 的元素(如 #send 按钮在
// bridge ready 前是 disabled,助手可能就是要测这个态).disabled 元素也允许 action 执行
// (applyAction 内各 case 会按需处理).rAF 轮询,1000ms 超时返 false.
const ACTION_WAIT_TIMEOUT_MS = 1000

function isActionable(el: Element): boolean {
  // 跨 realm 注意:el 来自 iframe 的 document,其原型链是 iframe window 的 HTMLElement,
  // 而本文件跑在父窗口 — el instanceof HTMLElement(父窗口的)会因跨 realm 返 false!
  // 用 duck-typing 检查(el.style 存在即 HTMLElement 子类)代替 instanceof.
  if (!("style" in el)) return false
  if (el.getAttribute("aria-hidden") === "true") return false
  if (el.hasAttribute("hidden")) return false
  if ((el as HTMLElement).style.display === "none") return false
  // CSS class 设的 display:none/visibility:hidden:用 iframe 自己的 window
  // (el.ownerDocument.defaultView)调 getComputedStyle,同 realm 不跨域,稳定.
  // 不等 enabled(disabled 元素也允许操作,见 design §3.1).
  const win = el.ownerDocument?.defaultView
  if (win) {
    try {
      const style = win.getComputedStyle(el)
      if (style.display === "none" || style.visibility === "hidden") return false
    } catch {
      // getComputedStyle 失败时忽略 CSS 可见性检查(不阻塞)
    }
  }
  return true
}

async function waitForActionable(doc: Document, selector: string, timeoutMs: number): Promise<boolean> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const el = doc.querySelector(selector)
    if (el && isActionable(el)) return true
    // 用 setTimeout 轮询而非 rAF — 隐藏 iframe(off-screen left:-9999px opacity:0)
    // 父窗口 rAF 可能被浏览器节流,setTimeout 更可靠.16ms ≈ 一帧.
    await new Promise<void>((resolve) => setTimeout(resolve, 16))
  }
  return false
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
// design §2:aria snapshot(无障碍树 YAML,role+name+状态)替换原 raw HTML 序列化.
// 对 LLM 语义密度更高、token 更省;行级 diff 天然成立(YAML 每行一节点).
// computed style(CSS vars + 关键容器)+ 渲染文本提取 + bridgeState 不变.

const MAX_DOM_DEPTH = 8
const MAX_ARIA_NAME = 80
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
  const domSummary = serializeAria(doc.body, 0).slice(0, MAX_DOM_SUMMARY)
  const computedStyles = collectKeyComputedStyles(doc)
  const renderedText = extractRenderedText(doc)
  return {
    domSummary,
    computedStyles,
    renderedText,
    bridgeState: bridgeReady ? "ready" : "loading",
  }
}

// aria snapshot 序列化:遍历 DOM,输出无障碍树 YAML.
// generic(无 ARIA role 映射的 div/span 等)输出为 `- generic "name"`,
// 带 class/id 标识让助手能定位结构节点(如 .msg / .user-msg / .msg-body).
// 不完全折叠 generic — 那会丢失 div 容器结构(测试发现消息气泡消失).
function serializeAria(root: Element, depth: number): string {
  const lines: string[] = []
  walkAria(root, depth, lines)
  return lines.join("\n")
}

function walkAria(el: Element, depth: number, out: string[]): void {
  if (depth > MAX_DOM_DEPTH) return
  if (!isRelevantForAria(el)) return
  const role = computeAriaRole(el)
  const name = computeAccessibleName(el)
  const state = computeAriaState(el)
  const indent = "  ".repeat(depth)
  // 所有节点都输出行(generic 也输出),保结构层级.
  // generic 附 class/id 标识(取首个非通用 class),让助手能定位 .msg 等容器.
  const label = name ? ` "${name}"` : ""
  const stateStr = state ? ` [${state}]` : ""
  const identStr = role === "generic" ? computeGenericIdentifier(el) : ""
  out.push(`${indent}- ${role}${identStr}${label}${stateStr}`)
  // 递归子节点:统一用 depth+1(因所有节点都占行,不再有 generic 折叠 depth 修正).
  for (const child of Array.from(el.children)) {
    walkAria(child, depth + 1, out)
  }
}

// 给 generic 节点算标识字符串:取首个语义 class 或 id.
// 形如 ` ".user-msg"` 或 ` "#messages"`,无标识则空.
// 跳过通用 class(util class 如 flex/hidden 等不报结构语义).
const GENERIC_SKIP_CLASSES = new Set([
  "flex", "flex-col", "flex-row", "flex-row-reverse", "flex-1", "flex-shrink-0", "shrink-0", "grow",
  "grid", "grid-cols", "block", "inline", "inline-block", "inline-flex",
  "hidden", "relative", "absolute", "fixed", "sticky",
  "w-full", "h-full", "w-auto", "h-auto", "min-h-dvh", "h-dvh", "w-screen",
  "border-0", "border", "border-t", "border-b", "rounded", "rounded-lg",
  "bg-void", "bg-panel", "bg-transparent",
  "text-center", "text-left", "text-right", "text-sm", "text-xs", "text-lg",
  "p-0", "p-1", "p-2", "p-3", "p-4", "px-2", "px-3", "px-4", "py-1", "py-2",
  "m-0", "m-1", "m-2", "mx-auto", "mt-2", "mb-2", "gap-1", "gap-2", "gap-4",
  "overflow-hidden", "overflow-auto", "overflow-y-auto", "overflow-scroll",
  "cursor-pointer", "cursor-not-allowed", "select-none", "whitespace-pre-wrap",
  "items-center", "items-start", "items-end", "justify-center", "justify-between",
])
function computeGenericIdentifier(el: Element): string {
  const id = el.id
  if (id) return ` #${id}`
  const classList = el.classList
  for (const cls of Array.from(classList)) {
    if (!GENERIC_SKIP_CLASSES.has(cls) && !cls.startsWith("vue-")) {
      return ` .${cls}`
    }
  }
  return ""
}

// 跳过隐藏/装饰节点(不进 aria 树).
function isRelevantForAria(el: Element): boolean {
  const tag = el.tagName.toLowerCase()
  if (tag === "script" || tag === "style" || tag === "link" || tag === "meta" || tag === "head") {
    return false
  }
  if (el.hasAttribute("hidden")) return false
  if (el.getAttribute("aria-hidden") === "true") return false
  const style = el.ownerDocument?.defaultView?.getComputedStyle(el)
  if (style && (style.display === "none" || style.visibility === "hidden")) {
    return false
  }
  return true
}

// role:显式 role 属性优先 → tag 隐式映射 → generic.
function computeAriaRole(el: Element): string {
  const explicit = el.getAttribute("role")
  if (explicit && explicit.trim()) {
    const trimmed = explicit.trim().toLowerCase()
    // role="none"/"presentation" 视为 generic(递归子,不输出)
    if (trimmed === "none" || trimmed === "presentation") return "generic"
    return trimmed
  }
  const tag = el.tagName.toLowerCase()
  if (tag === "button") return "button"
  if (tag === "a") return "link"
  // 跨 realm:用 tagName === "input" 代替 instanceof HTMLInputElement.
  if (tag === "input") {
    const type = (el as HTMLInputElement).type.toLowerCase()
    if (type === "checkbox") return "checkbox"
    if (type === "radio") return "radio"
    if (type === "button" || type === "submit" || type === "reset") return "button"
    if (type === "image") return "button"
    return "textbox"
  }
  if (tag === "textarea") return "textbox"
  if (tag === "select") return "combobox"
  if (/^h[1-6]$/.test(tag)) return "heading"
  if (tag === "ul") return "list"
  if (tag === "ol") return "list"
  if (tag === "li") return "listitem"
  if (tag === "nav") return "navigation"
  if (tag === "img") return "img"
  if (tag === "p") return "paragraph"
  if (tag === "table") return "table"
  if (tag === "tr") return "row"
  if (tag === "td") return "cell"
  if (tag === "th") return "columnheader"
  if (tag === "form") return "form"
  if (tag === "dialog") return "dialog"
  if (tag === "details") return "group"
  if (tag === "summary") return "button"
  if (tag === "figure") return "figure"
  if (tag === "blockquote") return "blockquote"
  if (tag === "section" || tag === "article" || tag === "main" || tag === "aside" || tag === "header" || tag === "footer") {
    return tag
  }
  return "generic"
}

// accessible name:aria-label → aria-labelledby → 元素类型相关 fallback.
// 关键:只有"name from contents"型元素(button/link/heading/listitem/cell 等)
// 才用 textContent 作为 name 来源;容器型元素(main/section/article/div 等)
// 不从子文本累积 name(否则会把所有后代文本碾进容器 name,塌缩子结构).
// 简化版,未实现完整 WAI-ARIA name calculation.
// 参考:WAI-ARIA "Name From" 规则 — author/contents 两种来源.
function computeAccessibleName(el: Element): string {
  const ariaLabel = el.getAttribute("aria-label")
  if (ariaLabel && ariaLabel.trim()) return ariaLabel.trim().slice(0, MAX_ARIA_NAME)

  const labelledby = el.getAttribute("aria-labelledby")
  if (labelledby) {
    const doc = el.ownerDocument
    if (doc) {
      const refText = labelledby
        .split(/\s+/)
        .map((id) => doc.getElementById(id)?.textContent?.trim() ?? "")
        .filter(Boolean)
        .join(" ")
      if (refText) return refText.slice(0, MAX_ARIA_NAME)
    }
  }

  const tag = el.tagName.toLowerCase()
  // 跨 realm:用 tagName 判断表单元素,不用 instanceof HTMLInputElement 等.
  if (tag === "input" || tag === "textarea" || tag === "select") {
    const placeholder = (el as HTMLInputElement).placeholder
    if (placeholder && placeholder.trim()) return placeholder.trim().slice(0, MAX_ARIA_NAME)
    const title = el.getAttribute("title")
    if (title && title.trim()) return title.trim().slice(0, MAX_ARIA_NAME)
    // <label for> 关联
    const id = el.id
    if (id) {
      const doc = el.ownerDocument
      const label = doc?.querySelector(`label[for="${id}"]`)?.textContent?.trim()
      if (label) return label.slice(0, MAX_ARIA_NAME)
    }
    return ""
  }
  if (tag === "img") {
    const alt = el.getAttribute("alt")
    if (alt && alt.trim()) return alt.trim().slice(0, MAX_ARIA_NAME)
    const title = el.getAttribute("title")
    if (title && title.trim()) return title.trim().slice(0, MAX_ARIA_NAME)
    return ""
  }
  // "name from contents"型元素:用 textContent 作为 name(累积后代可见文本).
  // 只对交互/标题/列表项/单元格等元素用 textContent,容器(main/section/article/
  // div/span/p 等)不从这里取 name — 容器的 name 只来自 aria-label/labelledby,
  // 否则会把所有后代文本碾进容器 name,塌缩子结构(测试发现的缺陷 A).
  // 注:textContent 是累积后代文本(非仅直接子),对 button/link/heading 这类深度浅
  // 的元素等价于"可见文本",不会把整页文本碾进来.
  if (isNameFromContents(el, tag)) {
    const text = el.textContent?.trim()
    if (text) return text.slice(0, MAX_ARIA_NAME)
  }
  const title = el.getAttribute("title")
  if (title && title.trim()) return title.trim().slice(0, MAX_ARIA_NAME)
  return ""
}

// 判断元素是否属于 "name from contents"(WAI-ARIA):即 name 可从自身/子文本获取.
// 容器型元素(main/section/article/nav/aside/header/footer/div/span/p/form/table/
// list/row 等)不在内 — 它们的 name 只来自 aria-label/labelledby,不从子文本累积.
function isNameFromContents(el: Element, tag: string): boolean {
  // heading h1-h6:name from contents
  if (/^h[1-6]$/.test(tag)) return true
  // button / a / link:name from contents
  if (tag === "button") return true
  if (tag === "a") return true
  // listitem / cell / columnheader:name from contents
  if (tag === "li") return true
  if (tag === "td") return true
  if (tag === "th") return true
  // 显式 role 为 button/link/heading/menuitem/tab/option 等交互型
  const explicit = el.getAttribute("role")
  if (explicit) {
    const r = explicit.trim().toLowerCase()
    if (["button", "link", "heading", "menuitem", "tab", "option", "treeitem", "listitem", "cell", "columnheader", "rowheader"].includes(r)) {
      return true
    }
  }
  return false
}

// state:组合 disabled/checked/expanded/level/required/selected/readonly,
// 返回 "key=val key=val" 字符串或空.
// 跨 realm 注意:用 tagName duck-typing 代替 instanceof HTMLInputElement 等.
function computeAriaState(el: Element): string {
  const parts: string[] = []
  const tag = el.tagName.toLowerCase()
  const isInput = tag === "input"
  const isTextarea = tag === "textarea"
  const isSelect = tag === "select"
  const ariaDisabled = el.getAttribute("aria-disabled")
  // disabled 反映为 DOM attribute,统一用 hasAttribute 检测.
  if (ariaDisabled === "true" || el.hasAttribute("disabled")) {
    parts.push("disabled")
  }
  const ariaChecked = el.getAttribute("aria-checked")
  // checked:checkbox/radio 的 .checked 属性(跨 realm 安全:input.checked 直接读).
  if (ariaChecked === "true" || (isInput && (el as HTMLInputElement).checked)) {
    parts.push("checked")
  }
  const ariaExpanded = el.getAttribute("aria-expanded")
  if (ariaExpanded !== null) parts.push(`expanded=${ariaExpanded}`)
  const ariaSelected = el.getAttribute("aria-selected")
  if (ariaSelected === "true") parts.push("selected")
  const ariaReadonly = el.getAttribute("aria-readonly")
  if (
    ariaReadonly === "true"
    || ((isInput || isTextarea) && (el as HTMLInputElement).readOnly)
  ) {
    parts.push("readonly")
  }
  const ariaRequired = el.getAttribute("aria-required")
  if (
    ariaRequired === "true"
    || ((isInput || isTextarea || isSelect) && (el as HTMLInputElement).required)
  ) {
    parts.push("required")
  }
  // heading level:h1-h6 或 aria-level(tag 已在函数顶部声明)
  if (/^h[1-6]$/.test(tag)) {
    parts.push(`level=${tag[1]}`)
  } else {
    const ariaLevel = el.getAttribute("aria-level")
    if (ariaLevel && /^\d+$/.test(ariaLevel)) parts.push(`level=${ariaLevel}`)
  }
  return parts.join(" ")
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
