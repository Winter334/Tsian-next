# Design — 限制机制改造（token 预算）

> **⚠️ 已过时，待重写（2026-06-19）**
> 本文档基于错误假设（历史对话是上下文大头、压缩可只在 turn 内做、token 预算独立可做）。规划讨论已推翻这些假设——见 prd.md "讨论结论沉淀"。真实形态需在新基础任务 `agent-session-context-lifecycle` 落实 master agent 上下文生命周期后重新设计。本文档保留作历史参考，**勿据此实现**。

---

> 子任务2 of `06-19-tool-runtime-performance`。**依赖子1（tool-skill-decouple）**——子1 改了工具循环形态（use_skill 注入 SKILL.md 全文、run_script 执行 browser_script），token 预算与压缩机制需在新循环上实现。本文件解决 PRD 留给 design 的 4 个开放问题，并定下实现边界、契约与权衡。

## 1. 架构与边界

### 1.1 涉及模块

| 层 | 文件 | 改动性质 |
|---|---|---|
| runtime-core | `apps/platform-web/src/agent-runtime/index.ts` | **重构核心**：两处工具循环（native `:1099` / text `:1263`）终止条件从 `round >= maxToolRounds` 改为 token 预算压缩兜底；新增每轮 model 调用前的 token 估算 + 超限压缩；移除 `maxToolRoundsPerAgent` 字段及 normalize |
| runtime-core | `apps/platform-web/src/agent-runtime/token-budget.ts` | **新文件**：token 估算 + 压缩策略纯函数（无副作用，可单测） |
| platform-host | `apps/platform-web/src/platform-host/index.ts` | collaborationPolicy 注入点：移除 `maxToolRoundsPerAgent` 传参（若有） |
| contracts | `packages/contracts/src/runtime.ts` | 若 `AgentRuntimeCollaborationPolicy` 在 contracts 定义则移除字段；**倾向 index.ts 内部定义则只改 index.ts**（见 §2.1 勘察） |
| platform-web | `apps/platform-web/src/config/ai.ts` | `contextWindow` 字段已存在（`:22`），本任务只落实 enforcement——读 model.contextWindow 作为 token 上限覆盖源 |
| platform-web | `apps/platform-web/src/views/AssistantView.vue` | catch 逻辑新增"上下文已满"温和兜底分支（`:665`） |

### 1.2 不动的边界

- **use_skill/run_script 工具循环形态**——子1 已定稿，本任务只在循环外层加 token 估算/压缩，不改循环内的 observation push、skill 注入逻辑。
- **abort 机制**（停止按钮，子2a/2b 已实现）——不动。压缩逻辑在 `assertNotAborted` 之后、model 调用之前，abort 仍优先。
- **流式 thought 推送**（`onDelta`/`onRoundEnd`/`onTool`）——不动。压缩发生在 model 调用前，已流式的 thought 不受影响；温和兜底保留已推 thought。
- **model.config 的 contextWindow 字段定义**——不动（字段已存在 `:22`，本任务只消费它做 enforcement）。
- **agent_call 协作策略**（maxCallsPerTurn/maxDepth/historyWindows）——不动，与工具轮次独立。
- **工具命名/glob/patch-validate 移除**——不动（归子3）。
- **actionExecutorPolicy 接通**——不动（归子4）。
- **token 精确计数**（tokenizer 依赖）——不做，MVP 用字符数估算（PRD 明确不做）。

### 1.3 循环结构现状（勘察锚点）

两处循环结构对称，终止条件改造点一致：

- **native 循环** `callAgentModelWithWorkspaceToolsNative`（index.ts:1099-1261）：
  - `for (let round = 0; round <= maxToolRounds; round += 1)`（`:1131`）
  - round limit 耗尽抛错（`:1183-1198`）
  - `runtimeMessages: RuntimeChatMessage[]`（`:1108`，可变数组，循环内 push）
- **text 循环** `callAgentModelWithWorkspaceTools`（index.ts:1263-1426）：
  - `for (let round = 0; round <= maxToolRounds; round += 1)`（`:1320`）
  - round limit 耗尽抛错（`:1352-1369`）
  - `nextMessages: AiChatMessage[]`（`:1315`，不可变风格，循环内重新赋值）

