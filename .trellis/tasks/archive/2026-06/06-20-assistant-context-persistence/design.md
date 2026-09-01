# Design — 助手 agent 跨 turn 持久化（.tsian/local/assistant/sessions 虚拟文件系统 + 任务摘要稳态）

> 父任务：`06-19-tool-runtime-performance`。
> **依赖 `06-20-agent-task-compression`（已交付归档）**——复用其 task 压缩模式（`compressionMode: "task"` + turn 内 `compressTaskContext` + 时长兜底），在其上加跨 turn/跨加载持久化层。
> 本文件 2026-06-20 编写，对应 `prd.md` 已对齐方向。存储位置经与用户二次对齐（文件系统可视化野心）。

## 0. 核心机制（一句话）

**给桌面助手加跨 turn 持久化，机制与 master 的 `agents/master/context.json` 同构但换内容为任务摘要、换存储载体为 `.tsian/local/assistant/` 虚拟文件系统：每会话一份 context 快照存 `.tsian/local/assistant/sessions/<sessionId>/context.json`（实际落 local-assistant-files 的 Dexie map），turn 开头 host 从已加载的 localAssistantFiles 里 find 快照注入 runtime、runtime turn 开头检查 token 超 85% 压任务摘要、turn 结束 host 把快照写进 workspaceTransaction（搭便车 `commitAssistantWorkspaceFiles` → `saveLocalAssistantFiles` 落盘）；跨加载从虚拟文件系统恢复。复用 `AgentContextSnapshot` 类型（放宽 `agentId`/`schema`）+ `context-lifecycle.ts` 函数（参数化 prompt/schema/agentId），不新建模块、不新建类型、不动 master 路径。context 作为虚拟文件暴露，agent 可用 workspace_read/workspace_write 管理——契合"所有平台数据收录到文件系统、用桌面 agent 管理"的产品哲学。**

对标 master 的 context.json 稳态（1 摘要 + 最近 K 轮正文，跨 turn/跨加载不膨胀不失忆），助手换压缩内容为任务摘要（已做工作 + 结论）、换存储为虚拟文件系统。与 master 的同构与差异：

| | master（叙事，不动） | 助手（本任务建立） |
|---|---|---|
| 持久化路径 | save runtime 文件 `agents/master/context.json` | **虚拟文件 `.tsian/local/assistant/sessions/<sessionId>/context.json`**（每会话独立） |
| 存储载体 | save runtime workspace 文件（跨平台契约） | **local-assistant-files 的 Dexie map**（`assistant-local-files` key，path→content map） |
| schema | `tsian.agent.context.v1` | **`tsian.assistant.context.v1`**（新 schema 标记，复用 `AgentContextSnapshot` 类型） |
| agentId | `"master"` | `"assistant"` |
| 压缩内容 | 剧情梗概（`COMPRESSION_SYSTEM_PROMPT`） | **任务摘要（新 `ASSISTANT_CONTEXT_COMPRESSION_SYSTEM_PROMPT`）** |
| 多实例 | 一存档一 context | **一会话一 context**（多会话独立，sessions 子目录） |
| turn 开头读 | `readAgentContextFromWorkspace`（workspace find） | **从 `localAssistantFiles` find**（已加载，零额外 IO） |
| turn 结束写 | `stageAgentContextFile`（workspaceTransaction.write + save 提交） | **`workspaceTransaction.write` + `commitAssistantWorkspaceFiles` → `saveLocalAssistantFiles`**（搭便车，零额外 IO） |
| agent 可管理 | 是（workspace_read/write save runtime） | **是（workspace_read/write `.tsian/local/assistant/sessions/`）**——契合文件系统可视化哲学 |
| 跨加载恢复 | save 恢复 → 下 turn 读 context.json | **`loadLocalAssistantFiles` 恢复 map → 下 turn find session context** |

## 1. 架构与边界

### 1.1 涉及模块

| 层 | 文件 | 改动性质 |
|---|---|---|
| contracts | `packages/contracts/src/runtime.ts` | **小扩展**：`AgentContextSnapshot.agentId` 从 `"master"` 字面量放宽为 `string`；`schema` 从单值放宽为联合。向后兼容（master 仍传 `"master"` / 旧 schema） |
| runtime-core | `apps/platform-web/src/agent-runtime/context-lifecycle.ts` | **参数化 + 新常量**：① 新增 `ASSISTANT_CONTEXT_SCHEMA` / `ASSISTANT_CONTEXT_AGENT_ID` / `ASSISTANT_CONTEXT_COMPRESSION_SYSTEM_PROMPT` 常量；② `createEmptyAgentContext` / `createInitialAgentContext` / `parseAgentContext` 加可选 `{ schema?, agentId? }` 参数（默认 master 值，向后兼容）；③ `compressContext` + `buildCompressionPrompt` 加可选 `systemPrompt` / `userLabel` / `assistantLabel` 参数（默认 master 值）。现有函数签名向后兼容，master 调用点不改 |
| runtime-core | `apps/platform-web/src/agent-runtime/index.ts` | **放宽 turn 开头压缩 guard**：entry 路径 turn 开头压缩（`index.ts:2005-2037`）从 `entryCompressionMode === "narrative"` 放宽为两模式都执行，按 mode 选压缩 prompt（narrative→剧情梗概，task→任务摘要）。task 模式压缩快照（summary + recentTurns），与 turn 内 `compressTaskContext`（压工具交互段）独立互补 |
| platform-host | `apps/platform-web/src/platform-host/index.ts` | **核心改动**：①`AssistantChatInput` 加 `sessionId: string`；②新增 `assistantContextPath(sessionId)` helper + `readAssistantContextFromFiles` + `stageAssistantContextFile`（对称 master 的 `readAgentContextFromWorkspace`/`stageAgentContextFile`，但从 localAssistantFiles 读、写 workspaceTransaction）；③`runAssistantChat` turn 开头从 `localAssistantFiles` find 快照 + 推 turn 号 + 传 `agentContext`/`contextTokenBudget` 给 runtime；④turn 结束 `stageAssistantContextFile` 写进事务（搭便车 `commitAssistantWorkspaceFiles` → `saveLocalAssistantFiles` 落盘） |
| storage | `apps/platform-web/src/storage/local-assistant-files.ts` | **新增 path helper + 删除能力**：①导出 `assistantContextPath(sessionId)` 常量函数（路径 `.tsian/local/assistant/sessions/<sessionId>/context.json`）；②新增 `deleteLocalAssistantFile(path)` 函数（从 map 删单项，供会话删除清理 context 用）。现有 `loadLocalAssistantFiles`/`saveLocalAssistantFiles`/`isLocalAssistantPath` 不改（合并落盘机制已支持新路径） |
| storage | `apps/platform-web/src/storage/assistant-conversations.ts` | **会话删除清理**：`deleteAssistantSession` 连带调 `deleteLocalAssistantFile(assistantContextPath(id))` 清理该会话的 context 快照（防孤儿） |
| platform-web | `apps/platform-web/src/views/AssistantView.vue` | **传 sessionId**：`send()` 调 `runAssistantChat` 时传 `sessionId: activeSessionId.value` |

