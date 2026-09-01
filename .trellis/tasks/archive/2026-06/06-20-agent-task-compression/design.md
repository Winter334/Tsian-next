# Design — 子代理/助手任务压缩 + 兜底改造（消息序列化 + 多次压缩 + 时长兜底）

> 子任务 of `06-19-tool-runtime-performance`。
> **依赖子2（tool-token-budget，R1-R4 已落地）+ agent-call-concurrency（R1-R4 已落地）**——在"去硬轮次 + master 一次剧情压缩 + ContextBudgetExhaustedError + 并行 agent_call + 事件 agentId"基础上，建立 Tsian 的**第二种压缩模式（任务压缩）**，并修正 tool-token-budget 遗留的"delegated 跳过压缩、只走预算兜底（实际连预算兜底都没接上）"缺口。
> 本文件 2026-06-20 编写，对应 prd.md 已对齐方向。

## 0. 核心机制（一句话）

**把子代理（delegated `agent_call` 目标）与桌面助手（`runAssistantChat`）归为"任务型 agent"，与 master 的"叙事型 agent"并列：任务型 agent 的 messages 保持单条框架 user（合并，论证 §4.1）、压缩对象是整个上下文含工具调用+返回（新建 `compressTaskContext` + 任务摘要 prompt）、可多次压缩不限次（靠时长兜底防死循环 + 压缩无效早退防烧钱）；`agent_call` 加可选 `timeoutMs`、assistant 加可选 `timeoutMs`（默认 300s），超时经独立 `AbortController` 合并用户 abort 后识别为 `TaskTimeoutError` 温和中止；master 的"一次剧情压缩 + ContextBudgetExhaustedError"保持不动，靠 entry 路径的压缩模式枚举分层。**

对标 Codex/Claude Code 的"任务 agent 达预算就压缩、反复压、超时兜底"；不抄其"子代理结果包装成用户消息"（破坏 Tsian 剧情/tool 分层，agent-call-concurrency 已明确）。两种压缩范式并列的根因（prd §背景）：

| | master（叙事，已有剧情压缩，**不动**） | 子代理/助手（任务型，**本任务建立**） |
|---|---|---|
| 压缩对象 | 剧情正文（summary + recentTurns），过滤工具 | **整个上下文**（工具调用 + 返回 + 思考） |
| 压缩次数 | 一次 | **多次**（反复压，每次都腾空间） |
| 兜底 | 第二次达预算 = ContextBudgetExhaustedError | **时长兜底**（超时 = TaskTimeoutError）+ 压缩无效早退 |
| 摘要风格 | 叙事梗概（COMPRESSION_SYSTEM_PROMPT） | 任务摘要（已做工作 + 结论，新建 prompt） |
| 跨 turn 持久化 | context.json（底层已交付） | 子代理无（turn 内即弃）；助手待后续任务 C |
| 预算来源 | `AgentRuntimeTurnInput.contextTokenBudget`（host 注入） | 任务型 agent 的 model contextWindow 或 256k 默认 |

## 1. 架构与边界

### 1.1 涉及模块

| 层 | 文件 | 改动性质 |
|---|---|---|
| runtime-core | `apps/platform-web/src/agent-runtime/index.ts` | **核心改动**：①新增 `compressTaskContext` + 任务摘要 prompt + `TaskTimeoutError` + `TaskCompressionStalledError`；②`WorkspaceToolLoopOptions` 加 `compressionMode: "narrative" \| "task"` + 任务压缩所需字段；③两处工具循环（native `:1246` / text `:1457`）按模式分流压缩/兜底；④新增 `locateTaskInteractionSpan`；⑤`createAgentCallRunner` 给 delegated 传任务 toolOptions + 时长 AbortController（messages 仍用 `buildDelegatedAgentMessages`，仅 section 排序微调）；⑥`runAgentRuntimeTurn` entry 路径按 `compressionMode` 分流（master=narrative，assistant=task）；⑦`AgentRuntimeTurnInput` 加 `timeoutMs?` + `compressionMode?` |
| runtime-core | `apps/platform-web/src/agent-runtime/workspace-tools.ts` | `RuntimeAgentCallArguments` 加可选 `timeoutMs?: number`；`agent_call` tool schema description 注明 `timeoutMs` 语义 |
| runtime-core | `apps/platform-web/src/agent-runtime/context-lifecycle.ts` | **小扩展**：新增 `TASK_COMPRESSION_SYSTEM_PROMPT` 常量 + `buildTaskCompressionPrompt`；新增 `TaskTimeoutError`、`TaskCompressionStalledError`（与 `ContextBudgetExhaustedError` 同文件）。现有 `estimateTokenCount` / `estimateRuntimeMessagesTokens` / `estimateAiChatMessagesTokens` / `resolveTokenBudget` / `CONTEXT_COMPRESS_TRIGGER_RATIO` / `CompressCallModel` / `CompressCallOptions` 复用不改 |
| platform-host | `apps/platform-web/src/platform-host/index.ts` | ①`runAssistantChat` 传 `compressionMode: "task"` + `timeoutMs`（默认 120s）给 `runAgentRuntimeTurn`；②assistant 路径创建时长 AbortController 合并用户 abort；③`interaction.sendMessage`（master 路径）保持 `compressionMode: "narrative"`（显式传或默认） |
| platform-web | `apps/platform-web/src/views/AssistantView.vue` | catch 适配 `TaskTimeoutError` + `TaskCompressionStalledError`：走温和提示路径（与 `ContextBudgetExhaustedError` 同分支，非失败的中止） |
| contracts | `packages/contracts/src/runtime.ts` | **不改**——`timeoutMs` 是 runtime/tool-call 内部参数（`RuntimeAgentCallArguments` 在 workspace-tools.ts，不在 contracts）；`compressionMode` 是 runtime 内部；新错误类是 runtime 内部。`AgentContextSnapshot` schema 不变（任务压缩不落盘，无新持久化结构） |

### 1.2 不动的边界

- **master 的剧情压缩机制本身**——`compressContext` / `buildCompressionPrompt` / `COMPRESSION_SYSTEM_PROMPT` / `appendTurnToContext` / `buildAgentContextMessages` / `locateHistorySpan` / `replaceHistorySpan` / 剧情摘要风格不改。master 的"一次压缩 + 第二次达预算 = ContextBudgetExhaustedError"语义保持（tool-token-budget R2 不动其逻辑，只把它的适用范围**限定到 narrative 模式**）。
- **master 跨 turn 持久化**——`context.json` 读写、`stageAgentContextFile`、`contextUpdate.compressedContext` 落盘不改。assistant 不落盘（本任务），后续任务 C 加。
- **agent_call 并行执行 + 事件 agentId**——agent-call-concurrency 已落地。本任务在并行执行基础上加压缩能力（并行多子代理各自独立压缩各自的 messages、各自独立时长兜底）。`executeRuntimeWorkspaceToolCalls` 三组分组不改。
- **agent_call observation 走 tool 通道**——不改。observation 经 `formatRuntimeWorkspaceToolObservationMessage` 序列化，不包装成剧情 user message（Claude Code 那套明确不做）。
- **`maxDepth=2` 递归安全网**——保留。任务压缩不改变递归边界。
- **token 精确计数**——不做，复用底层字符估算（`charCount*0.4 + utf8Bytes*0.25`）。
- **native 与 text 两处循环**——两处都要改（对称），但核心机制一致。native 循环用 `estimateRuntimeMessagesTokens`，text 循环用 `estimateAiChatMessagesTokens`。
- **流式 thought 推送**——不动。压缩发生在 model 调用前，已流式 thought 不受影响。
- **abort 机制（用户 abort）**——不动。时长兜底用独立 AbortController 合并用户 abort，用户主动 abort 仍抛 AbortError（assistant 走 abort 分支，delegated 走 AGENT_CALL_FAILED）。
- **delegated 流式 round 语义**——不改（delegated 自己的 round，靠 agentId 区分）。
- **AssistantView 渲染**——不改（只加 catch 分支识别新错误类）。

