# Implement — 限制机制改造（token 预算）

> 执行计划。按 R 顺序实施，每个 R 是独立提交单元。design.md 是技术依据，本文件是有序清单 + 验证 + 回滚点。
> 2026-06-20 重写，对应重写后的 design.md（达预算压剧情 + 一次压缩限制 + 兜底C）。

## 验证命令

| 用途 | 命令 |
|---|---|
| contracts 构建 | `npm run build:contracts` |
| platform-web 构建（含 vue-tsc 类型检查） | `npm run build:web` |
| 全量构建（本任务验收） | `npm run build:contracts && npm run build:web` |

> 仓库无 test 脚本。类型安全靠 `vue-tsc -b`；行为正确性靠真实 API 实测（§收尾 C3-C6）。

## 风险文件

| 文件 | 风险 | 回滚锚 |
|---|---|---|
| `agent-runtime/context-lifecycle.ts` | 新增估算函数 + 错误类，逻辑 bug 导致压缩不触发或误判 | R1 独立提交，纯函数无副作用 |
| `agent-runtime/index.ts` | 两处工具循环改造（去轮次 + 压剧情接入）+ context 快照透传 + maxToolRoundsPerAgent 移除，改动最密集 | R2/R3 分段提交，类型系统兜底捕获遗漏引用 |
| `views/AssistantView.vue` | catch 新增 budgetExhausted 分支，误改 abort 分支 | R4 单独提交，只新增分支不动现有 |

## 关键实现路径（勘察已确认）

- **底层结构改造已完成（commit 837ddd2，底层任务已归档）**：`buildEntryAgentMessages` 已改为独立 message 序列，新增 `buildAgentContextMessages(context): AiChatMessage[]`（index.ts，产出 summary + recentTurns 独立 message）。本任务压剧情直接复用它做 slice+替换，**无需锚点拆分文本**。真实 API 行为待 PV-001 验证（`docs/active/pending-verification.md`）。
- `contextTokenBudget` 已在 platform-host（:1487）注入 `AgentRuntimeTurnInput`，runtime 直接用 `input.contextTokenBudget`，**无需改 host 注入**。
- `agentContext`（AgentContextSnapshot）已在 host（:1486）注入 `AgentRuntimeTurnInput`，但**没传进工具循环**——R2 在 `runAgentRuntimeTurn` 内把它传给 `callAgentModelWithWorkspaceTools(Native)`。
- `compressedContext` 落盘已支持：`stageAgentContextFile`（host :401）`base = input.compressedContext ?? readExisting ?? empty`。turn 内压缩结果透传到 `contextUpdate.compressedContext` 即自动落盘，**无需改 host 落盘逻辑**。
- `maxToolRoundsPerAgent` host 没注入（grep 无命中），只需改 index.ts。
- `compressContext` / `estimateTokenCount` / `estimateAiChatMessagesTokens` / `resolveTokenBudget` / `CONTEXT_COMPRESS_TRIGGER_RATIO` / `CompressCallModel` / `buildAgentContextMessages` 底层已导出/已存在，直接 import 复用。

## 执行清单

### R1 — context-lifecycle.ts 小扩展 + index.ts rebuild helper

> 先做 R1：纯函数 + 错误类 + rebuild helper，不接循环，为 R2 工具循环改造提供基础。复用底层现有 `estimateTokenCount` / `compressContext`，不重复造轮子。

- [ ] **R1.1** `context-lifecycle.ts` 新增 `estimateRuntimeMessagesTokens(messages: RuntimeChatMessage[]): number`（design §2.2）：
  - 从 `../runtime-host/ai` import `RuntimeChatMessage` 类型。
  - 遍历 messages：`role==="system"|"user"` 计 content；`role==="assistant"` 计 content + `toolCalls?.[]` 的 `name` + `JSON.stringify(arguments)`；`role==="tool"` 计 content（toolCallId 短，忽略保持简单）。
  - 累加调现有 `estimateTokenCount`。
- [ ] **R1.2** `context-lifecycle.ts` 新增 `ContextBudgetExhaustedError extends Error`（design §2.5）：
  - `constructor()`，`super("上下文已满，无法继续本轮探索。请开始新会话或精简对话。")`，`this.name = "ContextBudgetExhaustedError"`。
  - 与现有 `ContextCompressionFailedError` 同文件、同风格。
