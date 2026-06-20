# Implement — 助手 agent 跨 turn 持久化（.tsian/local/assistant/sessions 虚拟文件系统 + 任务摘要稳态）

> 对应 `design.md`。执行前先读 `prd.md` + `design.md`。
> 分阶段实施，每阶段结束跑验证命令，通过后再进下一阶段。回滚点 = 每阶段一个 commit（便于二分定位回归）。
> **前置依赖**：`06-20-agent-task-compression` 已交付归档（task 压缩模式 + 时长兜底已落地）。
> **存储机制**：context 快照存 `.tsian/local/assistant/sessions/<sessionId>/context.json` 虚拟文件（local-assistant-files Dexie map 的一项），搭便车 `loadLocalAssistantFiles`/`saveLocalAssistantFiles` 现有 IO 路径，不走独立 Dexie 键（契合文件系统可视化哲学）。

## 前置：加载 spec 上下文

- [ ] 读 `.trellis/spec/platform-web/frontend/type-safety.md` 的 "Agent Context Snapshot Lifecycle" / "Turn Token Budget And In-Turn Compression" 场景（改造的契约基准）。
- [ ] 读 `.trellis/spec/platform-web/frontend/state-management.md`（Dexie meta 表存储边界、`.tsian/local/` 虚拟文件系统规范、platform-local 元数据）。
- [ ] 读 `.trellis/spec/platform-web/frontend/quality-guidelines.md`（提交前质量门）。
- [ ] 读 `.trellis/spec/guides/code-reuse-thinking-guide.md`（复用 context-lifecycle.ts 而非新建模块的依据）+ `cross-layer-thinking-guide.md`（host → 虚拟文件系统 → runtime → 跨加载恢复跨层）。

## 阶段 A：contracts 类型放宽 + context-lifecycle 参数化

> 纯扩展（类型放宽 + 可选参数），不改现有函数体逻辑。最先做，因后续阶段依赖这些原语。master 调用点不改（靠默认值向后兼容）。

- [ ] **A1** `packages/contracts/src/runtime.ts` 放宽 `AgentContextSnapshot`（design §2.1）：
  - `schema: "tsian.agent.context.v1"` → `"tsian.agent.context.v1" | "tsian.assistant.context.v1"`
  - `agentId: "master"` → `string`
  - 更新字段注释说明 master/助手两种取值。
- [ ] **A2** `apps/platform-web/src/agent-runtime/context-lifecycle.ts` 新增助手常量（design §2.2）：
  - `ASSISTANT_CONTEXT_SCHEMA = "tsian.assistant.context.v1" as const`
  - `ASSISTANT_CONTEXT_AGENT_ID = "assistant" as const`
  - `ASSISTANT_CONTEXT_COMPRESSION_SYSTEM_PROMPT`（任务对话摘要风格，design §2.2 文案）
- [ ] **A3** `context-lifecycle.ts` 参数化 `createEmptyAgentContext`（design §2.2）：
  - 加可选 `options?: { schema?: string; agentId?: string }` 参数。
  - 用 `options?.schema ?? AGENT_CONTEXT_SCHEMA` / `options?.agentId ?? AGENT_CONTEXT_AGENT_ID` 替换硬编码。
  - **注意 schema 类型**：`options.schema` 是 `string`，但 `AgentContextSnapshot.schema` 是联合字面量。用 `as AgentContextSnapshot["schema"]` 断言（已校验值合法）。
  - master 调用点（`stageAgentContextFile` `platform-host:417` 等不传 options 的地方）行为不变（默认值）。
- [ ] **A4** `context-lifecycle.ts` 参数化 `createInitialAgentContext`（同 A3 模式加 options 参数）。
- [ ] **A5** `context-lifecycle.ts` 参数化 `parseAgentContext`（design §2.2）：
  - 加可选 `options?: { schema?: string; agentId?: string }`。
  - 解析后 `schema`/`agentId` 用 options 值（默认 master），而非硬编码 `AGENT_CONTEXT_SCHEMA`/`AGENT_CONTEXT_AGENT_ID`。
  - master 调用点（`readAgentContextFromWorkspace` `platform-host:396`）不传 → 默认值不变。