### 1.3 关键技术约束（勘察确认）

**约束1：delegated 当前无压缩也无预算兜底（比 PRD 认知的缺口更大）。**

`createAgentCallRunner`（index.ts:1040）的闭包调 `callAgentModelWithWorkspaceTools`（L1124-1156）时**只传 5 个位置参数 + targetContext + transcriptCollector，不传 `toolOptions`**。所以 `triggerThreshold = 0`（L1280-1282 / L1521-1523 的 `toolOptions?.contextTokenBudget !== undefined` 判 false），整个 `if (triggerThreshold > 0)` 块跳过——delegated 工具循环**既无压缩也无预算兜底**，会无限增长直到 provider 窗口报错（通常是 400 invalid_request_error）。

PRD §背景缺口1 说"delegated 跳过压缩、只走预算兜底（达 85% 直接抛 ContextBudgetExhaustedError）"——这是 tool-token-budget design §1.2/§2.4 的**设计意图**，但**实现没接上**（delegated 没传 toolOptions，连预算兜底的 triggerThreshold 都没有）。本任务 R2 把 delegated 从"无任何 token 限制"升级为"任务压缩多次 + 时长兜底"，补的不只是 design 意图，还有实际缺口。

**约束2：assistant 当前走 entry 剧情压缩路径（用兜底 agentContext），需切换到任务压缩。**

`runAssistantChat`（platform-host:1725）调 `runAgentRuntimeTurn` 时**不传 `agentContext` 也不传 `contextTokenBudget`**（只传 snapshot 空壳）。entry 路径（index.ts:1690）`agentContext = input.agentContext ?? createInitialAgentContext(...)` 兜底初始化，`budget = resolveTokenBudget(undefined)` 用 256k 默认。所以 assistant 实际走的是 **entry 剧情压缩路径**（`buildEntryAgentMessages` 已是独立 message 序列 + `compressContext` 压剧情），但：
- 压缩结果 `contextUpdate` 被 `runAssistantChat` 忽略（不落盘）——每轮重新从 `recentHistory` 兜底初始化，压缩白做。
- assistant 是任务型 agent（像 Codex），压剧情（叙事梗概）风格不对——应压工具交互（任务摘要）。

PRD 决策8"助手 agent 与子代理统一"要求 assistant 切换到任务压缩。实现：entry 路径加 `compressionMode` 分流，assistant 传 `task`，master 传 `narrative`。assistant 的 messages 仍由 entry 路径构建（`buildEntryAgentMessages` 已序列化），但压缩走任务模式（压工具交互段而非剧情段）。delegated 的 messages **保持旧 `buildDelegatedAgentMessages` 形态（单条框架 user message 带 section header）**——论证见约束3，拆分无收益且损模型理解鲁棒性，仅做 section 排序微调（稳定内容前置、request/指令末尾）。

**约束3：任务压缩的"工具交互段"边界判定 + 消息结构（合并 vs 拆分）的客观论证。**

**先纠正 PRD §背景缺口2 的一个错误前提**：它说"delegated/助手 messages 是单条大 user message，单条 message 无法做基于 message 边界的 slice+替换压缩，任务压缩的前提是 messages 改成独立序列"。但任务压缩的 slice+替换对象是**工具交互段**（assistant(toolCalls) + tool(observation) 成对），而工具交互段**本来就已是独立 message**（每轮工具循环 append 的）——框架段是 1 条还是 N 条 user 都不影响工具交互的压缩。框架段（请求/历史/目标上下文）体积小且稳定，从来不是压缩目标（真正撑大的是工具返回的大段文件正文，在工具交互段里）。所以"必须拆框架 user 才能任务压缩"这个前提不成立。

**delegated messages 结构（保持单条框架 user，与旧 `buildDelegatedAgentMessages` 同形态）**：

```
[
  { role: "system",    content: delegatedSystemPrompt },                          // index 0, 稳定
  { role: "user",      content: "历史窗口：...\n目标 Agent 上下文：...\n调用方：...\n玩家本轮输入：...\n调用请求：...\n期望输出：...\n<指令>" }, // index 1, 框架段(单条,turn 内稳定)
  // ↑ 框架段(system + 1 条 user),压缩时全保留
  // ↓ 工具交互段(每轮 append,压缩时定位这段做 slice+替换)
  { role: "assistant", content, toolCalls },                                       // round 0+
  { role: "tool", toolCallId, content },                                           // round 0+
  { role: "assistant", content, toolCalls },                                       // round 1+
  ...
]
```

**assistant（走 entry 路径但 task 模式）的 messages 结构（`buildEntryAgentMessages` 产出，不改）**：

```
[
  { role: "system",    content: entrySystemPrompt },                               // index 0
  { role: "user",      content: "早期剧情摘要：\n<summary>" },                    // summary(若有) —— assistant 兜底初始化,通常空
  { role: "user"/"assistant", content: <recentTurns> },                           // recentTurns —— assistant 兜底,通常占位
  { role: "user",      content: "当前回合：N\nWorkspace Agent 上下文：..." },     // 框架信息
  { role: "user",      content: "玩家本轮输入：\n<userInput>" },                  // 本轮输入
  // ↑ 框架段(含兜底剧情段),压缩时全保留
  // ↓ 工具交互段
  { role: "assistant", content, toolCalls },                                       // round 0+
  { role: "tool", toolCallId, content },
  ...
]
```

**任务压缩定位"工具交互段"** = 框架段之后到 messages 末尾。**统一方案**：新增 `locateTaskInteractionSpan(messages, mode)`——从末尾向前扫描，跳过所有"工具交互形态"的 message，定位到第一条"非工具交互"message 的下一索引 = 工具交互段起点 `{ start, end }`（end = messages.length）。扫描逻辑**不依赖框架段是几条 message、不依赖框架锚点前缀**，只依赖工具交互的 message 形态。所以 delegated 框架是 1 条 user、assistant 框架是多条，`locateTaskInteractionSpan` 都正确工作。兜底（无工具交互，start>=end）→ 返回 {-1,-1}，跳过压缩（通常 round 0 调 model 前触发）。

**消息结构"拆分 vs 合并"的客观论证**（用户提出 online AI 建议合并，此处论证后采合并）：