## 2. 数据流与契约

### 2.1 maxToolRoundsPerAgent 字段处置（PRD R1 决议）

**勘察**：`AgentRuntimeCollaborationPolicy`（index.ts:153-158）在 **index.ts 内部定义**，不进 contracts。`DEFAULT_AGENT_RUNTIME_COLLABORATION_POLICY`（`:181`）含 `maxToolRoundsPerAgent: 3`。`normalizeAgentRuntimeCollaborationPolicy`（`:249`）normalize 该字段。输入类型 `AgentRuntimeCollaborationPolicyInput`（`:160`）是 Partial。

**决议（PRD 倾向移除，YAGNI）**：**移除字段**。原型期可接受配置 shape 破坏性。理由：
- 保留停用会留死字段，调用方误配仍不生效，语义混乱。
- 字段在 index.ts 内部（非 contracts），无跨包消费者，移除影响面小。
- 移除后 `normalizeAgentRuntimeCollaborationPolicy` 少一行 normalize；`DEFAULT_AGENT_RUNTIME_COLLABORATION_POLICY` 少一个字段；`AgentRuntimeCollaborationPolicy` interface 少一个字段。

**需 grep 确认的引用点**：
- `apps/platform-web/src/agent-runtime/index.ts`（3 处定义/默认/normalize + 2 处循环读取 `:1111`/`:1318`）
- `apps/platform-web/src/platform-host/index.ts`（若注入 collaborationPolicy 时显式传 maxToolRoundsPerAgent）
- 任何调用 `normalizeAgentRuntimeCollaborationPolicy` 传该字段的外部调用方

移除后循环读取点（`:1111`/`:1318`）一并删除，循环终止条件改由 token 预算接管（§2.3）。

### 2.2 token 估算契约（PRD R3）

**估算函数**（新文件 `token-budget.ts`）：

```ts
const utf8Encoder = new TextEncoder()

/** 粗略 token 估算（中英混合优化）：字符数*0.4 + UTF-8 字节数*0.25。
 *  中文 1 字符(3 字节)≈1.15 token（接近真实 ~1-1.5）；英文 1 字符(1 字节)≈0.65 token
 *  （高估 2.6×，对软预算安全——早压缩优于晚压缩）。不引入 tokenizer 依赖（PRD 明确不做）。 */
export function estimateTokenCount(text: string): number {
  const charCount = text.length
  const byteCount = utf8Encoder.encode(text).length
  return Math.ceil(charCount * 0.4 + byteCount * 0.25)
}

/**
 * 估算一组 RuntimeChatMessage（native 循环）的 token 总量。
 * 遍历每条 message：content + assistant.toolCalls 的 arguments（JSON 序列化）+ tool.toolCallId。
 */
export function estimateRuntimeMessagesTokens(messages: RuntimeChatMessage[]): number

/**
 * 估算一组 AiChatMessage（text 循环）的 token 总量。
 * AiChatMessage 只有 role + content，直接累加 content。
 */
export function estimateAiChatMessagesTokens(messages: AiChatMessage[]): number
```

**精度决议（PRD 开放问题 Q2）**：`Tokens = 字符数 * 0.4 + UTF-8 字节数 * 0.25`。理由：
- **按字符类别摊算**（字节数按 UTF-8，providers 实际 tokenize UTF-8 字节流；字符数用 `str.length`）：
  - 英文/ASCII 1 字符(1 字节) → 0.65 token（真实 ~0.25，**高估 2.6×**）
  - 中文 1 字符(3 字节) → 1.15 token（真实 ~1.0–1.5，**接近**）
  - Emoji 代理对(2 字符/4 字节) → 1.8 token（真实 ~1–3，合理）
