# Implement — master agent 会话上下文生命周期与压缩持久化

> 执行计划。按 R 顺序实施，每个 R 是独立提交单元。design.md 是技术依据，本文件是有序清单 + 验证 + 回滚点。

## 验证命令

| 用途 | 命令 |
|---|---|
| contracts 构建 | `npm run build:contracts` |
| platform-web 构建（含 vue-tsc 类型检查） | `npm run build:web` |
| 全量构建（本任务验收） | `npm run build:contracts && npm run build:web` |

> 无单元测试套件。类型安全靠 `vue-tsc -b`；行为正确性靠真实 API 实测（§验收）。

## 风险文件

| 文件 | 风险 | 回滚锚 |
|---|---|---|
| `agent-runtime/context-lifecycle.ts`（新） | 压缩/读写逻辑 bug 导致上下文错乱或压缩腐烂 | 纯/半纯函数，R1 独立提交，可单独回滚（回滚后无压缩但 context.json 仍读写） |
| `agent-runtime/index.ts` | R2 上下文源切换改 `buildEntryAgentMessages` + R3 压缩插入 `runAgentRuntimeTurn` 开头，改动密集 | R2/R3 分开提交；R2 回滚到 saveHistory 作上下文源可临时止血 |
| `platform-host/index.ts` | R2 注入 context + R4 收尾写 context.json，两处对称改（:1413/:1695, :1503-1519） | R4 单独提交，收尾写 context.json 失败不阻断 turn（事务回滚 context.json 写入，saveHistory 仍更新） |
| `contracts/src/runtime.ts` | AgentRuntimeTurnInput/Result 新增字段，类型扩展 | 向后兼容（可选字段），旧调用方不传走兜底 |

## 执行清单

### R1 — 新增 context-lifecycle.ts 核心模块（纯/半纯函数，先做）

> 先做 R1：context.json 读写 + 估算 + 压缩 + 类型，不接 runtime/host，可独立验证。

- [ ] **R1.1** 新建 `apps/platform-web/src/agent-runtime/context-lifecycle.ts`，定义类型：
  - `AgentContextSnapshot`（schema/saveId/agentId/summary/recentTurns/lastCompressedTurn/updatedAt，design §2.1）。
  - `AgentContextTurnEntry`（turn/role/content）。
  - 常量 `AGENT_CONTEXT_SCHEMA = "tsian.agent.context.v1"`、`AGENT_CONTEXT_PATH = "agents/master/context.json"`、`DEFAULT_CONTEXT_TOKEN_BUDGET = 256_000`、`CONTEXT_COMPRESS_TRIGGER_RATIO = 0.85`、`CONTEXT_KEEP_RECENT_TURNS = 5`、`TARGET_COMPRESSION_TOKENS = 2000`（摘要目标体积，可后续调）。
- [ ] **R1.2** token 估算（design §2.6，复用 tool-token-budget 决策，自含不依赖 token-budget.ts）：
  - 模块级 `const utf8Encoder = new TextEncoder()`。
  - `estimateTokenCount(text)`：`Math.ceil(text.length * 0.4 + utf8Encoder.encode(text).length * 0.25)`。
  - `estimateContextTokens(context)`：summary tokens + recentTurns content tokens 累加。
  - `resolveTokenBudget(modelContextWindow)`：配置值或 256k。
- [ ] **R1.3** context.json 序列化/反序列化：
  - `serializeAgentContext(snapshot): string`——`JSON.stringify` + schema 校验。
  - `parseAgentContext(content: string, saveId: string): AgentContextSnapshot`——JSON.parse + schema 字段校验 + 兜底（缺字段时 summary=null/recentTurns=[]/lastCompressedTurn=null）。
  - `createInitialAgentContext(saveId: string, recentHistory: ConversationMessageRecord[], currentTurn: number): AgentContextSnapshot`——从 saveHistory 最近 5 轮初始化（design §3.1 首 turn 兜底）。
- [ ] **R1.4** 摘要 prompt（design §2.4）：
  - `COMPRESSION_SYSTEM_PROMPT`（叙事梗概风格常量）。
  - `buildCompressionPrompt(oldSummary, compressEntries, targetTokens)`——旧 summary + 被压缩轮次正文格式化。
- [ ] **R1.5** 压缩函数（design §2.3，半纯——含 async callModel）：
  - `async compressContext(context, threshold, callModel, options): Promise<AgentContextSnapshot>`：
    - 保留最近 `CONTEXT_KEEP_RECENT_TURNS` 轮（按 turn 降序取最近5个 turn 的 user+assistant 对）。
    - 被压缩轮次 + 旧 summary 送 `callModel` 生成叙事梗概。
    - callModel 失败 → `throw new ContextCompressionFailedError()`（design §2.5）。
    - 返回新快照（newSummary + keepEntries + lastCompressedTurn 更新 + updatedAt）。
