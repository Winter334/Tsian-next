# Implement — 限制机制改造（token 预算）

> **⚠️ 已过时，待重写（2026-06-19）**
> 本文档基于已推翻的假设——见 prd.md "讨论结论沉淀" 与 design.md 顶部标注。真实执行计划需在新基础任务 `agent-session-context-lifecycle` 完成后重新制定。本文档保留作历史参考，**勿据此实施**。

---

> 执行计划。按 R 顺序实施，每个 R 是独立提交单元。design.md 是技术依据，本文件是有序清单 + 验证 + 回滚点。

## 验证命令

| 用途 | 命令 |
|---|---|
| contracts 构建 | `npm run build:contracts` |
| platform-web 构建（含 vue-tsc 类型检查） | `npm run build:web` |
| 全量构建（本任务验收） | `npm run build:contracts && npm run build:web` |

> 无单元测试套件（仓库无 test 脚本）。类型安全靠 `vue-tsc -b`；行为正确性靠真实 API 实测（§验收）。

## 风险文件

| 文件 | 风险 | 回滚锚 |
|---|---|---|
| `agent-runtime/token-budget.ts`（新） | 估算/压缩纯函数，逻辑 bug 导致压缩不触发或过度压缩 | 纯函数无副作用，可独立提交（R1），单测式手动验证 |
| `agent-runtime/index.ts` | 两处工具循环终止条件改造 + maxToolRoundsPerAgent 字段移除，改动最密集；遗漏引用导致类型错 | 按 R 分段提交；R2 改循环、R3 移字段分开，类型系统兜底捕获遗漏引用 |
| `platform-host/index.ts` | 两处 `runAgentRuntimeTurn` 调用注入 contextTokenBudget（:1413, :1695） | R4 单独提交，两处对称改 |
| `views/AssistantView.vue` | catch 逻辑新增 budgetExhausted 分支，误改 abort 分支 | R5 单独提交，只新增分支不动现有 |

## 执行清单

### R1 — 新增 token-budget.ts 纯函数（先做，无副作用基础）

> 先做 R1：纯函数模块，不接循环，可独立验证估算/压缩逻辑正确性，为 R2 循环改造提供基础。

- [ ] **R1.1** 新建 `apps/platform-web/src/agent-runtime/token-budget.ts`：
  - 导出常量 `DEFAULT_CONTEXT_TOKEN_BUDGET = 256_000`。
  - 导出常量 `CONTEXT_COMPRESS_TRIGGER_RATIO = 0.85`（压缩触发阈值，design §2.3：85% budget 触发，留 15% 余量吸收估算偏差 + 给压缩后留空间）。
  - 导出常量 `COMPRESS_KEEP_RECENT_ROUNDS = 2`（压缩保留轮数，design §2.4）。
  - 导出 `estimateTokenCount(text: string): number`——`Math.ceil(text.length * 0.4 + utf8Encoder.encode(text).length * 0.25)`；模块级 hoisted `const utf8Encoder = new TextEncoder()`（避免每轮每消息重复构造）。公式详见 design §2.2（中文准确、英文保守高估，误差倒向早压缩安全侧）。
  - > **不设轮次软 cap**（design §2.6 决议）：纯 token 预算 + 用户 stop 按钮兜底，无 `MAX_TOOL_ROUNDS_SOFT_CAP` 常量。
- [ ] **R1.2** `token-budget.ts` 导出 `estimateRuntimeMessagesTokens(messages: RuntimeChatMessage[]): number`：
  - 遍历 messages：`role==="system"|"user"` 计 content；`role==="assistant"` 计 content + `toolCalls?.[].arguments`（`JSON.stringify`）；`role==="tool"` 计 `toolCallId + content`。
  - 累加调 `estimateTokenCount`。
  - 从 `../runtime-host/ai` import `RuntimeChatMessage` 类型。