### 1.2 不动的边界

- **master 的 context.json 全链路**——`AGENT_CONTEXT_PATH` / `readAgentContextFromWorkspace` / `stageAgentContextFile` / `agents/master/context.json` 落盘 / master 的 `compressContext` 调用（narrative prompt）全不改。master 路径（`interaction.sendMessage`）传 `compressionMode: "narrative"` 走 narrative 分支，行为不变。
- **task 压缩机制本身**（`06-20-agent-task-compression` 交付物）——`compressTaskContext` / `locateTaskInteractionSpan` / `TaskTimeoutError` / `TaskCompressionStalledError` / `compressionMode: "task"` / 时长兜底 / `TASK_COMPRESSION_SYSTEM_PROMPT` 不改。本任务在其上加持久化层，不动 turn 内工具交互压缩。
- **助手可见消息存储**（`assistant-conversations.ts` 现有 `saveAssistantSessionMessages` / `getAssistantSessionMessages` / `assistant-session:<id>` key）——不改。可见消息（UI 展示）与 context 快照（agent 上下文稳态）分离，对称 master 的 saveHistory vs context.json。
- **`.tsian/local/assistant/` 身份文件**（`local-assistant-files.ts` 的 agent.json / AGENT.md / SOUL.md / notes.md / skills/）——不改。context 快照存 `sessions/` 子目录（会话状态），与身份文件（跨会话共享）同 map 不同子目录，职责分明。
- **`loadLocalAssistantFiles` / `saveLocalAssistantFiles` / `isLocalAssistantPath` 核心机制**——不改。`saveLocalAssistantFiles` 的合并落盘机制天然支持新路径（`sessions/<id>/context.json` 匹配 `isLocalAssistantPath` 前缀，自动合并）。`loadLocalAssistantFiles` 加载整个 map（含 sessions）天然让 context 进 workspaceFiles。
- **`AgentContextTurnEntry` 结构**——`{ turn, role: "user"|"assistant", content }` 通用，master/助手共用，不改。
- **abort 机制 + 时长兜底**——`runAssistantChat` 现有的 `controller`（用户 abort）+ `timeoutController`（时长兜底）+ `compositeSignal` 不改。context 读写发生在 runtime 调用前后，turn 失败不写回 context（对称 master turn 失败 `workspaceTransaction.discard()`）。
- **AssistantView 渲染 + session 管理**——只加传 `sessionId` 一行，不改 session 创建/切换/删除/重命名逻辑。
- **delegated agent_call 路径**——delegated 不走 `runAgentRuntimeTurn` entry 路径（走 `createAgentCallRunner` 闭包直调 `callAgentModelWithWorkspaceTools`），不受 entry turn 开头压缩 guard 放宽影响。delegated 无跨 turn 持久化（turn 内即弃），本任务不涉及。

### 1.3 关键技术约束（勘察确认）

**约束1：助手是多会话模型，context 快照必须按会话独立存储，且要走文件系统可视化路径。**

PRD 写的 `.tsian/local/assistant/context.json` 是单一共享路径，但 `AssistantView` 支持多会话。单一共享路径 → 切换会话串上下文（会话 B 读到会话 A 的摘要）。同时用户明确提出"把所有平台配置和有用数据收录到文件系统、用桌面 agent 管理"的产品哲学——context 应作为虚拟文件暴露给 agent，而非藏进不可见的 Dexie KV。

**决议（与用户二次对齐 2026-06-20）**：按会话独立存储，走 `.tsian/local/assistant/` 虚拟文件系统。路径 `.tsian/local/assistant/sessions/<sessionId>/context.json`（实际存 local-assistant-files 的 Dexie map 的一项）。理由见 §4.1。`sessions/` 子目录与身份文件（agent.json/SOUL.md 等）同 map 不同子目录，职责分明。agent 可 `workspace_read .tsian/local/assistant/sessions/<id>/context.json` 读到、可 workspace_write 管理——契合文件系统可视化哲学。

**约束2：助手当前 fake snapshot turn=0，每轮 turn 号恒为 1，破坏 `lastCompressedTurn` 去重。**

`runAssistantChat`（`platform-host:1818`）传 `snapshot: { ..., state: { turn: 0, messages: [] } }`。`currentRuntimeTurnNumber(input) = input.snapshot.state.turn + 1`（`index.ts:521-523`）→ 助手每轮 turn=1。`appendTurnToContext` 用 turn 标记 recentTurns 条目，`compressContext` 用 `lastCompressedTurn` 防重复压缩。turn 恒为 1 → 所有轮次 turn=1 → 压缩去重失效（`lastCompressedTurn` 永远停在 1）。

**决议**：`runAssistantChat` turn 开头从读出的 context 快照推算下一 turn 号，设入 fake snapshot 的 `state.turn`。推算逻辑（新增 helper `nextAssistantTurnNumber`）：

```ts
function nextAssistantTurnNumber(snapshot: AgentContextSnapshot): number {
  const maxRecent = snapshot.recentTurns.reduce((max, e) => Math.max(max, e.turn), 0)
  const maxCompressed = snapshot.lastCompressedTurn ?? 0
  return Math.max(maxRecent, maxCompressed) + 1
}
```

设入 `snapshot.state.turn = nextTurn - 1`，使 `currentRuntimeTurnNumber` 返回 `nextTurn`。首次（空快照）→ maxRecent=0, maxCompressed=0 → nextTurn=1。每轮递增，`lastCompressedTurn` 去重正确工作。

**约束3：`parseAgentContext` 硬编码 master schema/agentId，不认 assistant schema。**

`parseAgentContext`（`context-lifecycle.ts:120-150`）解析后强制 `schema: AGENT_CONTEXT_SCHEMA`（`tsian.agent.context.v1`）+ `agentId: AGENT_CONTEXT_AGENT_ID`（`"master"`），不管原文是什么。若存了 `tsian.assistant.context.v1` 的快照，parse 会被覆写回 master 值——agentId/schema 丢失。

