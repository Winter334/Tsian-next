# Design — 限制机制改造（token 预算）

> 子任务2 of `06-19-tool-runtime-performance`。
> **依赖子1（tool-skill-decouple）**——子1 改了工具循环形态（use_skill 注入 SKILL.md 全文、run_script 执行 browser_script），本任务在新循环上落实 token 预算。
> **依赖底层 `agent-session-context-lifecycle`**（已交付，commit 05d9da2）——本任务复用其 `compressContext` / token 估算能力，在其"跨 turn 剧情正文压缩"之上做"turn 内工具循环体积兜底 + 去硬轮次限制"。
>
> 本文件 2026-06-20 重写。旧 design.md（基于已推翻的"丢 tool 轮次"假设）在 git 历史可查，勿据此实现。

## 0. 核心机制（一句话）

**去掉 `maxToolRoundsPerAgent` 硬轮次限制；工具循环每轮调 model 前估算 `runtimeMessages` 总 token，达 85% budget 时压剧情正文（复用底层 `compressContext`）腾空间、tool 交互全保留；turn 内压缩只触发一次，第二次达预算走"有 text 返回 / 无 text 温和报错"兜底。**

对标：OpenClaw / Hermes / Claude Code / Codex 均无硬轮次限制；Codex"达预算就压缩"思路；Tsian 比主流更精细——剧情正文/tool 交互分层，只压剧情不压 tool（tool 是过程性内容，摘要无价值且成本高）。

## 1. 架构与边界

### 1.1 涉及模块

| 层 | 文件 | 改动性质 |
|---|---|---|
| runtime-core | `apps/platform-web/src/agent-runtime/index.ts` | **核心改动**：①移除 `maxToolRoundsPerAgent` 字段 + normalize + 两处循环终止条件；②两处工具循环（native `:1161` / text `:1325`）加每轮 token 估算 + 达预算压剧情 + 一次压缩限制 + 兜底；③把 `AgentContextSnapshot` 传进工具循环（当前未传）；④抽取"重建 user message 剧情段"能力 |
| runtime-core | `apps/platform-web/src/agent-runtime/context-lifecycle.ts` | **小扩展**：新增 `estimateRuntimeMessagesTokens`（估算 `RuntimeChatMessage[]`，含 toolCalls arguments + tool content）；新增 `ContextBudgetExhaustedError`。现有 `estimateTokenCount` / `compressContext` / `resolveTokenBudget` / 常量复用不改 |
| platform-host | `apps/platform-web/src/platform-host/index.ts` | 若注入了 `maxToolRoundsPerAgent` 则移除传参（勘察确认） |
| platform-web | `apps/platform-web/src/views/AssistantView.vue` | catch 新增"上下文已满"温和兜底分支（保留已流式 thought，不 pop 占位消息） |
| contracts | `packages/contracts/src/runtime.ts` | **不改**——`maxToolRoundsPerAgent` 只在 index.ts 内部 `AgentRuntimeCollaborationPolicy`，不在 contracts |

### 1.2 不动的边界

- **底层压缩机制本身**——`compressContext` / `parseAgentContext` / `appendTurnToContext` / 压缩 prompt / 摘要风格不改。本任务复用它们，只在工具循环内新增调用点。
- **use_skill/run_script 工具循环形态**——子1 已定稿，本任务只在循环外层加 token 估算/压缩，不改 observation push、skill 注入逻辑。
- **abort 机制**（子2a/2b 已实现）——不动。压缩检查在 `assertNotAborted` 之后、model 调用之前，abort 仍优先。
- **流式 thought 推送**（`onDelta`/`onRoundEnd`/`onTool`）——不动。压缩发生在 model 调用前，已流式 thought 不受影响。
- **跨 turn 压缩时机**（底层 turn 开头压缩）——不动。turn 开头压缩 + turn 内压缩是两次独立检查，各自判断各自的内容。
- **model.config contextWindow 字段定义**——不动，只消费它。
- **agent_call 协作策略**（maxCallsPerTurn/maxDepth/historyWindows）——不动，与工具轮次独立。
- **子3（工具命名/glob）/子4（actionExecutorPolicy）**——不动。
- **token 精确计数**——不做，复用底层字符估算（`charCount*0.4 + utf8Bytes*0.25`）。
- **软轮次保底**——不做。AIRP 用户用次旗舰/旗舰模型，防死循环靠 model 可靠 + 用户 abort。
- **压缩 tool 交互**——不做。tool 交互是过程性内容，摘要无价值且成本高，用"压剧情腾空间"替代。

### 1.3 关键技术约束（勘察确认）