- [ ] **R1.3** `token-budget.ts` 导出 `estimateAiChatMessagesTokens(messages: AiChatMessage[]): number`：
  - 遍历累加 `content` 调 `estimateTokenCount`。
  - 从 `packages/contracts`（或 `../runtime-host/ai` 重导出源）import `AiChatMessage` 类型——确认 import 路径与 index.ts 现有 import 一致。
- [ ] **R1.4** `token-budget.ts` 导出 `resolveTokenBudget(modelContextWindow: number | null | undefined): number`：
  - `typeof === "number" && > 0` 时**直接返回 `modelContextWindow`**（design §2.3 决议：尊重用户配置，不做 256k 封顶；大模型用满自己的窗口是用户意图，85% 压缩阈值兜底撞墙风险）；否则 `DEFAULT_CONTEXT_TOKEN_BUDGET`。
- [ ] **R1.5** `token-budget.ts` 导出 `compressRuntimeMessages(messages: RuntimeChatMessage[], budget: number, keepRecentRounds = COMPRESS_KEEP_RECENT_ROUNDS): RuntimeChatMessage[]`（design §2.4，借鉴 Codex 工具产出修剪：两遍策略）：
  - 模块级常量 `const TOOL_OUTPUT_OMITTED = "[Tool output omitted]"`。
  - 分离前缀保留段：所有 `role==="system"` + 第一条 `role==="user"`（永不压缩，对齐 Codex 非对称保护）。
  - 剩余按 tool 交互轮次分组：一组 = 一条 `role==="assistant"`（含 toolCalls） + 其后紧跟的所有 `role==="tool"` + 紧跟的注入 skill 全文 `role==="user"`（若该 user 在 tool 之后且下一组 assistant 之前）。
  - 标记最后 `keepRecentRounds` 组为"完整保留"。
  - **第一遍（修剪 tool output）**：从最早可修剪组开始，把组内 `role==="tool"` 的 `content` 替换为 `TOOL_OUTPUT_OMITTED`（**保留 assistant toolCall + tool 角色占位**，模型仍知调过什么）；每轮修剪后 `estimateRuntimeMessagesTokens` 重估，≤ budget 即停。
  - **第二遍（整轮删除兜底）**：若第一遍所有可修剪组都已修剪仍 > budget，从最早已修剪组开始**整组删除**（连 assistant toolCall 一起丢）；每删一组重估，≤ budget 即停。
  - 若发生了修剪或删除，构造压缩提示 user message（design §2.4 文案：告知"调用事实保留、输出省略"），插在前缀保留段之后、剩余组之前。
  - 返回 `[...前缀保留段, 压缩提示?, ...剩余组（含修剪/删除后的）]`。
  - 若无可修剪组（消息少于 keepRecentRounds）或两遍后仍超，原样返回（由调用方判断抛错）。
- [ ] **R1.6** `token-budget.ts` 导出 `compressAiChatMessages(messages: AiChatMessage[], budget: number, keepRecentRounds = COMPRESS_KEEP_RECENT_ROUNDS): AiChatMessage[]`：
  - text 协议对称（design §2.4）：前缀保留段 = system + 第一条 user；剩余按 assistant(content含工具块)+user(observation) 一组分组；标记最后 N 组完整保留。
  - **第一遍**：中间组把 user(observation) 的 `content` 替换为 `TOOL_OUTPUT_OMITTED`，**保留 assistant content**（含工具调用声明块，模型知调过什么）；逐组修剪 + 重估。
  - **第二遍**：整组删除兜底（连 assistant 一起丢）。
  - 修剪/删除后插压缩提示 user message。
- [ ] **R1.7** `token-budget.ts` 导出 `ContextBudgetExhaustedError extends Error`（design §2.5）：
  - `constructor(debugLabel: string)`，`super(\`${debugLabel} 上下文已满，无法继续。请开始新会话或精简对话历史。\`)`，`this.name = "ContextBudgetExhaustedError"`。
- [ ] **R1.8** 验证：`npm run build:web` 通过（纯函数 + 类型，无循环接入）。

