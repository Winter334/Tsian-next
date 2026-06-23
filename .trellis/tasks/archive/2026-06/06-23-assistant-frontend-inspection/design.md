# Design — 助手前端自检工具 inspect_game_frontend

## 1. 架构总览

```
助手 agent 回合
  └─ executeInspectFrontend(args, context)             [agent-runtime/workspace-tools.ts]
       └─ context.runInspectFrontend(args)             [新 capability]
            └─ createFrontendInspector()(...)           [platform-host/frontend-inspector.ts 新文件]
                 ├─ 1. 取 active 卡 + frontend binding
                 ├─ 2. resolvePackagedFrontendUrl        [复用 package-loader]
                 ├─ 3. mountRemoteIframeFrontend(隐藏容器, 专用 bridge)  [复用 bridge/remote-iframe-bridge]
                 ├─ 4. onBridgeReady 后注入采集脚本（结构层+诊断层）
                 ├─ 5.（若 send）ephemeral save + runAgentRuntimeTurn + 事件转发给 iframe
                 ├─ 6.（若 actions）DOM 交互 + observeBetween 采集
                 ├─ 7.（若 refresh）拉最新 snapshot
                 ├─ 8. 采集结果 + 事件时间线 + 行号映射 + diff
                 └─ 9. dispose iframe + deleteLocalSave
```

关键：**加载复用、回合自编排、采集走父窗口侧**。不抽新 mount 函数，不碰 `playFrontendBridge.sendMessage`，不碰 active save 指针。工具名短：`inspect_frontend`。操作面分层泛化：send（驱动回合，烧 token）/ actions（DOM 交互）/ refresh（拉最新 snapshot）可组合，但不开放任意 bridgeCall——send/refresh 是语义化原语，助手不用背桥协议。

## 2. 新文件：platform-host/frontend-inspector.ts

镜像 `browser-skill-script-executor.ts:666` 的工厂模式。

### 2.1 工厂签名
```ts
export function createFrontendInspector(): (input: InspectFrontendInput) => Promise<InspectFrontendResult>
```
单例化（模块级 lazy），因为要管理"单会话串行"——后一次调自动 dispose 前一次的隐藏 iframe + 隐藏容器。

### 2.2 隐藏容器
off-screen div：`position:fixed; width:1024px; height:768px; opacity:0; pointer-events:none; left:-9999px; top:0; z-index:-1`。挂在 `document.body` 上，首次调用时创建，dispose 时若下次还要用就保留容器只换 iframe。注意 `mountRemoteIframeFrontend` 会 `container.replaceChildren(iframe)`，所以容器要专用、不与可见 UI 共享。iframe className 被硬编码（`remote-iframe-bridge.ts:279`），靠容器隐藏而非 className。

### 2.3 InspectFrontendInput / Result 类型
```ts
interface InspectFrontendInput {
  send?: { message: string }                         // 驱动回合（烧 token，语义化原语，非任意 bridgeCall）
  actions?: InspectDomAction[]                      // DOM 交互
  observeBetween?: boolean                          // 步间采集
  refresh?: boolean                                 // 操作后拉最新 snapshot（语义化原语）
  wait?: "bridge-ready" | "turn-completed"          // 观测点，默认 bridge-ready
  // 延后项接口预留（初版不实现，传了报 not-supported）：
  runtime?: "real" | "mock"                         // 预留，初版只 real
  screenshot?: boolean                              // 预留，初版不做
}

interface InspectDomAction {
  type: "click" | "type" | "press" | "scroll"
  selector: string
  text?: string                                     // type 用
  key?: string                                      // press 用
  to?: "top" | "bottom"                             // scroll 用
}

interface InspectFrontendResult {
  ok: boolean
  cardId: string
  entry: string
  structure: {                                      // 结构层
    domSummary: string                              // 裁剪过的 DOM 树文本
    computedStyles: Record<string, string>[]        // 关键元素 computed style
    renderedText: string                            // 当前渲染的消息文本
    bridgeState: "loading" | "ready" | "turn-active" | "error"
  }
  diagnostics: {                                    // 诊断层
    errors: { message: string; stack?: string; source?: string; line?: number; col?: number }[]
    console: { level: "log"|"warn"|"error"; args: string[] }[]
    resourceFailures: { url: string; status?: number; reason: string }[]
    bridgeHandshake: "pending" | "ready" | "timeout"
  }
  timeline?: {                                      // 事件时间线（send 后）
    t: number                                       // 时戳
    event: "turn-delta" | "turn-tool" | "turn-round-end" | "turn-completed"
    payload: unknown
  }[]
  actionSnapshots?: {                               // observeBetween 步间快照
    step: number
    action: InspectDomAction
    after: { domSummary: string; bridgeState: string }
  }[]
  fileLineMap?: Record<string, { source: string; line: number }[]>  // 行号映射
  diff?: {                                          // 与上次 inspect 对比
    added: string[]
    removed: string[]
    changed: { path: string; from: string; to: string }[]
  }
  truncated?: boolean
  error?: { code: string; message: string; details?: unknown }
}
```