- [ ] **A6** `context-lifecycle.ts` 参数化 `compressContext` + `buildCompressionPrompt`（design §2.2 约束5）：
  - `CompressCallOptions` 扩展：加 `systemPrompt?: string`、`userLabel?: string`、`assistantLabel?: string`。
  - `compressContext` 内 `systemPrompt ?? COMPRESSION_SYSTEM_PROMPT`。
  - `buildCompressionPrompt(oldSummary, compressEntries, userLabel = "玩家", assistantLabel = "叙事")`：`${entry.role === "user" ? userLabel : assistantLabel}`。
  - master 调用点（entry 路径 `index.ts:2015`）不传新字段 → 默认值（剧情梗概 prompt + 玩家/叙事标签）不变。
- [ ] **A7** `context-lifecycle.ts` 导出 `ASSISTANT_CONTEXT_*` 常量（供 host/storage 引用）。
- [ ] **A 验证**：`npm run build:contracts && npm run build:web`（类型放宽 + 参数化编译通过，master 调用点不传新参数验证默认值路径无回归）。

**回滚点 A**：commit "feat(contracts,runtime): relax AgentContextSnapshot + parametrize context-lifecycle for assistant"。

## 阶段 B：local-assistant-files 新增 path helper + 删除能力 + 会话删除清理

> 纯新增函数。不改现有 `loadLocalAssistantFiles`/`saveLocalAssistantFiles`/`isLocalAssistantPath`（合并落盘机制天然支持新路径）。

- [ ] **B1** `apps/platform-web/src/storage/local-assistant-files.ts` 新增 `assistantContextPath(sessionId)` 函数（design §2.3）：
  ```ts
  /** 助手会话 context 快照的虚拟文件路径(存本模块 Dexie map 的一项). */
  export function assistantContextPath(sessionId: string): string {
    return `${LOCAL_ASSISTANT_DIR}/sessions/${sessionId}/context.json`
  }
  ```