### R2 — 两循环接入 token 预算 + 压缩

> R2 改循环终止条件，R3 才移字段。R2 先保留 maxToolRounds 变量（暂不读），改循环为 `for(;;)` + token 预算检查，避免一次改太多。

- [ ] **R2.1** `index.ts` `WorkspaceToolLoopOptions`（:196）增 `contextTokenBudget: number`（必填）。
- [ ] **R2.2** `index.ts` `AgentRuntimeTurnInput`（:52）增可选 `contextTokenBudget?: number`。
- [ ] **R2.3** `index.ts` `runAgentRuntimeTurn`（:1428）：resolve 预算 `const contextTokenBudget = resolveTokenBudget(input.contextTokenBudget)`；构造 `toolOptions` 时传入。import `resolveTokenBudget` from `./token-budget`。
- [ ] **R2.4** `index.ts` native 循环 `callAgentModelWithWorkspaceToolsNative`（:1099）：
  - 循环头 `for (let round = 0; round <= maxToolRounds; round += 1)`（:1131）→ `for (let round = 0; ; round += 1)`。
  - 删除 `const maxToolRounds = ...`（:1111-1112）读取（R3 再删字段定义，此处先不读）。
  - 删除 `if (round >= maxToolRounds)` 分支（:1183-1199，含 round limit 抛错）。
  - 在 `assertNotAborted(options.signal)`（:1132）之后、`callModelNative`（:1138）之前，插入 token 预算检查（design §2.3：85% 阈值触发，压缩目标回到阈值以下）：
    ```ts
    const budget = toolOptions.contextTokenBudget
    const triggerThreshold = budget * CONTEXT_COMPRESS_TRIGGER_RATIO   // 85% 触发线
    const beforeTokens = estimateRuntimeMessagesTokens(runtimeMessages)
    if (beforeTokens > triggerThreshold) {
      runtimeMessages = compressRuntimeMessages(runtimeMessages, triggerThreshold)
      capabilities.emitTrace?.({ type: "context_compressed", agentId: agentContext.agent.id, debugLabel: options.debugLabel, ok: true, data: { round, beforeTokens, budget, triggerThreshold } })
      if (estimateRuntimeMessagesTokens(runtimeMessages) > triggerThreshold) {
        throw new ContextBudgetExhaustedError(options.debugLabel)
      }
    }
    ```
  - import `estimateRuntimeMessagesTokens, compressRuntimeMessages, ContextBudgetExhaustedError, CONTEXT_COMPRESS_TRIGGER_RATIO` from `./token-budget`。
  - 末尾兜底 `throw new Error(... failed to complete ...)`（:1260）保留（理论不可达，防御）。
- [ ] **R2.5** `index.ts` text 循环 `callAgentModelWithWorkspaceTools`（:1263）：
  - 循环头 `for (let round = 0; round <= maxToolRounds; round += 1)`（:1320）→ `for (let round = 0; ; round += 1)`。
  - 删除 `const maxToolRounds = ...`（:1318-1319）读取。
  - 删除 `if (round >= maxToolRounds)` 分支（:1352-1369）。
  - 在 `assertNotAborted`（:1321）之后、`callModel`（:1323）之前，插入对称的 token 预算检查（用 `estimateAiChatMessagesTokens`/`compressAiChatMessages` 作用于 `nextMessages`，同样用 `CONTEXT_COMPRESS_TRIGGER_RATIO` 算 85% 阈值线 + 压缩目标回到阈值以下）。
  - import `estimateAiChatMessagesTokens, compressAiChatMessages, ContextBudgetExhaustedError, CONTEXT_COMPRESS_TRIGGER_RATIO` from `./token-budget`。
- [ ] **R2.6** 验证：`npm run build:web` 通过。此时 `maxToolRounds` 字段仍在 policy 但不再被读（R3 移除）。

### R3 — 移除 maxToolRoundsPerAgent 字段