**决议**：`parseAgentContext` 加可选 `{ schema?, agentId? }` 参数（默认 master 值）。parse 时用传入的 schema/agentId 而非硬编码。master 调用点（`readAgentContextFromWorkspace`）不传（用默认）。助手 host 用 `parseAgentContext(content, sessionId, { schema: ASSISTANT_CONTEXT_SCHEMA, agentId: "assistant" })`。

**约束4：turn 开头压缩 guard 当前 narrative-only，task 模式跳过快照压缩。**

`index.ts:2005-2007`：`if (entryCompressionMode === "narrative" && estimateContextTokens(agentContext) > triggerThreshold)`。task 模式（助手）跳过 turn 开头快照压缩。这是 `06-20-agent-task-compression` 的设计——当时助手无持久化快照（兜底初始化的剧情段无压缩价值），task 压缩只在 turn 内压工具交互段。

现在本任务给助手加了持久化快照（任务摘要 + 最近 K 轮），turn 开头需要压快照（summary + recentTurns 累积超阈值时压任务摘要）。**这和 turn 内 `compressTaskContext`（压工具交互段）是两个独立维度**：
- turn 开头压快照：压的是跨 turn 累积的 `AgentContextSnapshot`（summary + recentTurns），防止跨 turn 稳态膨胀。
- turn 内压工具交互：压的是本轮 messages 的工具调用段（assistant toolCalls + tool observation），防止单轮探索膨胀。

两者都用 85% 阈值但作用对象不同（`estimateContextTokens(snapshot)` vs `estimateRuntimeMessagesTokens(messages)`），互补不冲突。

**决议**：放宽 guard 从 `entryCompressionMode === "narrative"` 为两模式都执行。按 mode 选压缩 prompt：

```ts
if (estimateContextTokens(agentContext) > triggerThreshold) {
  const compressOptions: CompressCallOptions = {
    debugLabel: "entry-agent",
    signal: input.signal,
    agentId: entryContext.agent.id,
    ...(entryCompressionMode === "task"
      ? {
          systemPrompt: ASSISTANT_CONTEXT_COMPRESSION_SYSTEM_PROMPT,
          userLabel: "用户",
          assistantLabel: "助手",
        }
      : {}),
  }
  agentContext = await compressContext(agentContext, triggerThreshold, capabilities.callModel, compressOptions)
  compressedContext = agentContext
  ...
}
```

narrative 分支不传新字段 → `compressContext` 用默认 `COMPRESSION_SYSTEM_PROMPT` + "玩家"/"叙事"标签（master 行为不变）。task 分支传 `ASSISTANT_CONTEXT_COMPRESSION_SYSTEM_PROMPT` + "用户"/"助手"标签。

**约束5：`compressContext` 用 `COMPRESSION_SYSTEM_PROMPT`（叙事梗概），不适合任务摘要。**

`compressContext`（`context-lifecycle.ts:319-370`）调 model 时硬用 `COMPRESSION_SYSTEM_PROMPT`（"你正在为一段互动剧情的 AI 叙事者压缩对话历史…叙事梗概风格…"）。助手快照存的是任务对话（用户问工作问题 + 助手答 + 工具结论），压成叙事梗概文风不对。

**决议**：`compressContext` 加可选 `systemPrompt` / `userLabel` / `assistantLabel` 参数（经 `CompressCallOptions` 扩展）。默认 `undefined` → 用 `COMPRESSION_SYSTEM_PROMPT` + "玩家"/"叙事"（master 向后兼容）。助手传 `ASSISTANT_CONTEXT_COMPRESSION_SYSTEM_PROMPT`（新常量，任务摘要风格：保留用户关键请求 + 助手已做工作与结论 + 未解决问题，丢寒暄/重复/工具技术细节）。`buildCompressionPrompt` 的角色标签参数化。

**约束6：助手快照的 `saveId` 字段语义复用为 sessionId。**

`AgentContextSnapshot.saveId` 在 master 语义是 save ID（用于定位 save runtime 里的 context.json）。助手用虚拟文件路径（`.tsian/local/assistant/sessions/<sessionId>/context.json`）定位，不靠 `saveId` 字段。`saveId` 在 `compressContext`/`appendTurnToContext` 中不参与逻辑（只透传），仅标识。

**决议**：助手快照 `saveId = sessionId`（语义复用：助手的"存档"就是会话）。不新增字段（复用类型），host 落盘/读取用 sessionId 拼路径，`saveId` 字段值与之一致。documented 在常量注释里。

**约束7：会话删除需连带清理 context 虚拟文件，但 `saveLocalAssistantFiles` 是合并模式（不删项）。**

`deleteAssistantSession`（`assistant-conversations.ts:252-266`）当前删 `messagesKey(id)` + 从 list 移除 + 更新 active。若 context 存 local-assistant-files map，删会话不删 context → map 里残留孤儿 path。

`saveLocalAssistantFiles`（`local-assistant-files.ts:168-199`）是合并模式：只收本批文件 + 保留未在本批的已有文件（`:179-194`）。它不会删项——传空批也不删（只合并）。所以不能靠 `saveLocalAssistantFiles([])` 删 context。

**决议**：`local-assistant-files.ts` 新增 `deleteLocalAssistantFile(path: string)` 函数——load map + delete 该 path + put 回去。`deleteAssistantSession` 调 `deleteLocalAssistantFile(assistantContextPath(id))` 清理。`deleteLocalAssistantFile` 只处理 `.tsian/local/assistant/` 前缀路径（安全边界）。

**约束8：`loadLocalAssistantFiles` 加载所有会话 context 进 workspaceFiles，需确认 registry/context 层不误扫 `sessions/` 目录。**

`loadLocalAssistantFiles`（`local-assistant-files.ts:133`）返回整个 map 的所有文件（含 `sessions/<id>/context.json`）。`runAssistantChat` merge 这些进 `workspaceFiles`（`platform-host:1777-1780`）。runtime 的 `buildAgentRegistry`（`registry.ts:643`）扫描 `.tsian/local/<id>/agent.json`（`:373-386`）和 `.tsian/local/<agent>/skills/<skill>`（`:346-362`）。`sessions/` 不匹配这些模式 → registry 不误扫。`assembleAgentContext`（`context.ts:72`）按 `agentId="assistant"` 找入口 agent，读 `AGENT.md`/`SOUL.md`，不读 `sessions/`。助手 config `contextPaths: []`（空）→ 不额外扫目录。

