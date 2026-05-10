# Design: Prompt Preset System + AI Workflow Engine

> 本文件给出本次变更的"零决策"约束集，所有结论均已对齐用户输入；后续 `/ccg:spec-plan` 直接据此排任务，不再开放设计选择。

## 1. fast-tavern 接入清单（阶段 G）

### 1.1 复制范围（保留）

按 `F:/workspace/.tsian-research/fast-tavern/npm-fast-tavern/src/` 树原样复制至 `packages/prompt-engine/src/`：

| 路径 | 行数 | 留 / 改 |
|------|-----|--------|
| `core/types.ts` | 380 | 留（CharacterCard 实为 Tsian 模组主角资源容器，详见本表后说明） |
| `core/convert.ts` | 56 | 留 |
| `core/modules/history/{factories,guards,index}.ts` | 34+ | 留 |
| `core/modules/worldbook/{getActiveEntries,index}.ts` | 198+ | 留 |
| `core/modules/regex/{applyRegex,mergeRegexRules,index}.ts` | 197+ | 留 |
| `core/modules/macro/{replaceMacros,index}.ts` | 72+ | 留（这是 Tsian 占位符注入点） |
| `core/modules/assemble/{assembleTaggedPromptList,index}.ts` | 149+ | 留 |
| `core/modules/build/{buildPrompt,buildPromptFromSillyTavern,index}.ts` | 275+ | 留 |
| `core/modules/inputs/normalizeWorldbooks.ts` | 145 | 留 |
| `core/modules/inputs/normalizeRegexes.ts` | 136 | 留 |
| `core/modules/inputs/convertFromSillyTavern.ts` | 784 | 留（CharacterCard 保留，convertCharacterFromSillyTavern 不删） |
| `core/modules/pipeline/*` | 98+ | 留 |
| `core/modules/variables/*` | 256+ | 留 |
| `core/channels/{detect,gemini,openai,text,tagged,index}.ts` | 全留 | **保留 gemini channel 与 parts 内部表示**（修订记录见本表后说明） |
| `index.ts` | 16 | 留 |

**约束（合并原"剥离改造点"为"语义校准"）**：

1. 不引入 npm 依赖；`packages/prompt-engine/package.json` 仅声明 `"type": "module"` + 必要 devDeps（typescript），与现有包风格一致。
2. 体积评估：保留 CharacterCard 路径后，预计 ~2796 行 / 33 文件 / Vite 浏览器打包目标仍 < 100 KB gzip。

**CharacterCard 保留说明（2026-05-10 修订）**：原稿要求"删 `interface CharacterCard` + 剥离 CharacterCard 分支"。修订后保留全部 CharacterCard 路径，理由：

- **CharacterCard 实为 worldBook + regexScripts + `{{char}}` 宏的资源容器**——`buildPrompt` 实际只消费 `name` / `worldBook` / `regexScripts` 三个字段（见 `core/modules/build/buildPrompt.ts:82-168`），其余字段（`description` / `avatar` / `message` / `other` / `chatDate` / `createDate`）仅在 ST 转换时填充，不参与 prompt 流程
- **从 Tsian 视角看，CharacterCard 等价于"模组主角资源容器"**：`name` 对应玩家选定的扮演对象；`worldBook` 对应模组级 lorebook（与运行时 archives 解耦的静态背景）；`regexScripts` 对应模组约定的输出后处理（剥 `<thinking>` 标签等）；`message[]` 对应开场白预设
- **删除会破坏世界书优先级路径**：`getActiveEntries` 区分 `'global'` vs `'character'` source（line 187 排序），删 character.worldBook 等于把这条路径合并进 globals，丢失模组级 lorebook 的独立性
- **Group Chat / Quick Reply 误指**：fast-tavern 中 `groupChat` 仅指 `UtilityPrompts.newGroupChatPrompt` 一个字符串字段（无业务分支），`quickReply` 在源码中 0 命中。两者均无需剥离

详见自动记忆 `project_g2_character_card_findings.md`。

**gemini channel 保留说明（2026-05-10 修订）**：原稿写"删 gemini 渠道（Tsian AI 出口统一走 OpenAI 兼容）"。修订后保留全部 channels（含 `gemini.ts`）与 `OutputFormat`/`MessageFormat` 联合中的 `'gemini'` 字面量，理由：(a) Tsian 用户的提供商池本身多样化（OpenAI / Anthropic / Gemini / Mistral 等），强行只走 OpenAI 兼容会牺牲一部分用户；(b) 未来要支持多模态（生图、语音），依赖 `MessagePart.inlineData` / `fileData` 的 parts 出口；(c) gemini 的 parts 形式同时是 fast-tavern 的内部统一表示，物理保留更安全。详见自动记忆 `feedback_multi_channel_support.md`。