曾考虑把 delegated 框架拆成 4 条独立 user（请求/历史/目标/玩家输入），两条原主张论据经推敲均**不成立**：
1. **缓存论据（不成立）**：provider 前缀缓存（OpenAI/DeepSeek automatic prefix caching、Claude prompt caching）是** token 级**的，对 token 序列前缀做 hash，**message 边界不是缓存单元**。一个 agent_call turn 内 4 条框架 user 全稳定 → 拆 4 条与合 1 条的稳定前缀只差 role-marker 控制符（也都稳定），**命中行为完全一致**。跨 turn 同目标多次 agent_call 时 request 不同，拆合都在 system 后分叉、缓存都断在 system 后。即使把 history 放前面 request 放后面，合 1 条把 history 放内容开头同样能命中 history 重叠前缀（prefix 缓存不关心"message 后面还装了什么"）。**缓存维度拆合中性，拆分无收益。**
2. **压缩边界论据（不成立）**：`locateTaskInteractionSpan` 按工具交互形态从末尾扫描定位，与框架段 message 数无关。框架合 1 条时 `[system, user(框架), assistant(toolCalls), tool, ...]` 从末尾扫停在 `user(框架)` → start 正确。**压缩维度拆合中性，拆分非硬需求。**

支持**合并**的论据（成立）：
- **模型理解**：模型主要在 user/assistant 交替对话上训练。连续 user 越多越极端——较弱模型可能把每条当独立 turn 分别回应、或丢失对话流。master 现状只有 2 条连续 user（框架信息+本轮输入，已在 PV-001 验证），delegated 拆 4 条是**比 master 更极端**的未验证形态。旗舰模型（GPT-4/Claude/DeepSeek-V3）处理连续 user 无碍，但 Tsian 面向 AIRP 用户用次旗舰/旗舰仍存在鲁棒性边界。
- **provider 鲁棒性**：部分 provider/SDK 对连续同 role 有 normalize/warning 行为（非硬阻塞，但属鲁棒性顾虑）。
- **token 开销**：每条 message 有 role-marker 控制符（~4-10 token），拆 4 条比合 1 条多 ~12-30 token。微小但真实。
- **语义清晰**：框架注入的上下文（请求/历史/目标）本非"用户发言"，用 1 条带 section header 的 user message 承载比 4 条"用户发言"语义更准。

**结论：delegated 框架保持单条 user message（合并），仅做 section 排序微调**——稳定内容（历史窗口/目标上下文）前置以利于任何潜在的 prefix 缓存，request + 指令末尾让模型聚焦。这实质是保留旧 `buildDelegatedAgentMessages` 形态（它本就是单条 user 带 section），不引入 `buildTaskAgentMessages` 拆分。master 的连续 user 是 2 条（剧情段 user/assistant 交替后的框架+输入），delegated 合并后是 1 条，都比"4 条连续 user"鲁棒。PRD R1"messages 改独立消息序列"重新解读为：**工具交互段已是独立 message 序列**（压缩对象），框架段单条 user 不影响压缩，R1 实质需求（可压缩）被满足。

**约束4：任务压缩的"替换"形态——把早期 tool 轮次摘要成 1 条 user message。**

任务压缩定位工具交互段 `[start, end)` 后：
- 保留**最近 N 轮** tool 交互（N 个"assistant(toolCalls) + tool(observation)"对，N=5 design 决议，见 §4.2）。
- 早期 tool 交互（`[start, end - recentN*2)`）送 model 生成任务摘要（`buildTaskCompressionPrompt`）。
- 摘要产出 1 条 `{ role: "user", content: "已完成工作摘要：\n<summary>" }`，**替换**早期 tool 交互段。
- 替换后 messages：`[...框架段(单条user), {user: 已完成工作摘要}, ...最近N轮tool交互]`。

**为什么摘要是 user message 而非 assistant**：user message 在工具交互段里是"框架注入的上下文"角色（与 tool observation 同为 user/tool 通道），assistant message 是"模型产出"角色。把摘要放 user 角色保持"框架注入 vs 模型产出"的语义分层，且不伪造 assistant 发言。这与 master 剧情压缩的 summary 用 user message（`buildAgentContextMessages` 的 `早期剧情摘要` user）一致。

**约束5：native 与 text 循环的 tool 交互段形态不同。**
- native：工具交互 = `{role:"assistant", toolCalls}` + `{role:"tool", toolCallId, content}`。
- text：工具交互 = `{role:"assistant", content含<tsian-tool-call>块}` + `{role:"user", content含<tsian-tool-observation>}`。
- `locateTaskInteractionSpan` 对 native 识别 `role==="tool"` + `assistant.toolCalls`；对 text 识别 `role==="user"` 且 content 含 `<tsian-tool-observation>` + `assistant` content 含 `<tsian-tool-call>`。两种形态分别适配（传 mode 参数）。**注意**：text 模式框架 user（含 `最近对话窗口：` + formatHistory）不得含 `<tsian-tool-observation>` 子串——formatHistory 是 recentHistory（玩家/叙事对话），不含工具 observation 标签，天然满足；`locateTaskInteractionSpan` 扫描停在框架 user 正确。

**约束6：时长兜底需区分"用户 abort"与"超时 abort"。**

delegated/assistant 都已有用户 abort（`input.signal`）。时长兜底加独立 `timeoutController = new AbortController()` + `setTimeout(() => timeoutController.abort("task-timeout"), timeoutMs)`。合并成 composite signal 传给工具循环（`AbortSignal.any([input.signal, timeoutController.signal].filter(Boolean))`）。工具循环 `assertNotAborted(compositeSignal)` 检查——任一 abort 都抛 AbortError。但闭包 catch 需区分：
- `timeoutController.signal.aborted === true` → 抛 `TaskTimeoutError`（温和，assistant 走温和提示，delegated 走 AGENT_CALL_FAILED with 超时标记）。
- 否则 → 透传 AbortError（用户主动 abort）。

`AbortSignal.any` 现代浏览器（Chromium 116+ / Firefox 124+ / Safari 17.4+）支持，Tsian 是 Electron/浏览器平台，可用。若需兼容旧环境可手写 composite（addEventListener 转发），design 不预先做（YAGNI，实测遇到再加）。

**约束7：压缩无效早退需记录压缩前后 token。**

多次压缩时，每次压缩后比较 `totalTokensBefore` 与 `totalTokensAfter`。若 `(before - after) / before < 0.1`（下降 <10%）→ 压不动了（recentToolInteractions 已剩极少 + 工具交互还在涨）→ 抛 `TaskCompressionStalledError`（温和，不傻等超时烧钱）。阈值 0.1 design 决议（见 §4.3）。

**约束8：assistant 的 `timeoutMs` 与 master 不加时长。**

PRD 决策4"master 不加时长（一次压缩够，时长会误杀叙事深思）"。所以 `AgentRuntimeTurnInput.timeoutMs` 只对 task 模式（assistant）生效，narrative 模式（master）忽略。host `interaction.sendMessage`（master）不传 `timeoutMs`；`runAssistantChat`（assistant）传默认 300s。

## 2. 数据与契约

### 2.1 压缩模式枚举 + WorkspaceToolLoopOptions 扩展

`WorkspaceToolLoopOptions`（index.ts:237）加压缩模式 + 任务压缩字段：