- [ ] **R1.3** `index.ts` 新增剧情段定位+替换逻辑（复用底层 `buildAgentContextMessages`，不新写锚点拆分 helper）：
  - 底层任务已新增 `buildAgentContextMessages(context: AgentContextSnapshot): AiChatMessage[]`（index.ts，产出 summary + recentTurns 独立 message 序列）。本任务直接复用它，不重写。
  - 新增 `locateHistorySpan(messages, frameworkUserIndex): { start: number; end: number }`——扫描定位剧情段边界：从 `frameworkUserIndex + 1`（框架信息 user 之后）开始，到"玩家本轮输入："user 之前结束。返回剧情段在 messages 里的 `[start, end)` 区间。若未注入 agentContext（兜底路径，剧情段是单条 `最近对话：` user），返回 `{ start: -1, end: -1 }` 表示无可压剧情段（跳过 turn 内压缩）。
  - 新增 `replaceHistorySpan(messages, span, newSnapshot)`——`messages.splice(span.start, span.end - span.start, ...newHistoryMessages)`，native 循环 newHistoryMessages 经 `aiChatMessagesToRuntime(buildAgentContextMessages(newSnapshot))`，text 循环直接 `buildAgentContextMessages(newSnapshot)`。
  - 这两个 helper 放 index.ts（紧挨 `buildAgentContextMessages`），不跨文件。
- [ ] **R1.4** 验证：`npm run build:web` 通过（纯函数 + 错误类 + helper + 类型，无循环接入）。

### R2 — 工具循环接入 token 预算 + 压剧情（核心改动）

> R2 改两处工具循环：去 `maxToolRounds` 终止条件 + 每轮调 model 前检查 token + 达预算压剧情 + 一次压缩限制 + 兜底。R2 暂保留 `maxToolRoundsPerAgent` 字段定义（R3 移除），只改循环行为。

- [ ] **R2.1** `index.ts` `WorkspaceToolLoopOptions`（:232）增字段：
  - `agentContextSnapshot: AgentContextSnapshot`（可变对象引用，压缩后就地更新）。
  - `contextTokenBudget: number`。
  - `compressCallModel: CompressCallModel`。
  - import `AgentContextSnapshot` from `@tsian/contracts`、`CompressCallModel` from `./context-lifecycle`。
- [ ] **R2.2** `index.ts` `runAgentRuntimeTurn`（:1505 附近）：构造 `toolOptions` 时传入 `agentContextSnapshot: agentContext`（:1512 的变量，turn 开头压缩后已是更新值）、`contextTokenBudget: budget`（:1525 已 resolve）、`compressCallModel`（复用 turn 开头压缩用过的 `capabilities.callModel` 路径，:1537 已验证签名兼容 `CompressCallModel`）。
- [ ] **R2.3** `index.ts` turn 内压缩结果透传（design §3.5）：
  - `toolOptions.agentContextSnapshot` 是对象引用，循环内压缩后 `Object.assign(toolOptions.agentContextSnapshot, compressed)` 就地更新。
  - `runAgentRuntimeTurn` 在工具循环返回后判断 `agentContext` 是否被压过（对比 turn 开头传入的 snapshot，或循环内设一个 `compressedInTurn` 标志位透出——倾向后者，显式）。
  - 组装 `contextUpdate.compressedContext`（:1609）：`turn内压缩结果 ?? turn开头压缩结果(compressedContext) ?? undefined`。host `stageAgentContextFile` 自动用它落盘。