### 1.2 新增 Tsian 高层 API（在 `packages/prompt-engine/src/tsian/`）

```ts
// packages/prompt-engine/src/tsian/assemble.ts
import type {
  PresetInfo,
  WorldBook,
  RegexScriptData,
  ChatMessage,
} from '../core/types'

export interface AssembleInput {
  preset: PresetInfo
  worldBooks?: WorldBook[]            // 可选：模组传入 lorebook
  regexScripts?: RegexScriptData[]    // 可选：preset 已带，可叠加
  history?: ChatMessage[]             // 上一轮历史 / 当前 user input 也走这里（fast-tavern 原生类型）
  macros: Record<string, string>      // Tsian 占位符（key 可含点路径如 "node:retrieval.events"）
  channel?: 'openai' | 'text' | 'tagged' | 'gemini'  // 默认 'openai'；gemini 渠道保留供 Google Gemini 等 parts 风格 API 与未来多模态出口使用
  view?: 'user' | 'model'             // 默认 'model'。决定哪些 view-filtered 正则脚本生效：'model' 用于发给 LLM 的 prompt（三段链主用例），'user' 用于给玩家渲染的版本。模组/玩家自定义节点可显式覆盖
}
export interface AssembleOutput {
  messages: ChatMessage[]   // 按 channel 序列化后的最终消息列表（openai/gemini 是结构化数组；text/tagged 退化为单条合并消息）
  rendered: string          // 调试用纯文本视图（text channel 直接给字符串；其它 channel 给 JSON.stringify(messages, null, 2)）
}
export function assemblePromptFromPreset(input: AssembleInput): AssembleOutput
```

实现 = 包装 fast-tavern 的 `buildPrompt()`（`core/modules/build/buildPrompt.ts`），把 `AssembleInput` 映射到 `BuildPromptParams`，从 `result.stages.output.afterPostRegex` 取最终 channel 序列化结果。`buildPrompt` 内部已编排 `convert → assemble → macro → regex → channel-out` 完整 pipeline，assemble 这层只负责字段映射 + 默认值 + rendered 字符串生成，不改 pipeline 顺序。

**字段映射表**（AssembleInput → BuildPromptParams）：

| AssembleInput | BuildPromptParams | 备注 |
|---|---|---|
| `preset` | `preset` | 直传 |
| `worldBooks` | `globals.worldBooks` | 包装进 globals |
| `regexScripts` | `globals.regexScripts` | 包装进 globals |
| `history` | `history` | 直传（fast-tavern 内部已做 toInternalHistory 归一化） |
| `macros` | `macros` | 直传（buildMacros 自动合并 char 宏） |
| `channel ?? 'openai'` | `outputFormat` | 字面量 1:1 映射 |
| `view ?? 'model'` | `view` | 默认 'model' |

**rendered 字段生成规则**：

- `channel === 'text'`：`stages.output.afterPostRegex` 已经是 `string`，直接返回
- 其它 channel：`JSON.stringify(stages.output.afterPostRegex, null, 2)`

**修订记录（2026-05-10）**：原稿 (a) `history?: ChatHistoryEntry[]` 类型未定义，已改为 fast-tavern 原生 `ChatMessage[]`；(b) 未暴露 `view` 字段（buildPrompt 必填），已补充并默认 `'model'`，理由见自动记忆 — Tsian AI 节点自定义场景下模组/玩家可能选 `'user'` 视图；(c) "包装 convert + replaceMacros + applyRegex" 的实现说明改为"包装 buildPrompt"，等价但不重写 pipeline，契合 G1 "原样复制 + 不改 core" 目标。

## 2. 占位符命名空间设计

**结论：方案 c（macros KV 方案）—— 不改 fast-tavern 解析，靠 Tsian 注入端约定 key 格式。**

- fast-tavern 的 `replaceMacros(text, macros: Record<string, string>)` 是纯字符串替换，对 `{{key}}` / `<<key>>` 形式做扁平 KV 查找，**key 允许包含 `.` `:` 等任意字符**。
- 因此 Tsian 在注入时按"命名空间前缀 + 点路径"组织 key，不和 fast-tavern 内置宏（`{{user}}` / `{{char}}` / `{{lastMessage}}` 等）冲突：