```ts
// before
interface WorkspaceToolLoopOptions {
  agentCallState: AgentCallTurnState
  agentCallDepth: number
  collaborationPolicy: AgentRuntimeCollaborationPolicy
  agentContextSnapshot?: AgentContextSnapshot    // narrative 模式用
  contextTokenBudget?: number                    // 两模式共用
  compressCallModel?: CompressCallModel          // 两模式共用
}

// after
type RuntimeCompressionMode = "narrative" | "task"

interface WorkspaceToolLoopOptions {
  agentCallState: AgentCallTurnState
  agentCallDepth: number
  collaborationPolicy: AgentRuntimeCollaborationPolicy
  /** 压缩模式:narrative=master 剧情压缩(一次+ContextBudgetExhaustedError);task=子代理/助手任务压缩(多次+时长兜底+早退). */
  compressionMode: RuntimeCompressionMode
  /** narrative 模式:master 会话上下文快照(turn 内压剧情就地更新).task 模式不用. */
  agentContextSnapshot?: AgentContextSnapshot
  /** token 预算(已 resolve).两模式共用,达 85% 触发. */
  contextTokenBudget?: number
  /** 压缩用的 model 调用(复用 capabilities.callModel).两模式共用. */
  compressCallModel?: CompressCallModel
  /** task 模式:时长兜底起点 wall-clock(超 timeoutMs 抛 TaskTimeoutError).narrative 不用. */
  taskStartedAt?: number
  /** task 模式:时长配额 ms(默认 120000).narrative 不用. */
  taskTimeoutMs?: number
}
```

**向后兼容**：`compressionMode` 是新增必填字段，但 `WorkspaceToolLoopOptions` 是 index.ts 内部类型，所有构造点（entry 路径 L1763、delegated 路径新增）同步改。无 contracts 破坏。

### 2.2 RuntimeAgentCallArguments + AgentRuntimeTurnInput 加 timeoutMs

`RuntimeAgentCallArguments`（workspace-tools.ts:91）加可选 `timeoutMs`：

```ts
export interface RuntimeAgentCallArguments {
  agentId: string
  request: string
  reason?: string
  contextSummary?: string
  expectedOutput?: string
  historyMode: RuntimeAgentCallHistoryMode
  /** 可选:本子代理调用时长配额 ms(超时抛 TaskTimeoutError,温和中止).不传用默认 120000. */
  timeoutMs?: number
}
```

`AgentRuntimeTurnInput`（index.ts:69）加可选 `timeoutMs`（assistant 用）：

```ts
export interface AgentRuntimeTurnInput {
  // ... 现有字段
  /** task 模式(assistant)时长配额 ms.超时抛 TaskTimeoutError.仅 compressionMode==="task" 生效.narrative(master)忽略. */
  timeoutMs?: number
}
```

`agent_call` tool schema（`tool-schemas.ts` 的 agentCall schema）`parameters` 加 `timeoutMs` 可选字段 + description 注明"子代理调用时长上限 ms，默认 120000，超时温和中止"。

**向后兼容**：`timeoutMs` 可选，不传用默认。无 contracts 破坏（`RuntimeAgentCallArguments` 在 workspace-tools.ts，不在 contracts）。

### 2.3 保留 buildDelegatedAgentMessages（单条框架 user，section 排序微调）

delegated 的 messages **保持旧 `buildDelegatedAgentMessages` 形态**——单条 user message 带 section header（历史窗口 / 目标 Agent 上下文 / 调用方 / 玩家本轮输入 / 调用请求 / 指令），不新建 `buildTaskAgentMessages` 拆分。论证见约束3 + §4.1：拆分 vs 合并经客观论证后区别很小（缓存中性、压缩边界中性），合并更简单且模型理解鲁棒性更好（function calling agent 场景单条框架 user 比 4 条连续 user 更自然，且 master 现状已是 2 条连续 user，delegated 合并为 1 条比拆 4 条更保守）。

**唯一微调**：旧 `buildDelegatedAgentMessages` 的 section 顺序是"当前回合N + historyMode + 目标上下文 + 调用方 + 请求 + ... + 历史窗口 + 玩家输入 + 指令"混排。本任务做 section 排序微调——稳定内容（历史窗口 / 目标 Agent 上下文）前置（利于任何潜在的 prefix 缓存重叠），request + 指令末尾（让模型聚焦当前任务）。这是单条 user 内的文本重排，不改变 message 数量、不新建 helper。

**assistant 不走此路径**：assistant 走 entry 路径（`buildEntryAgentMessages` 已序列化），只切换 `compressionMode: "task"`。PRD R1"统一构建 helper：子代理 + 助手共用"重新解读——两者 messages 结构不同（assistant 有剧情段/框架/本轮输入三层；delegated 有请求/历史/目标三层），强行共用 helper 造结构转换层无收益；**统一的是压缩机制**（`compressTaskContext` + task 模式 + 时长兜底），而非 messages 构建 helper。design 偏离 PRD 字面"共用 helper"，理由见 §4.1。

### 2.4 新增 compressTaskContext + 任务摘要 prompt

`context-lifecycle.ts` 新增（复用 `CompressCallModel` / `CompressCallOptions` / `estimateTokenCount`，不依赖 `AgentContextSnapshot`）：

```ts
/** 任务压缩保留最近 N 轮 tool 交互(assistant+tool 成对,原文不压). */
export const TASK_KEEP_RECENT_TOOL_ROUNDS = 5
/** 压缩无效早退阈值:压缩后 token 下降幅度 < 此比例 → 抛 TaskCompressionStalledError. */
export const TASK_COMPRESSION_STALL_RATIO = 0.1

const TASK_COMPRESSION_SYSTEM_PROMPT = [
  "你是任务执行摘要器。把子代理/助手的早期工具交互过程压缩成「已完成工作 + 结论」摘要。",
  "保留:已读取/写入的关键信息、已做出的判断、已达成的中间结论、未解决的问题。",
  "丢弃:工具调用的具体命令与参数、工具返回的原始大段内容、重复的探索步骤。",
  "用简洁的任务日志风格输出,不要叙事化,不要复述工具协议。",
].join("\n")

function buildTaskCompressionPrompt(
  oldSummary: string | null,
  interactionEntries: { role: string; content: string; toolName?: string }[],
): string {
  return [
    oldSummary ? `此前的工作摘要：\n${oldSummary}\n` : "",
    "需要压缩的早期工具交互（assistant 调用 + tool 返回）：",
    ...interactionEntries.map((e, i) =>
      `${i + 1}. [${e.role}${e.toolName ? `:${e.toolName}` : ""}] ${e.content}`),
  ].filter(Boolean).join("\n")
}

/**
 * 任务压缩:把工具交互段的早期轮次摘要成 1 条 user message,保留最近 N 轮.
 * 不依赖 AgentContextSnapshot(任务型 agent 无跨 turn 快照).返回新 messages + 是否压动.
 */
export async function compressTaskContext(
  messages: RuntimeChatMessage[] | AiChatMessage[],
  interactionSpan: { start: number; end: number },
  callModel: CompressCallModel,
  options: CompressCallOptions,
): Promise<{ messages: typeof messages; compressed: boolean; summary: string | null }> {
  // 1. 切出工具交互段,保留最近 N 轮(成对计算),早期送摘要
  // 2. 无可压缩早期内容 → { messages, compressed: false, summary: null }
  // 3. 调 model 生成任务摘要,失败 throw ContextCompressionFailedError(复用)
  // 4. 拼新 messages:[...框架段, {user: 已完成工作摘要:summary}, ...最近N轮]
  // 5. 返回 { messages: newMessages, compressed: true, summary }
}
```