- **误差倒向安全侧**：对"软上限触发压缩"而言，**早压缩 > 晚压缩**。中文准确、英文保守高估，正好把误差倒向"压缩触发偏早"的安全方向——避免原 `/4`（中文低估 4-6×）导致压缩触发偏晚、逼近 provider 真实 contextWindow 才动手的危险（provider 会拒超长请求）。
- **契合 Tsian 内容画像**：中文为主（prompt/AGENT.md/SOUL.md/对话）+ 英文代码为辅。公式对主内容准确、对次内容保守高估。
- 英文高估 2.6× 的代价：纯代码真实 10k token 估成 26k，256k 预算在真实 ~98k 时触发——仍远低于主流 128k-200k 窗口，安全可接受。
- 零依赖（`TextEncoder` 内置），`estimateTokenCount` 仍是单一替换点，后续若需精确（引入 tokenizer）只改此函数。
- 字节计数用模块级 hoisted `const utf8Encoder = new TextEncoder()`（避免每轮每消息重复构造）。

**toolCalls arguments 计入**：native 循环 assistant message 的 `toolCalls[].arguments`（Record）JSON 序列化后计入。tool 角色的 `toolCallId` 计入（短，但批量时累加）。system prompt（首条 system role）计入。

### 2.3 token 预算上限与压缩触发（PRD R2）

**上限计算**：

```ts
const DEFAULT_CONTEXT_TOKEN_BUDGET = 256_000
const CONTEXT_COMPRESS_TRIGGER_RATIO = 0.85   // 85% 触发压缩（留 15% 余量）

function resolveTokenBudget(modelContextWindow: number | null | undefined): number {
  // 直接用 model 配置的 contextWindow（尊重用户花钱买的窗口能力）；
  // 没配或非法时兜底 256k 默认。不做 256k 封顶——大模型用满自己的窗口是用户意图，
  // 且 85% 压缩阈值（§2.3）保证不会真顶到 provider 真实上限。
  if (typeof modelContextWindow === "number" && modelContextWindow > 0) {
    return modelContextWindow
  }
  return DEFAULT_CONTEXT_TOKEN_BUDGET
}
```

> **为什么直接用配置值而非 min(256k, 配置值)**（决议，替代原 min 方案）：用户配了 1M 窗口的模型就是要用它，256k 封顶浪费用户配置能力。原方案"防膨胀"的顾虑由两个机制消解：① 85% 压缩阈值让上下文在撞 provider 真实上限前主动压缩（留 15% 余量吸收估算偏差）；② 压缩后回落到阈值以下，继续循环不无限增长。小模型配小窗口自然早压缩，大模型用满大窗口——行为贴合用户配置意图。

**压缩触发阈值 = 85%**（非 100%）。理由：
- **吸收估算偏差**：我们的 `estimateTokenCount`（§2.2）与 provider 真实 token 计数有偏差（尤其英文高估 2.6×，但 provider 真实可能更低；中文准确但 provider 真实可能略高）。等 100% 才压缩，估算误差可能导致"我们估 100% 但 provider 真实已 105%"→ provider 拒请求。85% 留 15% 余量吸收偏差。
- **给压缩后留空间**：压缩触发时上下文已很满，模型可用空间小。85% 触发、压缩后回落到 ~70%，模型有更多空间继续任务。
- 取 85%（80-90% 中间偏保守）：80% 偏早可能信息没充分利用就压缩，90% 偏晚余量只留 10% 吸不住大偏差。85% 是平衡点，作为常量可后续实测调。

**contextWindow 来源**：`AgentRuntimeModelCallOptions` / `AgentRuntimeTurnInput` 当前不直接携带 model.config。勘察 `runAgentRuntimeTurn`（index.ts:1428）的 capabilities——需确认 contextWindow 如何传到循环。**方案**：在 `WorkspaceToolLoopOptions` 或 capabilities 增 `contextTokenBudget?: number`（已 resolve 好的预算值），由 platform-host 注入时调 `resolveTokenBudget(model.contextWindow)`。这样循环内不关心 config 细节，只消费预算值。具体注入点见 §3.1。

**触发时机**：每轮 model 调用**前**（`callModelNative`/`callModel` 之前），估算当前 `runtimeMessages`/`nextMessages` token 总量，超 `budget * 0.85` 则先压缩，压缩目标回到 `budget * 0.85` 以下（压缩函数的 budget 参数传 `budget * 0.85`，即压缩目标线），压缩后再估一次；压缩后仍超阈值则抛温和错误（§2.5）。