## 3. 加载复用（R1 前半）

```ts
const card = await getPlatformActiveGameCard()
const frontend = card.manifest.frontend
if (!frontend || frontend.kind !== "packaged") {
  throw toolError("INSPECT_FRONTEND_NOT_PACKAGED", "自检只支持 packaged 前端。")
}
const url = await resolvePackagedFrontendUrl({ gameCardId: card.id, entry: frontend.entry })
```
然后：
```ts
disposePrevSession()  // 单会话串行
const bridge = createInspectionBridge(card)  // §4
dispose = mountRemoteIframeFrontend(hiddenContainer, {
  url,
  bridge,
  sandbox: "allow-scripts allow-same-origin allow-forms",
  title: "Tsian frontend inspection",
  onBridgeReady: () => { bridgeReady = true; injectCollectors(iframe) },
})
```
`onBridgeReady` 是"前端活着且桥通了"的可靠信号——在此之后才开始父窗口侧采集。`onError` 不可靠（只捕获 iframe 元素 error），不依赖它。

## 4. 专用 bridge（send 回合编排核心）

不给隐藏 iframe 用 `playFrontendBridge`（它会 `ensureActiveSave()` + 广播流式到玩家前端 + 用 `previousTurnController` abort 玩家回合）。自检 bridge 自己实现 `PlayFrontendBridge` 接口：

```ts
function createInspectionBridge(card: LocalGameCardRecord): PlayFrontendBridge {
  return {
    runtime: {
      getRuntimeSnapshot() {
        // 返回 ephemeral save 的 snapshot（drive 前是空 snapshot）
        return ephemeralSnapshot
      },
    },
    interaction: {
      async sendMessage(input) {
        // §5 编排 ephemeral 回合，不调 playFrontendBridge
        return runEphemeralTurn(input.content, card)
      },
    },
    query: getBaseBridge().query,           // 复用 base bridge 的 query（只读，无副作用）
    platform: {
      getPlatformContext() {
        return { version: "0.0.0", activeFrontendId: card.id, activeSaveId: ephemeralSaveId }
      },
      async runAction() {
        return { ok: false, error: { code: "INSPECT_ACTION_UNAVAILABLE", message: "自检会话不执行 platform action。" } }
      },
    },
    // 不接 debug bridge（自检不需要 ai-debug）
  }
}
```
`mountRemoteIframeFrontend` 内部会在 `interaction.sendMessage` resolve 后 `postEvent("turn-completed", { snapshot: result.snapshot })` 给 iframe（`remote-iframe-bridge.ts:364`），且它已订阅 `subscribeTurnDelta/RoundEnd/Tool` 转发流式事件给 iframe——**这些转发机制现成，自检只需让 ephemeral 回合的 emit 走同一套 streaming-events 总线**。所以 ephemeral 回合的 `onDelta/onRoundEnd/onTool` 直接调 `emitTurnDelta/emitTurnRoundEnd/emitTurnTool`（和 `index.ts:747-749` 一样），mount 函数的订阅就会把事件推给隐藏 iframe 的前端。同时自检自己也订阅同一总线采集时间线。

## 5. ephemeral save 回合编排（send，本任务最复杂段）

1:1 镜像 `platform-host/index.ts:692-828` 的 sendMessage 数据组装，但 save 用 ephemeral、不 commit、不 abort 玩家回合：