**决议**：无需特殊处理。`sessions/<id>/context.json` 作为普通工作区文件存在于 workspaceFiles，registry/context 层不扫描它，只被 host 的 context 读写逻辑 find。agent 若主动 `workspace_read` 该路径能读到（这是期望行为——可视化）。agent 若 `workspace_list .tsian/local/assistant/sessions/` 能列出会话 context（也是期望行为）。

## 2. 数据与契约

### 2.1 AgentContextSnapshot 类型放宽（contracts）

`packages/contracts/src/runtime.ts:24-36`：

```ts
// before
export interface AgentContextSnapshot {
  schema: "tsian.agent.context.v1"
  saveId: string
  agentId: "master"
  summary: string | null
  recentTurns: AgentContextTurnEntry[]
  lastCompressedTurn: number | null
  updatedAt: string
}

// after
export interface AgentContextSnapshot {
  /** schema 标记.master=tsian.agent.context.v1;助手=tsian.assistant.context.v1. */
  schema: "tsian.agent.context.v1" | "tsian.assistant.context.v1"
  /** master=saveId;助手=sessionId(语义复用,定位靠文件路径不靠此字段). */
  saveId: string
  /** master="master";助手="assistant".放宽为 string 以复用类型. */
  agentId: string
  summary: string | null
  recentTurns: AgentContextTurnEntry[]
  lastCompressedTurn: number | null
  updatedAt: string
}
```

**向后兼容**：`agentId` 从字面量 `"master"` 放宽为 `string`——master 代码传 `"master"` 仍合法（`"master"` 是 `string` 子类型）。`schema` 从单值放宽为联合——master 传 `"tsian.agent.context.v1"` 仍合法。无运行时行为变化（字段值不变），仅类型放宽。

### 2.2 context-lifecycle.ts 参数化

**新常量**（`context-lifecycle.ts`，与 master 常量并列）：

```ts
/** 助手 context 快照 schema 标记(与 master 的 tsian.agent.context.v1 区分,语义分明). */
export const ASSISTANT_CONTEXT_SCHEMA = "tsian.assistant.context.v1" as const
/** 助手 agent 固定 id. */
export const ASSISTANT_CONTEXT_AGENT_ID = "assistant" as const
```

**`ASSISTANT_CONTEXT_COMPRESSION_SYSTEM_PROMPT`**（新，任务摘要风格，与 master 叙事梗概 prompt + turn 内 `TASK_COMPRESSION_SYSTEM_PROMPT` 区分）：

```ts
const ASSISTANT_CONTEXT_COMPRESSION_SYSTEM_PROMPT = [
  "你是任务对话摘要器。把助手与用户的早期对话压缩成「已完成工作 + 结论」摘要。",
  "保留:用户的关键请求、助手已做的工作与结论、未解决的问题、重要上下文与决策。",
  "丢弃:寒暄、重复内容、工具调用的技术细节、冗余的中间过程。",
  "用简洁的任务日志风格输出,不要叙事化,不要逐字复述。",
  `- 控制在约 ${TARGET_COMPRESSION_TOKENS} token 以内。`,
].join("\n")
```

> 三个 prompt 的分工：`COMPRESSION_SYSTEM_PROMPT`（master 快照压剧情梗概）、`ASSISTANT_CONTEXT_COMPRESSION_SYSTEM_PROMPT`（助手快照压任务对话摘要）、`TASK_COMPRESSION_SYSTEM_PROMPT`（turn 内压工具交互段）。三者作用对象不同，不混用。

**`createEmptyAgentContext` / `createInitialAgentContext` / `parseAgentContext` 加可选参数**：

```ts
export function createEmptyAgentContext(
  saveId: string,
  options?: { schema?: string; agentId?: string },
): AgentContextSnapshot {
  return {
    schema: (options?.schema ?? AGENT_CONTEXT_SCHEMA) as AgentContextSnapshot["schema"],
    saveId,
    agentId: options?.agentId ?? AGENT_CONTEXT_AGENT_ID,
    summary: null,
    recentTurns: [],
    lastCompressedTurn: null,
    updatedAt: new Date(0).toISOString(),
  }
}
// createInitialAgentContext 同模式加 options
// parseAgentContext 加 options,schema/agentId 用 options 值(默认 master)而非硬编码
```

master 调用点不传 options（默认值不变）。助手 host 传 `{ schema: ASSISTANT_CONTEXT_SCHEMA, agentId: ASSISTANT_CONTEXT_AGENT_ID }`。

**`compressContext` + `buildCompressionPrompt` 加可选参数**：

```ts
export async function compressContext(
  context: AgentContextSnapshot,
  threshold: number,
  callModel: CompressCallModel,
  options: CompressCallOptions & { systemPrompt?: string; userLabel?: string; assistantLabel?: string },
): Promise<AgentContextSnapshot> {
  // systemPrompt ?? COMPRESSION_SYSTEM_PROMPT
  // buildCompressionPrompt 用 userLabel/assistantLabel（默认"玩家"/"叙事"，助手传"用户"/"助手"）
}
```

### 2.3 local-assistant-files.ts 新增 path helper + 删除能力

```ts
/** 助手会话 context 快照的虚拟文件路径(存本模块 Dexie map 的一项). */
export function assistantContextPath(sessionId: string): string {
  return `${LOCAL_ASSISTANT_DIR}/sessions/${sessionId}/context.json`
}

/**
 * 从 local-assistant-files map 删除单个文件(供会话删除清理 context 快照).
 * saveLocalAssistantFiles 是合并模式不删项,故需此专用删除函数.
 * 只处理 .tsian/local/assistant/ 前缀路径(安全边界).
 */
export async function deleteLocalAssistantFile(path: string): Promise<void> {
  if (!isLocalAssistantPath(path)) return
  const record = await localDb.meta.get(LOCAL_ASSISTANT_FILES_KEY)
  if (!record?.value) return
  try {
    const map = JSON.parse(record.value) as StoredAssistantFileMap
    if (map && typeof map === "object" && path in map) {
      delete map[path]
      await localDb.meta.put({ key: LOCAL_ASSISTANT_FILES_KEY, value: JSON.stringify(map) })
    }
  } catch {
    // 损坏 map 忽略,不阻塞会话删除
  }
}
```

现有 `loadLocalAssistantFiles`/`saveLocalAssistantFiles`/`isLocalAssistantPath` 不改——合并落盘机制天然支持 `sessions/<id>/context.json`（匹配 `isLocalAssistantPath` 前缀，`commitAssistantWorkspaceFiles` 自动把该路径的文件调 `saveLocalAssistantFiles` 合并落盘）。

