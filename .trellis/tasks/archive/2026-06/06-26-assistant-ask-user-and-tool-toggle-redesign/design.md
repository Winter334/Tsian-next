# Design — ask_user 助手开关与工具开关体系重设计

## 1. 架构总览

三层改动，自底向上：

```
合同层 (contracts)      AgentPlatformToolName 已含 ask_user（runtime.ts:259）— 无需改
        │
权限层 (permissions)    ask_user 进常量；默认态按 agent 类型派生
        │
runtime 层             schema 门控接入 ask_user 权限；onAskUser 绑定路径补全
        │
UI 层 (双面板)          重新分组 + 补齐开关项 + 助手 ask 渲染 UI
```

合同层零改动——`ask_user` 已在 `AgentPlatformToolName` 联合类型里。改动集中在权限、runtime、UI 三层。

## 2. 权限层：默认态按 agent 类型派生

### 2.1 现状问题

`permissions.ts:52 enabledAgentPlatformTools` 用单一 `DEFAULT_AGENT_PLATFORM_TOOLS` 数组做默认回退：

```ts
const enabled = agent.platformTools.enabled.length > 0
  ? agent.platformTools.enabled
  : DEFAULT_AGENT_PLATFORM_TOOLS
```

所有 agent 共享同一默认集。D4 要求助手默认开 ask_user、游戏 agent 默认关，单一数组做不到。

### 2.2 方案（实现期纠正：放弃运行时派生，回到显式配置）

**初版方案**曾尝试用 `defaultPlatformToolsForAgent(agent)` 按 agent.id 派生默认态，但引入了"派生说开了但显式数组没有"的脱节——toggle 逻辑用 `isAgentPlatformToolEnabled`（含派生）判断是否 append，导致"启用一个默认就开的工具"误判为已开而跳过写入，加上 registry allow-list 漏 ask_user，表现为"toast 成功但开关没变化"。

**纠正后方案**：回到项目既有模式——各 agent 的默认启用态由其 **agent.json 显式声明**，`DEFAULT_AGENT_PLATFORM_TOOLS` 只是 enabled 为空时的单一回退（很少触发）。ask_user 直接写进 `defaultAssistantConfig().platformTools.enabled`（`local-assistant-files.ts`），游戏 agent 的默认 agent.json 不含。

```ts
// permissions.ts —— 单一回退数组，不派生
export const DEFAULT_AGENT_PLATFORM_TOOLS: AgentPlatformToolName[] = [
  AGENT_PLATFORM_TOOL_NAMES.agentCall,
  AGENT_PLATFORM_TOOL_NAMES.workspaceRead,
  AGENT_PLATFORM_TOOL_NAMES.workspaceWrite,
]
```

```ts
// local-assistant-files.ts defaultAssistantConfig()
platformTools: {
  enabled: ["agent_call", "workspace_read", "workspace_write", "inspect_frontend", "ask_user"],
  disabled: [],
}
```

开关 = 显式数组，所见即所得。UI toggle 改为无条件 append 到目标侧（removePlatformToolReference 已清理对侧），不依赖 `isAgentPlatformToolEnabled` 判断。

### 2.3 兼容性

- **新用户/重置**：助手 agent.json seed 含 ask_user，默认开。
- **已有用户**：持久化的旧 agent.json 不含 ask_user（loadLocalAssistantFiles 按文件级 merge，不合并文件内部字段），需手动在配置面板开一次。这是可接受的——用户自己决定是否启用，手动开后持久化。
- 游戏 agent 默认不含 ask_user，需时手动开。
- `DEFAULT_AGENT_PLATFORM_TOOLS` 常量若被其它处引用，替换为对应分类常量或派生函数调用。

## 3. Runtime 层：schema 门控 + onAskUser 绑定

### 3.1 schema 门控（tool-schemas.ts:443）

现状 `buildEnabledToolSchemas:463` 无条件 push `askUserSchema`：

```ts
const schemas: ToolSchema[] = [useSkillSchema, runScriptSchema, askUserSchema]
```

改为受 `ask_user` 平台工具门控：

```ts
const schemas: ToolSchema[] = [useSkillSchema, runScriptSchema]

const canAskUser = platformToolEnabled(
  options.enabledPlatformTools,
  AGENT_PLATFORM_TOOL_NAMES.askUser,
)
if (canAskUser) {
  schemas.push(askUserSchema)
}
```

效果：未启用 ask_user 的 agent（含默认关的游戏 agent）不再看到该工具。