```ts
// native 循环每轮开头（assertNotAborted 之后、callModelNative 之前）
const budget = toolOptions.contextTokenBudget
const triggerThreshold = budget * CONTEXT_COMPRESS_TRIGGER_RATIO   // 85% 触发线
let estimated = estimateRuntimeMessagesTokens(runtimeMessages)
if (estimated > triggerThreshold) {
  runtimeMessages = compressRuntimeMessages(runtimeMessages, triggerThreshold)
  capabilities.emitTrace?.({ type: "context_compressed", ... data: { round, beforeTokens: estimated, budget, triggerThreshold } })
  estimated = estimateRuntimeMessagesTokens(runtimeMessages)
  if (estimated > triggerThreshold) {
    throw new ContextBudgetExhaustedError(options.debugLabel)
  }
}
```

> **压缩目标 = 阈值线（85%），非 budget（100%）**：`compressRuntimeMessages` 的第二个参数是"压缩目标线"，传 `triggerThreshold`（85% budget）而非 `budget`。丢弃轮次直到 < 85%——否则压缩后刚好 99%，下一轮稍微增加又触发，频繁压缩。温和兜底条件相应改为"压缩后仍 > 85%"（连降到 85% 都做不到，如单条 message 占 90%）→ 比"仍 > 100%"更早更安全地兜底。

### 2.4 压缩策略（PRD R2 MVP）

**策略**：从 `runtimeMessages` 中间丢弃最早的 tool 调用/observation 轮次，保留 system + 最初 user + 最近 N 轮。

**N 值决议（PRD 开放问题 Q1）**：**N = 2**（保留最近 2 轮 tool 交互）。理由：
- 2 轮足够模型继续当前任务（最近一次 tool 结果 + 上一次的 tool 调用上下文）。
- 3 轮偏保守，压缩力度小，可能压缩后仍超限（尤其 SKILL.md 全文注入后单轮体积大）。
- 压缩可重复触发——若 2 轮后仍超，下一轮再压缩又丢 2 轮，逐步收敛。

**保留规则**（native `RuntimeChatMessage[]`，借鉴 Codex 非对称保护 + 工具产出修剪，详见 §2.4a）：
1. **始终保留**：所有 `role === "system"`（system prompt，通常首条）。
2. **始终保留**：第一条 `role === "user"`（最初 user message，任务发起）。**对齐 Codex 非对称保护**：用户原始意图含最高密度约束，绝不压缩。Tsian 单 turn 内真实用户输入只有最初一条（后续轮次的 user message 是 tool observation 或框架注入的 SKILL.md，非用户原话），故"保留第一条 user"已等价于 Codex"保留所有用户原话"。
3. **始终保留**：最近 N=2 个"tool 交互轮次"的**完整内容**。一个轮次 = 一条 assistant(含 toolCalls) + 其后紧跟的所有 role==="tool" observations + 该轮注入的 skill 全文 user message（若有）。
4. **修剪（非丢弃）**：中间的 tool 交互轮次**不整轮删除**，而是把 `role==="tool"` observation 的 `content` 替换为占位符 `[Tool output omitted]`，**保留 assistant toolCall + tool 角色占位**——模型仍能看到"第 3 轮调过 read('a.ts')"的事实，只是看不到 a.ts 具体内容。从最早可修剪轮开始逐轮修剪，每轮修剪后重估，≤ 阈值即停。
5. **修剪后仍超**：若所有可修剪轮都已修剪仍 > 阈值，再从最早修剪轮开始**整轮删除**（连 assistant toolCall 一起丢），每删一轮重估，≤ 阈值即停。
6. **保留顺序**：system → 最初 user → [中间轮（含修剪后的）] → 保留的最近 N 轮（按原顺序）。

