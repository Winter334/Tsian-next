# Design — master agent 会话上下文生命周期与压缩持久化

> 复杂任务。落实 AIRP 基础模型：master agent 的上下文记录与玩家剧情正文存档分离，持久化跨 turn / 跨加载保持"1 摘要 + K 轮正文"稳态。是 `tool-token-budget` 的底层依赖。需求与决策见 prd.md（brainstorm 已定全部 open questions）。

## 1. 架构与边界

### 1.1 三层视角与四份存储（落实后的目标态）

```
玩家视角（UI 翻阅）     → saveHistory (IndexedDB)          完整原文剧情正文，不变
                         → rawAirpHistoryTurn (工作区镜像)  不变
master agent 视角       → save/agents/master/context.json  【新建】上下文快照(摘要+K轮正文)
trace/审计             → save/agents/master/session.jsonl  不变(每轮完整record追加)
```

**核心分离**：`saveHistory`（玩家存档，原文）≠ `context.json`（master agent 上下文，含压缩）。当前架构混用 `saveHistory` 作上下文源，本任务分离之。

### 1.2 涉及模块与改动性质

| 层 | 文件 | 改动 |
|---|---|---|
| runtime-core | `apps/platform-web/src/agent-runtime/context-lifecycle.ts` | **新文件**：context.json 读写 + 估算 + 压缩（调 callModel）+ 稳态维护纯/半纯函数 |
| runtime-core | `apps/platform-web/src/agent-runtime/index.ts` | R2：`buildEntryAgentMessages`（:631）"最近对话"区从 `formatHistory(history)` 改为从 context 记录拼 summary+recentTurns；R3：`runAgentRuntimeTurn`（:1428）开头插入读 context → 估算 → 压缩；R4：turn 结果暴露本轮正文供 platform-host 写 context.json |
| platform-host | `apps/platform-web/src/platform-host/index.ts` | R2：`runAgentRuntimeTurn` 调用处（:1413/:1695）注入 context 记录（读 context.json 传入）；R4：turn 收尾（:1503-1519）`stageAgentContextFile` 把本轮正文追加进 context.json |
| platform-web | `apps/platform-web/src/views/AssistantView.vue` | R3 失败兜底：`ContextCompressionFailedError` 经现有 catch else 分支（:677）显示温和文案（error.message 即温和提示，无需新增分支） |
| contracts | `packages/contracts/src/runtime.ts` | 若 `AgentRuntimeTurnInput` / `AgentRuntimeTurnResult` 需新增字段（context 记录传入/本轮正文暴露），在此定义类型 |

### 1.3 不动的边界

- **`saveHistory` 语义**：玩家剧情正文存档，完整原文，给 UI 翻阅。本任务不修改其结构/读写/截断逻辑（`getHistoryForSave`/`normalizeHistory slice(-20)` 保留——它仍服务玩家视角，只是不再作 master agent 上下文源）。
- **`agentSessionTranscript`（session.jsonl）**：trace/审计职责不变，每轮追加完整 record。与 context.json 是两份独立存储（trace 是"发生了什么"的审计流，context 是"master agent 当前上下文窗口"的快照）。
- **`rawAirpHistoryTurn`**：正文工作区镜像不变。
- **工具循环形态**（use_skill/run_script，子1 定稿）：不动。本任务只改上下文源 + 生命周期，不改工具循环内部。
- **delegated agent 上下文**：无状态（勘察确认），不引入 context.json，本任务只针对 master agent。
- **记忆 agent / 状态 agent 机制**：不动。本任务只确保 master agent 上下文能查工作区（现有机制），不改记忆/状态 agent。
- **token 精确计数**：不做，MVP 用字符数估算（`字符数*0.4 + UTF-8字节数*0.25`，复用 tool-token-budget 决策）。
- **去 maxToolRoundsPerAgent + 工具循环内 tool 体积兜底**：归 `tool-token-budget`，本任务不做。

## 2. 数据流与契约

### 2.1 context.json 数据结构（brainstorm 已定）