| key 形态 | 含义 | 来源 |
|----------|------|------|
| `{{user.input}}` | 本轮用户输入 | 平台内置 |
| `{{user.name}}` | 玩家名（默认 "玩家"） | 平台内置 |
| `{{narrative.currentTime}}` | 当前叙事时间 `YYYY-MM-DD HH:mm` | 平台内置 |
| `{{narrative.formattedTime}}` | 自然语言时间 | 平台内置 |
| `{{globals.<key>}}` | runtime globals 路径取值（JSON.stringify） | 平台内置 |
| `{{archives.<id>.name}}` | 档案字段直取 | 平台内置 |
| `{{archives.recent.json}}` | 最近相关档案 JSON | 平台内置 |
| `{{events.recent.json}}` | 最近事件 JSON | 平台内置 |
| `{{events.active.json}}` | 当前进行中事件 | 平台内置 |
| `{{retrieval.prompt}}` | 检索节点完整拼装 | retrieval 节点输出 |
| `{{retrieval.directEntities.csv}}` | 命中实体名列表 | retrieval 节点输出 |
| `{{node:<nodeId>.<portName>}}` | 上游节点端口注入 | 边注入（最高优先级） |
| `{{lastReply}}` | 上一轮 assistant 回复 | 平台内置 |

边注入优先级 > 平台内置；同名 key 后写覆盖前写。

## 3. 平台内置占位符集（原型期清单）

| key | 类型 | 描述 |
|-----|------|------|
| `user.input` | string | 本轮 user 消息原文 |
| `user.name` | string | 玩家显示名 |
| `narrative.currentTime` | string | `YYYY-MM-DD HH:mm` |
| `narrative.formattedTime` | string | 自然语言（"未设置" 兜底） |
| `globals.<path>` | string | JSON.stringify 后的 globals 字段（路径不存在 → 空字符串 + warn） |
| `events.recent.json` | string | 最近 N 条事件 JSON 数组（N 由 retrievalSettings.maxInjectedEvents 控制） |
| `events.active.json` | string | 当前进行中事件 JSON |
| `archives.recent.json` | string | 检索命中的档案 JSON |
| `archives.player.json` | string | 玩家档案（如果已 mark） |
| `lastReply` | string | 上一轮 assistant content |
| `history.recent.json` | string | 最近 N 条 ConversationMessageRecord |
| `meta.modId` | string | 当前激活模组 id |
| `meta.turn` | string | 当前回合数 |

模组通过 `manifest.customMacros` 声明的额外 key 走相同注入流程，由引擎按 `globals.<path>` 路径取值（HC-11）。

## 4. 节点提取规则（敲定字段）

```ts
// packages/contracts/src/workflow.ts
export type NodeOutputExtractRule =
  | { type: "tag"; tag: string; parse?: "json" | "number" }
  | { type: "regex"; pattern: string; flags?: string; group?: number; parse?: "json" | "number" }
  | { type: "raw"; parse?: "json" | "number" }

export interface NodeOutputDeclaration {
  name: string                        // 端口名（边里 from.outputName 引用）
  extract: NodeOutputExtractRule
}
```

- `tag` 提取：从 AI 文本中匹配第一个 `<{tag}>...</{tag}>` 内部字符串（贪婪到最近的 `</{tag}>`）。
- `regex` 提取：用 `new RegExp(pattern, flags)` 在文本中执行 `.match()`，返回 `match[group ?? 0]`。
- `raw` 提取：返回完整 AI 原始文本。
- `parse: "json"` → `JSON.parse`，失败抛错（触发节点重试）。
- `parse: "number"` → `Number(value)`，`NaN` 抛错。

## 5. 重试机制具体参数

- 节点级重试：默认 `maxRetries = 1`（即首次失败后再尝试一次，共 2 次），可在节点 `config.retry.maxRetries` 覆盖。
- 失败判定：抛错 / `compute` 超时 / `compute` return undefined / 提取规则解析失败 / AI HTTP 错误。
- 失败后行为统一：节点最终标记 `status: "failed"`，写入 outputs store 中该 nodeId 的 `error` 字段；下游消费者得到的端口值是 `undefined`，自行处理"未到达"。
- 不分级（chat 失败弹错 / retrieval 失败降级 / maintenance 失败 warn）—— 由模组在 prompt / workflow 层显式表达（例如 `switch` 节点根据上游 `error` 字段路由到兜底分支）。
- abort 行为：下一轮 `sendMessage` 调用进入工作流执行前，对上一轮 `AbortController.abort()`，所有未 settle 的节点 promise 进入 rejected → 写入 `status: "aborted"`。

## 6. 结果存储 reactive 实现

