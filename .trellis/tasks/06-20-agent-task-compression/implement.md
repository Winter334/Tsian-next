# Implement — 子代理/助手任务压缩 + 兜底改造（消息序列化 + 多次压缩 + 时长兜底）

> 对应 `design.md`。执行前先读 `prd.md` + `design.md`。
> 分阶段实施，每阶段结束跑验证命令，通过后再进下一阶段。回滚点 = 每阶段一个 commit（便于二分定位回归）。

## 前置：加载 spec 上下文

- [ ] 读 `.trellis/spec/platform-web/frontend/type-safety.md` 的 "Turn Token Budget And In-Turn Compression" + "Parallel agent_call Within A Round" 两场景（改造的契约基准）。
- [ ] 读 `.trellis/spec/platform-web/frontend/quality-guidelines.md`（提交前质量门）。
- [ ] 读 `.trellis/spec/guides/cross-layer-thinking-guide.md` + `code-reuse-thinking-guide.md`（跨层 + 复用）。

## 阶段 A：context-lifecycle 扩展（常量 + 错误类 + 任务摘要 prompt + compressTaskContext）

> 纯新增，不改现有函数。最先做，因后续阶段依赖这些原语。

- [ ] **A1** `context-lifecycle.ts` 新增常量：
  - `DEFAULT_TASK_TIMEOUT_MS = 300_000`
  - `TASK_KEEP_RECENT_TOOL_ROUNDS = 5`
  - `TASK_COMPRESSION_STALL_RATIO = 0.1`
  - `TASK_COMPRESSION_SYSTEM_PROMPT`（任务日志风格摘要器 system prompt，design §2.4）
- [ ] **A2** `context-lifecycle.ts` 新增错误类（与 `ContextBudgetExhaustedError` 同文件）：
  - `TaskTimeoutError extends Error`（`name: "TaskTimeoutError"`，message 含超时秒数）
  - `TaskCompressionStalledError extends Error`（`name: "TaskCompressionStalledError"`，message "上下文持续膨胀且压缩无效，已中止。请精简任务或拆分子任务。"）
- [ ] **A3** `context-lifecycle.ts` 新增 `buildTaskCompressionPrompt(oldSummary, interactionEntries)`（design §2.4）。
- [ ] **A4** `context-lifecycle.ts` 新增 `compressTaskContext(messages, interactionSpan, callModel, options)`：
  - 切工具交互段 `[start, end)`，保留最近 `TASK_KEEP_RECENT_TOOL_ROUNDS` 轮（成对计算：N 轮 = 2N 条 message，assistant+tool 或 assistant+user-observation）。
  - 早期段送 `buildTaskCompressionPrompt` + `TASK_COMPRESSION_SYSTEM_PROMPT` 调 `callModel`，失败 throw `ContextCompressionFailedError`（复用）。
  - 无可压缩早期内容（早期段为空）→ 返回 `{ messages, compressed: false, summary: null }`。
  - 拼新 messages：`[...messages.slice(0, start), { role: "user", content: "已完成工作摘要：\n<summary>" }, ...recentN]`。
  - 返回 `{ messages: newMessages, compressed: true, summary }`。
  - **类型注意**：`messages` 参数用泛型或联合类型（`RuntimeChatMessage[] | AiChatMessage[]`），因 native/text 两循环都调。返回类型与入参一致。`interactionEntries` 给 prompt 用时需提取 `role/content/toolName`（native 的 tool message 无 toolName，从配对的 assistant.toolCalls 推断；text 的 observation user content 含工具名标签）。
- [ ] **A 验证**：`npm run build:web`（类型检查通过，新函数未被调用但需编译无误）。

**回滚点 A**：commit "feat(agent-runtime): add task compression primitives (compressTaskContext, errors, prompt)"。

## 阶段 B：index.ts 压缩模式分流 + locateTaskInteractionSpan

> 改两处工具循环的压缩块，按 `compressionMode` 分流。narrative 分支保持原样，task 分支新增。