```ts
// save/agents/master/context.json
interface AgentContextSnapshot {
  schema: "tsian.agent.context.v1"
  saveId: string
  agentId: "master"
  /** 早期剧情摘要（叙事梗概，压缩后产生）。null = 尚未触发压缩。 */
  summary: string | null
  /** 最近 K=5 轮正文（user+assistant 对，带 turn 索引，原文）。按 turn 升序。 */
  recentTurns: AgentContextTurnEntry[]
  /** 上次压缩覆盖到第几轮（防重复压缩）。null = 未压缩过。 */
  lastCompressedTurn: number | null
  updatedAt: string  // ISO timestamp
}

interface AgentContextTurnEntry {
  turn: number
  role: "user" | "assistant"
  content: string  // 剧情正文原文
}
```

**不存完整 messages**：system prompt（AGENT.md/SOUL.md）、Workspace 上下文、当前回合号、玩家本轮输入——这些每 turn 现构建（`buildEntryAgentMessages` 现有逻辑），不持久化进 context.json。context.json 只存"跨 turn 需保持的剧情上下文段"（summary + recentTurns）。

### 2.2 turn 生命周期数据流（落实后）

```
[turn 开始] platform-host runAgentRuntimeTurn 调用处 (:1413/:1695)
  ↓ 读 context.json（workspaceTransaction 或直接读工作区文件）→ AgentContextSnapshot
  ↓ 注入 input.agentContext = snapshot
  ↓
runAgentRuntimeTurn (index.ts:1428)
  ↓ 【R3 下轮开头压缩】
  ↓   const context = input.agentContext
  ↓   const budget = resolveTokenBudget(modelContextWindow)  // 256k 或配置值
  ↓   const triggerThreshold = budget * 0.85
  ↓   const estimated = estimateContextTokens(context)  // summary + recentTurns
  ↓   if (estimated > triggerThreshold) {
  ↓     const compressed = await compressContext(context, threshold, capabilities.callModel, options)
  ↓     // compressContext 调 callModel 生成叙事梗概摘要，保留最近5轮，旧summary+早期轮次浓缩
  ↓     // 失败 → throw ContextCompressionFailedError（温和文案）
  ↓     context = compressed
  ↓     emitTrace context_compressed
  ↓   }
  ↓ 【R2 上下文源切换】
  ↓   buildEntryAgentMessages(..., agentContext: context)
  ↓     剧情正文层 = buildAgentContextMessages(context)  // 独立 message 序列(见 §2.2a)
  ↓     （替换原 formatHistory(normalizeHistory(input.recentHistory))）
  ↓ ↓ 工具循环（不变）→ replyText
  ↓
  return { replyText, agentSessionTranscripts, contextUpdate: { user, assistant, turn } }
  ↓
[turn 收尾] platform-host (:1503-1519)
  ↓ nextHistory = [...historyBefore, user, assistant]  // saveHistory 不变
  ↓ stageRawAirpHistoryTurnFile(...)                    // 正文镜像不变
  ↓ stageAgentSessionTranscriptFiles(...)               // trace 不变
  ↓ 【R4 新增】stageAgentContextFile(workspaceTransaction, {
  ↓   saveId, agentId:"master", turn: nextTurn,
  ↓   user: content, assistant: result.replyText,
  ↓   compressedContext: result.compressedContext  // 若本轮开头压缩了，写压缩后快照
  ↓ })
  ↓   → 读现有 context.json → 追加本轮 user+assistant 进 recentTurns（保持最近5轮，超5则从头部丢）
  ↓   → 若 result.compressedContext 存在，用它覆盖 summary/recentTurns/lastCompressedTurn
  ↓   → workspaceTransaction.write("agents/master/context.json", JSON.stringify(snapshot))
  ↓ commit 事务
```

**关键时序**：压缩在 turn 开头（R3），但压缩结果写回 context.json 在 turn 收尾（R4）——因为 turn 开头没有 workspaceTransaction（事务在 platform-host 调用 runAgentRuntimeTurn 前后管理）。压缩后的快照通过 `result.compressedContext` 带到收尾阶段写入。若 turn 中途 abort，压缩结果不写入（下轮开头重新压缩），可接受。

### 2.2a 剧情正文层 message 结构（2026-06-20 收尾修正）

**原实现偏差**：初版 `buildEntryAgentMessages` 把 summary + recentTurns 用 `formatAgentContextHistory` 拍扁成一段文本，和"当前回合/Workspace 上下文/玩家本轮输入"塞进**同一条 user message content**。这导致下游 `tool-token-budget` 子任务2 的"turn 内压剧情"要在格式化文本里做字符串切片（脆弱），且与 context.json 的 `recentTurns` 结构化数据形态不一致（结构化→文本→结构化往返）。