```ts
async function runEphemeralTurn(content: string, card: LocalGameCardRecord): Promise<MessageInteractionResult> {
  // 1. 建 ephemeral save（不设 active、不 emit savesChanged）
  const save = await createLocalSaveFromGameCard(card)
  ephemeralSaveId = save.id
  try {
    // 2. 组装数据（镜像 index.ts:694-731）
    const snapshotBefore = cloneSnapshot(await getSnapshotForSave(save.id))
    const historyBefore = await getHistoryForSave(save.id)
    const nextTurn = snapshotBefore.state.turn + 1
    const workspaceTransaction = createRuntimeWorkspaceTransaction(
      await listEffectiveWorkspaceFilesForSave(save.id, card),   // 注意：用 storage 导出，不走 active save 版
    )
    const providerPresetMap = buildAgentProviderPresetMap(workspaceTransaction.workspaceFiles)
    const agentContext = readAgentContextFromWorkspace(workspaceTransaction.workspaceFiles, save.id)
    const masterConfig = resolveAgentModelConfig("master", providerPresetMap)
    const contextTokenBudget = resolveTokenBudget(masterConfig?.parameters.contextWindow ?? null)

    // 3. 自己的 abort controller（不复用模块级 previousTurnController，避免干扰玩家回合）
    const controller = new AbortController()

    // 4. 采集器：既 emit 到总线（让 mount 转发给 iframe）又记时间线
    const timeline: TimelineEntry[] = []
    const onDelta = (agentId, delta, turn, round, kind) => {
      timeline.push({ t: Date.now(), event: "turn-delta", payload: { agentId, delta, turn, round, kind } })
      emitTurnDelta(agentId, delta, turn, round, kind)
    }
    // onRoundEnd / onTool 同理

    // 5. 跑回合（capabilities 照 index.ts:751-827 接全）
    const result = await runAgentRuntimeTurn(
      { agentId: "master", userInput: content, recentHistory: historyBefore, snapshot: snapshotBefore,
        workspaceFiles: workspaceTransaction.workspaceFiles, signal: controller.signal,
        agentContext: agentContext ?? undefined, contextTokenBudget, compressionMode: "narrative",
        onDelta, onRoundEnd, onTool },
      { callModel, callModelNative, toolCallMode, runBrowserScript, workspaceMutations, emitTrace },  // 同 index.ts
    )

    // 6. 算 snapshotAfter（镜像 index.ts:834-840，但不 commit）
    const snapshotAfter = snapshotWithTurnAndMessages(snapshotBefore, nextTurn, [
      ...snapshotBefore.state.messages,
      { role: "user", content },
      { role: "assistant", content: result.replyText },
    ])
    timeline.push({ t: Date.now(), event: "turn-completed", payload: { snapshot: snapshotAfter } })
    ephemeralSnapshot = snapshotAfter   // 让 bridge.getRuntimeSnapshot 返回最新

    return { snapshot: snapshotAfter }
  } finally {
    // 7. 删 ephemeral save（不 commit、不碰 active 指针）
    await deleteLocalSave(save.id)
    ephemeralSaveId = undefined
  }
}
```

**关键差异点（与 index.ts sendMessage 对照）**：
- save 来源：`createLocalSaveFromGameCard` 而非 `ensureActiveSave`
- workspace files：`listEffectiveWorkspaceFilesForSave(save.id, card)`（storage 导出）而非 `listEffectiveWorkspaceFilesForActiveSave`
- abort：自己的 controller，不复用模块级 `previousTurnController`
- 不调 `commitSuccessfulRuntimeTurnForSave`
- `runBrowserScript` 用同一个 `createBrowserSkillScriptRunner`（只读脚本，无 save 写副作用）
- `workspaceMutations.write/delete` 接 ephemeral 的 `workspaceTransaction`，但因不 commit，staged 写随 save 删除丢弃
- **capabilities 的 callModel/callModelNative/toolCallMode 照 `index.ts:752-792` 完整接**，遗漏任一 master agent 工具调用会缺能力

## 6. 采集层（R1 结构层 + 诊断层）

### 6.1 注入时机
`onBridgeReady` 后（前端活着、桥通），但**坏前端不发 ready**——所以还要一个 onLoad 后的超时兜底：若 N 秒内没 ready，仍注入采集（这时 bridgeState=loading/timeout，采集的是"加载到哪步死的"）。