- [ ] **B1** `index.ts` 新增类型 `RuntimeCompressionMode = "narrative" | "task"`。
- [ ] **B2** `WorkspaceToolLoopOptions`（:237）加字段：
  - `compressionMode: RuntimeCompressionMode`（必填）
  - `taskStartedAt?: number`
  - `taskTimeoutMs?: number`
- [ ] **B3** `index.ts` 新增 `locateTaskInteractionSpan(messages, mode: "native" | "text")`（design §2.8）：
  - native：从末尾向前跳过 `role === "tool"` 和 `role === "assistant" && toolCalls?.length > 0`。
  - text：从末尾向前跳过 `role === "user" && content.includes("<tsian-tool-observation>")` 和 `role === "assistant" && content.includes("<tsian-tool-call>")`。
  - 返回 `{ start, end }`，`end = messages.length`，`start` = 第一条非工具交互 message 的下一索引。无工具交互 → `{-1, -1}`。
- [ ] **B4** native 循环（`callAgentModelWithWorkspaceToolsNative`，:1246 起）压缩块改造：
  - 现有 `if (triggerThreshold > 0)` 块内分流：
    - `compressionMode === "narrative"`：现有逻辑原样（`compressedThisTurn` + 第二次 ContextBudgetExhaustedError + `compressContext` + `replaceHistorySpan`）。`canCompressInTurn` 条件加 `compressionMode === "narrative"` 前置。
    - `compressionMode === "task"`：新增分支——时长检查（`taskStartedAt && Date.now() - taskStartedAt > taskTimeoutMs` → `TaskTimeoutError`）；`locateTaskInteractionSpan`；`compressTaskContext`；压缩无效（`before/after` 下降 < `TASK_COMPRESSION_STALL_RATIO`）→ `TaskCompressionStalledError`；无段可压/压不动 → 有 `lastRoundText` 返回 / 无 `ContextBudgetExhaustedError`；不设 `compressedThisTurn`（可多次）；emit trace `task_context_compressed`。
- [ ] **B5** text 循环（`callAgentModelWithWorkspaceTools`，:1457 起的 text 分支）压缩块对称改造（B4 的 text 版，`estimateAiChatMessagesTokens` + text 形态 `locateTaskInteractionSpan`）。
- [ ] **B6** 两处循环的 `contextTokenBudget` / `compressCallModel` / `taskStartedAt` / `taskTimeoutMs` 都从 `toolOptions` 取（task 模式下这些字段必须存在，entry/delegated 构造点保证注入）。
- [ ] **B 验证**：`npm run build:web`（`compressionMode` 必填会触发所有 `WorkspaceToolLoopOptions` 构造点编译错误——这正是兜底，逐个修）。

**回滚点 B**：commit "feat(agent-runtime): split compression mode (narrative/task) in tool loops"。

## 阶段 C：delegated 路径接入（保留 buildDelegatedAgentMessages + section 排序微调 + 任务 toolOptions + 时长 AbortController）

> 不新建 `buildTaskAgentMessages`（论证 design §4.1：合并更简单且鲁棒）。delegated messages 保持 `buildDelegatedAgentMessages` 单条框架 user，仅做 section 排序微调 + 传任务 toolOptions + 时长兜底。