- [ ] **B2** `local-assistant-files.ts` 新增 `deleteLocalAssistantFile(path)` 函数（design §2.3 约束7）：
  ```ts
  /** 从 local-assistant-files map 删除单个文件(供会话删除清理 context 快照). */
  export async function deleteLocalAssistantFile(path: string): Promise<void> {
    if (!isLocalAssistantPath(path)) return  // 安全边界
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
- [ ] **B3** `apps/platform-web/src/storage/assistant-conversations.ts` 修改 `deleteAssistantSession`（design §1.1 + §2.3 约束7）：
  - import `deleteLocalAssistantFile` / `assistantContextPath` from `./local-assistant-files`。
  - 在现有 `await localDb.meta.delete(messagesKey(id))` 后加 `await deleteLocalAssistantFile(assistantContextPath(id))`。
  - 用 try/catch 包裹 delete context（失败不阻塞会话删除）或顺序 await（倾向顺序，简单；deleteLocalAssistantFile 内部已 catch）。
- [ ] **B 验证**：`npm run build:web`（新函数编译通过，import 路径正确）。

**回滚点 B**：commit "feat(storage): assistant context virtual-file path + delete cleanup"。

## 阶段 C：runtime entry 路径 turn 开头压缩 guard 放宽

> 改 1 处 guard + 按 mode 选 prompt。master narrative 分支不传新字段 → 默认值不变。

- [ ] **C1** `apps/platform-web/src/agent-runtime/index.ts` 放宽 entry 路径 turn 开头压缩 guard（design §1.3 约束4）：
  - `index.ts:2005-2007` 的 `if (entryCompressionMode === "narrative" && estimateContextTokens(agentContext) > triggerThreshold)` 改为 `if (estimateContextTokens(agentContext) > triggerThreshold)`（删 mode 前置，两模式都执行）。
- [ ] **C2** `index.ts` 按 mode 选压缩 prompt（design §2.2 约束5）：
  - 块内构造 `compressOptions` 时按 `entryCompressionMode` 分流：
    ```ts
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
    ```
  - import `ASSISTANT_CONTEXT_COMPRESSION_SYSTEM_PROMPT` from `./context-lifecycle`。
  - narrative 模式不传 → `compressContext` 用默认 `COMPRESSION_SYSTEM_PROMPT` + "玩家"/"叙事"标签 → master 行为不变。
- [ ] **C3** 更新 entry 路径压缩块的注释（`index.ts:1996-2000`）：说明两模式都执行 turn 开头快照压缩，按 mode 选 prompt（narrative=剧情梗概，task=任务摘要），与 turn 内 `compressTaskContext`（压工具交互段）独立互补。
- [ ] **C 验证**：`npm run build:web`；手动 trace 检查 master 路径（narrative）压缩仍用剧情梗概 prompt、助手路径（task）压缩用任务摘要 prompt。

**回滚点 C**：commit "feat(agent-runtime): entry turn-start compression for task mode (assistant summary prompt)"。

## 阶段 D：host runAssistantChat 接入持久化（虚拟文件系统读写）

> 核心改动：turn 开头从 localAssistantFiles 读快照注入 + turn 结束 stageAssistantContextFile 写进事务（搭便车 commitAssistantWorkspaceFiles 落盘）。对称 master 的 `readAgentContextFromWorkspace`/`stageAgentContextFile`。

- [ ] **D1** `platform-host/index.ts` `AssistantChatInput` 加 `sessionId: string`（design §2.4）：
  - 加字段 + 注释说明 host 据此读写该会话的 context 虚拟文件。
- [ ] **D2** `platform-host/index.ts` 新增 helper `nextAssistantTurnNumber(snapshot)`（design §1.3 约束2）：
  ```ts
  function nextAssistantTurnNumber(snapshot: AgentContextSnapshot): number {
    const maxRecent = snapshot.recentTurns.reduce((max, e) => Math.max(max, e.turn), 0)
    const maxCompressed = snapshot.lastCompressedTurn ?? 0
    return Math.max(maxRecent, maxCompressed) + 1
  }
  ```
  放在 `runAssistantChat` 附近（与 `readAgentContextFromWorkspace`/`stageAgentContextFile` 同区域）。
- [ ] **D3** `platform-host/index.ts` 新增 `readAssistantContextFromFiles` + `stageAssistantContextFile`（对称 master，design §2.5）：
  - `readAssistantContextFromFiles(files, sessionId)`：从 `files`（localAssistantFiles）find `assistantContextPath(sessionId)`，parse（传 assistant schema/agentId），无则 null。
  - `stageAssistantContextFile(workspaceTransaction, input)`：base = compressedContext ?? fallbackContext ?? createEmptyAgentContext(sessionId, opts)；appendTurnToContext + `workspaceTransaction.write({ path: assistantContextPath(sessionId), content: serializeAgentContext(updated), mediaType: "application/json" })`。
  - import `assistantContextPath` from `../storage/local-assistant-files`，`parseAgentContext`/`serializeAgentContext`/`appendTurnToContext`/`createEmptyAgentContext`/`createInitialAgentContext`/`ASSISTANT_CONTEXT_SCHEMA`/`ASSISTANT_CONTEXT_AGENT_ID`/`resolveTokenBudget` from `../agent-runtime/context-lifecycle`。
- [ ] **D4** `platform-host/index.ts` `runAssistantChat` turn 开头读快照注入（design §3.1）：
  - 在 `loadLocalAssistantFiles()` 后（`localAssistantFiles` 已可用）、`runAgentRuntimeTurn` 调用前：
    ```ts
    // 读会话 agent 上下文快照(虚拟文件 sessions/<id>/context.json).无则从 history 兜底初始化(旧会话迁移).
    const persistedContext = readAssistantContextFromFiles(localAssistantFiles, input.sessionId)
    const assistantContext = persistedContext
      ?? createInitialAgentContext(input.sessionId, history, 1, {
          schema: ASSISTANT_CONTEXT_SCHEMA, agentId: ASSISTANT_CONTEXT_AGENT_ID,
        })
    const nextTurn = nextAssistantTurnNumber(assistantContext)
    // resolve 助手 model contextWindow 预算(对称 master 的 contextTokenBudget 注入)
    const assistantModelConfig = resolveAgentModelConfig(agentId, providerPresetMap)
    const assistantContextTokenBudget = resolveTokenBudget(
      assistantModelConfig?.parameters?.contextWindow ?? null,
    )
    ```
  - **注意**：复用 `assistantModelConfig` 变量给后续 `localAssistantToolCallMode`（`platform-host:1807` 现有 `resolveAgentModelConfig(agentId, providerPresetMap)?.toolCallMode`）——提取变量避免重复 resolve。
- [ ] **D5** `platform-host/index.ts` `runAssistantChat` 传 `agentContext`/`contextTokenBudget`/修正 turn 号给 runtime（design §3.1）：
  - `runAgentRuntimeTurn` 调用（`index.ts:1813-1834`）加：
    ```ts
    agentContext: assistantContext,           // ← 注入持久化快照(之前不传)
    contextTokenBudget: assistantContextTokenBudget,  // ← 注入预算(之前不传)
    snapshot: {
      version: "tsian.runtime.snapshot.v1",
      state: { turn: nextTurn - 1, messages: [] },  // ← 修正 turn 号(之前恒 0)
    },
    ```
  - `compressionMode: "task"` / `timeoutMs` / `signal` 等现有字段保留。
- [ ] **D6** `platform-host/index.ts` `runAssistantChat` turn 结束 stage context 写进事务（design §3.1）：
  - 在 `const finalFiles = activeWorkspaceTransaction.finalWorkspaceFiles()` 前、`return { replyText }` 前：
    ```ts
    // 写回会话 context 快照(虚拟文件):本轮正文追加 + 压缩结果落盘.
    // 写进 workspaceTransaction,搭便车 commitAssistantWorkspaceFiles → saveLocalAssistantFiles 合并落盘.
    const contextUpdate = result.contextUpdate
    if (contextUpdate) {
      stageAssistantContextFile(activeWorkspaceTransaction, {
        sessionId: input.sessionId,
        turn: contextUpdate.turn,
        user: contextUpdate.user,
        assistant: contextUpdate.assistant,
        compressedContext: contextUpdate.compressedContext,
        fallbackContext: assistantContext,
      })
    }
    const finalFiles = activeWorkspaceTransaction.finalWorkspaceFiles()
    await commitAssistantWorkspaceFiles(activeSaveId, finalFiles)
    return { replyText: result.replyText }
    ```
  - **注意**：`stageAssistantContextFile` 写进事务后，`finalWorkspaceFiles()` 会包含 context 虚拟文件，`commitAssistantWorkspaceFiles` 的 `isLocalAssistantPath` 分流（`platform-host:1943-1946`）自动调 `saveLocalAssistantFiles` 合并落盘——搭便车，无需额外 save 调用。
- [ ] **D7** `platform-host/index.ts` turn 失败不写回 context（design §3.5）：
  - catch 块（`index.ts:1923-1934`）现有 `activeWorkspaceTransaction.discard()` 保留。`stageAssistantContextFile` 只在 try 块成功路径（D6）调用，catch 路径不触及 → context 不写回。discard 也会丢弃事务里的 context 写入（对称 master turn 失败 discard 不落盘）。
- [ ] **D 验证**：`npm run build:contracts && npm run build:web`；手动 trace 检查 `runAssistantChat` 现在传 `agentContext`/`contextTokenBudget`/修正 turn 号 + turn 结束 stageAssistantContextFile 写进事务 + commitAssistantWorkspaceFiles 落盘 context 虚拟文件。

**回滚点 D**：commit "feat(platform-host): assistant cross-turn context persistence via virtual file (inject + stage + commit)"。

## 阶段 E：AssistantView 传 sessionId

> 1 行改动。AssistantView 已有 `activeSessionId` ref。

- [ ] **E1** `apps/platform-web/src/views/AssistantView.vue` `send()` 调 `runAssistantChat` 加 `sessionId`（design §2.4）：
  - `AssistantView.vue:659-665` 的 `runAssistantChat({ message, history, onDelta, onTool, signal })` 加 `sessionId: activeSessionId.value!`。
  - **注意**：`activeSessionId` 是 `ref<string | null>`。`send()` 前必有 active session（`loadActiveSession` `:427` 调 `ensureAssistantSession("local")` 保证非空）。用 `!` 断言或加 guard `if (!activeSessionId.value) return`（倾向 guard 更稳，但 ensureAssistantSession 已保证——用 `!` 简洁，注释说明）。
- [ ] **E 验证**：`npm run build:web`；vue-tsc 检查 `sessionId` 类型完备。

**回滚点 E**：commit "feat(views): assistant view passes sessionId to host"。

## 阶段 F：spec 同步 + 全量验证

- [ ] **F1** 更新 `.trellis/spec/platform-web/frontend/type-safety.md`：
  - "Agent Context Snapshot Lifecycle" 场景：补充助手 context 快照（`tsian.assistant.context.v1` schema + `.tsian/local/assistant/sessions/<sessionId>/context.json` 虚拟文件 + 跨加载恢复 + turn 开头压缩按 mode 选 prompt）。
  - "Turn Token Budget And In-Turn Compression" 场景：补充 turn 开头快照压缩 guard 放宽（两模式都执行），与 turn 内 `compressTaskContext`（压工具交互段）独立互补的说明。
  - `AgentContextSnapshot` 类型放宽记录：`agentId: string` + `schema` 联合，master/助手复用类型。
  - 新增/更新场景 "Assistant Cross-Turn Context Persistence"：虚拟文件系统路径 + host read/stage + commitAssistantWorkspaceFiles 搭便车落盘 + 旧会话迁移 + 会话删除清理 + turn 号推算 + agent workspace_read/write 可管理。
- [ ] **F2** 更新 `.trellis/spec/platform-web/frontend/state-management.md`（若该 spec 记载 `.tsian/local/` 虚拟文件系统边界）：
  - 补充 `.tsian/local/assistant/sessions/<sessionId>/context.json` 属会话状态虚拟文件（local-assistant-files Dexie map 的一项），与身份文件（agent.json/SOUL.md 等跨会话共享）同 map 不同子目录；会话删除经 `deleteLocalAssistantFile` 清理。
- [ ] **F3** 全量构建：`npm run build:contracts && npm run build:web`。
- [ ] **F4** 跨层数据流核对（trellis-check 跨层）：
  - `AssistantView.send` → `runAssistantChat({ sessionId })` → `loadLocalAssistantFiles` → `readAssistantContextFromFiles(localAssistantFiles, sessionId)` → `parseAgentContext` → 注入 `runAgentRuntimeTurn.agentContext` → entry 路径 turn 开头压缩（task 模式用 `ASSISTANT_CONTEXT_COMPRESSION_SYSTEM_PROMPT`）→ `buildEntryAgentMessages` 用快照 → 工具循环 → `result.contextUpdate` → host `stageAssistantContextFile`（写 workspaceTransaction）→ `commitAssistantWorkspaceFiles` → `saveLocalAssistantFiles` 合并落盘 Dexie map → 跨加载 `loadLocalAssistantFiles` 恢复。
  - turn 号：`nextAssistantTurnNumber(snapshot)` → fake snapshot `state.turn` → `currentRuntimeTurnNumber` → `appendTurnToContext` 的 turn 参数 → `lastCompressedTurn` 去重。
  - 会话删除：`deleteAssistantSession` → `localDb.meta.delete(messagesKey)` + `deleteLocalAssistantFile(assistantContextPath(id))` → 无孤儿。
- [ ] **F5** 代码复用核对：
  - `AgentContextSnapshot` 复用（类型放宽，不新建 `AssistantContextSnapshot`）。
  - `serializeAgentContext`/`parseAgentContext`/`createEmptyAgentContext`/`createInitialAgentContext`/`compressContext`/`appendTurnToContext`/`estimateContextTokens`/`resolveTokenBudget` 复用（参数化，不新建模块）。
  - `CompressCallModel`/`CompressCallOptions`/`ContextCompressionFailedError`/`CONTEXT_COMPRESS_TRIGGER_RATIO`/`CONTEXT_KEEP_RECENT_TURNS` 复用不改。
  - `loadLocalAssistantFiles`/`saveLocalAssistantFiles`/`isLocalAssistantPath` 复用不改（合并落盘机制天然支持新路径）。
  - `stageAssistantContextFile` 对称 master 的 `stageAgentContextFile`（同 workspaceTransaction.write + commit 落盘模式）。
- [ ] **F6** master 不回归核对：
  - `AgentContextSnapshot` 类型放宽后 master 调用点（`readAgentContextFromWorkspace`/`stageAgentContextFile`/entry narrative 分支）传值不变（`"master"`/`tsian.agent.context.v1`），编译通过。
  - `compressContext` 默认 `systemPrompt`/`userLabel`/`assistantLabel` = master 现状值，narrative 分支不传新字段 → 行为不变。
  - entry turn 开头压缩 guard 放宽后，narrative 模式仍执行（只是不再被 `=== "narrative"` 前置过滤，但 narrative 本就执行），prompt 用默认 → 行为不变。
  - master 的 `agents/master/context.json` 落盘 / `stageAgentContextFile` / `readAgentContextFromWorkspace` 全不动。

**回滚点 F**：commit "docs(spec): assistant cross-turn context persistence via virtual file + type relaxation"。

## 阶段 G：真实 API 实测

> 依赖 API key 环境。登记到 `docs/active/pending-verification.md`（PV-NNN）若环境不具备。

- [ ] **G1** 跨 turn 持久化：助手多轮对话（≥3 轮）后关闭重开浏览器，助手从 context 虚拟文件恢复，知道之前聊过什么（不失忆）。
- [ ] **G2** 文件系统可视化：助手对话后，用 workspace 工具 `workspace_read .tsian/local/assistant/sessions/<id>/context.json` 能读到快照内容（summary + recentTurns）；`workspace_list .tsian/local/assistant/sessions/` 能列出会话 context 文件（验证文件系统可视化哲学落地）。
- [ ] **G3** 长对话稳态：构造长对话（多轮 + 大量工具探索撑爆 85%），观察快照触发压缩，summary 滚动浓缩，recentTurns 保持最近 5 轮，不膨胀。
- [ ] **G4** 多会话隔离：创建会话 A 和 B，各自对话几轮，切换 A↔B 验证 agent 上下文不串（A 不知 B 的对话，各自读各自 `sessions/<id>/context.json`）。
- [ ] **G5** 会话删除清理：删除会话后，`workspace_list .tsian/local/assistant/sessions/` 不列已删会话的 context（`deleteLocalAssistantFile` 孤儿清理生效）。
- [ ] **G6** 旧会话迁移：有可见消息但无 context 虚拟文件的旧会话（新代码前创建的），首次发消息后 context 从 history 兜底初始化，后续正常持久化。
- [ ] **G7** turn 失败不写回：助手 turn 中途 abort（点停止）/ timeout（超 300s 或调小 timeoutMs），context 虚拟文件不追加本轮（`readAssistantContextFromFiles` 读出的 recentTurns 不含失败轮）。
- [ ] **G8** master 不回归：master turn 开头剧情压缩 + `agents/master/context.json` 落盘 + 跨加载恢复行为不变（玩一局游戏多轮 + 重开验证）。
- [ ] **G9** turn 号递增：多轮对话后 `readAssistantContextFromFiles` 读出的 recentTurns 的 turn 号单调递增（1,2,3,...），`lastCompressedTurn` 正确去重（压缩后不再重复压已压轮次）。

**回滚点 G**：实测通过后无代码改动；若实测发现回归，回滚到对应阶段 commit 修复。

## 验证命令汇总

```bash
# 每阶段至少跑
npm run build:contracts && npm run build:web