**为什么修剪优于整轮丢弃（借鉴 Codex 工具产出修剪）**：
- 保留轮次结构（assistant toolCall + tool 占位）让模型知道自己做过什么，避免重复调用同一工具空转。
- 纯函数可做（替换 content 字符串），不引入额外 model 调用成本（与摘要式压缩不同，见 §2.4b）。
- tool observation 通常是体积大头（read 大文件、大 JSON 返回），修剪它收益最大；assistant toolCall 的 arguments 体积小，保留成本低。

**压缩提示注入（PRD 开放问题 Q4 决议）**：**注入**。压缩发生后，在压缩后的 messages 里、保留段之前插一条 user message：

```
[上下文已压缩] 早期的工具调用结果已被替换为占位符以腾出空间（你仍能看到调用过哪些工具，但具体输出已省略），最近 2 轮工具交互完整保留。如需早期工具的详细输出，请重新调用相关工具。
```

让模型知道早期信息可能不在了 + 明确告知"调用事实保留、输出省略"，引导它按需重调而非假设输出仍在。

**实现**（`compressRuntimeMessages` 纯函数）：

```ts
const TOOL_OUTPUT_OMITTED = "[Tool output omitted]"

export function compressRuntimeMessages(
  messages: RuntimeChatMessage[],
  budget: number,            // 压缩目标线（调用方传 budget * 0.85）
  keepRecentRounds = 2,
): RuntimeChatMessage[] {
  // 1. 分离 system + 最初 user（前缀保留段，永不压缩）
  // 2. 剩余按 tool 交互轮次分组（assistant + 其 tool observations + 注入 skill user）
  // 3. 标记最近 keepRecentRounds 轮为"完整保留"
  // 4. 第一遍：从最早可修剪轮开始，把 role==="tool" 的 content 替换为 TOOL_OUTPUT_OMITTED
  //    （保留 assistant toolCall + tool 角色占位）；每轮修剪后重估，≤ budget 即停
  // 5. 第二遍（若第一遍修剪完仍 > budget）：从最早已修剪轮开始整轮删除
  //    （连 assistant toolCall 一起丢）；每删一轮重估，≤ budget 即停
  // 6. 若发生了修剪或删除，插入压缩提示 user message
  // 7. 返回 [前缀保留段, 压缩提示?, 中间轮（含修剪/删除后的）, 保留的最近 N 轮]
}
```

**text 循环 `AiChatMessage[]` 压缩**：text 协议的 tool 交互是 assistant(content含工具块) + user(observation) 两条一组。压缩策略对称：保留 system + 最初 user + 最近 N=2 组完整；中间组把 user(observation) 的 content 替换为占位符、保留 assistant(content含工具块)；第二遍整组删除。`compressAiChatMessages` 同构实现。

> **text 协议特殊性**：text 模式 assistant content 内含 `<tool_call>` 块（工具调用声明）、user content 是 observation 格式化文本。修剪只替换 user(observation) content，不动 assistant content（保留工具调用声明块，模型能看到自己调过什么）。不解析块内结构（保持简单）。

### 2.4a 借鉴 Codex 压缩策略的对齐说明

对照 Codex 三大策略的取舍：

| Codex 策略 | Tsian 取舍 | 理由 |
|---|---|---|
| **单层交接棒**（开新 session + 旧 session 产出交接文档） | **暂不，记为未来演进**（§2.4b） | 需在工具循环中途插一次额外 model 调用生成摘要，PRD 明确"MVP 不做摘要式压缩"；Tsian 是运行时 turn 内循环（非 CLI 无状态 session），中途开新 turn 会丢流式 thought/sessionState。实测若"修剪+提示"仍频繁失忆再升级 |
| **非对称保护**（用户原话不压缩，只压模型产出） | **已对齐** | Tsian 单 turn 内真实用户输入 = 第一条 user message，§2.4 规则2"保留第一条 user"已等价。框架注入的 SKILL.md user message 属"模型产出性质"（可经 use_skill 重新激活），不纳入用户原话保护 |
| **工具产出修剪**（物理修剪旧 tool output 为占位符，先于 LLM 压缩） | **直接借鉴** | §2.4 规则4/5：把 `role==="tool"` content 替换为 `[Tool output omitted]`，保留轮次结构。纯函数可做，不引入 model 调用成本，信息保留度↑（模型仍知调用过哪些工具） |