- [ ] **C1** `index.ts` 微调 `buildDelegatedAgentMessages` 的 section 排序（design §2.3）：稳定内容（历史窗口 / 目标 Agent 上下文）前置，request + 指令末尾让模型聚焦。**不改变 message 数量**（保持单条 user），仅单条 user 内的文本 section 顺序重排。旧的"请只回答调用方请求..."指令保留在末尾。
- [ ] **C2** `createAgentCallRunner`（:1040）闭包改造：
  - 入口创建 `timeoutController = new AbortController()` + `setTimeout(() => timeoutController.abort("task-timeout"), agentCall.timeoutMs ?? DEFAULT_TASK_TIMEOUT_MS)`。
  - `compositeSignal = AbortSignal.any([input.signal, timeoutController.signal].filter(Boolean))`。
  - 调 `callAgentModelWithWorkspaceTools` 时：
    - messages 用 `buildDelegatedAgentMessages(...)`（保持，不替代）。
    - options.signal 用 `compositeSignal`。
    - 传 `toolOptions`（之前没传）：`{ agentCallState, agentCallDepth, collaborationPolicy, compressionMode: "task", contextTokenBudget: resolveDelegatedTokenBudget(targetContext, capabilities), compressCallModel: capabilities.callModel, taskStartedAt: Date.now(), taskTimeoutMs: agentCall.timeoutMs ?? DEFAULT_TASK_TIMEOUT_MS }`。
    - **delegated 的 contextTokenBudget**：从目标 agent 的 model config `contextWindow` resolve（`resolveTokenBudget(targetModelConfig?.parameters.contextWindow ?? null)`），需在闭包内 resolve 目标 agent model config（复用 host 已注入的 `capabilities` 或从 targetContext 推断——design 定：delegated 预算用目标 agent 自己的 contextWindow，host 的 `callModelNative` 闭包已按 `options.agentId` resolve config，但预算是 runtime 层估算用，需在闭包内拿目标 config；若拿不到用 256k 默认）。
  - catch：`timeoutController.signal.aborted` → `throw new TaskTimeoutError(timeoutMs)`；否则透传。
  - finally：`clearTimeout(timeoutTimer)`。
- [ ] **C3** **不删除** `buildDelegatedAgentMessages`（保持使用，仅 C1 微调 section 排序）。
- [ ] **C4** `agent_call` observation 失败路径：`createAgentCallRunner` catch 的 `TaskTimeoutError` / `TaskCompressionStalledError` 转 `AGENT_CALL_FAILED` observation，details 标明 `{ timeout: true, timeoutMs }` 或 `{ stalled: true }`（让 master 收到后能区分）。
- [ ] **C 验证**：`npm run build:web`；手动 trace 检查 delegated 工具循环现在有 `triggerThreshold > 0`（不再跳过压缩块）。

**回滚点 C**：commit "feat(agent-runtime): delegated task-mode toolOptions + timeout + section reorder (no message split)"。

## 阶段 D：assistant 路径切换 task 模式 + timeoutMs

- [ ] **D1** `AgentRuntimeTurnInput`（index.ts:69）加 `timeoutMs?: number`。
- [ ] **D2** `runAgentRuntimeTurn` entry 路径（:1690 起）按 `compressionMode` 分流：
  - 加 `compressionMode` 参数（从 `input` 或新字段读——design 定：`AgentRuntimeTurnInput` 加 `compressionMode?: RuntimeCompressionMode`，默认 `"narrative"`；host 显式传 `task` 给 assistant）。
  - entry 路径构造 `toolOptions` 时传 `compressionMode`（master=narrative，assistant=task）+ task 模式传 `taskStartedAt` / `taskTimeoutMs`。
  - **assistant 的 agentContext**：仍兜底初始化（无注入），但 task 模式下**不走 `compressContext` 剧情压缩**（task 分支不碰 `agentContextSnapshot`）。entry 路径的 turn 开头压缩（R3，:1699-1734）对 task 模式跳过（assistant 兜底剧情段无压缩价值）——加 `if (compressionMode === "narrative" && estimateContextTokens(...) > triggerThreshold)` 前置。
  - **assistant 的 contextUpdate**：task 模式下 `compressedContext` 恒 undefined（不压剧情，无快照产出）；`contextUpdate` 仍返回（turn/user/assistant），host 忽略 `compressedContext`。