**与 `compressContext` 的关系**（PRD 开放问题3 决议）：**新建 `compressTaskContext`**，职责分明——`compressContext` 压 `AgentContextSnapshot`（剧情正文，产出新快照）；`compressTaskContext` 压 messages 的工具交互段（产出新 messages + 摘要文本）。两者复用 `CompressCallModel` 的 model 调用形态 + `estimateTokenCount`，但不共享压缩逻辑/数据结构。任务压缩不落盘（无 `AgentContextSnapshot` 产出），摘要文本随 messages 在 turn 内存在，turn 结束即弃。

**任务压缩接入点**（对称 tool-token-budget R2 的 master 接入点）：两处工具循环每轮调 model 前检查 token。task 模式分支：

```ts
// 伪代码(task 模式,native 循环,text 循环对称)
if (compressionMode === "task" && triggerThreshold > 0) {
  const totalTokens = estimateRuntimeMessagesTokens(runtimeMessages)
  if (totalTokens > triggerThreshold) {
    // 时长兜底检查(每轮也查,不等 model 调用)
    if (taskStartedAt && Date.now() - taskStartedAt > taskTimeoutMs) {
      throw new TaskTimeoutError()
    }
    const interactionSpan = locateTaskInteractionSpan(runtimeMessages, "native")
    if (interactionSpan.start < 0) {
      // 无工具交互段可压(异常,通常 round 0 不该触发)→ 走兜底
      const finalText = lastRoundText.trim()
      if (finalText) { /* record + return */ }
      throw new ContextBudgetExhaustedError()  // 复用,任务模式兜底同语义
    }
    const beforeTokens = totalTokens
    const result = await compressTaskContext(runtimeMessages, interactionSpan, compressCallModel, compressOptions)
    if (!result.compressed) {
      // 压不动(早期无可压内容)→ 走兜底
      const finalText = lastRoundText.trim()
      if (finalText) { /* record + return */ }
      throw new ContextBudgetExhaustedError()
    }
    runtimeMessages = result.messages
    const afterTokens = estimateRuntimeMessagesTokens(runtimeMessages)
    if ((beforeTokens - afterTokens) / beforeTokens < TASK_COMPRESSION_STALL_RATIO) {
      // 压缩无效早退
      throw new TaskCompressionStalledError()
    }
    compressedCount += 1  // 不限次
    emitTrace({ type: "task_context_compressed", ... })
    continue  // 不设 compressedThisTurn,可再压
  }
}
```

**narrative 模式分支**（master，保持 tool-token-budget R2 不动）：

```ts
if (compressionMode === "narrative" && triggerThreshold > 0) {
  // 现有逻辑原样保留:compressedThisTurn 标记 + 第二次达预算 ContextBudgetExhaustedError
  // 只是把"canCompressInTurn"条件改为"compressionMode === narrative && agentContextSnapshot 存在"
}
```

### 2.5 新增错误类 + AssistantView catch

`context-lifecycle.ts` 新增（与 `ContextBudgetExhaustedError` 同文件）：

```ts
/** 任务型 agent(子代理/助手)超时:时长兜底触发,温和中止. */
export class TaskTimeoutError extends Error {
  constructor(timeoutMs?: number) {
    super(timeoutMs ? `任务执行超时（${Math.round(timeoutMs / 1000)}s），已中止。` : "任务执行超时，已中止。")
    this.name = "TaskTimeoutError"
  }
}

/** 任务压缩无效早退:多次压缩后 token 下降 <10%,压不动了,不傻等超时. */
export class TaskCompressionStalledError extends Error {
  constructor() {
    super("上下文持续膨胀且压缩无效，已中止。请精简任务或拆分子任务。")
    this.name = "TaskCompressionStalledError"
  }
}
```

**AssistantView catch 适配**（index.ts:671-698 现有 `ContextBudgetExhaustedError` 分支扩展）：

```ts
const budgetExhausted = error instanceof Error && error.name === "ContextBudgetExhaustedError"
const taskTimeout = error instanceof Error && error.name === "TaskTimeoutError"
const taskStalled = error instanceof Error && error.name === "TaskCompressionStalledError"
if (aborted) { /* 现有 abort 分支 */ }
else if (budgetExhausted || taskTimeout || taskStalled) {
  // 三类温和中止同路径:保留已流式 thought,用 content 承载提示,不设 errorMessage、不 pop 占位
  const hint = taskTimeout ? "（任务超时，已中止）" : taskStalled ? "（上下文持续膨胀且压缩无效，已中止）" : "（上下文已满，请开始新会话或精简对话）"
  if (assistantMsg.content) { assistantMsg.content = `${assistantMsg.content}\n\n_${hint}_` }
  else { assistantMsg.content = hint.replace(/[（）]/g, "") }
  await persistCurrentSession()
}
else { /* 现有 errorMessage 分支 */ }
```

**delegated 路径的 TaskTimeoutError/Stalled 处理**（`createAgentCallRunner` 闭包 catch）：转成 `AGENT_CALL_FAILED` observation，details 标明超时/压缩无效。master 收到 observation 继续自己的循环（不抛出，不中断 master turn）。

### 2.6 时长兜底实现（AbortController + setTimeout + AbortSignal.any）

**delegated 路径**（`createAgentCallRunner` 闭包）：

```ts
// 闭包入口
const timeoutMs = agentCall.timeoutMs ?? DEFAULT_TASK_TIMEOUT_MS  // 120000
const timeoutController = new AbortController()
const timeoutTimer = setTimeout(() => timeoutController.abort("task-timeout"), timeoutMs)
// 合并用户 abort(input.signal) + 超时 abort
const compositeSignal = AbortSignal.any(
  [input.signal, timeoutController.signal].filter(Boolean) as AbortSignal[]
)
try {
  const response = await callAgentModelWithWorkspaceTools(
    buildDelegatedAgentMessages(...),
    input, capabilities,
    { ...options, signal: compositeSignal },  // 工具循环用 composite signal
    targetContext,
    { compressionMode: "task", contextTokenBudget, compressCallModel,
      taskStartedAt: Date.now(), taskTimeoutMs },
    transcriptCollector,
  )
  return { status: "completed", ... }
} catch (error) {
  if (timeoutController.signal.aborted) {
    throw new TaskTimeoutError(timeoutMs)  // 超时 → 温和错误(被 agent_call runner 转 AGENT_CALL_FAILED observation)
  }
  throw error  // 用户 abort / 其他错误透传
} finally {
  clearTimeout(timeoutTimer)
}
```

**assistant 路径**（`runAssistantChat`，platform-host:1768 现有 controller 基础上）：