### 2.4b 未来演进：摘要式压缩 / 交接棒（明确不做，MVP）

当前 MVP 用"工具产出修剪 + 占位符 + 压缩提示"（§2.4），不引入额外 model 调用。未来若实测发现模型频繁失忆（修剪后丢失早期 tool 输出导致重复空转），可升级为 Codex 式"交接棒"：压缩时调一次 model 生成被修剪轮次的摘要，替代占位符。这会把 `compressRuntimeMessages` 从纯函数变为 async（需 `capabilities.callModel`），且要处理"压缩调用本身也耗 token/可能失败"的递归问题——复杂度显著上升，MVP 不值。

### 2.5 温和兜底错误（PRD R4）

**新错误类型**（token-budget.ts）：

```ts
export class ContextBudgetExhaustedError extends Error {
  constructor(debugLabel: RuntimeTraceDebugLabel) {
    super(
      `${debugLabel} 上下文已满，无法继续。请开始新会话或精简对话历史。`,
    )
    this.name = "ContextBudgetExhaustedError"
  }
}
```

**抛出条件**：压缩后估算仍 > `budget * 0.85`（阈值线）——即连降到 85% 都做不到的极端情况（如单条 message 占 90% budget，或一个巨型 SKILL.md / 超长 tool output 无法被轮次丢弃压缩）。比"仍 > 100% budget"更早兜底，更安全。

**AssistantView catch 处理**（AssistantView.vue:665-684）：

```ts
} catch (error) {
  flushRemaining()
  const aborted = error instanceof Error && error.name === "AbortError"
  const budgetExhausted = error instanceof Error && error.name === "ContextBudgetExhaustedError"
  if (aborted) {
    // 现有：保留半截 + （已停止）
  } else if (budgetExhausted) {
    // 新增：保留已流式 thought + 温和提示，不 pop 占位消息
    if (assistantMsg.content) {
      assistantMsg.content = `${assistantMsg.content}\n\n_（上下文已满，请开始新会话）_`
    } else {
      assistantMsg.content = "上下文已满，请开始新会话或精简对话历史。"
    }
    await persistCurrentSession()
  } else {
    // 现有：errorMessage + 可能 pop
  }
}
```

**关键**：budgetExhausted 分支**不 pop 占位消息**、**不设 errorMessage**（用 assistantMsg.content 承载提示，与 abort 分支对称——都是"非失败的中止"）。

### 2.6 maxToolRounds 移除后的循环终止条件

移除 `round >= maxToolRounds` 后，循环终止条件改为：

1. **正常结束**：`result.finishReason === "stop"` 或 `toolCalls.length === 0`（现有逻辑保留）。
2. **token 预算耗尽**：压缩后仍超 → 抛 `ContextBudgetExhaustedError`（§2.5）。
3. **abort**：`assertNotAborted` 抛 AbortError（现有逻辑保留）。

**循环变为无上限 for 循环**：

```ts
for (let round = 0; ; round += 1) {
  assertNotAborted(options.signal)
  // token 预算检查 + 压缩（§2.3）
  const result = await capabilities.callModelNative!(runtimeMessages, callOptions, tools)
  // ... 现有 finishReason/toolCalls 处理 ...
  if (result.finishReason === "stop" || result.toolCalls.length === 0) {
    return result.text.trim()  // 正常结束
  }
  // ... 执行 tools、push observation、注入 skill ...
}
```

> **无轮次软 cap，纯 token 预算 + 用户 stop 兜底**：不设 `MAX_TOOL_ROUNDS_SOFT_CAP`。理由（决议，替代原 50 软 cap 方案）：
> - PRD 核心诉求是"几乎无轮次限制感"，任何软 cap 在触发时都产生"被掐感"，只是阈值更高；50 轮在"低 token 增长的深度探索"（list→read 逐层探小文件，每轮 < 1k tokens）场景会**先于 256k 预算触发**，误掐正常多步探索——与 PRD 初衷相悖。
> - 主流框架（Claude Code 等）靠 token 预算 + 用户手动 stop，无自动轮次 cap。Tsian 已有 abort 机制（AssistantView 停止按钮，子2a/2b 实现），用户观察模型陷入循环时可主动终止。
> - 256k 预算确保最终一定终止（不会真无限）：即便每轮只增 500 tokens，512 轮也到预算。低增长死循环的"等待时长"问题由用户 stop 按钮解决，而非自动硬掐。
> - 末尾兜底 `throw new Error(... failed to complete ...)` 保留作防御（理论不可达：stop/abort/budget 三条件必有一个先满足）。