- [ ] **R3.1** `index.ts` `AgentRuntimeCollaborationPolicy`（:153-158）：删 `maxToolRoundsPerAgent: number`。
- [ ] **R3.2** `index.ts` `DEFAULT_AGENT_RUNTIME_COLLABORATION_POLICY`（:181-190）：删 `maxToolRoundsPerAgent: 3,`。
- [ ] **R3.3** `index.ts` `normalizeAgentRuntimeCollaborationPolicy`（:249-266）：删 `maxToolRoundsPerAgent: normalizePolicyInteger(...)` 块（:261-264）。
- [ ] **R3.4** 全量 grep `maxToolRoundsPerAgent` 在 `apps/platform-web/src`——应只剩 spec 文档（type-safety.md:625，Phase 3.3 更新）与注释（若有）。确认无代码引用残留。
- [ ] **R3.5** 验证：`npm run build:web` 通过（类型系统兜底：若 R2.4/R2.5 漏删 maxToolRounds 读取，此处编译报错）。

### R4 — platform-host 注入 contextTokenBudget

- [ ] **R4.1** `platform-host/index.ts` 第 1 处 `runAgentRuntimeTurn`（:1413）：在 input 构造前 resolve 入口 agent config 拿 contextWindow：
  ```ts
  const entryAgentConfig = resolveAgentModelConfig("master", providerPresetMap)
  const contextTokenBudget = resolveTokenBudget(entryAgentConfig?.contextWindow ?? null)
  ```
  input 增 `contextTokenBudget`。import `resolveTokenBudget` from `../agent-runtime/token-budget`。
- [ ] **R4.2** `platform-host/index.ts` 第 2 处 `runAgentRuntimeTurn`（:1695）：对称改，`resolveAgentModelConfig(agentId, providerPresetMap)` 拿 config，注入 `contextTokenBudget`。
- [ ] **R4.3** 验证：`npm run build:web` 通过。

### R5 — AssistantView 温和兜底

- [ ] **R5.1** `views/AssistantView.vue` catch 块（:665-684）：
  - 在 `aborted` 判断后新增 `budgetExhausted` 判断（design §2.5）：
    ```ts
    const budgetExhausted = error instanceof Error && error.name === "ContextBudgetExhaustedError"
    ```
  - 新增 `else if (budgetExhausted)` 分支：保留已流式 thought（`assistantMsg.content` 非空则追加 `\n\n_（上下文已满，请开始新会话）_`，空则设为温和提示文案）；`await persistCurrentSession()`；**不 pop 占位消息**、**不设 errorMessage**。
- [ ] **R5.2** 验证：`npm run build:web` 通过。

### 收尾

- [ ] **C1** 全量 grep 残留：`grep -rn "maxToolRoundsPerAgent\|reached the workspace tool round limit" apps/platform-web/src` 应无代码引用（spec 文档单独 Phase 3.3 更新）。
- [ ] **C2** `npm run build:contracts && npm run build:web` 最终通过。
- [ ] **C3** 真实 API 实测（设计探索场景）：让模型在空卡片查 Agent 场景探索 6+ 轮（list→read→list→read），确认不再报 round limit，自然给出回复。
- [ ] **C4** 真实 API 实测（压缩场景）：人为构造超长上下文（多次大 tool output 或超长 history），确认压缩触发（trace `context_compressed` 事件 / 模型行为显示早期信息丢失后仍继续），压缩后循环继续不崩；极端构造压缩后仍超限，确认温和兜底"上下文已满"出现且已流式 thought 保留。
- [ ] **C5** 回归实测：普通短对话不误触压缩；abort（停止按钮）行为不变。

## task.py start 前检查

- [ ] design.md 已完成（4 开放问题已决议）。
- [ ] implement.md 已完成（有序清单 + 验证命令）。
- [ ] implement.jsonl / check.jsonl 已配 spec 引用（1.3）。
- [ ] 用户审查通过 design.md + implement.md。