### 2.4 AssistantChatInput 加 sessionId

`platform-host/index.ts:1688-1726`：

```ts
export interface AssistantChatInput {
  message: string
  history?: ConversationMessageRecord[]
  /** 当前助手会话 id.host 据此读写该会话的 agent 上下文快照(.tsian/local/assistant/sessions/<id>/context.json). */
  sessionId: string
  onDelta?: ...
  onTool?: ...
  signal?: AbortSignal
  timeoutMs?: number
}
```

`AssistantView.send()` 调用时加 `sessionId: activeSessionId.value`（`activeSessionId` 已是 `ref<string | null>`，send 前必非空——loadActiveSession 保证）。

### 2.5 host 新增 read/stage helper（对称 master）

`platform-host/index.ts` 新增（与 master 的 `readAgentContextFromWorkspace`/`stageAgentContextFile` 同区域并列）：

```ts
/** 助手会话 context 路径. */
import { assistantContextPath, ... } from "../storage/local-assistant-files"

/** 从已加载的 localAssistantFiles 读助手会话 context 快照.无则 null(host 兜底初始化). */
function readAssistantContextFromFiles(
  files: WorkspaceFile[],
  sessionId: string,
): AgentContextSnapshot | null {
  const path = assistantContextPath(sessionId)
  const file = files.find((f) => f.path === path)
  if (!file) return null
  return parseAgentContext(file.content, sessionId, {
    schema: ASSISTANT_CONTEXT_SCHEMA,
    agentId: ASSISTANT_CONTEXT_AGENT_ID,
  })
}

/** turn 收尾:把本轮正文追加进助手会话 context,写进 workspaceTransaction(搭便车 commitAssistantWorkspaceFiles 落盘). */
function stageAssistantContextFile(
  workspaceTransaction: RuntimeWorkspaceTransaction,
  input: {
    sessionId: string
    turn: number
    user: string
    assistant: string
    compressedContext?: AgentContextSnapshot
    fallbackContext: AgentContextSnapshot  // turn 开头读出的快照(无压缩时作 base)
  },
): WorkspaceFile {
  const base =
    input.compressedContext
    ?? input.fallbackContext
    ?? createEmptyAgentContext(input.sessionId, {
        schema: ASSISTANT_CONTEXT_SCHEMA, agentId: ASSISTANT_CONTEXT_AGENT_ID,
      })
  const updated = appendTurnToContext(
    { ...base, saveId: input.sessionId },
    input.turn,
    input.user,
    input.assistant,
  )
  return workspaceTransaction.write({
    path: assistantContextPath(input.sessionId),
    content: serializeAgentContext(updated),
    mediaType: "application/json",
  })
}
```

`stageAssistantContextFile` 写进 `workspaceTransaction` 后，turn 结束 `commitAssistantWorkspaceFiles`（`platform-host:1920`）处理 `finalFiles`，其中 `isLocalAssistantPath` 的（含 context）走 `saveLocalAssistantFiles` 合并落盘——**搭便车现有提交路径，零额外 IO**。

## 3. 数据流

### 3.1 助手正常 turn（含跨 turn 持久化）

```
AssistantView.send()
  → runAssistantChat({ message, history, sessionId, onDelta, onTool, signal, timeoutMs? })
  → host turn 开头:
     ① loadLocalAssistantFiles() → localAssistantFiles (含 sessions/<id>/context.json,已加载)
     ② merge localAssistantFiles 进 workspaceFiles (现有逻辑 platform-host:1777-1780)
     ③ readAssistantContextFromFiles(localAssistantFiles, sessionId) → snapshot (或 null)
     ④ null → createInitialAgentContext(sessionId, history, 1,
          { schema: ASSISTANT_CONTEXT_SCHEMA, agentId: "assistant" })  // 旧会话迁移
     ⑤ nextTurn = nextAssistantTurnNumber(snapshot)
     ⑥ assistantConfig = resolveAgentModelConfig(agentId, providerPresetMap)
        assistantContextTokenBudget = resolveTokenBudget(assistantConfig?.parameters?.contextWindow ?? null)
     ⑦ snapshot.state.turn = nextTurn - 1  // 设入 fake snapshot
  → runAgentRuntimeTurn({
       agentId: "assistant", userInput, recentHistory: history,
       snapshot: { ..., state: { turn: nextTurn-1, messages: [] } },
       agentContext: snapshot,          // ← 注入持久化快照(关键:之前不传)
       contextTokenBudget,              // ← 注入预算(之前不传)
       compressionMode: "task",
       timeoutMs, signal: compositeSignal, ...
     })
  → runtime entry 路径:
     ① agentContext = input.agentContext (非空,host 注入了)
     ② budget = resolveTokenBudget(input.contextTokenBudget)
     ③ turn 开头压缩(放宽后的 guard,两模式都执行):
        if (estimateContextTokens(agentContext) > budget*0.85):
          systemPrompt = task 模式 ? ASSISTANT_CONTEXT_COMPRESSION_SYSTEM_PROMPT : undefined
          agentContext = compressContext(agentContext, threshold, callModel,
            { systemPrompt, userLabel:"用户", assistantLabel:"助手" })
          compressedContext = agentContext
     ④ buildEntryAgentMessages 用 agentContext(summary + recentTurns)构建上下文段
     ⑤ 工具循环 task 分支:compressTaskContext 压工具交互段(已交付,不动)
     ⑥ return { replyText, contextUpdate: { turn: nextTurn, user, assistant, compressedContext } }
  → host turn 结束:
     ① stageAssistantContextFile(activeWorkspaceTransaction, {
          sessionId, turn: contextUpdate.turn, user, assistant,
          compressedContext: contextUpdate.compressedContext,
          fallbackContext: snapshot,
        })  // 写进 workspaceTransaction
     ② const finalFiles = activeWorkspaceTransaction.finalWorkspaceFiles()
     ③ commitAssistantWorkspaceFiles(activeSaveId, finalFiles)
        → isLocalAssistantPath 的(含 sessions/<id>/context.json)走 saveLocalAssistantFiles 合并落盘
        → 搭便车,零额外 IO
     ④ return { replyText: result.replyText }
```

### 3.2 跨加载恢复