**约束1：剧情正文不是独立 message，是第二条 user message content 里的一段文本。**

`buildEntryAgentMessages`（index.ts:690）把剧情正文（`formatAgentContextHistory(agentContext)` 的输出：summary + recentTurns）和"当前回合"、"Workspace Agent 上下文"、"玩家本轮输入"拼成**一条 user message 的 content**。结构：

```
runtimeMessages = [
  { role: "system", content: systemPrompt },                                    // index 0
  { role: "user",   content: "当前回合:N\nWorkspace Agent 上下文:...\n最近对话:\n<剧情正文段>\n\n玩家本轮输入:..." },  // index 1
  { role: "assistant", content, toolCalls },                                      // round 0+
  { role: "tool", toolCallId, content },                                          // round 0+
  ...
]
```

→ turn 内压剧情后，要**重建 index 1 这条 user message 的"最近对话"段**，保留其它部分（当前回合/Workspace 上下文/玩家输入）。

**约束2：context 快照当前没传进工具循环。**

`callAgentModelWithWorkspaceToolsNative`（:1161）和 text 版（:1325）的参数只有 `agentContext: AgentContextEntry`（agent 配置），**没有** `AgentContextSnapshot`（剧情正文快照）。剧情正文在 `buildEntryAgentMessages` 阶段就格式化进 message 了。

→ 要在工具循环内压剧情，**必须把 `AgentContextSnapshot` 传进工具循环**，压缩后用它重建 message。

**约束3：native 与 text 循环 message shape 不同。**

- native：`runtimeMessages: RuntimeChatMessage[]`，tool 结果 = `{role:"tool", toolCallId, content}`。
- text：`nextMessages: AiChatMessage[]`，tool 结果 = `{role:"user", content: formatRuntimeWorkspaceToolObservationMessage(...)}`。

两处循环的剧情段重建逻辑要各自适配，但核心机制一致。

## 2. 数据与契约

### 2.1 移除 maxToolRoundsPerAgent

`AgentRuntimeCollaborationPolicy`（index.ts:189）移除 `maxToolRoundsPerAgent` 字段：

```ts
// before
export interface AgentRuntimeCollaborationPolicy {
  maxCallsPerTurn: number
  maxDepth: number
  historyWindows: Record<RuntimeAgentCallHistoryMode, number>
  maxToolRoundsPerAgent: number  // ← 移除
}
```

- `DEFAULT_AGENT_RUNTIME_COLLABORATION_POLICY`（:225）移除 `maxToolRoundsPerAgent: 3`。
- `normalizePolicyInteger` 对 `maxToolRoundsPerAgent` 的调用（:297-299）移除。
- 两处循环 `const maxToolRounds = ... maxToolRoundsPerAgent`（:1173, :1380）移除。
- `AgentRuntimeCollaborationPolicyInput`（:196）自动收窄（它是 `Partial<Omit<...,"historyWindows">`，去掉字段后 input 也不再有该键）。

**向后兼容**：`maxToolRoundsPerAgent` 不在 contracts，无外部契约破坏。host 若曾注入该字段，TS 编译报错提示移除（编译期发现）；运行时多余字段被忽略。

### 2.2 新增 estimateRuntimeMessagesTokens

`context-lifecycle.ts` 新增（复用 `estimateTokenCount`）：

```ts
/** 估算 RuntimeChatMessage[](native 循环)的 token 总量,含 toolCalls arguments + tool content. */
export function estimateRuntimeMessagesTokens(messages: RuntimeChatMessage[]): number {
  return messages.reduce((sum, msg) => {
    let tokens = estimateTokenCount(msg.content)
    if (msg.role === "assistant" && msg.toolCalls) {
      // toolCalls arguments 是 Record<string,unknown>,JSON.stringify 计入体积
      for (const call of msg.toolCalls) {
        tokens += estimateTokenCount(call.name)
        tokens += estimateTokenCount(JSON.stringify(call.arguments))
      }
    }
    return sum
  }, 0)
}
```

text 循环的 `AiChatMessage[]` 已有 `estimateAiChatMessagesTokens`（context-lifecycle.ts:49）可复用——text 循环的 tool 结果是 user message content（已被 `formatRuntimeWorkspaceToolObservationMessage` 序列化进 content），`estimateAiChatMessagesTokens` 累加 content 即可覆盖。故 text 循环直接用 `estimateAiChatMessagesTokens`，native 循环用新的 `estimateRuntimeMessagesTokens`。

### 2.3 turn 内压缩接入点

工具循环新增参数：`agentContextSnapshot: AgentContextSnapshot`（可变，压缩后更新）+ `contextTokenBudget: number` + `compressCallModel: CompressCallModel`。