**修正**：剧情正文层改为**独立 message 序列**，新增 `buildAgentContextMessages(context)`：

```
messages = [
  { role: "system",    content: systemPrompt },                              // AGENT.md/SOUL.md/工具说明
  { role: "user",      content: "当前回合:N\nWorkspace Agent 上下文:..." },   // 框架信息(非剧情,每 turn 现构建)
  { role: "user",      content: "早期剧情摘要：\n<summary>" },               // summary(若有)作 user message
  { role: "user",      content: "<玩家12轮原文>" },                          // recentTurns 每条独立 message
  { role: "assistant", content: "<叙事12轮原文>" },
  { role: "user",      content: "<玩家13轮原文>" },
  { role: "assistant", content: "<叙事13轮原文>" },
  ...
  { role: "user",      content: "玩家本轮输入：\n<userInput>" },             // 本轮输入单独一条
  // 之后是工具循环的 assistant/tool messages
]
```

**设计要点**：
- summary 作 `user` message（剧情历史的一部分，非系统指令；作 system 会被 Gemini/Claude 的 `splitSystemMessage` 合并进 system 字段，与 systemPrompt 语义混淆）。
- recentTurns 每条 `{role, content}` 直接用 context.json 的 `entry.role`/`entry.content`，不加"12. 玩家:"前缀（role 已表达角色，turn 索引不进 content 以免污染正文）。
- 框架信息（回合号/Workspace 上下文）单独一条 user message，与剧情正文层分离——压剧情时只动 summary + recentTurns 那段，框架信息和本轮输入不动。
- 兜底路径（agentContext 未注入，首 turn/旧存档迁移）：保持 `formatHistory` 文本形式塞一条 user message（非稳态路径，不追求结构化）。

**连续 user message 的 provider 兼容性**：此结构会产生连续 user message（框架信息 user → summary user → recentTurns 首 user）。OpenAI Chat Completions / Gemini / Claude API 均**允许**连续同 role message（按顺序处理），非标准行为。若个别国产 OpenAI 兼容端点有问题，属端点非标准行为，后续按需处理。

**对下游 tool-token-budget 的意义**：turn 内压剧情从"在格式化文本里做字符串切片"变成"按 message 边界 slice + 替换"——保留最近 K 轮 = 保留最后 2K 条 user/assistant message，早期轮次替换成 summary message。健壮、自然，无锚点拆分脆弱性。

### 2.3 压缩算法（compressContext）

```ts
async function compressContext(
  context: AgentContextSnapshot,
  threshold: number,  // budget * 0.85
  callModel: AgentRuntimeCapabilities["callModel"],
  options: AgentRuntimeModelCallOptions,
): Promise<AgentContextSnapshot> {
  const KEEP_RECENT_TURNS = 5
  // 1. 保留最近 KEEP_RECENT_TURNS 轮（按 turn 降序取最近5个 turn 的 user+assistant 对）
  const recentTurnNumbers = uniqueTurnNumbers(context.recentTurns).slice(-KEEP_RECENT_TURNS)
  const keepEntries = context.recentTurns.filter(e => recentTurnNumbers.includes(e.turn))
  const compressEntries = context.recentTurns.filter(e => !recentTurnNumbers.includes(e.turn))
  // 2. 被压缩轮次 + 旧 summary 一起送 model 生成叙事梗概
  const prompt = buildCompressionPrompt(context.summary, compressEntries, targetTokens)
  const newSummary = await callModel(
    [{ role: "system", content: COMPRESSION_SYSTEM_PROMPT }, { role: "user", content: prompt }],
    options,
  )
  // 3. 返回新快照
  return {
    ...context,
    summary: newSummary,
    recentTurns: keepEntries,
    lastCompressedTurn: max(compressEntries.turn) ?? context.lastCompressedTurn,
    updatedAt: nowIso(),
  }
}
```

**稳态循环**：下次压缩时，`context.summary` 已是上次摘要，与新增的早期轮次一起再送 model → 旧摘要被二次浓缩 → 越早的剧情被浓缩次数越多，细节自然淡出（brainstorm 讨论结论）。无需显式"丢弃早期"层。

### 2.4 摘要 prompt（brainstorm 已定，叙事梗概）