```ts
// apps/platform-web/src/workflow-host/outputs-store.ts
export interface NodeOutputState {
  status: "pending" | "running" | "succeeded" | "failed" | "aborted"
  outputs?: Record<string, unknown>   // 端口名 → 值
  error?: { code: string; message: string }
  startedAt?: number
  finishedAt?: number
}
export type WorkflowOutputsStore = ShallowRef<{
  nodes: Record<string, NodeOutputState>
  results: Record<string, unknown>    // type='result' 节点的 config.name → 当前值
  turn: number
}>
```

- 选 `shallowRef` 不选 `ref`：避免对节点 outputs 内的对象做深响应（节点输出可能是大段 retrieval JSON / archives 数组）。
- 不引入 Pinia：单回合生命周期 + 单文件可见，Pinia 是过度设计。
- 写入策略：节点状态变更时整体替换 `nodes[nodeId]`，触发 shallowRef 更新。
- 前端订阅：`watchEffect(() => store.value.results['reply'])` 即可拿到正文 AI 输出。

## 7. 模组 manifest 扩展字段

```ts
// packages/contracts/src/runtime.ts (扩展 ModStaticContent / ModManifest)
export interface ModManifest {
  // ...既有字段...
  workflow?: WorkflowDefinition
  presets?: Record<string, PresetInfo>          // 按 key 索引；ai-call 节点 config.presetId 引用
  customMacros?: Record<string, string>         // { "weatherStat": "globals.weather.kind" }
  customNodeTypes?: never                       // 原型期保留口，工程上禁用（编译期强制 never）
}

export interface WorkflowDefinition {
  nodes: WorkflowNode[]
  edges: WorkflowEdge[]
}

export type WorkflowNodeType = "ai-call" | "result" | "switch" | "apply-patch" | "compute"

export interface WorkflowNodeBase<T extends WorkflowNodeType = WorkflowNodeType> {
  id: string
  type: T
  config: Record<string, unknown>
  retry?: { maxRetries: number }
  outputs?: NodeOutputDeclaration[]   // ai-call / compute 用；其它节点忽略
}

export type AiCallNodeConfig = {
  presetId: string                                  // 引用 manifest.presets[key]
  worldBookKeys?: string[]                          // 启用哪些 lorebook
  appendUserInput?: boolean                         // 是否把 user.input 追加到 messages
}

export type ResultNodeConfig = { name: string }     // 写入 outputs.results[name]

export type SwitchNodeConfig = {
  cases: Array<{ when: string; outputName: string }>  // when = 简单等值字符串匹配（原型期）
  defaultOutputName?: string
}

export type ApplyPatchNodeConfig = {
  patchVarName: string                              // 从 inputs[patchVarName] 取 patch JSON
  pushCheckpointReason?: string                     // 默认 "after-turn"
}

export type ComputeNodeConfig = {
  script: string                                    // function body string
  timeout?: number                                  // 默认 5000
}

export interface WorkflowEdge {
  from: { nodeId: string; outputName?: string }
  to:   { nodeId: string; varName: string }
  condition?: string                                // 原型期：简单字符串等值匹配上游端口值
}
```

## 8. 平台默认工作流（兜底）

模组未声明 workflow 时使用，复刻当前 3 段链路：

```ts
// apps/platform-web/src/workflow-host/default-workflow.ts
{
  nodes: [
    { id: "retrieval", type: "ai-call", config: { presetId: "builtin.retrieval" }, outputs: [
      { name: "prompt", extract: { type: "raw" } },
      { name: "directEntities", extract: { type: "tag", tag: "directEntities", parse: "json" } }
    ] },
    { id: "chat", type: "ai-call", config: { presetId: "builtin.chat", appendUserInput: true } },
    { id: "reply", type: "result", config: { name: "reply" } },
    { id: "maintenance", type: "ai-call", config: { presetId: "builtin.maintenance" }, outputs: [
      { name: "patch", extract: { type: "raw", parse: "json" } }
    ] },
    { id: "applyPatch", type: "apply-patch", config: { patchVarName: "patch", pushCheckpointReason: "after-turn" } }
  ],
  edges: [
    { from: { nodeId: "retrieval", outputName: "prompt" }, to: { nodeId: "chat", varName: "retrieval.prompt" } },
    { from: { nodeId: "chat", outputName: "raw" },         to: { nodeId: "reply", varName: "value" } },
    { from: { nodeId: "chat", outputName: "raw" },         to: { nodeId: "maintenance", varName: "lastReply" } },
    { from: { nodeId: "retrieval", outputName: "directEntities" }, to: { nodeId: "maintenance", varName: "directEntities" } },
    { from: { nodeId: "maintenance", outputName: "patch" }, to: { nodeId: "applyPatch", varName: "patch" } }
  ]
}
```

内置三个 preset 文件以 JSON 形式存放：