每轮调 model 前（`assertNotAborted` 之后、`callModel(Native)` 之前）：

```ts
// 伪代码(native 循环, text 循环对称)
const totalTokens = estimateRuntimeMessagesTokens(runtimeMessages)
if (totalTokens > triggerThreshold) {
  if (compressedThisTurn) {
    // 第二次达预算 → 兜底(§2.5)
    const finalText = lastRoundText.trim()
    if (finalText) {
      recordTranscript(..., { status: "completed" })
      return finalText
    }
    throw new ContextBudgetExhaustedError()
  }
  // 第一次达预算 → 压剧情(复用底层 compressContext)
  const compressed = await compressContext(
    agentContextSnapshot, triggerThreshold, compressCallModel, compressOptions,
  )
  agentContextSnapshot = compressed
  compressedThisTurn = true
  rebuildHistorySectionInMessages(runtimeMessages, agentContextSnapshot)  // §2.4
  emitTrace({ type: "context_compressed_in_turn", ... })
}
```

**budget / 阈值复用底层**：
- `budget = resolveTokenBudget(input.contextTokenBudget)`（底层已 resolve 好，从 `AgentRuntimeTurnInput.contextTokenBudget` 传进来，:111）。
- `triggerThreshold = budget * CONTEXT_COMPRESS_TRIGGER_RATIO`（0.85，底层常量复用）。
- `compressContext` 的 `threshold` 参数传 `triggerThreshold`（压到 85% 以下）。

### 2.4 重建 user message 剧情段

新增纯函数 `rebuildHistorySectionInRuntimeMessages`（native）/ `rebuildHistorySectionInAiChatMessages`（text）。

native 循环 index 1 的 user message content 结构是 `\n` 分隔的多段，"最近对话："后到"玩家本轮输入："前是剧情段。**设计选择**：不靠脆弱的字符串定位，而是**工具循环入口按已有锚点拆分 user message，缓存非剧情部分，压缩后用新 `formatAgentContextHistory` 重新拼接**。

`buildEntryAgentMessages`（:722-734）的 user content 拼接已有 `"最近对话："` 和 `"玩家本轮输入："` 两个锚点字符串。工具循环入口用这两个锚点 split，得到 `[prefix, historySection, suffix]`：

```ts
// 工具循环入口(伪代码)
const userContent = runtimeMessages[1].content  // 第二条 user message
const [prefix, rest1] = splitOnce(userContent, "最近对话：")
const [historySection, suffix] = splitOnce(rest1, "玩家本轮输入：")
// 缓存 prefix + suffix,压缩后重组:
runtimeMessages[1] = {
  role: "user",
  content: prefix + "最近对话：" + formatAgentContextHistory(newSnapshot) + suffix,
}
```

**不改 `buildEntryAgentMessages`，不改 `formatAgentContextHistory`**——靠已有锚点字符串拆分。`splitOnce` 是工具内小 helper（按首次出现位置切一刀）。

text 循环同理（`nextMessages[1]` 是同样的 user message 结构）。

### 2.5 ContextBudgetExhaustedError + 兜底

新增错误类（`context-lifecycle.ts`，与 `ContextCompressionFailedError` 同文件）：

```ts
/** turn 内第二次达预算(压缩已用过一次)兜底:上下文已满. */
export class ContextBudgetExhaustedError extends Error {
  constructor() {
    super("上下文已满，无法继续本轮探索。请开始新会话或精简对话。")
    this.name = "ContextBudgetExhaustedError"
  }
}
```

**兜底行为**（第二次达预算时）：
1. 取模型**最后一轮**的 text 输出（thought / 半截回复，已流式推过 UI）。
2. `finalText = lastRoundText.trim()`，**有内容** → 记 transcript(completed) + 返回 finalText（尽力而为，不打断用户）。
3. **无内容** → `throw new ContextBudgetExhaustedError()`。

**AssistantView catch 处理**（与 `ContextCompressionFailedError` 同路径）：
- 对 `ContextBudgetExhaustedError`：保留已流式 thought + 显示该温和提示，**不 pop 占位消息**、不设 errorMessage（用 assistantMsg.content 承载提示，与 abort 分支对称——都是"非失败的中止"）。

### 2.6 循环终止条件（新）

两处循环 `for (let round = 0; round <= maxToolRounds; round += 1)` 改 `for (let round = 0; ; round += 1)`，终止条件：