- [ ] **D3** `platform-host/index.ts` `runAssistantChat`（:1725）改造：
  - 创建 `timeoutController` + `setTimeout(timeoutMs)`（`input.timeoutMs ?? DEFAULT_TASK_TIMEOUT_MS`）。
  - 合并现有 `controller`（用户 abort）+ `timeoutController` → `compositeSignal = AbortSignal.any([controller.signal, timeoutController.signal])`。
  - `runAgentRuntimeTurn` 传 `compressionMode: "task"` + `timeoutMs` + `signal: compositeSignal`。
  - catch：`timeoutController.signal.aborted` → `throw new TaskTimeoutError(timeoutMs)`；否则透传。
  - finally：`clearTimeout(timeoutTimer)`。
  - `AssistantChatInput` 加 `timeoutMs?: number`（AssistantView 可选传，默认 300s）。
- [ ] **D4** `platform-host/index.ts` `interaction.sendMessage`（master，:1433）显式传 `compressionMode: "narrative"`（或依赖默认，但显式更清晰）；不传 `timeoutMs`。
- [ ] **D 验证**：`npm run build:contracts && npm run build:web`。

**回滚点 D**：commit "feat(platform-host): assistant task-mode compression + timeout"。

## 阶段 E：AssistantView catch 适配 + tool schema timeoutMs

- [ ] **E1** `AssistantView.vue` catch（:669-698）扩展：识别 `TaskTimeoutError` + `TaskCompressionStalledError`，与 `ContextBudgetExhaustedError` 同温和分支（design §2.5）。提示文案区分：超时/压缩无效/上下文已满。
- [ ] **E2** `workspace-tools.ts` `RuntimeAgentCallArguments`（:91）加 `timeoutMs?: number`。
- [ ] **E3** `tool-schemas.ts` agentCall schema `parameters` 加 `timeoutMs`（可选 integer，description 注明"子代理调用时长上限 ms，默认 300000，超时温和中止"）。
- [ ] **E4** `workspace-tools.ts` `agent_call` observation 失败路径：`AGENT_CALL_FAILED` 的 details 透传 timeout/stalled 标记（C4 已在 runner 层加，确认 observation 序列化包含）。
- [ ] **E 验证**：`npm run build:web`；vue-tsc 检查 AssistantView catch 分支类型完备。

**回滚点 E**：commit "feat(views): assistant catch task timeout/stalled + agent_call timeoutMs schema"。

## 阶段 F：spec 同步 + 全量验证

- [ ] **F1** 更新 `.trellis/spec/platform-web/frontend/type-safety.md`：
  - "Turn Token Budget And In-Turn Compression" 场景：补充 `compressionMode` 分层（narrative 保持原契约，task 新契约）+ task 模式的 `compressTaskContext` / `TaskTimeoutError` / `TaskCompressionStalledError` / 多次压缩 / 时长兜底 / 早退。
  - 新增 "Task Agent Compression (Delegated + Assistant)" 场景（或并入上文）：delegated messages 序列化（`buildTaskAgentMessages`）+ task 压缩对象（整个上下文含工具交互）+ 多次压缩 + 时长兜底 + 早退 + `agent_call.timeoutMs` + assistant task 模式。
  - "Runtime Agent Tool Calls" 场景：`agent_call.arguments` 加 `timeoutMs?`；`ContextBudgetExhaustedError` 适用范围注明"两模式共用兜底"。
  - "Parallel agent_call Within A Round" 场景：补"并行多子代理各自独立任务压缩 + 各自独立时长兜底"。
- [ ] **F2** 全量构建：`npm run build:contracts && npm run build:web`。
- [ ] **F3** 跨层数据流核对（trellis-check 跨层）：
  - `agent_call.timeoutMs`（tool schema）→ `RuntimeAgentCallArguments.timeoutMs`（workspace-tools）→ `createAgentCallRunner` 闭包 timeoutController → compositeSignal → 工具循环 `assertNotAborted` → `TaskTimeoutError` → `AGENT_CALL_FAILED` observation → master 收到。
  - assistant `timeoutMs`（AssistantView）→ `AssistantChatInput.timeoutMs` → `runAssistantChat` timeoutController → compositeSignal → `runAgentRuntimeTurn` → entry task 分支 → `TaskTimeoutError` → AssistantView catch 温和提示。
  - `compressionMode`：host（master narrative / assistant task）→ `AgentRuntimeTurnInput` → entry 路径 → `WorkspaceToolLoopOptions` → 两处循环分流。