- `apps/platform-web/src/workflow-host/builtin-presets/retrieval.preset.json` — 当前 retrieval prompt 拼装翻译为 PresetInfo
- `apps/platform-web/src/workflow-host/builtin-presets/chat.preset.json` — 当前 chat system prompt（直接消费 `{{retrieval.prompt}}`）
- `apps/platform-web/src/workflow-host/builtin-presets/maintenance.preset.json` — 当前 `buildMaintenancePrompt` 翻译为 PresetInfo（保留 50 行 schema 约束作为 system prompt 内容）

## 9. 与 platform-host/index.ts 解耦方案

### 9.1 `interaction.sendMessage` 改写

```ts
// 伪代码
async sendMessage(input) {
  const activeSaveId = await getActiveSaveId()
  if (!activeSaveId) {
    // 无激活存档：回退最简交互（不跑工作流，直接调 baseBridge）
    await baseBridge.interaction.sendMessage(input)
    return { snapshot: await runtimeEngine.getSnapshot() }
  }

  abortPreviousTurn()  // 取消上一轮还没 settle 的节点
  const workflow = resolveWorkflow(activeSaveId)  // 模组 manifest.workflow ?? defaultWorkflow
  const macros = await buildBuiltinMacros(activeSaveId, input)  // 平台内置占位符全集
  const store = createOutputsStore()
  await workflowEngine.execute({ workflow, macros, store, signal: currentAbortController.signal })
  await persistAfterTurn(activeSaveId, store)  // snapshot/history/checkpoint 持久化（patch 已由 apply-patch 节点写完）
  return { snapshot: await runtimeEngine.getSnapshot() }
}
```

### 9.2 `persistActiveSnapshot` 拆分

- 旧职责：调维护 AI + 应用 patch + 持久化 snapshot/history/checkpoint。
- 新职责：**只**持久化 snapshot/history/checkpoint。维护 + apply 由工作流节点完成。
- 重命名为 `persistAfterTurn`，改名提示职责变更。

### 9.3 `LocalRuntimeEngine` 接口收敛

去掉 `sendMessageWithContext({ prompt })`，新增/保留：

- `getSnapshot()`、`loadSnapshot()`、`applyRuntimeStatePatch()` 保留
- 新增 `appendUserMessage(content)` / `appendAssistantMessage(content)` —— 工作流节点调用
- 旧 `sendMessage()` 保留但改为内部调用：先 append user，再调 `generateAssistantReply`，再 append assistant（仅给"无激活存档"兜底分支用，不再跑维护链）

## 10. compute 节点最小工程约束实现

```ts
// apps/platform-web/src/workflow-host/nodes/compute.ts
async function executeCompute(node, inputs, macros, signal) {
  const fn = new Function(
    "{ inputs, macros }",
    `"use strict"; return (async () => {\n${node.config.script}\n})()`,
  ) as (arg: { inputs: any; macros: any }) => Promise<unknown>

  const timeout = node.config.timeout ?? 5000
  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error("compute timeout")), timeout),
  )

  let outputs: unknown
  try {
    outputs = await Promise.race([fn({ inputs, macros }), timeoutPromise])
  } catch (e) {
    throw e   // → 节点级 retry / failed
  }

  if (signal.aborted) throw new Error("aborted")
  if (outputs === undefined) throw new Error("compute returned undefined")
  if (typeof outputs !== "object" || outputs === null) {
    throw new Error("compute must return an object (outputs map)")
  }

  return outputs as Record<string, unknown>
}
```

约束：

1. 函数体用 `new Function`，不暴露 `RuntimeEngine` / `globalThis.tsian` 引用（HC-1）。
2. 5000 ms 超时（SC-6）。
3. try/catch 包裹，失败走节点重试。
4. 节点级 ref 隔离：每个 compute 节点拿到的 `inputs` 是从边注入的浅拷贝；写入 outputs store 时整体替换。

不做：完整 JS 沙箱（QuickJS / Sval / SES），fetch / DOM 拦截。

## 11. 测试模组接入计划（最小测试模组应包含什么）

主人将另行决定具体模组主题。最小测试模组的 manifest 应包含：

1. **manifest.id / name / version** — 标准字段
2. **manifest.presets**：至少 3 个 PresetInfo（retrieval / chat / maintenance），可直接复用平台内置 builtin-presets 的副本
3. **manifest.workflow**：至少 1 个非默认形态，验证模组工作流替换生效。例如：
   - 在 retrieval 与 chat 之间插入一个 `compute` 节点（清洗 retrieval 输出）
   - 或者 retrieval 后并行两个 ai-call（normal chat + alternate chat），由 switch 选其一进 result