1. `finishReason === "stop"` 或 `toolCalls.length === 0` → 返回 text（正常结束，现有逻辑保留）。
2. 第一次达预算 → 压剧情，`compressedThisTurn = true`，继续循环。
3. 第二次达预算 → 有 finalText 返回 / 无 finalText 抛 `ContextBudgetExhaustedError`（§2.5）。
4. abort（`assertNotAborted` 抛 AbortError，现有逻辑保留）。

不再有 `round >= maxToolRounds` 分支。`for(;;)` 无上限，靠 stop / abort / 预算兜底三条件终止——256k 预算确保最终一定终止（低增长死循环由用户 abort + 第二次达预算兜底终止）。

## 3. 数据流

### 3.1 正常 turn（不触发压缩）

```
turn 开头: 底层检查 context.json → 不超 85% → 不压缩
  → buildEntryAgentMessages(agentContext) → messages
  → 工具循环:
     round 0: 估算 tokens < 阈值 → callModel → stop → 返回
turn 结束: appendTurnToContext + 持久化
```

### 3.2 turn 开头触发底层压缩，turn 内不触发

```
turn 开头: 底层检查 context.json → 超 85% → compressContext → 更新 agentContext
  → buildEntryAgentMessages(newAgentContext) → messages(剧情已压)
  → 工具循环:
     round 0-5: tool 交互累积,但 tokens 始终 < 阈值(剧情压过后空间够) → stop → 返回
turn 结束: appendTurnToContext + 持久化 compressedContext
```

### 3.3 turn 内触发一次压缩

```
turn 开头: 底层不压缩(未超 85%)
  → messages(剧情未压, 占大头)
  → 工具循环:
     round 0-2: tool 交互累积
     round 3 调 model 前: tokens > 85% → 第一次 → compressContext(剧情)
        → 重建 history 段 → compressedThisTurn=true → 继续
     round 4-6: tool 交互继续, tokens < 阈值(剧情压过腾了空间) → stop → 返回
turn 结束: appendTurnToContext + 持久化 compressedContext(turn 内压的也要写回)
```

### 3.4 turn 内第二次达预算（兜底）

```
  → 工具循环:
     round N 调 model 前: tokens > 85% → compressedThisTurn=true → 第二次
       → lastRoundText 有内容 → 返回 finalText(尽力而为)
       → lastRoundText 空 → throw ContextBudgetExhaustedError → AssistantView 温和提示
```

### 3.5 turn 内压缩结果的持久化

turn 结束时 `AgentRuntimeTurnContextUpdate`（index.ts:1609）已有 `compressedContext` 字段。当前它只装 turn 开头压缩的结果。**扩展**：turn 内压缩的结果也要带出来——`compressedContext` 改为"本 turn 任何时点压缩后的最新快照"（turn 开头或 turn 内，取最后一次）。host 落盘逻辑（R4 写 context.json）不变，只是写入的快照可能是 turn 内压过的。

工具循环要把 turn 内压缩后的 `agentContextSnapshot` 透传回 `runAgentRuntimeTurn`，用于组装 `contextUpdate.compressedContext`。

## 4. 权衡

### 4.1 为什么压剧情而非丢 tool 交互（核心权衡）

- 压剧情腾空间大（K=5 轮正文 → 1 段摘要，可腾几十~上百 k）；丢 tool 轮次腾空间小（几组 observation）。
- 压剧情**不丢 tool 上下文** → 模型记得探索进度 → 不重复探索 → 不震荡。这是本方案相对"丢 tool 轮次"方案的关键优势（旧 design 的丢 tool 方案有"接近临界值时 tool 窗口太小→丢上下文→重复探索→震荡"缺陷，本方案从根上避免）。
- 剧情摘要有质量保证（底层叙事梗概 prompt 已验证）；tool 摘要无价值（过程性内容）。
- 代价：turn 内压缩要调 model（重）。但"通常压缩一次够探索用"（用户判断）→ 不会频繁触发。

### 4.2 为什么 turn 内只压一次

- 通常一次压缩腾的空间足够整个 turn 的工具探索。
- 第二次达预算说明不正常（剧情已压无可压 + tool 仍持续增长 = 大概率工具死循环）。
- 第二次压缩收益小（recentTurns 可能已剩 K=5 压不动）且破坏上下文（细节二次丢失）。
- 一次限制 + 兜底 = "信任 model 但简单兜底"的边界。

### 4.3 已知残留风险

**工具死循环**：模型重复探索，tool 交互持续增长。第一次压缩后若仍持续增长到第二次达预算 → 兜底（有 text 返回 / 无 text 报错）终止。不加软轮次保底，靠 model 可靠 + 用户 abort + 这个兜底三层。

### 4.4 turn 开头压缩 vs turn 内压缩的关系