## 3. 实现要点

### 3.1 contextTokenBudget 注入路径

勘察 `runAgentRuntimeTurn`（index.ts:1428）→ `callAgentModelWithWorkspaceTools(Native)` 的调用链。`toolOptions: WorkspaceToolLoopOptions`（index.ts:196）在 `runAgentRuntimeTurn` 内构造。**方案**：

- `WorkspaceToolLoopOptions` 增 `contextTokenBudget: number`（必填，由 `runAgentRuntimeTurn` resolve 好传入）。
- `runAgentRuntimeTurn` 从 `capabilities` 或 `input` 取 model contextWindow，调 `resolveTokenBudget` 得预算值，传入 toolOptions。
- **contextWindow 来源勘察**：`AgentRuntimeCapabilities`（index.ts:128 起）当前不携带 model.config。需确认 platform-host 构造 capabilities 时是否可拿到 model.config。若不可，则在 `AgentRuntimeTurnInput` 增 `contextTokenBudget?: number`，由 platform-host 的 `runAgentRuntimeTurn` 调用方（platform-host/index.ts）注入——那里能拿到 agent 的 model 配置。

**倾向**：在 `AgentRuntimeTurnInput` 增可选 `contextTokenBudget?: number`（platform-host 注入），`runAgentRuntimeTurn` 内 `resolveTokenBudget(input.contextTokenBudget ?? null)` 兜底用默认。这样不强制所有调用方传，且 model config 知识留在 platform-host 层（runtime-core 不依赖 config/ai.ts）。

### 3.2 两循环对称改造

native 与 text 两循环改动对称，分别调 `estimateRuntimeMessagesTokens`/`compressRuntimeMessages` 和 `estimateAiChatMessagesTokens`/`compressAiChatMessages`。token-budget.ts 导出 4 个消息类型特化函数 + 1 个纯文本估算 + 预算 resolve + 错误类型。

### 3.3 trace 事件

新增 trace 事件 `context_compressed`（在压缩发生时 emit）：

```ts
capabilities.emitTrace?.({
  type: "context_compressed",
  agentId: agentContext.agent.id,
  debugLabel: options.debugLabel,
  ok: true,
  data: { round, beforeTokens, afterTokens, droppedRounds, budget },
})
```

供 diagnostics 观察压缩行为。非必需，但成本低、调试价值高（实测时确认压缩触发时机）。

## 4. 开放问题决议（PRD §开放问题）

### 4.1 Q1 — 压缩保留最近 N 轮的 N 值

**决议**：N = 2。详见 §2.4。2 轮足够模型继续任务，压缩力度适中，可重复触发逐步收敛。

### 4.2 Q2 — token 估算精度

**决议**：`字符数 * 0.4 + UTF-8 字节数 * 0.25`。详见 §2.2。中文准确、英文保守高估（误差倒向早压缩的安全侧），零依赖，`estimateTokenCount` 是单一替换点。

### 4.3 Q3 — maxToolRoundsPerAgent 字段移除 vs 保留停用

**决议**：**移除**。详见 §2.1。字段在 index.ts 内部非 contracts，无跨包消费者，原型期可接受 shape 破坏。不留死字段。

### 4.4 Q4 — 压缩后是否给模型提示

**决议**：**注入提示** user message。详见 §2.4。让模型知道早期信息可能不在，避免基于错误假设继续。成本一条短 message，收益明确。

## 5. 兼容性与迁移