### 6.2 诊断层注入（在 iframe context 里）
```ts
const win = iframe.contentWindow!
const doc = iframe.contentDocument!
// 劫持 onerror / unhandledrejection
win.addEventListener("error", (e) => collectError(e))
win.addEventListener("unhandledrejection", (e) => collectError(e.reason))
// 劫持 console
const origConsole = { error: win.console.error, warn: win.console.warn, log: win.console.log }
win.console.error = (...args) => { collectConsole("error", args); origConsole.error(...args) }
// 同理 warn/log
// 资源加载失败：performance entries + error 事件冒泡
```
注意：要在 iframe 的脚本运行**之前**注入才能捕获早期错误。`onLoad` 时 iframe 脚本可能已跑完。方案：在 `mountRemoteIframeFrontend` 建 iframe 后、设 src 前，先注入采集脚本——但现有 mount 函数不暴露这个钩子。**折中**：onLoad 后注入能捕获"运行时后续错误 + 控制台后续输出"，早期错误靠 SW fetch 层 + DOM 空态推断（白屏=脚本早崩的强信号）。若需捕获早期错误，design 标注未来可给 mount 函数加一个 `beforeLoad` 钩子在 src 设置后、load 前注入——但那是 bridge 文件改动，本任务先靠 onLoad 后注入 + DOM 空态推断。

### 6.3 结构层采集
```ts
function collectStructure(doc: Document) {
  const domSummary = serializeDom(doc.body, { maxDepth: 8, skipEmpty: true })  // 裁剪
  const computedStyles = collectKeyComputedStyles(doc)   // :root CSS vars + 关键元素
  const renderedText = extractRenderedText(doc)          // 消息区文本
  return { domSummary, computedStyles, renderedText, bridgeState }
}
```
DOM 序列化裁剪：限制深度、跳过空文本节点、截断超长属性。computed style 只采 CSS 变量（`:root`）+ 前端常见容器（`#messages`/`.msg-*`/`#status` 等）。

## 7. DOM 交互（actions）

```ts
function applyAction(doc: Document, action: InspectDomAction) {
  const el = doc.querySelector(action.selector)
  if (!el) throw toolError("INSPECT_SELECTOR_NOT_FOUND", `选择器无匹配：${action.selector}`)
  switch (action.type) {
    case "click": el.click()  // 或 dispatchEvent(new MouseEvent("click", {bubbles:true}))
    case "type": (el as HTMLInputElement).value = action.text ?? ""
                 el.dispatchEvent(new Event("input", {bubbles:true}))
    case "press": el.dispatchEvent(new KeyboardEvent("keydown"/"keyup", {key: action.key, bubbles:true}))
    case "scroll": el.scrollTop = action.to === "bottom" ? el.scrollHeight : 0
  }
}
```
`observeBetween`：每个 action 后 await 一微 tick（让渲染更新）再采 `collectStructure`，push 到 `actionSnapshots`。

## 8. 文件-行号映射

packaged 前端文件在 `default-frontend-files.ts` 是字符串数组 join 成的。stack 里的 `app.js:42` 是 join 后的行号。映射：在 inspector 加载时，从 `listLocalGameCardFrontendFiles(card.id)` 拿文件列表，对每个文件已知其内容（Blob），可算行数。但 stack 报的是 iframe 里加载的文件 URL（SW 虚拟 URL 下的 `app.js`），需把 URL path → 源文件。**初版简化**：stack 的 source 直接是 SW 虚拟路径（如 `/__tsian_game_card_frontends/<cardId>/frontend/app.js`），path 已含文件名，line 是行号。映射只做"文件名 → 源文件"（`app.js` → `default-frontend-files.ts` 的 `FRONTEND_APP_JS`），行号直接用（join 后行号 = 源行号，因为数组每元素一行）。若未来源不是单文件 join（用户上传 zip），映射退化为"直接给文件名+行号"，助手够用。

## 9. 复查 diff

模块级保留上次 inspect 的 `structure` + `diagnostics.errors`。本次 inspect 时做 diff：
- errors: 新增/消失的错误
- renderedText: 变化
- computedStyles: 变化的 CSS 变量值
- domSummary: 简单文本 diff（新增/移除的行）
返回 `diff` 字段。单会话串行保证"上次"是同一隐藏会话的前一次 inspect。