- [ ] **R2.4** `index.ts` native 循环 `callAgentModelWithWorkspaceToolsNative`（:1161）：
  - 循环头 `for (let round = 0; round <= maxToolRounds; round += 1)`（:1193）→ `for (let round = 0; ; round += 1)`。
  - 删除 `const maxToolRounds = ...`（:1173-1174）读取。
  - 删除 `if (round >= maxToolRounds)` 分支（:1245-1261，含 round limit 抛错 + finalText 返回）。
  - 循环内维护 `let compressedThisTurn = false` + `let lastRoundText = ""`（每轮 `result.text` 赋值给它，供兜底用）。
  - 入口定位剧情段边界：`const historySpan = locateHistorySpan(runtimeMessages, 1)`（frameworkUserIndex=1，即框架信息 user）。若 `historySpan.start === -1`（兜底路径无 agentContext），跳过 turn 内压缩检查（整个 if 块不执行）。
  - 循环内 `assertNotAborted`（:1194）之后、`callModelNative`（:1200）之前，插入 token 预算检查（design §2.3）：
    ```ts
    if (historySpan.start >= 0) {  // 仅稳态路径(有剧情段)做 turn 内压缩
      const triggerThreshold = toolOptions.contextTokenBudget * CONTEXT_COMPRESS_TRIGGER_RATIO
      const totalTokens = estimateRuntimeMessagesTokens(runtimeMessages)
      if (totalTokens > triggerThreshold) {
        if (compressedThisTurn) {
          // 第二次达预算 → 兜底(design §2.5)
          const finalText = lastRoundText.trim()
          if (finalText) {
            recordAgentSessionTranscript(transcriptCollector, input, agentContext, options, {
              messages, modelOutput: lastRoundText, toolCalls: [], toolObservations: [], round, status: "completed",
            })
            return finalText
          }
          throw new ContextBudgetExhaustedError()
        }
        // 第一次达预算 → 压剧情(复用底层 compressContext)
        const compressOptions = { debugLabel: options.debugLabel, signal: options.signal, agentId: agentContext.agent.id }
        const compressed = await compressContext(
          toolOptions.agentContextSnapshot, triggerThreshold, toolOptions.compressCallModel, compressOptions,
        )
        Object.assign(toolOptions.agentContextSnapshot, compressed)
        compressedThisTurn = true
        replaceHistorySpan(runtimeMessages, historySpan, toolOptions.agentContextSnapshot)  // slice+替换剧情段
        // 替换后剧情段长度可能变,更新 historySpan.end(后续轮次若再压用——但一次压缩限制下不会二次压,仅防御)
        historySpan.end = historySpan.start + aiChatMessagesToRuntime(buildAgentContextMessages(toolOptions.agentContextSnapshot)).length
        capabilities.emitTrace?.({
          type: "context_compressed_in_turn", agentId: agentContext.agent.id, debugLabel: options.debugLabel, ok: true,
          data: { round, beforeTokens: totalTokens, budget: toolOptions.contextTokenBudget, triggerThreshold },
        })
      }
    }
    ```
  - 每轮 `result.text` 赋值 `lastRoundText = result.text`（在 finishReason 判断前，供兜底读）。
  - import `estimateRuntimeMessagesTokens, compressContext, ContextBudgetExhaustedError, CONTEXT_COMPRESS_TRIGGER_RATIO` from `./context-lifecycle`。
- [ ] **R2.5** `index.ts` text 循环 `callAgentModelWithWorkspaceTools`（:1325，工具循环部分 :1377 起）：
  - 循环头 `for (let round = 0; round <= maxToolRounds; round += 1)`（:1382）→ `for (let round = 0; ; round += 1)`。
  - 删除 `const maxToolRounds = ...`（:1380-1381）读取。
  - 删除 `if (round >= maxToolRounds)` 分支（:1414-1431）。
  - 对称插入 token 预算检查：用 `estimateAiChatMessagesTokens` 作用于 `nextMessages`，压剧情用 `compressContext` 同一个，替换剧情段用 `replaceHistorySpan`（text 版，newHistoryMessages 直接用 `buildAgentContextMessages` 产出 `AiChatMessage[]`，不经 `aiChatMessagesToRuntime`）。入口同样 `locateHistorySpan(nextMessages, 1)` 定位边界。`lastRoundText` 用 `stripRuntimeWorkspaceToolCallBlocks(response)`（text 循环的 finalText 提取方式，参考 :1415）。
  - import `estimateAiChatMessagesTokens` from `./context-lifecycle`（已存在）。
- [ ] **R2.6** `index.ts` `callAgentModelWithWorkspaceTools`（:1325 分发函数）：把新增的 `agentContextSnapshot` / `contextTokenBudget` / `compressCallModel` 透传给 native 和 text 两个分支（签名 + 两个分支调用点）。
- [ ] **R2.7** 验证：`npm run build:web` 通过。此时 `maxToolRoundsPerAgent` 字段仍在 policy 但不再被读（R3 移除）。

### R3 — 移除 maxToolRoundsPerAgent 字段