- **配置 shape 破坏**：`AgentRuntimeCollaborationPolicy.maxToolRoundsPerAgent` 移除。原型期可接受。若 platform-host 或其它调用方显式传该字段，TS 编译报错兜底捕获（类型系统保证遗漏引用被发现）。
- **无数据迁移**：token 预算是运行时机制，无持久化数据。旧 session transcript 不受影响（不重放）。
- **contextWindow 字段**：已存在于 `BrowserAiModelConfig`（config/ai.ts:22），UI 已有输入（AddModelDialog.vue:193、ModelParamsFields.vue:8）。本任务只消费它做 enforcement，不改字段定义与 UI。
- **用户可见行为变化**：工具循环不再 3 轮硬掐，模型可多步探索。压缩时模型可能"忘记"早期 tool 结果（有提示）。需实测确认体感。

## 6. 权衡

| 决策 | 选择 | 权衡 |
|---|---|---|
| 轮次限制 | 移除硬上限 + 纯 token 预算（无软 cap） | 牺牲自动死循环兜底（靠用户 stop 按钮），换主流框架"几乎无轮次限制感" + 不误掐深度探索 |
| token 估算 | 字符数*0.4 + UTF-8 字节*0.25 | 英文高估 2.6×（安全侧），中文准确；契合 Tsian 中文为主画像，误差倒向早压缩；零依赖 |
| 预算上限 | 直接用 model.contextWindow（无配置才 256k） | 牺牲自动防膨胀（大模型上下文可涨到接近窗口），换尊重用户配置能力 + 85% 压缩阈值兜底撞墙风险 |
| 压缩策略 | 工具产出修剪（tool output 占位符化）+ 整轮删除兜底 + 保留最近 2 轮（借鉴 Codex） | 牺牲早期 tool 具体输出（占位符替代），换保留轮次结构 + 纯函数无 model 调用成本 + 模型知调用过什么 |
| 压缩触发阈值 | 85% budget（非 100%） | 牺牲一点窗口利用率（85% 就动手），换吸收估算偏差 + 压缩后留空间 + 不撞 provider 真实上限 |
| 压缩提示 | 注入 user message | 牺牲一点 token，换模型对上下文缺失的知情 |
| maxToolRounds 字段 | 移除 | 牺牲配置 shape 兼容，换无死字段 + 语义清晰 |
| 软 cap 50 轮 | 不设（已否决） | 50 轮会先于 256k 预算误掐低增长深度探索；改靠用户 stop 按钮 + 256k 预算最终兜底 |

## 7. 运维与回滚

- **回滚点**：按 R 分段提交（见 implement.md）。最危险是 R1（移除轮次限制 + 加 token 预算）同时改两循环——若压缩逻辑 bug 导致上下文错乱，回滚到 R1 前的"轮次限制 + 无预算"中间态可临时止血（但会恢复 3 轮硬掐）。
- **验收**：`npm run build`（含 contracts）通过；真实 API 实测模型 6+ 轮探索不卡死；人为构造超长上下文触发压缩不崩、压缩提示出现、压缩后继续循环。
- **diagnostics**：`context_compressed` trace 事件供调试压缩行为。

## 8. 与上下游子任务的接口

- **上游子1（tool-skill-decouple）**：本任务在子1 定稿的循环形态上实现。子1 的 SKILL.md 全文注入会增加单轮 message 体积，token 估算已纳入（§2.2 content 全计入）。压缩时注入的 skill 全文 message 随轮次可被丢弃（若它属早期轮次）——但 `injectedSkillPaths` 仍记录已注入，不会因压缩丢失而重复注入（去重靠 sessionState，不靠 messages 内容）。**风险**：压缩丢掉 skill 全文后模型可能无法执行该 skill 的 run_script——此时模型需重新 use_skill（observation 里 action 列表仍在最近轮）或框架重新注入。MVP 不处理此细化（压缩优先保活循环，skill 重新激活靠模型自然行为）。
- **下游子3（tool-rename-and-glob）**：与本任务无直接依赖。子3 改工具命名/schema，不改循环结构。
- **下游子4（tool-executor-policy）**：与本任务无直接依赖。子4 接通 policy，不改循环结构。