4. **manifest.customMacros**：至少声明 1 个，验证路径映射注入（如 `weatherKind: globals.world.weather`）
5. **初始 archives + events**：与 grey-salt-town 同等规模（5-10 个 archive，3-5 个 catalog event），保证 retrieval 评分有素材
6. **首条 message / 开场白** — 同 grey-salt-town
7. **构建 + 装载验收清单**：
   - `npm run build:web` 通过
   - 启动后能选择该模组并创建新存档
   - 一轮交互后 `result` 节点输出在前端可见
   - 调试面板能看到工作流节点状态机变迁
   - 删除模组的 `manifest.workflow` 后能跑默认工作流，作为 sanity check

## 12. 前端写运行时桥 API（阶段 I）

**决策摘要（2026-05-10）：**
- A-1：桥 API 直接复用 patch 应用器（不绕一层 apply-patch 节点）
- B-2 拆下一阶段：fragment / nodeId 触发不在本次 change
- C-1：数据回流全走 `globals`（HC-12 复用）
- D-1 局部：A 入本次 change，B 拆下一个 change

### 12.1 patch 应用器抽离

把目前散落在 `platform-host/index.ts` 中的"应用 patch"代码（`applyArchivePatchesForSave` / `applyEventPatchForSave` / `runtimeEngine.applyRuntimeStatePatch` 三连）抽成纯函数：

```ts
// apps/platform-web/src/runtime-host/patch-applier.ts
export interface ApplyPatchInput {
  patch: MaintenancePatchDocument
  runtimeEngine: LocalRuntimeEngine
  saveId: string
  // 应用器内部读 archives / events / globals 当前快照，不需要外部传
}
export interface ApplyPatchOutput {
  appliedArchives: string[]
  appliedEventIds: string[]
  globalsChanged: boolean
  currentTimeChanged: boolean
}
export async function applyMaintenancePatch(input: ApplyPatchInput): Promise<ApplyPatchOutput>
```

**两个调用方共用：**
- `apply-patch` 节点（工作流路径）：`await applyMaintenancePatch({ patch: inputs[patchVarName], runtimeEngine, saveId })`
- 桥 API `bridge.runtime.applyPatch(patch)`（前端路径）：同样调 `applyMaintenancePatch`

fail loud 收口在 `applyMaintenancePatch` 内部——`MaintenancePatchDocument` schema 不合 / 引用不存在的 archive id / currentTime 倒退等情况，直接 throw。

### 12.2 桥 API 扩展（`PlayFrontendBridge.runtime`）

```ts
// packages/contracts/src/bridge.ts
export interface PlayFrontendBridge {
  // ...既有...
  runtime: {
    // 既有：getSnapshot / loadSnapshot / ...
    /** 提交一个完整 MaintenancePatchDocument，由平台 patch 应用器写入运行时 */
    applyPatch(patch: MaintenancePatchDocument): Promise<ApplyPatchOutput>
    /** 便捷写 globals 单字段，内部包成 patch 走 applyMaintenancePatch */
    updateGlobals(path: string, value: unknown): Promise<void>
    /** 在不触发工作流的前提下追加用户消息 / assistant 消息（前端做了局部计算后想留痕） */
    appendUserMessage(content: string): Promise<void>
    appendAssistantMessage(content: string): Promise<void>
  }
}
```

### 12.3 数据回流路径

前端做完计算 → 调 `bridge.runtime.applyPatch(patch)` 或 `updateGlobals(path, value)` → 数据落到 `globals / archives / events` 三大运行时数据 → **下一轮工作流**通过 `{{globals.xxx}}` / `{{archives.xxx}}` 占位符自动消费。

不引入"前端临时数据袋"——`globals` 已经是非实体全局状态的真源，再加一层会违反 KISS 与 HC-12。

### 12.4 与 HC-13 的关系

HC-13 原文："Mod cannot register a `type='apply-patch'` node. Writing runtime is platform-only authority."

桥 API 的写入仍然是**平台权威**——`bridge.runtime.applyPatch` 是平台代码，不是模组代码。模组前端能调它，但不能旁路它。约束变化：

- **HC-13 修订**：写运行时入口收口在 `apps/platform-web/src/runtime-host/patch-applier.ts` 的 `applyMaintenancePatch` 函数。`apply-patch` 节点与 `bridge.runtime.applyPatch` 都是该函数的客户端，不可绕过。
- **HC-1 不变**：compute 节点仍然不能拿 RuntimeEngine 引用、不能调桥 API、不能写运行时。
- **新增 HC-14**：桥 API 写运行时与 `apply-patch` 节点必须共用同一份 patch 应用器代码；任何一方有特殊处理（前置校验、后置 hook）都必须放在 `applyMaintenancePatch` 内部，不允许其中一个调用方包一层差异化逻辑。