- [ ] **R3.1** `index.ts` `AgentRuntimeCollaborationPolicy`（:189）：删 `maxToolRoundsPerAgent: number`。
- [ ] **R3.2** `index.ts` `DEFAULT_AGENT_RUNTIME_COLLABORATION_POLICY`（:225）：删 `maxToolRoundsPerAgent: 3,`。
- [ ] **R3.3** `index.ts` `normalizeAgentRuntimeCollaborationPolicy`（:285-302）：删 `maxToolRoundsPerAgent: normalizePolicyInteger(...)` 块（:297-300）。
- [ ] **R3.4** 全量 grep `maxToolRoundsPerAgent` 在 `apps/platform-web/src`——应无代码引用残留（spec 文档 type-safety.md:625 留到 Phase 3.3 spec 更新）。
- [ ] **R3.5** 验证：`npm run build:web` 通过（类型系统兜底：若 R2 漏删 maxToolRounds 读取，此处编译报错）。

### R4 — AssistantView 温和兜底

> host 注入 + 落盘已就绪（勘察确认），无需改 host。只改 AssistantView catch。

- [ ] **R4.1** `views/AssistantView.vue` catch 块（:665-684）：
  - 在 `aborted` 判断后新增 `budgetExhausted` 判断（design §2.5）：
    ```ts
    const budgetExhausted = error instanceof Error && error.name === "ContextBudgetExhaustedError"
    ```
  - 新增 `else if (budgetExhausted)` 分支（与 abort 分支对称——"非失败的中止"）：
    - `assistantMsg.content` 非空 → `assistantMsg.content = \`${assistantMsg.content}\n\n_（上下文已满，请开始新会话或精简对话）_\``。
    - 空 → `assistantMsg.content = "上下文已满，请开始新会话或精简对话。"`（不 pop 占位，让用户看到提示）。
    - `await persistCurrentSession()`。
    - **不设 errorMessage**（用 content 承载提示，与 abort 同路径）。
- [ ] **R4.2** 验证：`npm run build:web` 通过。

### 收尾

- [ ] **C1** 全量 grep 残留：`maxToolRoundsPerAgent` 和 `reached the workspace tool round limit` 在 `apps/platform-web/src` 应无代码引用（spec 文档 Phase 3.3 单独更新）。
- [ ] **C2** `npm run build:contracts && npm run build:web` 最终通过。
- [ ] **C3** 真实 API 实测（多步探索不被卡死）：让模型在空卡片查 Agent 场景探索 6+ 轮（list→read→list→read），确认不再报 round limit，自然给出回复。
  - **前置**：依赖 `docs/active/pending-verification.md` PV-001（底层结构改造回归实测）通过——剧情正文独立 message 序列 + 连续 user message 在真实 provider 验证 OK。PV-001 未过则 C3-C6 暂缓（详见 PV-002）。
- [ ] **C4** 真实 API 实测（turn 内压缩）：人为构造超长上下文（多次大文件 read 累积），确认压缩触发（trace `context_compressed_in_turn` 事件 / 模型行为显示压缩后继续探索不重复），压缩后循环继续不崩、tool 交互保留。
- [ ] **C5** 真实 API 实测（兜底）：构造极端场景（压缩后仍持续增长到第二次达预算），确认"有 text 返回 finalText / 无 text 温和报错上下文已满"且已流式 thought 保留。
- [ ] **C6** 回归实测：普通短对话不误触压缩；abort（停止按钮）行为不变；关闭重开存档后 master agent 上下文从 context.json 恢复（底层路径，确认未被本任务破坏）。

## 回滚点

- R1 独立（纯函数 + 错误类 + helper，回滚无副作用）。
- R2 是核心风险点（改两循环 + 压剧情接入）——若压剧情逻辑 bug 导致上下文错乱，回滚 R2 恢复"轮次限制 + 无预算"中间态临时止血（会恢复 3 轮硬掐，但可工作）。
- R3 移字段依赖 R2 已不读字段，R3 回滚无意义（字段在不在不影响 R2 行为）。
- R4 兜底分支独立，回滚只影响报错体验不影响核心逻辑。

## task.py start 前检查

- [ ] design.md 已完成（开放问题已决议）。
- [ ] implement.md 已完成（有序清单 + 验证命令）。
- [ ] implement.jsonl / check.jsonl 已配 spec 引用（1.3）。
- [ ] 用户审查通过 design.md + implement.md。