两者不冲突、不重复：
- turn 开头（底层）：检查 context.json 快照 token，超 85% 压剧情正文。作用于"跨 turn 累积的剧情"。
- turn 内（本任务）：检查 runtimeMessages 总 token（剧情 + tool 交互），超 85% 压剧情正文。作用于"turn 内 tool 交互累积撑大"。
- turn 开头压过后，turn 内第一次检查大概率不超（剧情已小）→ turn 内不重复压。
- turn 开头没压（剧情未超 85%），但 tool 交互累积撑大 → turn 内压。这时压的也是剧情（腾空间给 tool）。

两者用同一 `compressContext`、同一阈值、同一 budget，但触发时机和检查内容不同。turn 内压缩是 turn 开头压缩的"补充时机"——对标 Codex"达预算就压缩"，只是 Tsian 压的是剧情而非混合内容。

### 4.5 为什么不加软轮次保底

- AIRP 用户用次旗舰/旗舰模型（deepseek-v4-pro-auto 等），model 自身行为可靠性足够。
- 主流框架（Hermes/Claude Code）靠 model 可靠 + 用户中断，无软轮次。
- 软轮次在"低 token 增长的深度探索"场景会先于 256k 预算误掐正常多步探索。
- Tsian 已有 abort 机制（停止按钮），用户观察异常可主动终止。

## 5. 兼容性与回滚

- **配置 shape 破坏**：`AgentRuntimeCollaborationPolicy.maxToolRoundsPerAgent` 移除。不在 contracts，原型期可接受。host 若显式传该字段，TS 编译报错兜底捕获。
- **无数据迁移**：token 预算是运行时机制。context.json 格式不变（turn 内压缩产物与 turn 开头压缩产物同 schema `tsian.agent.context.v1`），无持久化兼容问题。
- **回滚**：本任务改的是 runtime 内部逻辑 + 一个新错误类 + AssistantView catch 分支，无数据迁移、无 contracts 变更。回滚 = revert 该任务提交，旧 `maxToolRoundsPerAgent` 逻辑从 git 恢复。

## 6. 验证策略

- **构建**：`npm run build`（含 contracts）通过。
- **单测**：`estimateRuntimeMessagesTokens` 纯函数单测（含 toolCalls arguments 计入）；`rebuildHistorySectionInRuntimeMessages` 纯函数单测（锚点拆分/重组正确，非剧情部分保留）。
- **真实 API 实测**：
  - 多步探索不被卡死（让模型探索 6+ 轮，无 round limit 报错）。
  - 人为构造超长上下文（大文件 read 累积）触发 turn 内压缩，观察压缩后继续循环不崩、tool 交互保留、模型不重复探索。
  - 第二次达预算兜底：构造极端场景观察"有 text 返回 / 无 text 温和报错"。
  - 关闭重开存档后 master agent 上下文从 context.json 恢复（底层已验证，本任务不改此路径）。

## 7. 与上下游子任务的接口

- **上游子1（tool-skill-decouple）**：本任务在子1 定稿的循环形态上实现。子1 的 SKILL.md 全文注入会增加单轮 message 体积，token 估算已纳入（content 全计入）。turn 内压缩只压剧情不动 tool 交互，注入的 skill 全文随 tool 交互保留——不会因压缩丢失 skill 内容。
- **上游底层（agent-session-context-lifecycle）**：复用 `compressContext` / `estimateTokenCount` / `resolveTokenBudget` / `CONTEXT_COMPRESS_TRIGGER_RATIO` / `CompressCallModel`。不改底层函数，只在工具循环内新增调用点。turn 内压缩结果通过 `contextUpdate.compressedContext` 透传给 host 落盘。
- **下游子3（tool-rename-and-glob）**：无直接依赖。子3 改工具命名/schema，不改循环结构。
- **下游子4（tool-executor-policy）**：无直接依赖。子4 接通 policy，不改循环结构。

## 8. 开放问题（design 已决）

- ~~N 值（保留几组 tool 轮次）~~：已否决"丢 tool 轮次"方案，改为压剧情，无 N 值。
- ~~maxToolRoundsPerAgent 移除 vs 保留~~：移除（无 contracts 依赖）。
- ~~压缩时 tool 交互怎么处理~~：全保留，只压剧情。
- ~~第二次达预算兜底~~：有 text 返回 / 无 text 报错。
- ~~turn 内压缩检查时机~~：每轮调 model 前检查（含 round 0）。
- ~~turn 内压缩次数~~：只允许一次。
- ~~软轮次保底~~：不加（信任 model 可靠 + 用户 abort）。

**无遗留开放问题，可进入 implement.md。**