### 12.5 验收清单

- 模组前端可以在不调 `bridge.interaction.sendMessage` 的前提下，通过 `bridge.runtime.updateGlobals("inventory.gold", 100)` 写入 globals
- 下一轮 `sendMessage` 触发工作流时，AI prompt 的 `{{globals.inventory.gold}}` 占位符能取到 100
- `bridge.runtime.applyPatch` 提交一个非法 patch（引用不存在的 archive id）时立刻 throw，前端可见错误
- `apply-patch` 节点执行同样的非法 patch 时表现一致（同样 throw / 同样错误信息）—— 验证两路径共用应用器

---

## 13. Resolved Constraints from Plan Phase

> 本节为 `/ccg:spec-plan` 阶段补齐的"零决策"约束钉子，覆盖 §1-§12 中残留的隐含点。多模型分析在本机环境下因 codex CLI ↔ ace-tool 集成不稳定（4/4 SSE 断流）放弃；现有 `_research-notes.md` 28 项条目 + 本节 9 条钉子已足够锁死实现路径，跳过外部 AI 分析的边界由用户明确授权。

### 13.1 `applyMaintenancePatch` 内部应用顺序与原子性

- 顺序固定：`currentTime → globals → archives → events`
  - 理由：archives 可能引用 globals 中的状态；events 可能引用刚被 patch 落地的 archives
- **不做回滚**（HC-9 fail loud + HC-10 no migration）：任何子项 apply 失败立即 throw 并把已 apply 的部分留在原地
- 调用方约束（apply-patch 节点 / bridge API）：**禁止 catch + 重试**；失败由调用栈向上抛到玩家界面，由玩家重发完整 patch
- `ApplyPatchOutput.appliedArchives / appliedEventIds` 只反映成功 apply 的项；失败时这些字段仍然返回（但调用方拿不到，已 throw）

### 13.2 switch 节点 `condition` 语法

- `condition` 是字面量字符串
- 匹配规则：`String(upstreamValue) === condition`，无字段路径访问，无表达式
- 想按 `globals.x` 分支：先放一个 compute 节点提取，再喂 switch
- 多分支：每个 switch 节点本身只判一个值；多路分支用多个 switch 串联或并联

### 13.3 `ApplyPatchOutput` 暴露面

- 桥 API：`bridge.runtime.applyPatch(patch)` 返回完整 `ApplyPatchOutput`
- `apply-patch` 节点：暴露 4 个输出端口，命名严格对齐：
  - `appliedArchives: string[]`
  - `appliedEventIds: string[]`
  - `globalsChanged: boolean`
  - `currentTimeChanged: boolean`
- 两路径返回结构完全相同（HC-14 要求）

### 13.4 工作流加载期校验清单

工作流定义在被首次执行**之前**必须通过下列校验，任一失败立刻 throw（不允许延迟到执行期）：

1. 节点 ID 全局唯一（同一工作流内）
2. 无环：拓扑排序成功
3. 无悬挂边：`edge.from.nodeId` 与 `edge.to.nodeId` 都必须存在于 `nodes`
4. 节点类型必须在五元组 `ai-call | result | switch | apply-patch | compute` 内（HC-13 + SC-CRIT-6）
5. `apply-patch` 节点的来源必须是平台默认工作流，**不允许**来自 `mod.manifest.workflow`（HC-13）
6. 同一工作流内，`result` 节点的 `config.name` 必须唯一

### 13.5 宏（macros）冲突解决顺序

宏键值的最终覆盖顺序（**后写覆盖前写**）：

```
platform-builtin  <  mod.manifest.customMacros  <  edge-injection
```

- 平台内置宏（如 `{{user.input}} / {{globals.xxx}} / {{archives.xxx}}`）由 platform-host 在工作流执行前组装
- 模组 `customMacros` 在 `buildBuiltinMacros` 之后合入；同名 key 模组覆盖平台
- 边注入（`varName` → 节点端口值）在节点执行前合入；同名 key 边注入覆盖前两层
- 模组 customMacros 若声明 `user.input`，模组生效；但被节点的 edge `varName: "user.input"` 进一步覆盖

### 13.6 `appendUserMessage` / `appendAssistantMessage` 与 `state.turn`

- 这两个方法**不**递增 `state.turn`
- `state.turn++` 仅由工作流引擎在 `sendMessage` **入口**触发（platform-host.sendMessage 调用 workflow.execute 之前）
- 桥 API 调用方对"挂着的用户消息"自负其责：要么紧接着调 `sendMessage` 走完工作流，要么接受这条 user 消息悬挂在 `state.messages` 中
- 这两个方法只 mutate `state.messages` 与持久化记录，不触发工作流