# spec 同步后(F1/F2)补
# (lint/type-check 已含在 build:web 内,若有单独 script 补跑)
```

## 回滚策略

- 每阶段一个 commit，回归时 `git revert <commit>` 二分定位。
- 关键回滚点：
  - **阶段 A**（类型放宽 + 参数化）——若 master 编译/行为回归，revert A 回到"AgentContextSnapshot 严格类型 + 硬编码"状态（助手后续阶段依赖 A，revert A 需连带 revert B-E）。
  - **阶段 C**（guard 放宽）——若 master turn 开头剧情压缩回归，revert C 回到"narrative-only guard"（助手无 turn 开头快照压缩，但 turn 内 `compressTaskContext` 仍在）。
  - **阶段 D**（host 接入）——若助手 turn 回归（如 turn 号推算错误、快照注入异常、context 虚拟文件落盘异常），revert D 回到"助手无 agentContext 注入 + contextUpdate 丢弃 + turn=0"（`06-20-agent-task-compression` 交付的 task 模式 + 时长兜底仍在，只是无跨 turn 持久化）。已写入 map 的 `sessions/<id>/context.json` 残留为孤儿（不影响功能，可留待后续清理）。
- 全量回滚：revert A-F 所有 commit，恢复旧状态（助手无跨 turn 持久化，master 不受影响）。

## 完成标准

- [ ] 阶段 A-F 全部 commit + `npm run build:contracts && npm run build:web` 通过。
- [ ] spec 同步完成（type-safety.md 两场景更新 + state-management.md 补充 + 新场景/契约）。
- [ ] 真实 API 实测 G1-G9 通过（或登记 PV 待环境）。
- [ ] master 剧情压缩 + `agents/master/context.json` 落盘 + 跨加载恢复不回归（F6 + G8 双重确认）。
- [ ] prd.md 验收标准全勾：
  - [ ] 助手 context 快照持久化到 `.tsian/local/assistant/sessions/<sessionId>/context.json`（虚拟文件），schema `tsian.assistant.context.v1` 标记正确。
  - [ ] turn 开头检查 token，超 85% 触发任务摘要压缩（复用 `compressContext` + `ASSISTANT_CONTEXT_COMPRESSION_SYSTEM_PROMPT`），turn 结束追加本轮 + host 落盘（搭便车 commitAssistantWorkspaceFiles）。
  - [ ] 跨加载恢复：关闭重开后助手从 context 虚拟文件恢复（任务摘要 + 最近 K 轮），不失忆。
  - [ ] 长对话稳态：多轮对话后快照保持"任务摘要 + 最近 K 轮"不膨胀。
  - [ ] master 的 context.json 不受影响（独立路径 + 独立 schema + narrative 分支不变）。
  - [ ] `npm run build:contracts && npm run build:web` 通过。
  - [ ] 真实实测：桌面助手多轮对话后关闭重开，上下文恢复；长对话触发压缩稳态不撑爆。
  - [ ] 文件系统可视化：context 虚拟文件可被 agent workspace_read/workspace_write 管理（契合产品哲学）。