```ts
const COMPRESSION_SYSTEM_PROMPT = [
  "你正在为一段互动剧情的 AI 叙事者压缩对话历史。",
  "请将以下剧情历史浓缩成一段梗概，供叙事者在后续创作时参考最近的情节走向。",
  "",
  "要求：",
  "- 保留这段时间内的关键情节推进、人物行动与状态变化、场景转换、未解决的线索或伏笔。",
  "- 用叙事梗概风格（非要点列表），连贯可读，让叙事者能快速理解\"最近发生了什么\"。",
  "- 不需要逐字复述；不需要记录具体台词。",
  `- 控制在约 ${TARGET_COMPRESSION_TOKENS} token 以内。`,
].join("\n")

function buildCompressionPrompt(oldSummary: string | null, entries: AgentContextTurnEntry[], targetTokens: number): string {
  return [
    oldSummary ? `此前的梗概：\n${oldSummary}\n` : "",
    "需要压缩的剧情正文：",
    ...entries.map(e => `${e.turn}. ${e.role === "user" ? "玩家" : "叙事"}: ${e.content}`),
  ].join("\n")
}
```

**与记忆 agent 职责区分**：记忆 agent 提取事实/设定（结构化存储供检索），压缩摘要浓缩情节流（一段梗概塞上下文）。prompt 明确"叙事梗概非要点列表"，与记忆 agent 的"fact extraction"形态区分。

### 2.5 ContextCompressionFailedError（R3 失败兜底）

```ts
export class ContextCompressionFailedError extends Error {
  constructor() {
    super("上下文压缩失败，无法继续本轮。请重试；若持续失败，请检查 Agent 模型配置或开始新会话。")
    this.name = "ContextCompressionFailedError"
  }
}
```

**传播路径**：`compressContext` 内 `callModel` 抛错 → `compressContext` catch 后 `throw new ContextCompressionFailedError()` → `runAgentRuntimeTurn` try 块（:1447）catch → `agent_step_failed` trace + rethrow（:1490）→ platform-host → AssistantView catch（:665）else 分支（:677）→ `errorMessage.value = error.message`（温和文案）+ pop 空占位（`assistantMsg.content` 为空，压缩在 model 生成前）。

**不新增 AssistantView 分支**：`ContextCompressionFailedError.message` 即温和文案，复用现有 else 分支。区别于 `AbortError`（:668）和未来的 `ContextBudgetExhaustedError`（tool-token-budget）——三者都靠 `error.name` / `error.message` 在 catch 区分，但压缩失败走 else（非 abort），用 message 承载文案。

### 2.6 预算与估算（复用 tool-token-budget 决策）

```ts
const DEFAULT_CONTEXT_TOKEN_BUDGET = 256_000
const CONTEXT_COMPRESS_TRIGGER_RATIO = 0.85
const CONTEXT_KEEP_RECENT_TURNS = 5

const utf8Encoder = new TextEncoder()
function estimateTokenCount(text: string): number {
  return Math.ceil(text.length * 0.4 + utf8Encoder.encode(text).length * 0.25)
}
function estimateContextTokens(context: AgentContextSnapshot): number {
  const summaryTokens = context.summary ? estimateTokenCount(context.summary) : 0
  const recentTokens = context.recentTurns.reduce((s, e) => s + estimateTokenCount(e.content), 0)
  return summaryTokens + recentTokens
}
function resolveTokenBudget(modelContextWindow: number | null | undefined): number {
  if (typeof modelContextWindow === "number" && modelContextWindow > 0) return modelContextWindow
  return DEFAULT_CONTEXT_TOKEN_BUDGET
}
```

> **注意**：这些常量/函数与 `tool-token-budget` 任务的 `token-budget.ts` 高度重叠。但 `tool-token-budget` 已搁置，本任务先在 `context-lifecycle.ts` 内自含这些（不依赖未实现的 token-budget.ts）。未来 `tool-token-budget` 重写时，可抽取共享 token util 模块——但那是 `tool-token-budget` 的事，本任务保持自含避免跨任务依赖。

## 3. 兼容性与迁移

### 3.1 旧存档迁移（context.json 不存在）

**首次加载无 context.json 的旧存档**：`stageAgentContextFile` 读 context.json 失败（文件不存在）→ 从 `saveHistory`（原文）初始化 context.json：取最近 5 轮 user+assistant 作 recentTurns，summary=null，lastCompressedTurn=null。**一次性迁移**，之后用 context.json。

