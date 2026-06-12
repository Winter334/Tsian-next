# Agent 上下文组装 MVP

## Goal

让平台能够从 Runtime Workspace 中为指定 Agent 组装一份可消费的上下文包，为后续把固定 `master-agent -> narrative-agent` 流程迁移到 workspace-defined Agent 打基础。

这个 MVP 不改变当前实际回合执行链。它先提供可测试的纯组装能力和 bridge query，让运行时、调试 UI、未来 `agent.call` / action executor 都能复用同一份 Agent 上下文来源。

## Confirmed Facts

- Runtime Workspace storage/API 已存在，save 内文件可 list/read/search/write/delete，并随 checkpoint 保存/恢复。
- 默认新存档已包含 `agents/master/AGENT.md`、`agents/narrative/AGENT.md`、各自 `notes.md`、`session.jsonl`，以及 `history/`、`world/`、`memory/` 等目录。
- `AGENT.md` registry 已能解析 `id`、`title`、`summary`、`contacts`、`defaultSkills`、`contextPaths`。
- Skill registry 已能返回轻量 `summary/triggers/appliesTo`，并区分 shared 与 agent-local skill。
- `skill-detail` 已能按 `SKILL.md` path 加载选中 skill 正文和资源索引，但不会批量返回 sibling resource content。
- 当前 `runAgentRuntimeTurn` 仍使用硬编码 master/narrative system prompt、recent history 和 stateRecords；本任务不迁移这条链路。

## Requirements

- 新增共享合约类型，用来表示组装后的 Agent 上下文包。
- 新增纯 helper，从一组 `WorkspaceFile` 中为指定 agent id 或 `AGENT.md` path 组装上下文。
- 上下文包至少包含：
  - 选中 Agent 的 registry entry；
  - 选中 Agent 的 `AGENT.md` 文件内容；
  - 选中 Agent 的 `notes.md`，如果存在；
  - 选中 Agent 的 `session.jsonl`，如果存在；
  - 选中 Agent 可见的轻量 Skill Index；
  - `AGENT.md` 声明的 `contextPaths` 对应文件，按存在情况返回；
  - 未找到的 `contextPaths`，供调用方调试或提示。
- Skill Index 仍保持渐进披露，只返回 registry entries，不返回 `SKILL.md` 正文和 action/resource 详情。
- Agent-local skills 默认只暴露给对应 Agent；shared skills 默认可见。
- 不要求平台理解 `contextPaths` 指向文件的玩法语义。
- 暴露 bridge query，建议资源名为 `agent-context`，支持按 `agentId` 查询。
- 无 active save、未知 agent、非法 path 或缺失上下文文件时，应以空 items 或显式缺失列表的方式温和失败，不破坏现有 query 行为。
- 更新当前状态/方向文档中已经过期的实现状态描述。

## Acceptance Criteria

- [x] `agent-context` query 对默认 `master` agent 返回一个上下文包，包含 `AGENT.md`、`notes.md`、`session.jsonl`、skill index、已存在的 `contextPaths` 文件和缺失路径列表。
- [x] `agent-context` query 对默认 `narrative` agent 返回对应上下文包，且不会混入其它 Agent 的 local skills。
- [x] 共享 skills 出现在 Agent 可见 skill index 中；目标 Agent 自己的 local skills 出现；其它 Agent 的 local skills 不出现。
- [x] 缺失的 `contextPaths` 不导致 query 抛错，并被记录在上下文包的 missing paths 中。
- [x] 未知 agent 或无 active save 返回空 items。
- [x] 当前 `interaction.sendMessage` 行为不变。
- [x] `npm run build:contracts` 通过。
- [x] `npm run build:web` 通过。

## Validation Results

- `npm run build:contracts` passed.
- `npm run build:web` passed.
- In-memory helper probe passed for shared/local skill visibility, missing context paths, notes/session files, and unknown agent handling.

## Out Of Scope

- 不迁移 `runAgentRuntimeTurn` 到 workspace prompt。
- 不实现 `agent.call`。
- 不实现 action executor registry。
- 不加载 skill detail 或 skill resource contents。
- 不做 UI。
- 不迁移 `stateRecords` 到 Runtime Workspace。

## Open Questions

- 无阻塞性开放问题。当前 MVP 范围由既有方向文档、默认 workspace 文件和已实现 registry 能力共同限定。