```ts
const controller = new AbortController()  // 现有:用户 abort
// 新增:时长兜底
const timeoutMs = input.timeoutMs ?? DEFAULT_TASK_TIMEOUT_MS
const timeoutController = new AbortController()
const timeoutTimer = setTimeout(() => timeoutController.abort("task-timeout"), timeoutMs)
// 合并(现有 input.signal → controller 逻辑 + timeout → composite)
// ... 现有 input.signal 合并到 controller 的逻辑保留 ...
const compositeSignal = AbortSignal.any([controller.signal, timeoutController.signal])
try {
  const result = await runAgentRuntimeTurn(
    { ...input, signal: compositeSignal, compressionMode: "task", timeoutMs },
    capabilities,
  )
  // ... 现有 result 处理(controller.signal.aborted 检查改为 compositeSignal.aborted) ...
} catch (error) {
  if (timeoutController.signal.aborted) { throw new TaskTimeoutError(timeoutMs) }
  throw error
} finally {
  clearTimeout(timeoutTimer)
}
```

**master 路径**（`interaction.sendMessage`）：不传 `timeoutMs`，`compressionMode: "narrative"`（或默认 narrative）。不创建 timeoutController。时长兜底对 master 不生效。

**DEFAULT_TASK_TIMEOUT_MS = 300_000**（context-lifecycle.ts 常量，5 分钟，任务型 agent 探索可能较长——读多文件+总结+多次压缩，300s 给足空间，与 Codex 长任务量级一致）。

### 2.7 master 兜底与新机制分层（PRD R4 + 开放问题5 决议）

tool-token-budget R2 的"第二次达预算 = ContextBudgetExhaustedError"当前是通用的（两处循环 `compressedThisTurn || !canCompressInTurn` 分支）。分层方案：

- **narrative 模式**（master）：保持 tool-token-budget R2 逻辑**原样**——`compressedThisTurn` 标记一次压缩，第二次达预算走"有 finalText 返回 / 无抛 ContextBudgetExhaustedError"。`canCompressInTurn` 条件 = `compressionMode === "narrative" && agentContextSnapshot 存在 && contextTokenBudget 存在 && compressCallModel 存在`。
- **task 模式**（delegated + assistant）：新逻辑——不设 `compressedThisTurn`（可多次压），每次达阈值调 `compressTaskContext`，压缩无效（下降 <10%）抛 `TaskCompressionStalledError`，无工具交互段可压或压不动走"有 finalText 返回 / 无抛 ContextBudgetExhaustedError"（复用，任务模式兜底同语义）。时长兜底每轮检查 `Date.now() - taskStartedAt > taskTimeoutMs` → `TaskTimeoutError`。

**共享基础设施不冲突**：
- `compressContext`（剧情）只被 narrative 模式调；`compressTaskContext`（任务）只被 task 模式调。两者不交叉。
- `ContextBudgetExhaustedError` 两模式共用（"压无可压"的兜底语义一致），AssistantView catch 同分支。
- `estimateRuntimeMessagesTokens` / `estimateAiChatMessagesTokens` / `CONTEXT_COMPRESS_TRIGGER_RATIO` / `resolveTokenBudget` / `CompressCallModel` 两模式共用。
- 唯一分流点 = `compressionMode` 枚举，在两处循环的 `if (triggerThreshold > 0)` 块内分流。

**master 行为不回归的保证**：narrative 分支代码 = 现有 tool-token-budget R2 代码 + `compressionMode === "narrative"` 前置条件。master 路径传 `compressionMode: "narrative"`，走 narrative 分支，行为与改造前一致。

### 2.8 locateTaskInteractionSpan（新增，任务压缩定位）

`index.ts` 新增（与 `locateHistorySpan` 并列）：

```ts
/**
 * 定位任务型 messages 的工具交互段边界,供任务压缩 slice+替换用.
 * 工具交互段 = 框架信息段之后到 messages 末尾(assistant toolCalls + tool observation 交替).
 * 从末尾向前扫描,跳过所有"工具交互 message",定位到第一条"非工具交互"message 的下一索引.
 *
 * native 形态:工具交互 = {role:"tool"} 或 {role:"assistant", toolCalls 非空}.
 * text 形态:工具交互 = {role:"user", content 含 <tsian-tool-observation>} 或
 *           {role:"assistant", content 含 <tsian-tool-call>}.
 *
 * 返回 {start, end}(半开区间),start<0 表示无工具交互段(通常 round 0 前),跳过压缩.
 */
function locateTaskInteractionSpan(
  messages: ReadonlyArray<{ role: string; content: string; toolCalls?: unknown[] }>,
  mode: "native" | "text",
): { start: number; end: number }
```

**为什么从末尾向前扫而非找框架锚点**：delegated 的 `buildDelegatedAgentMessages` 框架段是单条 user（含历史/目标/请求多 section），assistant 的 entry 路径框架段含"当前回合："锚点但混合剧情段。两种结构框架段 message 数不同，但从末尾向前扫"工具交互形态"不依赖框架段结构（只依赖工具交互的 message 形态），是最稳的统一定位。`replaceHistorySpan` 复用（splice 替换）。

## 3. 数据流

### 3.1 delegated 任务压缩（多次，正常）

```
master round N: agent_call(memory, request="读10个文件总结记忆")
  → createAgentCallRunner 闭包:
     timeoutController + setTimeout(300s)
     compositeSignal = AbortSignal.any([input.signal, timeoutController.signal])
     buildDelegatedAgentMessages → [system, user(框架:历史+目标+调用方+玩家输入+请求+指令)]
     callAgentModelWithWorkspaceTools(messages, ..., {compressionMode:"task", taskStartedAt, taskTimeoutMs, ...})
     → memory 工具循环:
        round 0-5: read 文件1-6, tool 交互累积, tokens < 85% → 继续
        round 6 调 model 前: tokens > 85% → task 分支
           → 时长检查:未超时
           → locateTaskInteractionSpan → [start=5, end=13](round 0-5 的 assistant+tool)
           → compressTaskContext:保留最近 N=3 轮(round 3-5),压 round 0-2 → 摘要 user message
           → runtimeMessages = [system, 请求, 历史, 目标上下文, 玩家输入, {user:已完成工作摘要}, round3, round4, round5]
           → afterTokens 下降 >10% → compressedCount=1 → 继续
        round 7-10: read 文件7-10 + 总结, tokens < 85% → stop → 返回 memory 结论
     → clearTimeout(timeoutTimer)
     → return { status:"completed", response: memory结论 }
  → master 收 observation, 继续自己循环
```

### 3.2 delegated 时长兜底（超时）

```
master round N: agent_call(memory, request="复杂探索", timeoutMs=60000)
  → 闭包: timeoutController + setTimeout(60s)
  → memory 工具循环 round 0-20: 持续探索, 反复压缩(compressedCount=3)
  → round 21 调 model 前: Date.now() - taskStartedAt > 60000
     → throw TaskTimeoutError
  → 闭包 catch: timeoutController.signal.aborted === true → throw TaskTimeoutError(60000)
  → agent_call runner catch: 转 AGENT_CALL_FAILED observation(details: {timeout: true, timeoutMs: 60000})
  → master 收 AGENT_CALL_FAILED observation, 继续自己循环(可决定放弃或重试)
```

### 3.3 delegated 压缩无效早退

```
master round N: agent_call(memory, request="读超大文件")
  → memory 工具循环 round 0-8: read 大文件, tokens 飙升
  → round 9: tokens > 85% → compressTaskContext → 压 round 0-6
     → afterTokens 下降 8% (<10%) → throw TaskCompressionStalledError
  → 闭包 catch: 透传(非超时)
  → agent_call runner catch: 转 AGENT_CALL_FAILED observation(details: {stalled: true})
  → master 收 observation
```