## 10. 工具注册（9 处文件，special-tool 模式）

工具名 `inspect_frontend`（短名）。操作面分层泛化：send/actions/refresh 可组合，不开放任意 bridgeCall。

| # | 文件 | 改动 |
|---|---|---|
| 1 | `agent-runtime/workspace-tools.ts` | `RUNTIME_WORKSPACE_TOOL_NAMES` 加 `inspectFrontend:"inspect_frontend"`；加 `normalizeInspectFrontendArguments` + `executeInspectFrontend`；`executeRuntimeWorkspaceToolCall` 加 `else if` 分支（镜像 `agent_call` `:1886-1904`，查 `context.runInspectFrontend`） |
| 2 | `agent-runtime/tool-schemas.ts` | 加 `inspectFrontendSchema: ToolSchema`（参数：`send`/`actions`/`observeBetween`/`refresh`/`wait`，无 cardId）；`buildEnabledToolSchemas`(`:300`) 按新 platform tool 门控 push |
| 3 | `packages/contracts/src/runtime.ts` | `AgentPlatformToolName`(`:234`) 加 `"inspect_frontend"` |
| 4 | `agent-runtime/permissions.ts` | `AGENT_PLATFORM_TOOL_NAMES`(`:7`) 加 `"inspect_frontend"` |
| 5 | `agent-runtime/registry.ts` | allow-set(`:45`) 加 `"inspect_frontend"`，防 `jsonPlatformToolArray` 剥离 |
| 6 | `storage/local-assistant-files.ts` | `defaultAssistantConfig().platformTools.enabled`(`:771`) 加 `"inspect_frontend"` |
| 7 | `agent-runtime/index.ts` | `AgentRuntimeCapabilities`(`:199`) 加 `runInspectFrontend?`；native/text 两 loop(`:1557`/`:1822`) threading 进 context；`buildWorkspaceToolInstructions`(`:725`) 加文本协议示例 |
| 8 | `platform-host/frontend-inspector.ts` | **新文件**：`createFrontendInspector` 工厂 + 全部编排逻辑 |
| 9 | `platform-host/assistant-chat.ts` | `:461` 附近注入 `runInspectFrontend: createFrontendInspector()` 进 capabilities |

## 11. 数据流与契约

- 工具入参：`InspectFrontendInput`（无 cardId，内部取 active）
- 工具出参：`InspectFrontendResult`（结构化对象，大结果截断标 `truncated`）
- capability 类型：`runInspectFrontend?: (input: InspectFrontendInput) => Promise<InspectFrontendResult>`
- 错误：executor 内 `throw toolError("INSPECT_FRONTEND_*", msg, details)`，dispatcher 转成 `{ok:false, error}`
- inspect 不进 `PARALLEL_TOOL_NAMES`（它有 iframe + runtime 副作用，非纯读）

## 12. 不破坏现有的保证

- 不改 `mountRemoteIframeFrontend`（复用不改）
- 不改 `playFrontendBridge`（自检用专用 bridge）
- 不碰 `previousTurnController`（自检用自己的 AbortController）
- 不碰 active save 指针（`createLocalSaveFromGameCard` 不设 active）
- 不 emit savesChanged（玩家列表 UI 不刷新）
- streaming-events 总线是 Set 订阅，自检订阅 + mount 转发订阅并存，互不干扰（玩家前端的 mount 订阅也还在）

## 13. 风险与回退

- **ephemeral 回合编排遗漏 capability**：对照 `index.ts:751-827` 逐项 checklist（见 implement.md），漏 callModel/callModelNative/toolCallMode/runBrowserScript/workspaceMutations 任一都会让回合或工具调用失败。
- **采集脚本注入时机**：onLoad 后注入捕获不到早期错误。初版靠 DOM 空态 + 资源 404 推断早期崩溃。未来可给 mount 加 beforeLoad 钩子。
- **单会话串行的并发安全**：用模块级 `currentDispose`，新 inspect 调用先 `currentDispose?.()`。若两次 inspect 极速连发，第二次可能在第一次 iframe 未完全 dispose 时起——用 await dispose 再 mount 保证串行。
- 回退：整块是新增 capability + 新文件，不动现有逻辑。出问题注释掉 capability 注入 + 工具 schema 即可禁用，不影响平台其他功能。