- [ ] **F4** 代码复用核对：`compressTaskContext` 复用 `CompressCallModel` / `estimateTokenCount` / `ContextCompressionFailedError`；`locateTaskInteractionSpan` 与 `locateHistorySpan` 并列不重复；`buildTaskAgentMessages` 复用 `selectHistoryForAgentCall` / `getVisibleAgentContacts` / `formatHistory` / `formatAgentRuntimeContext` / `buildWorkspaceAgentSystemPrompt`。
- [ ] **F5** master 不回归核对：narrative 分支代码 = 现有 R2 代码 + `compressionMode === "narrative"` 前置；master 路径（`interaction.sendMessage`）传 narrative；master 的 `compressContext` / `locateHistorySpan` / `replaceHistorySpan` / `context.json` 落盘全不动。

**回滚点 F**：commit "docs(spec): task compression mode + timeout fallback + assistant task mode"。

## 阶段 G：真实 API 实测

> 依赖可游玩游戏卡 + API key 环境。登记到 `docs/active/pending-verification.md`（PV-NNN）若环境不具备。

- [ ] **G1** delegated 任务压缩：记忆 agent 读 10 文件总结，中途触发 `task_context_compressed`，继续不报错，返回结论。
- [ ] **G2** delegated 多次压缩：读 20+ 文件，compressedCount ≥ 2。
- [ ] **G3** delegated 时长兜底：`agent_call(memory, timeoutMs=10000)` 长任务 → 10s TaskTimeoutError → master 收 AGENT_CALL_FAILED(details.timeout) → master 继续。
- [ ] **G4** delegated 压缩无效早退：读超大单文件 → TaskCompressionStalledError → AGENT_CALL_FAILED(details.stalled)。
- [ ] **G5** assistant 任务压缩 + 超时 + 早退温和提示。
- [ ] **G6** master 剧情压缩不回归：一次压缩 + 第二次 ContextBudgetExhaustedError + context.json 落盘正常。
- [ ] **G7** 并行多子代理各自压缩：`agent_call(memory)+agent_call(state)` 各自独立压缩/超时/早退。
- [ ] **G8** 用户 abort vs 超时区分：用户停止 → "已停止"；超时 → "任务超时"。

**回滚点 G**：实测通过后无代码改动；若实测发现回归，回滚到对应阶段 commit 修复。

## 验证命令汇总

```bash
# 每阶段至少跑
npm run build:contracts && npm run build:web

# spec 同步后(F1)补
# (lint/type-check 已含在 build:web 内,若有单独 script 补跑)
```

## 回滚策略

- 每阶段一个 commit，回归时 `git revert <commit>` 二分定位。
- 关键回滚点：
  - 阶段 B（压缩模式分流）——若 master 剧情压缩回归，revert B 回到"两模式未分流"状态（delegated 仍无压缩，但 master 正常）。
  - 阶段 C（delegated 接入）——若 delegated 压缩导致并行/事件链回归，revert C 回到"delegated 无压缩"（缺口仍在但不破坏已落地功能）。
  - 阶段 D（assistant 切换）——若 assistant 回归，revert D 回到"assistant 走 narrative"（旧状态，压缩结果不落盘但能用）。
- 全量回滚：revert A-F 所有 commit，恢复旧 `buildDelegatedAgentMessages` + delegated 无 toolOptions + assistant narrative + 无 timeoutMs。

## 完成标准

- [ ] 阶段 A-F 全部 commit + `npm run build:contracts && npm run build:web` 通过。
- [ ] spec 同步完成（type-safety.md 两场景更新 + 新场景/契约）。
- [ ] 真实 API 实测 G1-G8 通过（或登记 PV 待环境）。
- [ ] master 剧情压缩 + context.json 落盘不回归（F5 + G6 双重确认）。
- [ ] prd.md 验收标准全勾。
