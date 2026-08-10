# 开局访谈重复读取与恢复修复 — Design

## 1. Design Goal

用现有 task-mode Agent context 能力补齐跨轮 Tool 工作记忆，并通过卡包 workspace Skill 自包含地说明状态协议。开局业务状态、Tool 执行记忆和源文本继续保持三个独立权威边界；游戏前端 parser 保持不变。

## 2. Persistent task-mode Tool Memory

当前 runtime 已产生：

`projected observation -> collectToolMemoriesForContext -> result.contextUpdate.toolMemories`

目标 host 链路为：

`contextUpdate.toolMemories -> stageAgentContextFile -> sort + retention merge -> context-<slot>.json -> next task-mode request tool-memory layer`

具体边界：

- `ai-invocation.ts` 把 `result.contextUpdate.toolMemories` 传给 `stageAgentContextFile`。
- `history-turns.ts` 在追加 text-only user/assistant turn 后，复用 `sortToolMemoriesStable` 与 `applyTaskToolMemoryRetention` 合并 base snapshot 和本轮 memories。
- 如果本轮发生 context compression，以 `compressedContext` 为 base，再合并本轮新 memories，避免恢复已被压缩移除的旧摘要。
- `buildEntryAgentMessages()` 根据 `compressionMode === "task"` 决定是否渲染 `AgentContextSnapshot.toolMemories`；`.tsian/local/` 路径判断只继续决定用户/玩家措辞和 history label，不再承担能力路由。
- formal game turn 的 narrative mode 保持现状，不新增 Tool memory message。

不修改 `AgentContextToolMemory` shared shape，不保存 raw observation，不从 UI timeline 反造模型记忆。

## 3. Opening Skill Contract

只修改卡包 workspace 中访谈专用《开局建模》Skill。它不是游戏前端副本，也不需要同步到 `apps/play-frontend-dev`。

Skill 在回复协议附近直接给出完整 schema 和至少一个非空实例：

- 顶层只允许 `schema/sessionId/sourceHash/branch/revision/processedAttemptId/readSlices/protagonist?/decisions/unresolved/phase`。
- `protagonist` 是唯一主角摘要位置，形状为 `{mode,ref?,name?}`；不得把该对象塞入 `decisions.protagonist`。
- `decisions.<stableKey>` 固定为 `{value,evidenceRefs?}`；`evidenceRefs` 是去重 ref 数组。
- `unresolved.<stableKey>` 固定为 `{reason}`，不得用字符串、选项数组或以 `|` 拼接的值代替对象。
- 每轮输出完整快照，不输出 patch；同 key 更新，不保留冲突副本。

`readSlices` 采用章节内字符范围：

- 每个已精读章节一条 `{ref,start?,end?,purpose}`。
- `start/end` 是该章节正文的 0-based、end-exclusive 字符偏移；`read_opening_slice` 从章首读取时写 `start:0, end:charactersRead`。
- 完整章节也可省略 start/end；不得把 `window.startIndex/endIndex` 或章节序号重复填入每章字符范围。
- `inspect_source_opening` 是结构/候选预览，不伪装成完整精读 `readSlices`；它是否执行由跨轮 Tool memory 记录。

阅读决策规则：先检查隐藏状态和 Tool memory；若当前问题已有足够证据则复用，只有预览不足以支撑角色事实或切入点时才精读。预览与精读存在内容重叠可以是合法的，但必须由当前决策缺口驱动。

## 4. Source Boundaries

- Skill 作者文件：`cards/沉浸阅读器.tsian-card/workspace/agents/world-architect/skills/开局建模/SKILL.md`。
- Tool memory runtime：`apps/platform-web/src/agent-runtime` 与 `apps/platform-web/src/platform-host`。
- `apps/play-frontend-dev` 是游戏前端源码，但本次不修改；卡包构建仍会照常把现有游戏前端与更新后的 workspace 一起打包。

## 5. Verification

- Tool memory unit/integration：persistent task-mode side invocation 写入 context 后，下一轮 request 存在有界 Tool memory；narrative mode 不存在。
- Skill review：完整 schema、非空示例、非法形状警示和 read range 语义与当前严格 parser 一致。
- Build：platform web；最后运行卡包构建/验证，确认更新后的 workspace Skill 被正确收录且现有游戏前端无改动。

## 6. Rollback and Deferred Design

- Tool memory 接线和 Skill 文案可独立回退。
- 本次不创建脚本状态文件或 action，也不修改前端 parser。若后续转向脚本化，将另行设计 action 的读/写/幂等/恢复接口，并明确迁移 `[[开局会话]]` 的权威角色，不能叠加第二份进度。