- [ ] **R1.6** `ContextCompressionFailedError`（design §2.5）：`super(温和文案)`，`this.name = "ContextCompressionFailedError"`。
- [ ] **R1.7** recentTurns 追加 + 裁剪（供 R4 用）：
  - `appendTurnToContext(context, turn, user, assistant): AgentContextSnapshot`——追加本轮 user+assistant 进 recentTurns，保持最近 5 轮（超5从头部丢），更新 updatedAt。不在此压缩（压缩在 turn 开头）。
- [ ] **R1.8** 验证：`npm run build:web` 通过（纯/半纯函数 + 类型，未接入循环）。

### R2 — 上下文源切换（buildEntryAgentMessages + runAgentRuntimeTurn + contracts）

> R2 切换上下文源，但不引入压缩（R3 才加压缩）。先让 context.json 读写通，master agent 从 context 读历史。

- [ ] **R2.1** `contracts/src/runtime.ts`：`AgentRuntimeTurnInput` 增可选 `agentContext?: AgentContextSnapshot`（类型从 contracts 导出或 index.ts 导出再被 contracts 引用——确认类型定义位置，倾向 contracts 定义 `AgentContextSnapshot` 供跨层共享）。`AgentRuntimeTurnResult` 增可选 `contextUpdate?: { user: string; assistant: string; turn: number; compressedContext?: AgentContextSnapshot }`。
- [ ] **R2.2** `agent-runtime/index.ts` `buildEntryAgentMessages`（:631）：
  - 增参数 `agentContext: AgentContextSnapshot | null`。
  - "最近对话"区（:667-668）从 `formatHistory(normalizeHistory(input.recentHistory))` 改为：
    ```ts
    agentContext
      ? [
          agentContext.summary ? `早期剧情摘要：\n${agentContext.summary}` : "",
          "最近对话：",
          formatRecentTurns(agentContext.recentTurns),
        ].filter(Boolean).join("\n")
      : formatHistory(normalizeHistory(input.recentHistory))  // 兜底：无 context 用旧逻辑
    ```
  - 新增 `formatRecentTurns(entries)`：`entries.map(e => \`${e.turn}. ${e.role === "user" ? "玩家" : "叙事"}: ${e.content}\`).join("\n")`。
- [ ] **R2.3** `agent-runtime/index.ts` `runAgentRuntimeTurn`（:1428）：
  - try 块开头（:1447 前）读 `input.agentContext`，若无则从 `input.recentHistory` 用 `createInitialAgentContext` 兜底初始化（design §3.1 首 turn）。
  - `buildEntryAgentMessages` 调用（:1449）传入 `agentContext`。
  - return（:1493）增 `contextUpdate: { user: input.userInput, assistant: replyText, turn: currentRuntimeTurnNumber(input) }`。
- [ ] **R2.4** `platform-host/index.ts` 两处 `runAgentRuntimeTurn` 调用（:1413/:1695）：
  - 调用前读 context.json：`const agentContext = await readAgentContextFromWorkspace(workspaceTransaction或工作区, activeSaveId)`（读 `agents/master/context.json`，不存在则 null）。
  - 注入 `input.agentContext = agentContext`。
  - turn 收尾（:1503-1519）`stageAgentContextFile`（R4 详述，R2 先占位只写不压缩）。
- [ ] **R2.5** 验证：`npm run build`。实测：多轮对话 context.json 正确生成更新，master agent 从 context 读历史（非 saveHistory slice）。

### R3 — 压缩插入（runAgentRuntimeTurn 开头）

> R3 在 R2 基础上加压缩。R2 已通 context 读写，R3 加"超阈值压缩"。

- [ ] **R3.1** `agent-runtime/index.ts` `runAgentRuntimeTurn`（:1428）try 块开头（R2.3 读 context 之后、buildEntryAgentMessages 之前）：
  ```ts
  let agentContext = input.agentContext ?? createInitialAgentContext(input.recentHistory, currentRuntimeTurnNumber(input))
  const budget = resolveTokenBudget(modelContextWindow)  // modelContextWindow 来源：input 新增或从 capabilities
  const threshold = budget * CONTEXT_COMPRESS_TRIGGER_RATIO
  let compressedContext: AgentContextSnapshot | undefined
  if (estimateContextTokens(agentContext) > threshold) {
    try {
      agentContext = await compressContext(agentContext, threshold, capabilities.callModel, callOptions)
      compressedContext = agentContext
      capabilities.emitTrace?.({ type: "context_compressed", agentId: "master", debugLabel: "entry-agent", ok: true, data: { budget, threshold } })
    } catch (error) {
      capabilities.emitTrace?.({ type: "context_compression_failed", agentId: "master", debugLabel: "entry-agent", ok: false, data: errorToTraceData(error) })
      throw error  // ContextCompressionFailedError 冒泡
    }
  }
  ```
  - `modelContextWindow` 来源勘察：确认 `AgentRuntimeTurnInput` 或 capabilities 是否携带 model.config。若否，platform-host 注入时 resolve（同 tool-token-budget 的 contextTokenBudget 思路），或在 input 增 `contextTokenBudget?: number`。