### 3.4 assistant 任务压缩（切换自剧情压缩）

```
AssistantView → runAssistantChat({message, history, timeoutMs?})
  → host: controller(用户abort) + timeoutController(120s) + compositeSignal
  → runAgentRuntimeTurn({agentId:"studio-assistant", compressionMode:"task", timeoutMs, signal:compositeSignal, ...})
  → entry 路径: agentContext 兜底初始化(无注入), compressionMode="task"
     → buildEntryAgentMessages(已序列化,含兜底剧情段+框架信息+本轮输入)
     → 工具循环 task 分支: 压工具交互段(不压剧情段,assistant 兜底剧情段无价值)
     → 多次压缩 + 时长兜底 + 早退
  → 返回 replyText, contextUpdate 被 host 忽略(不落盘,本任务)
  → 超时/早退 → TaskTimeoutError/Stalled → AssistantView catch 温和提示
```

### 3.5 master 剧情压缩不回归（narrative 分支）

```
interaction.sendMessage → runAgentRuntimeTurn({agentId:"master", compressionMode:"narrative", contextTokenBudget, agentContext, ...})
  → entry 路径: compressionMode="narrative"
  → buildEntryAgentMessages(剧情段独立序列)
  → 工具循环 narrative 分支: 现有 tool-token-budget R2 逻辑原样
     → 第一次达 85%: compressContext(剧情) + compressedThisTurn=true
     → 第二次达 85%: 有 finalText 返回 / 无抛 ContextBudgetExhaustedError
  → contextUpdate.compressedContext 落盘(现有 R4 逻辑)
  → 行为与改造前一致
```

### 3.6 并行多子代理各自独立压缩

```
master round N: agent_call(memory) + agent_call(state) 并行(agent-call-concurrency)
  → 两个 createAgentCallRunner 闭包并行:
     各自独立 timeoutController + setTimeout(各自 timeoutMs)
     各自独立 buildDelegatedAgentMessages + 工具循环 + 任务压缩
     各自独立 taskStartedAt / compressedCount / 时长检查
  → memory 压缩 round 0-5, state 压缩 round 0-3, 互不影响
  → 各自完成/超时/早退, observation 按原 index 回填
  → master 收两个 observation 继续
```

## 4. 权衡

### 4.1 为什么 delegated 框架保持单条 user（合并）而非拆分多条

PRD §背景缺口2 主张"单条大 user message 无法做 slice+替换压缩，需改独立序列"。实际论证后该前提不成立，且拆分无收益：

- **压缩边界（拆合中性）**：任务压缩的 slice+替换对象是工具交互段（assistant toolCalls + tool observation 成对），本就是独立 message；框架段是 1 条还是 N 条 user 不影响 `locateTaskInteractionSpan`（按工具交互形态从末尾扫，与框架 message 数无关）。框架段体积小且稳定，从不是压缩目标。
- **缓存（拆合中性）**：provider 前缀缓存是 token 级，message 边界非缓存单元。一个 agent_call turn 内框架内容全稳定，拆 4 条与合 1 条的稳定前缀只差 role-marker 控制符（也都稳定），命中行为一致。跨 turn request 不同，拆合都在 system 后分叉。
- **模型理解（合并略优）**：function calling agent 场景连续 user 是常态（Claude tool_result 在 user、Gemini functionResponse 在 user），但 delegated 拆 4 条连续 user 仍比 master 现状（2 条）更极端、未经验证。单条框架 user 语义更准（框架注入非"用户发言"）、鲁棒性更好。旗舰模型两者皆可，合并是保守选择。
- **实现复杂度（合并更简）**：合并 = 保留现有 `buildDelegatedAgentMessages`（已验证多版本）零新代码；拆分 = 新建 helper + 新 PV 验证连续 user 兼容性 + text 模式合并过滤器边界 bug 风险。

**结论：区别不大时选更简单——合并**。delegated 保持 `buildDelegatedAgentMessages` 单条 user（仅 section 排序微调，§2.3），不新建 `buildTaskAgentMessages`。assistant 沿用 `buildEntryAgentMessages` + 切 `compressionMode: "task"`。PRD R1"统一构建 helper"重新解读：统一的是压缩机制（task 模式 + `compressTaskContext`），而非 messages 构建 helper——两者结构不同，强行共用 helper 造结构转换层无收益。

**未来演进备选**：当 Tsian 做多 provider 适配或结构化 message 表示时，在 `ai.ts` adapter 层引入"可合并标记 + provider 合并策略"是正确时机（内部拆分管理、发送时 adapter 合并）。本任务不做（YAGNI，收益微小、代价真实）。

### 4.2 TASK_KEEP_RECENT_TOOL_ROUNDS = 5 的依据

- 任务型探索的"当前焦点"通常在最近 3-6 步（刚 read 的文件、刚 write 的状态、正在处理的中间结果、上下游关联步骤）。
- N=5 覆盖"最近一次完整探索链 + 当前进行中的步骤 + 上下游关联"，保留足够上下文让模型不重复探索。代价是压缩腾空间略少，但任务模式支持多次压缩（不限次），单次少腾可通过多压补回。
- N 太大（如 8）→ 压缩腾空间少，多次压缩收益低、压缩次数增多（每次都调 model 烧钱）；N 太小（如 2）→ 丢中间结论，模型可能重复探索（震荡）。
- 与 master 的 `CONTEXT_KEEP_RECENT_TURNS = 5`（剧情轮次）不同维度——剧情轮次是"对话回合"，tool 轮次是"工具交互对"，N=5 对应约 10 条 message（5 assistant + 5 tool）。

### 4.3 TASK_COMPRESSION_STALL_RATIO = 0.1 的依据

- 压缩有效 = 早期工具交互（大段 tool 返回）被摘要成短文本，下降通常 >30%。
- 下降 <10% 说明早期已无可压内容（recentToolInteractions 已剩 N=3 + 工具交互还在涨）→ 再压也是压最近 N 轮（不该压，是当前焦点）→ 傻等超时烧钱。
- 0.1 是保守阈值（避免误判正常波动）。实测可调（design 定 0.1，implement 留常量易改）。

### 4.4 为什么时长兜底用 AbortController + setTimeout 而非循环内 elapsed 检查

- 循环内 elapsed 检查只能在 model 调用前后触发，无法取消正在进行的 model 调用（长 model 调用会超时很久才被检查到）。
- AbortController + setTimeout 能在超时瞬间 abort 正在 await 的 `callModelNative`（provider fetch 检查 signal），即时中止。
- 合并 `AbortSignal.any` 让用户 abort + 超时共享同一取消通道，工具循环 `assertNotAborted` 不需改。
- 代价：catch 需区分 `timeoutController.signal.aborted`（超时）vs `input.signal.aborted`（用户 abort）。可接受（一处 catch 分支）。

### 4.5 为什么任务压缩摘要用 user message 而非 assistant

- user message = 框架注入的上下文（与 tool observation 同通道）；assistant message = 模型产出。摘要放 user 保持语义分层，不伪造 assistant 发言。
- 与 master 剧情压缩的 summary 用 user message（`早期剧情摘要`）一致。
- provider 侧无障碍（user message 序列合法）。

### 4.6 已知残留风险