```
[刷新页面/重开浏览器]
  → AssistantView.loadActiveSession()
     → ensureAssistantSession("local") + getAssistantSessionMessages(session.id)
     → messages 回填(UI 可见消息恢复,现有逻辑不动)
  [用户发消息]
  → send() → runAssistantChat({ sessionId, ... })
  → host loadLocalAssistantFiles() → map 从 Dexie 恢复(含 sessions/<id>/context.json,跨加载持久)
  → readAssistantContextFromFiles → 快照从虚拟文件系统恢复(任务摘要 + 最近 K 轮)
  → 注入 runtime → agent 上下文恢复
  → 不失忆:agent 知道之前做过什么(summary) + 最近聊了什么(recentTurns)
```

### 3.3 长对话稳态（压缩触发）

```
[多轮对话累积,快照 token 超 85%]
  turn N 开头:
     snapshot = readAssistantContextFromFiles(localAssistantFiles, sessionId)
       → summary: "此前做过X、Y、Z"(已压缩的早期)
       → recentTurns: [turn N-5..N-1 的 user+assistant](最近 5 轮原文)
     estimateContextTokens(snapshot) > budget*0.85  → 触发压缩
     compressContext(snapshot, threshold, callModel,
       { systemPrompt: ASSISTANT_CONTEXT_COMPRESSION_SYSTEM_PROMPT, userLabel:"用户", assistantLabel:"助手" })
       → 保留最近 5 轮,早期 recentTurns + 旧 summary 送 model 生成新任务摘要
       → 新 snapshot: { summary: "做过X、Y、Z、W…", recentTurns: [turn N-5..N-1], lastCompressedTurn: N-6 }
     compressedContext = 新 snapshot
  turn N 结束:
     stageAssistantContextFile 写进 workspaceTransaction
     commitAssistantWorkspaceFiles → saveLocalAssistantFiles 合并落盘
     recentTurns: [turn N-5..N](6 轮,下次压缩会压 turn N-5)
  稳态:summary 滚动浓缩(越早越淡),recentTurns 保持最近 K 轮,不膨胀
```

### 3.4 旧会话迁移（首次跑新代码）

```
[已有会话有可见消息,但无 context 虚拟文件(新代码前创建)]
  turn 开头:
     snapshot = readAssistantContextFromFiles(localAssistantFiles, sessionId) → null
     → createInitialAgentContext(sessionId, history, nextTurn, { schema, agentId })
       → 从 history 最近 K*2 条倒推 recentTurns(无 summary)
     注入 runtime → 上下文从可见消息重建
  turn 结束:stageAssistantContextFile 写进事务 → commitAssistantWorkspaceFiles 落盘
  → 后续走正常持久化路径(sessions/<id>/context.json 已在 map 里)
```

### 3.5 turn 失败不写回 context（对称 master）

```
[turn 中途 abort/timeout/stalled/error]
  → runtime throw → host catch
  → activeWorkspaceTransaction.discard()  // 现有逻辑,context 写进事务也被 discard
  → **不调 stageAssistantContextFile**  // context 只在 try 块成功路径写
  → 快照停留在 turn 开头读出的状态(磁盘上的 sessions/<id>/context.json 不变)
  → 对称 master:master turn 失败 workspaceTransaction.discard() 不落盘 context.json
```

### 3.6 会话删除清理

```
AssistantView.handleDeleteSessionById(id)
  → deleteAssistantSession("local", id)
     → localDb.meta.delete(messagesKey(id))  // 现有:删可见消息
     → deleteLocalAssistantFile(assistantContextPath(id))  // 新增:删 context 虚拟文件
     → 从 session list 移除 + 更新 active  // 现有
  → 无孤儿:context 虚拟文件从 Dexie map 移除
```

### 3.7 master 不回归（narrative 分支不变）

```
interaction.sendMessage → runAgentRuntimeTurn({ agentId:"master", compressionMode:"narrative", agentContext, contextTokenBudget, ... })
  → entry 路径:entryCompressionMode = "narrative"
  → turn 开头压缩(放宽后的 guard):
     if (estimateContextTokens(agentContext) > threshold):
       narrative 模式不传 systemPrompt/userLabel/assistantLabel → compressContext 用默认
       → 行为与改造前一致(剧情梗概压缩)
  → stageAgentContextFile 落盘 save/agents/master/context.json(不动)
  → master 路径全链路行为不变
```

## 4. 权衡

### 4.1 为什么 context 快照存 `.tsian/local/assistant/sessions/<id>/context.json` 虚拟文件而非 Dexie 独立键

PRD 写 `.tsian/local/assistant/context.json`（单一共享路径）。勘察发现助手是多会话，单一共享路径会串上下文。同时用户明确提出"把所有平台配置和有用数据收录到文件系统、用桌面 agent 管理"的产品哲学。三个实现选项：

| | A. Dexie 独立键 | B. 虚拟文件系统路径（采用） | C. 单一共享 context.json |
|---|---|---|---|
| 形态 | key `assistant-session-context:<sessionId>` | `.tsian/local/assistant/sessions/<sessionId>/context.json`（local-assistant-files Dexie map 的一项） | `.tsian/local/assistant/context.json` 单一文件 |
| 多会话 | 每会话一键 | 每会话一文件路径 | 串上下文（不可行） |
| agent 可管理 | ❌ 不可见（Dexie KV） | ✅ workspace_read/write 可管理 | ✅ 但单一共享 |
| 读 IO | 每 turn Dexie get 一条 | **零额外 IO**（`loadLocalAssistantFiles` turn 开头已加载整个 map） | 零额外（但串上下文） |
| 写 IO | 每 turn Dexie put 一条 | **零额外 IO**（搭便车 `commitAssistantWorkspaceFiles` → `saveLocalAssistantFiles`） | 同 B |
| 会话清理 | `meta.delete(key)` | `deleteLocalAssistantFile(path)`（load+del+put） | 不适用 |
| 与 master 对称 | 部分对称（KV vs 文件） | **完全对称**（都是工作区文件，host stage + commit 落盘） | 对称但串上下文 |
| 文件系统可视化 | ❌ | ✅ 契合用户哲学 | ✅ 但不可用 |

**采 B**：契合用户"文件系统可视化 + agent 可管理"的产品哲学（context 作为虚拟文件暴露，agent 可 workspace_read 读、workspace_write 管理）；搭便车现有 IO 路径（`loadLocalAssistantFiles` turn 开头已加载，`commitAssistantWorkspaceFiles` turn 结束已落盘，零额外 IO）；完全对称 master（master 的 `stageAgentContextFile` 写 workspaceTransaction + save 提交落盘，助手的 `stageAssistantContextFile` 写 workspaceTransaction + `commitAssistantWorkspaceFiles` 落盘，同构）；多会话独立（`sessions/<id>/` 子目录）。代价是会话删除需专用 `deleteLocalAssistantFile`（`saveLocalAssistantFiles` 合并模式不删项），但这是一个小函数。