### 13.7 outputs 全局存储跨轮生命周期

- `outputsStore` 是 `shallowRef<OutputsByName>`
- 每一轮 `sendMessage` 入口创建**全新的** ref 实例；上一轮的 ref 在没有 Vue watcher 引用后由 GC 回收
- 上一轮被 abort 的节点若在 N+1 轮开始后才 settle：**不能**写入 N+1 轮的 store（因为 ref 实例已不同）
- 前端订阅模式：使用"store-of-stores"模式，每轮 watch 当前轮 ref；不允许跨轮缓存某一轮的 ref

### 13.8 流式输出节奏（streaming cadence）

- 当前阶段：`shallowRef.triggerRef()` 仅在节点生命周期事件 (`pending → running → succeeded/failed/aborted`) 处触发批更新
- token 级流式：接口预留（参考 SC-7），但本变更**不实现**；后续单独立项时显式定义节流策略
- 不允许节点执行过程中高频 mutation outputs store

### 13.9 checkpoint 创建位置

- checkpoint 创建逻辑封装在 `applyMaintenancePatch` 内部，且**仅当** `input.pushCheckpointReason` 存在时创建
- 桥 API 路径：`bridge.runtime.applyPatch(patch)` 调用 applier 时传 `pushCheckpointReason: undefined` → 不创建 checkpoint
  - 设计意图：前端写入是细颗粒变更，频繁 checkpoint 会污染回溯链
  - 若前端确实需要打点：先调 `runAction({ kind: "push-checkpoint", reason })` 再调 applyPatch
- 工作流路径：`apply-patch` 节点把 `config.pushCheckpointReason`（默认 `"after-turn"`）原样传给 applier → 创建 checkpoint
- 两路径不允许在 applier 之外有任何"额外创建 checkpoint"的副作用

---

## 14. PBT (Property-Based Testing) Properties

> 本变更不实现 PBT 框架，但记录用于 `/ccg:spec-impl` 阶段写常规单测时挑选断言点。每条属性给出 INVARIANT 与 FALSIFICATION 策略。

| ID | 来源 | INVARIANT | FALSIFICATION |
|----|------|-----------|---------------|
| P-G-1 | G3 | `assemblePromptFromPreset` 对相同 input 必须输出相同 messages（确定性） | 随机 preset+macros，调两次 diff |
| P-G-2 | G4 | 真实 ST preset.json 经 `convertFromSillyTavern` 不抛错且至少产出 1 条 message | 社区 preset 语料 |
| P-H-1 | H3 | 任意有效 DAG，节点 N 执行时机晚于 N 所有上游边 source 的 settled 时间戳 | 随机 DAG 生成器 + 时间戳断言 |
| P-H-2 | H3 | abort() 之后任何节点都不会再进入 `succeeded` 状态 | 随机工作流 mid-execute abort |
| P-H-3 | H3 + §13.4 | 含环工作流加载期 throw | injectCycle(workflow) → expect throw |
| P-H-4 | H3 + §13.4 | 悬挂边工作流加载期 throw | mutate edge.from.nodeId → expect throw |
| P-H-5 | H4 | 节点 N succeeded 后，turn T 内其 outputs 不再变化 | 在节点 settle 后篡改其它节点状态 |
| P-H-6 | H4 + §13.4 | 同名 result 节点加载期 throw | 复制一份 result 改 name 不改 |
| P-H-7 | H4 + §10 | compute 超时返回 `failed` with code `TIMEOUT` 在 timeout+ε 内完成 | setTimeout 99999, expect failed at 5s |
| P-H-8 | HC-1 | compute 拿不到 RuntimeEngine 引用 | 反射 Function.arguments 列出可达对象 |
| P-H-9 | §13.1 | apply-patch 节点：events 失败时 archives 已落地、不回滚、错误向上抛 | 注入合法 archives + 非法 events |
| P-I-1 | HC-14 + §13.3 | 桥 API 与 apply-patch 节点对相同 patch 输入产出相同的副作用 + 错误 | 同 patch 跑两次走两路径，diff 快照与异常 |
| P-I-2 | §13.5 + I3 | `updateGlobals("a.b", v)` 之后下一轮宏 `{{globals.a.b}}` 解析为 `JSON.stringify(v)` | 随机路径与值 |
| P-I-3 | §13.6 + §13.7 | 轮间桥 API 写入对下一轮工作流可见，但不会修改上一轮已存的 snapshot | snapshot diff |