**并行多子代理同时压缩的 model 调用并发**：多个并行 delegated 同时触发任务压缩 → 同时调 `compressCallModel`（= `capabilities.callModel`）→ 并发 model 调用。无共享状态（各自压缩各自 messages），但并发 model 调用增加瞬时 API 负载。与 agent-call-concurrency 的并行执行风险同质（并行 agent_call 本就并发 model 调用），不引入新风险模型。

**AbortSignal.any 兼容性**：旧浏览器/Electron 不支持。Tsian 目标环境（现代 Chromium）支持。若实测遇到，回退到手写 composite（addEventListener 转发两个 signal 到 composite controller）——design 不预先做，YAGNI。

**任务压缩摘要质量**：任务摘要 prompt 是新建，未经实测。摘要质量差会导致模型重复探索（类似旧 design 的丢 tool 轮次缺陷）。风险低于 master 剧情压缩（任务摘要保留"已做工作+结论"比叙事梗概更结构化）。实测验证（§6）。

## 5. 兼容性与回滚

- **配置 shape 扩展**：`WorkspaceToolLoopOptions.compressionMode` 新增必填——内部类型，所有构造点同步改。`RuntimeAgentCallArguments.timeoutMs` / `AgentRuntimeTurnInput.timeoutMs` 可选新增——无 contracts 破坏（workspace-tools.ts / index.ts 内部）。
- **无数据迁移**：任务压缩不落盘（无新持久化结构）。`AgentContextSnapshot` schema 不变。assistant 的 `contextUpdate` 仍被忽略（本任务不加落盘）。
- **错误类新增**：`TaskTimeoutError` / `TaskCompressionStalledError` 是新类，AssistantView catch 按 `error.name` 识别（无 runtime-internal import，与 `ContextBudgetExhaustedError` 同模式）。
- **回滚**：revert 该任务提交。旧 `buildDelegatedAgentMessages`（单条大 user）+ delegated 无 toolOptions + assistant 走 narrative + 无 timeoutMs 从 git 恢复。master 剧情压缩逻辑（narrative 分支）本就保持，回滚后 master 路径无变化。

## 6. 验证策略

- **构建**：`npm run build:contracts && npm run build:web` 通过（`compressionMode` 必填 + 新错误类 + 新 helper 靠 vue-tsc 兜底捕获遗漏构造点/消费者）。
- **真实 API 实测**（依赖可游玩游戏卡 + API key 环境）：
  - **delegated 任务压缩**：记忆 agent 读 10 个文件总结，中途撑爆 85% 触发任务压缩继续不报错，观察 trace `task_context_compressed` 事件、摘要后模型不重复探索、最终返回记忆结论。
  - **delegated 多次压缩**：构造超长任务（读 20+ 文件），观察 compressedCount ≥ 2，每次压缩后继续，最终完成或走兜底。
  - **delegated 时长兜底**：`agent_call(memory, timeoutMs=10000)` 跑长任务，10s 后 TaskTimeoutError → master 收 AGENT_CALL_FAILED observation（details.timeout=true）→ master 继续自己循环。
  - **delegated 压缩无效早退**：读超大单文件撑爆，压缩后下降 <10% → TaskCompressionStalledError → AGENT_CALL_FAILED observation（details.stalled=true）。
  - **assistant 任务压缩**：桌面助手长对话（多轮工具探索）触发任务压缩继续；超时温和提示；早退温和提示；不落盘（重开会话从 recentHistory 兜底）。
  - **master 剧情压缩不回归**：master turn 内一次压缩 + 第二次达预算 ContextBudgetExhaustedError 行为不变；context.json 落盘正常。
  - **并行多子代理各自压缩**：同轮 `agent_call(memory)+agent_call(state)`，各自独立压缩/超时/早退，observation 按 index 回填，互不影响。
  - **用户 abort vs 超时区分**：用户点停止 → AbortError（assistant 走 abort 分支"已停止"）；超时 → TaskTimeoutError（assistant 走温和提示"任务超时"）。

## 7. 与上下游子任务的接口

- **上游子2（tool-token-budget，已归档）**：本任务复用 `estimateRuntimeMessagesTokens` / `estimateAiChatMessagesTokens` / `resolveTokenBudget` / `CONTEXT_COMPRESS_TRIGGER_RATIO` / `CompressCallModel` / `CompressCallOptions` / `ContextBudgetExhaustedError` / `ContextCompressionFailedError`。narrative 分支保持其 R2 逻辑原样（只加 `compressionMode === "narrative"` 前置）。delegated 缺口（实际连预算兜底都没接上）由本任务 task 模式补上。
- **上游 agent-call-concurrency（已归档）**：本任务在其并行执行 + 事件 agentId 基础上加压缩能力。`createAgentCallRunner` 闭包加 timeoutController + 任务 toolOptions，不改变并行分组/observation 回填/事件链。并行多子代理各自独立压缩各自 messages + 各自独立时长兜底。
- **下游助手跨 turn 持久化（`06-20-assistant-context-persistence`）**：复用本任务的 task 模式 + `compressTaskContext`，加 `assistant/context.json` 落盘 + 跨加载恢复 + 稳态循环。本任务 assistant 的 `contextUpdate` 被忽略，后续任务 C 接它落盘。
- **同父子3（tool-rename-and-glob）/子4（tool-executor-policy）**：无直接依赖。子3/子4 改工具命名/policy，不改循环调度/压缩。

## 8. 开放问题（design 已决）

- ~~任务压缩的定位 + 替换逻辑~~：`locateTaskInteractionSpan` 从末尾向前扫工具交互形态，保留最近 N=3 轮，早期摘要成 1 条 user message（§1.3 约束3/4、§2.4、§2.8）。
- ~~任务压缩摘要 prompt~~：新建 `TASK_COMPRESSION_SYSTEM_PROMPT` + `buildTaskCompressionPrompt`，任务日志风格（已做工作+结论，丢工具细节），§2.4。
- ~~任务压缩函数与 compressContext 的关系~~：新建 `compressTaskContext`（职责分明，不依赖 AgentContextSnapshot，产出 messages+摘要），§2.4。
- ~~时长兜底的实现形态~~：AbortController + setTimeout + `AbortSignal.any` 合并用户 abort，catch 区分 `timeoutController.signal.aborted` → TaskTimeoutError，§2.6。
- ~~master 兜底与新机制如何分层~~：`compressionMode` 枚举分流，narrative 保持 R2 原样，task 走多次+时长+早退，§2.7。
- ~~delegated 框架拆分 vs 合并~~：合并（保持 `buildDelegatedAgentMessages` 单条 user，仅 section 排序微调），论证 §4.1/约束3。不新建 `buildTaskAgentMessages`。
- ~~N 值（保留几轮 tool 交互）~~：N=5（§4.2）。
- ~~压缩无效早退阈值~~：下降 <10% 抛 TaskCompressionStalledError（§4.3）。
- ~~默认 timeoutMs~~：300000（5 分钟，§2.6）。
- ~~PRD R1 统一构建 helper~~：不新建共用 helper；delegated 保持 `buildDelegatedAgentMessages`，assistant 沿用 `buildEntryAgentMessages`，统一的是压缩机制（task 模式），§4.1。

**无遗留开放问题，可进入 implement.md。**