**不采 A**：虽效率相当，但把 context 藏进不可见的 Dexie KV，破坏文件系统可视化哲学，agent 无法用 workspace 工具管理。**不采 C**：串上下文，不可行。

### 4.2 为什么复用 AgentContextSnapshot 类型而非新建 AssistantContextSnapshot

PRD 倾向新建（语义分明）。经勘察后采复用 + 放宽：

- **结构完全同构**：master 与助手的快照都是 `{ schema, saveId, agentId, summary, recentTurns, lastCompressedTurn, updatedAt }`，字段结构 100% 相同，仅 `schema`/`agentId` 值不同。新建类型 = 复制 7 个字段定义 + 复制全套 `serialize`/`parse`/`createEmpty`/`createInitial`/`append`/`compress`/`estimateContextTokens` 函数（~150 行结构相同的重复）。
- **放宽代价极小**：`agentId: "master"` → `string`、`schema` 单值 → 联合。两处类型放宽，向后兼容（`"master"` 是 `string` 子类型，master 代码不变）。
- **复用收益大**：`compressContext`/`appendTurnToContext`/`estimateContextTokens`/`parseAgentContext`/`createEmptyAgentContext`/`createInitialAgentContext` 全复用，参数化 prompt/schema/agentId 即可区分。不重复造轮子（code-reuse-guide）。
- **语义不混淆**：`schema` 字段值 `"tsian.assistant.context.v1"` + `agentId: "assistant"` 明确标识助手快照，与 master 的 `"tsian.agent.context.v1"` + `"master"` 区分。类型放宽不等于语义混淆——值层面分明。
- **runtime 输入类型无需改**：`AgentRuntimeTurnInput.agentContext: AgentContextSnapshot`（`index.ts:120`）已存在，助手传放宽后的 `AgentContextSnapshot` 合法。

### 4.3 为什么参数化 context-lifecycle.ts 而非新建 assistant-context-lifecycle.ts

PRD 倾向新建模块（职责分明）。经勘察后采参数化（同模块）：

- **函数结构同构**：`serialize`/`parse`/`createEmpty`/`createInitial`/`append`/`compress`/`estimateContextTokens` 逻辑 100% 相同，仅 schema/agentId/prompt/标签 值不同。
- **参数化是更优的复用**：加可选参数，默认值 = master 现状。master 调用点不传（不变），助手传区分值。比复制整模块更 DRY，且改动集中在函数签名（不碰函数体逻辑）。
- **master 不回归保证**：参数默认值 = 现有硬编码值。master 调用点不传 options → 行为与改造前一致。vue-tsc 编译验证默认值路径不变。
- **新模块的劣势**：`assistant-context-lifecycle.ts` 需 import `CompressCallModel`/`estimateTokenCount`/`ContextCompressionFailedError` 等 from `context-lifecycle.ts`（跨模块依赖），且函数体大量复制。参数化则在同模块内复用，无新依赖。

### 4.4 为什么 turn 开头压缩 guard 放宽而非 host 自己压

两个选择：runtime entry 路径压（放宽 guard）vs host 压（runtime 不改）。

- **runtime 压（采用）**：对称 master（master 的 turn 开头压缩在 runtime entry 路径）。host 只读+注入+写回，压缩逻辑集中在 runtime。`compressContext` + 阈值检查 + trace 发射都在 runtime，host 薄。
- **host 压（不采）**：host 在调 runtime 前自己 `compressContext`。但 host 拿不到 `capabilities.callModel`（runtime 的压缩 model 调用闭包），需额外传递或暴露。且压缩 trace 事件由 runtime 发射的体系被打破。不对称 master。

**采 runtime 压**：guard 放宽是删 1 个条件，按 mode 选 prompt 是 3 行。master narrative 分支不传新字段 → 默认行为不变。

### 4.5 三个压缩 prompt 的分工（避免混淆）

| prompt | 作用对象 | 何时触发 | 风格 |
|---|---|---|---|
| `COMPRESSION_SYSTEM_PROMPT` | master 快照（summary + recentTurns） | master turn 开头超 85% | 叙事梗概（情节/人物/场景） |
| `ASSISTANT_CONTEXT_COMPRESSION_SYSTEM_PROMPT`（新） | 助手快照（summary + recentTurns） | 助手 turn 开头超 85% | 任务对话摘要（用户请求 + 助手工作/结论） |
| `TASK_COMPRESSION_SYSTEM_PROMPT` | turn 内 messages 工具交互段 | turn 内工具循环超 85% | 任务日志（工具交互：已读/写/判断/结论） |

前两个压**跨 turn 快照**（持久化层），第三个压**turn 内 messages**（运行时层）。前两个的输入是 `{turn, role, content}` 文本对话，第三个的输入是 `{role, content, toolCalls}` 工具交互。三者不混用。

### 4.6 已知残留风险

**`loadLocalAssistantFiles` 加载所有会话 context 进 workspaceFiles**：多会话用户的 map 含多个 `sessions/<id>/context.json`，全部加载进 workspaceFiles。但 context 快照小（summary ~2000 token + 5 轮正文，压缩后约 2-4KB），10 个会话约 20-40KB，不影响 workspaceFiles 体积或 runtime 扫描（registry 不扫 `sessions/`，约束8 已确认）。

**`AbortSignal.any` 兼容性**：已由 `06-20-agent-task-compression` 引入（compositeSignal），本任务不新增依赖。

**旧会话迁移质量**：`createInitialAgentContext` 从 history 最近 K*2 条倒推 recentTurns，无 summary。首次 turn 后正常走压缩稳态。迁移质量取决于 history 完整度（max 200 条可见消息够用）。

**agent 误写 context 虚拟文件**：agent 理论上能 `workspace_write .tsian/local/assistant/sessions/<id>/context.json` 改自己的上下文快照。这是文件系统可视化哲学的固有副作用（暴露即可管理）。风险低（助手 SOUL.md 已指示"不编辑文件除非 UI/tooling 要求"），且 host turn 开头读时会 `parseAgentContext` 兜底（损坏 → null → createInitialAgentContext）。不额外限制（保持 agent 自主性，契合哲学）。

## 5. 兼容性与回滚