### 3.2 助手路径 onAskUser 绑定

现状 `assistant-chat.ts` 传给 `runAgentRuntimeTurn` 的对象**没有 onAskUser**（:421-453 只有 onDelta/onRoundEnd/onTool）。

关键简化：`interaction-events.ts` 的 `emitInteractionRequest` 是**纯进程内事件总线**（`Set<Listener>` + 等待表 Map），不依赖 iframe bridge。`remote-iframe-bridge` 只是它的一个订阅者。助手路径可直接复用：

```ts
// assistant-chat.ts runAssistantChat 内
const result = await runAgentRuntimeTurn(
  {
    // ... 现有 onDelta/onRoundEnd/onTool ...
    onAskUser: (requestId, request) =>
      emitInteractionRequest(requestId, request.question, request.options, request.allowCustom),
  },
  // ...
)
```

这样助手和游戏共用同一套阻塞式问答机制，只是**订阅方不同**：游戏走 remote-iframe-bridge 转给 iframe 前端，助手走 AssistantView 进程内订阅。

### 3.3 abort 清理

游戏路径在 turn abort 时调 `rejectAllInteractionRequests`（`index.ts:729`）清等待表。助手路径需在对应 abort 点（assistant-chat 的 signal abort / error 路径）同样调用，防止 ask_user 等待 Promise 悬空。

## 4. UI 层：重新分组 + 补齐 + 助手 ask 渲染

### 4.1 开关控件分组（两个面板共用结构）

D5 定的 3 组结构。把两个面板各自硬编码的 `platformToolControls` 扁平数组，统一为带分组结构的数据。建议抽一个共享定义，避免两面板再分叉：

```ts
// 新建 apps/platform-web/src/agent-runtime/tool-controls.ts（或放 permissions 旁）
export interface PlatformToolControl {
  id: AgentPlatformToolName
  label: string
  description: string
}
export interface PlatformToolControlGroup {
  title: string
  tools: PlatformToolControl[]
}
export const PLATFORM_TOOL_CONTROL_GROUPS: PlatformToolControlGroup[] = [
  {
    title: "协作与交互",
    tools: [
      { id: "agent_call", label: "Agent 协作", description: "..." },
      { id: "ask_user", label: "向用户提问", description: "允许向用户发起提问并等待回答（阻塞式）。助手默认启用，游戏内 agent 默认关闭。" },
    ],
  },
  {
    title: "Workspace",
    tools: [
      { id: "workspace_read", label: "读取 Workspace", description: "..." },
      { id: "workspace_write", label: "维护 Workspace", description: "..." },
      { id: "workspace_semantic_search", label: "语义检索", description: "..." },
    ],
  },
  {
    title: "前端自检",
    tools: [
      { id: "inspect_frontend", label: "前端自检", description: "..." },
    ],
  },
]
```

两面板的 `<section>` 改为按 `PLATFORM_TOOL_CONTROL_GROUPS` 渲染：外层 `v-for` 组，组标题用现有 `font-mono text-[11px] uppercase tracking-wider text-neon-muted` 风格，内层 `v-for` tool。

### 4.2 两面板补齐

- **AssistantConfigPanel.vue**：当前缺 `workspace_semantic_search`（StudioView 有），分组结构接入后自动补齐。
- **StudioView.vue**：当前缺 `ask_user`，分组结构接入后自动补齐。
- 两面板的 `platformToolControls` 局部定义都替换为引用共享 `PLATFORM_TOOL_CONTROL_GROUPS`。

### 4.3 助手 ask 渲染 UI（AssistantView）

助手调用 ask_user 时，需在对话流里渲染提问卡片 + 玩家回答入口。复用 `interaction-events.ts` 的 `subscribeInteractionRequest`：

**数据流：**
```
助手模型调 ask_user
  → assistant-chat onAskUser = emitInteractionRequest(requestId, ...)
  → emitInteractionRequest 把 {requestId, question, options, allowCustom} 推给订阅方，返回阻塞 Promise
  → AssistantView 订阅 subscribeInteractionRequest，收到请求 → 渲染 ask 卡片插入 timeline
  → 玩家点选项 / 填自定义输入 / 取消
  → AssistantView 调 resolveInteractionRequest(requestId, answer, cancelled)
  → emitInteractionRequest 的 Promise resolve → ask_user 工具拿到答案继续 turn
```