- [ ] **R3.2** return（:1493）的 `contextUpdate.compressedContext` 传 `compressedContext`（若本轮压缩了）。
- [ ] **R3.3** 验证：`npm run build`。实测：构造超长上下文（多轮大正文）触发压缩（trace context_compressed），压缩后 master agent 用 summary+最近5轮继续；压缩失败（人为断 model）显示温和提示，turn 中断可重试。

### R4 — turn 收尾写 context.json（platform-host）

> R4 在 turn 收尾把本轮正文追加 + 压缩结果落盘。

- [ ] **R4.1** `platform-host/index.ts` 新增 `stageAgentContextFile(workspaceTransaction, { saveId, agentId, turn, user, assistant, compressedContext })`：
  - 读现有 context.json（工作区文件）→ parseAgentContext；不存在则 createInitialAgentContext(saveHistory 最近5轮)。
  - 若 `compressedContext` 存在（本轮开头压缩了）：用 compressedContext 作基础（summary/recentTurns/lastCompressedTurn 已更新），再 `appendTurnToContext` 追加本轮 user+assistant。
  - 若无 compressedContext：`appendTurnToContext(现有context, turn, user, assistant)`。
  - `workspaceTransaction.write({ path: "agents/master/context.json", content: serializeAgentContext(snapshot), mediaType: "application/json" })`。
- [ ] **R4.2** turn 收尾（:1503-1519）在 `stageAgentSessionTranscriptFiles` 后加 `stageAgentContextFile(workspaceTransaction, { saveId: activeSaveId, agentId: "master", turn: nextTurn, user: content, assistant: result.replyText, compressedContext: result.contextUpdate?.compressedContext })`。
- [ ] **R4.3** trace：`trace.emit({ type: "agent_context_staged", ok: true, data: { turn: nextTurn, summaryPresent: !!snapshot.summary, recentTurns: snapshot.recentTurns.length } })`。
- [ ] **R4.4** 验证：`npm run build`。实测：多轮对话后关闭重开存档，master agent 上下文从 context.json 恢复（不失忆）；context.json 内容正确（summary + 最近5轮）。

### R5 — AssistantView 失败兜底验证（无新分支，确认传播）

> R3 的 ContextCompressionFailedError 走现有 catch else 分支（:677），error.message 即温和文案。R5 只验证传播正确，不新增代码。

- [ ] **R5.1** 确认 `ContextCompressionFailedError` 从 `compressContext` → `runAgentRuntimeTurn` rethrow（:1490）→ platform-host → AssistantView catch（:665）else 分支（:677）`errorMessage.value = error.message`（温和文案）+ pop 空占位（压缩在 model 生成前，assistantMsg.content 为空）。
- [ ] **R5.2** 验证：人为触发压缩失败（mock callModel reject），UI 显示"上下文压缩失败，无法继续本轮。请重试；若持续失败，请检查 Agent 模型配置或开始新会话。"，占位消息被 pop，用户可重发。

### 收尾

- [ ] **C1** 全量 grep：确认无残留 `formatHistory(normalizeHistory(input.recentHistory))` 作上下文源（buildEntryAgentMessages 内已切换，但 normalizeHistory/formatHistory 函数本身保留——仍服务兜底/其它用途）。
- [ ] **C2** `npm run build:contracts && npm run build:web` 最终通过。
- [ ] **C3** 真实 API 实测（正常流）：多轮对话 → context.json 正确更新 → 关闭重开存档 → master agent 上下文恢复不失忆 → 剧情连贯。
- [ ] **C4** 真实 API 实测（压缩流）：构造超长上下文触发压缩 → trace context_compressed → 压缩后 master agent 用 summary+最近5轮继续 → 再次累积触发二次压缩（旧summary被再浓缩）→ 稳态成立。
- [ ] **C5** 真实 API 实测（失败流）：人为断 model 触发压缩失败 → 温和提示 → 重试恢复（model 恢复后压缩成功）。
- [ ] **C6** 旧存档迁移实测：用旧存档（无 context.json）首次跑新代码 → 首 turn 从 saveHistory 兜底初始化 context → 收尾落盘 context.json → 后续 turn 正常用 context.json。

## task.py start 前检查

- [ ] prd.md 已完成（所有 open questions 已决）。
- [ ] design.md 已完成（架构边界/数据流契约/兼容迁移/权衡）。
- [ ] implement.md 已完成（有序清单 + 验证命令）。
- [ ] implement.jsonl / check.jsonl 已配 spec 引用。
- [ ] 用户审查通过 design.md + implement.md。