- **类型放宽向后兼容**：`AgentContextSnapshot.agentId: "master"` → `string`、`schema` → 联合。`"master"` 是 `string` 子类型，master 代码不变。vue-tsc 编译验证。
- **函数参数化向后兼容**：`createEmptyAgentContext`/`createInitialAgentContext`/`parseAgentContext`/`compressContext`/`buildCompressionPrompt` 加可选参数，默认值 = 现有硬编码。master 调用点不传 → 行为不变。
- **无数据迁移**：助手 context 虚拟文件是新路径（`sessions/<id>/context.json`），旧会话 map 无此路径 → `readAssistantContextFromFiles` 返回 null → `createInitialAgentContext` 从可见消息兜底。无需显式迁移脚本。
- **local-assistant-files 合并机制兼容**：`saveLocalAssistantFiles` 合并模式天然支持新路径（`sessions/<id>/context.json` 匹配 `isLocalAssistantPath` 前缀）。`loadLocalAssistantFiles` 加载整个 map 天然包含新路径。无需改现有 load/save 函数。
- **master 不回归**：narrative 分支不传 `systemPrompt`/`userLabel`/`assistantLabel` → `compressContext` 用默认值 → 行为不变。master 的 `readAgentContextFromWorkspace`/`stageAgentContextFile`/`agents/master/context.json` 全不动。
- **回滚**：revert 该任务提交。助手回到"无 agentContext 注入 + contextUpdate 丢弃 + fake snapshot turn=0"状态（`06-20-agent-task-compression` 交付的 task 模式 + 时长兜底仍在，只是无跨 turn 持久化）。已写入 map 的 `sessions/<id>/context.json` 残留为孤儿（不影响功能，`loadLocalAssistantFiles` 仍加载但不被 host 读写——可选手动清理或留待后续）。master 全链路本就不动，回滚后无变化。

## 6. 验证策略

- **构建**：`npm run build:contracts && npm run build:web` 通过（类型放宽 + 参数化 + 新函数靠 vue-tsc 兜底捕获遗漏构造点/消费者）。
- **真实 API 实测**（依赖 API key 环境）：
  - **跨 turn 持久化**：助手多轮对话（≥3 轮）后关闭重开浏览器，助手从 context 虚拟文件恢复，知道之前聊过什么（不失忆）。
  - **文件系统可视化**：助手对话后，用 workspace 工具 `workspace_read .tsian/local/assistant/sessions/<id>/context.json` 能读到快照内容（验证文件系统可视化哲学落地）。
  - **长对话稳态**：构造长对话（多轮 + 大量工具探索），观察快照 token 超 85% 触发压缩，summary 滚动浓缩，recentTurns 保持最近 5 轮，不膨胀。
  - **多会话隔离**：创建会话 A 和 B，各自对话，切换 A↔B 验证 context 不串（A 的 agent 不知 B 的对话，各自读各自的 `sessions/<id>/context.json`）。
  - **会话删除清理**：删除会话后，`workspace_list .tsian/local/assistant/sessions/` 不列已删会话的 context（孤儿清理）。
  - **旧会话迁移**：有可见消息但无 context 虚拟文件的旧会话，首次发消息后 context 从 history 兜底初始化，后续正常持久化。
  - **turn 失败不写回**：助手 turn 中途 abort/timeout，context 虚拟文件不追加本轮（停留在 turn 开头状态）。
  - **master 不回归**：master turn 开头剧情压缩 + `agents/master/context.json` 落盘 + 跨加载恢复行为不变。

## 7. 与上下游子任务的接口

- **上游 `06-20-agent-task-compression`（已归档）**：复用 `compressionMode: "task"` + turn 内 `compressTaskContext` + 时长兜底 + `TaskTimeoutError`。本任务在其上加持久化层（turn 开头快照压缩 + turn 结束写回虚拟文件），不动 turn 内工具交互压缩。turn 开头压缩 guard 放宽是本任务对 runtime 的唯一改动（narrative 分支不变）。
- **上游 `agent-session-context-lifecycle`（已交付）**：复用 `AgentContextSnapshot` 类型 + `context-lifecycle.ts` 的 `serializeAgentContext`/`parseAgentContext`/`createEmptyAgentContext`/`createInitialAgentContext`/`compressContext`/`appendTurnToContext`/`estimateContextTokens`/`resolveTokenBudget`/`CONTEXT_COMPRESS_TRIGGER_RATIO`/`CONTEXT_KEEP_RECENT_TURNS`/`CompressCallModel`/`CompressCallOptions`/`ContextCompressionFailedError`。参数化扩展（schema/agentId/prompt/标签）向后兼容。host 的 `stageAssistantContextFile` 对称 master 的 `stageAgentContextFile`（写 workspaceTransaction + commit 落盘）。
- **父 `06-19-tool-runtime-performance`**：本任务是其子任务，补助手跨 turn 持久化（父任务性能优化方向的助手侧延伸）。
- **下游**：无。

## 8. 开放问题（design 已决）

- ~~schema 复用 vs 新建~~：复用 `AgentContextSnapshot`，放宽 `agentId: string` + `schema` 联合，新 schema 值 `tsian.assistant.context.v1`（§4.2）。
- ~~助手 context 模块位置~~：参数化 `context-lifecycle.ts`（同模块），不新建 `assistant-context-lifecycle.ts`（§4.3）。
- ~~.tsian/local/assistant/ 存储机制~~：存 `.tsian/local/assistant/sessions/<sessionId>/context.json` 虚拟文件（local-assistant-files Dexie map 的一项），不走独立 Dexie 键（§4.1，与用户二次对齐文件系统可视化哲学）。
- ~~context.json 与 saveHistory 关系~~：可见消息（`assistant-session:<id>` Dexie 独立键，UI 展示）与 context 快照（`sessions/<id>/context.json` 虚拟文件，agent 上下文稳态）分离存储，对称 master 的 saveHistory vs context.json（§4.1）。
- ~~turn 号恒为 1~~：host 从快照推算 `nextAssistantTurnNumber` 设入 fake snapshot（约束2）。
- ~~turn 开头压缩 guard narrative-only~~：放宽为两模式都执行，按 mode 选 prompt（约束4/§4.4）。
- ~~压缩 prompt 叙事梗概不适合任务~~：`compressContext` 加可选 `systemPrompt`/`userLabel`/`assistantLabel`，助手传 `ASSISTANT_CONTEXT_COMPRESSION_SYSTEM_PROMPT` + "用户"/"助手"标签（约束5/§4.5）。
- ~~会话删除孤儿~~：新增 `deleteLocalAssistantFile(path)`，`deleteAssistantSession` 调它清理 context 虚拟文件（约束7）。
- ~~registry 误扫 sessions/~~：不匹配，无需特殊处理（约束8）。

**无遗留开放问题，可进入 implement.md。**