**渲染形态：** ask 卡片作为 timeline 的一个节点类型插入（和 thought/tool/content 节点并列）。卡片含：
- 问题文本（question）
- 选项按钮列表（options，若有）
- 自定义输入框 + 提交按钮（allowCustom 为 true 时）
- 取消按钮
- 已回答后卡片转为只读态显示玩家选择

**与 useAssistantTimeline 的集成：** ask 请求到来时 timeline 插入一个 `type: "ask"` 节点；玩家回答后更新该节点为已答态。useAssistantTimeline 需扩展支持 ask 节点类型。

**生命周期：** AssistantView `onMounted` 订阅、`onBeforeUnmount` 取消订阅，避免重复订阅泄漏。

### 4.4 游戏前端 ask-panel 保持不动

D3 保留游戏路径，remote-iframe-bridge 订阅 + game iframe 的 ask-panel 渲染原样不动。

## 5. 数据流总图

```
┌─ 助手路径 ─────────────────────────────────────────────────┐
│ AssistantView                                            │
│   subscribeInteractionRequest → 渲染 ask 卡片            │
│        ↑                          ↓ 玩家回答             │
│        │                          │                      │
│   emitInteractionRequest ←─────────┘ resolveInteraction  │
│        ↑ (阻塞 Promise)                                   │
│ assistant-chat onAskUser = emitInteractionRequest         │
│        ↑                                                  │
│   runAgentRuntimeTurn → ask_user 工具执行                 │
│   schema 由 buildEnabledToolSchemas 门控（ask_user 权限）│
└───────────────────────────────────────────────────────────┘

┌─ 游戏路径（保留，默认关）─────────────────────────────────┐
│ game iframe ask-panel                                     │
│        ↑                          ↓ 玩家回答             │
│ remote-iframe-bridge 订阅 ───────→ interaction.respond    │
│        ↑                          │                      │
│   emitInteractionRequest ←─────────┘ resolveInteraction  │
│        ↑                                                  │
│ platform-host onAskUser = emitInteractionRequest          │
└───────────────────────────────────────────────────────────┘

两路径共享 interaction-events.ts 事件总线（emit/resolve/reject + 等待表）
```

## 6. 兼容性与迁移

- **无数据迁移**：agent.json 现有 `platformTools.enabled/disabled` 数组结构不变，`ask_user` 只是新增可选条目。
- **默认态行为变化**：游戏 agent 若之前依赖 native 模式 ask_user 永远可见（罕见，因 text 模式主力），升级后默认不可见。需在 release note 注明。这是预期行为修正（D2/D4）。
- **回滚**：权限层和 schema 层改动独立，回滚时恢复 `DEFAULT_AGENT_PLATFORM_TOOLS` 单数组 + `askUserSchema` 无条件 push 即可恢复原行为。UI 层改动不影响数据兼容。

## 7. 关键文件改动清单

| 层 | 文件 | 改动 |
|---|---|---|
| 权限 | `agent-runtime/permissions.ts` | 加 askUser 常量；默认态按 agent 类型派生 |
| runtime | `agent-runtime/tool-schemas.ts` | askUserSchema 受门控 |
| runtime | `platform-host/assistant-chat.ts` | 绑定 onAskUser = emitInteractionRequest；abort 清理 |
| UI 共享 | `agent-runtime/tool-controls.ts`（新建）| 分组控件定义 |
| UI | `components/assistant/AssistantConfigPanel.vue` | 用分组控件；补齐 semantic_search |
| UI | `views/StudioView.vue` | 用分组控件；补齐 ask_user |
| UI | `views/AssistantView.vue` | 订阅 interaction-request；渲染 ask 卡片；回答回填 |
| UI | `composables/useAssistantTimeline.ts`（若存在）| 扩展 ask 节点类型 |

## 8. 待确认实现细节（实现期已全部核实）

- ~~`useAssistantTimeline` 的确切文件位置与节点类型定义结构~~ → 已确认 `apps/platform-web/src/composables/useAssistantTimeline.ts`，判别联合 `AssistantTimelineNode`，加 `ask` 类型直接。
- ~~AssistantView abort/signal 路径里 `rejectAllInteractionRequests` 的最佳插入点~~ → 已确认 `assistant-chat.ts` catch 块（turn 失败/abort/timeout 统一清理点）。
- ~~`DEFAULT_AGENT_PLATFORM_TOOLS` 常量是否被 permissions.ts 之外的文件引用~~ → 已确认仅 permissions.ts 内部使用，已安全替换为分类常量 + 派生函数。