**迁移时机**：turn 收尾时，若 context.json 不存在，用 `historyBefore` 的最近 5 轮初始化（而非 turn 开头——turn 开头读不到就用空 context，可能导致首 turn 上下文丢失历史；故收尾时从 saveHistory 补建）。

> **首 turn 上下文**：旧存档首次跑新代码时，turn 开头读不到 context.json → 用空 context（summary=null, recentTurns=[]）构建 messages → 该 turn master agent 上下文无历史（可能影响连贯）。权衡：① 首 turn 上下文丢失历史 vs ② turn 开头从 saveHistory 现建 context。倾向②：turn 开头读不到 context.json 时，从 `input.recentHistory`（saveHistory）取最近5轮初始化内存 context（不落盘），turn 收尾再正式落盘 context.json。这样首 turn 不丢历史。

### 3.2 saveHistory 不再作上下文源的兼容

`buildEntryAgentMessages` 的 `input.recentHistory` 参数：R2 后不再用于"最近对话"区（改用 agentContext）。但 `input.recentHistory` 仍传入（platform-host 仍读 saveHistory）——用于 3.1 的首 turn 兜底初始化 + 可能的调试。不删除参数，只改其用途。

### 3.3 无数据格式破坏

- `saveHistory`（IndexedDB）结构不变。
- `agentSessionTranscript` jsonl 格式不变。
- 新增 context.json 是新文件，不破坏既有。
- `AgentRuntimeTurnInput` / `AgentRuntimeTurnResult` 可能新增字段（agentContext 传入 / contextUpdate 暴露）——属 contracts 扩展，向后兼容（旧调用方不传新字段时走兜底）。

## 4. 权衡

| 决策 | 选择 | 权衡 |
|---|---|---|
| 上下文存储 | 工作区 context.json（原地更新快照） | 牺牲新文件维护，换统一工作区模型 + 复用事务机制 + checkpoint 自动覆盖 + 与 trace 同目录聚合 |
| 数据结构 | summary+recentTurns+索引（非完整messages） | 牺牲重建时需拼接，换无冗余（system 不持久化）+ 职责清晰（只存剧情正文） |
| 压缩时机 | 下轮开头（非本轮结束） | 牺牲存档即时一致（压缩结果延一 turn 落盘），换用户感知好 + 失败回退简单 + 与 R2 同处实现 |
| 失败兜底 | 失败即温和报错（非跳过继续） | 牺牲可用性（用户需重试），换剧情质量（不强行用爆满上下文劣化生成） |
| 摘要风格 | 叙事梗概（非要点列表） | 牺牲结构清晰，换与 AIRP 剧情形态一致 + 不与记忆 agent 事实提取职责重叠 |
| 稳态机制 | 旧summary+新正文二次浓缩（非显式分层丢弃） | 牺牲早期剧情细节（反复浓缩淡出），换极简（无N参数）+ 天然记忆梯度 |
| 压缩对象 | 只压剧情正文（过滤工具过程） | 牺牲工具过程跨 turn 可见，换摘要纯净（不混非剧情）+ 体积可控 + 符合"工具用完即弃" |

## 5. 运维与回滚

- **回滚点**：按 R 分段提交。最危险是 R2（上下文源切换）——若 context.json 读写 bug 导致上下文错乱，回滚到 R2 前"saveHistory 作上下文源"可临时止血（但失去压缩能力）。R3（压缩）独立，可单独回滚（不压缩 = 上下文不缩但能跑，体积大）。
- **验收**：`npm run build` 通过；真实 API 实测多轮对话后 context.json 正确更新；关闭重开存档 master agent 上下文从 context.json 恢复不失忆；超长对话触发压缩（trace context_compressed）不崩；压缩失败显示温和提示。
- **diagnostics**：`context_compressed` / `context_compression_failed` trace 事件供调试。

## 6. 与上下游任务接口

- **下游 `tool-token-budget`**：本任务落实后，`tool-token-budget` 在其上做"工具循环内 tool 体积兜底 + 去 maxToolRoundsPerAgent"。`tool-token-budget` 的 token 估算常量/函数与本任务 `context-lifecycle.ts` 的重叠，未来可抽取共享 util（归 `tool-token-budget` 重写时处理）。本任务自含不依赖。
- **上游子1（tool-skill-decouple）**：本任务不改工具循环形态，子1 定稿的 use_skill/run_script 不受影响。
- **记忆 agent / 状态 agent**：无接口改动，本任务只读工作区（现有机制），不改它们的机制。
