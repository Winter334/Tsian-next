# Workspace Agent Runtime MVP

## Goal

把当前硬编码 `master-agent -> narrative-agent` 回合，迁移为由 Runtime Workspace 中的 Agent 定义驱动的回合。

MVP 仍保留两次模型调用：`master` 先产出 brief，`narrative` 再产出玩家可读正文。但两者的 system/context 输入应来自 `AGENT.md` 与 `agent-context`，而不是只依赖 TypeScript 中的常量提示词。

## User Value

- Agent 行为开始真正由存档内 `agents/<agent>/AGENT.md` 定义，可配置、可替换、可扩展。
- 内容包或玩家后续可以通过改 workspace 文件影响 Agent 运行，而不是改平台代码。
- 前面已完成的 Runtime Workspace、registry、skill index、agent-context 能力进入真实 AIRP 回合链路。

## Confirmed Facts

- 当前 `runAgentRuntimeTurn` 位于 `apps/platform-web/src/agent-runtime/index.ts`，每轮固定调用 `master-agent` 和 `narrative-agent` 两次模型。
- 当前 master/narrative system prompt 是硬编码常量。
- `platform-host` 的 `interaction.sendMessage` 已能在 active save 上调用 runtime、保存 history/snapshot、创建 checkpoint，并在失败时回滚 snapshot。
- 新建 save 会调用 `initializeWorkspaceForSave`，默认写入 `agents/master/AGENT.md`、`agents/narrative/AGENT.md`、notes/session 和 context paths 指向的工作区文件。
- `assembleAgentContext(files, { agentId })` 已能从 `WorkspaceFile[]` 组装 Agent 文件、notes/session、可见 Skill Index、context files 和 missing paths。
- `AgentContextEntry.skillIndex` 只包含轻量 registry，不包含 `SKILL.md` 正文或 action/resource detail。
- 已确认 fallback 策略：旧存档或异常存档的 workspace 为空时，运行前自动初始化默认 workspace；如果 workspace 已存在但缺少 `master` 或 `narrative` Agent 定义，则明确失败，不静默回退硬编码提示词。

## Requirements

- `runAgentRuntimeTurn` 应支持接收当前 save 的 `WorkspaceFile[]` 或等价 workspace 上下文输入。
- Runtime 应为 `master` 和 `narrative` 分别组装 `AgentContextEntry`。
- Production `sendMessage` 路径应在读取 workspace files 前确保 active save 至少拥有默认 workspace 文件，以兼容旧存档。
- 模型 system prompt 应包含对应 Agent 的 `AGENT.md` 正文和必要的平台级输出约束。
- 模型 user/context 输入应包含该 Agent 的 notes、session 摘要或原文、declared context files、missing context paths 和轻量 skill index。
- 当前 recent history、stateRecords、snapshot turn 和玩家输入仍应保留在模型输入中。
- Master 仍输出 brief，不直接输出玩家正文。
- Narrative 仍输出玩家可读正文，且不得提到 Agent、brief、工具或提示词。
- Debug label 可继续使用 `master-agent` / `narrative-agent`，避免改动 AI debug UI。
- `interaction.sendMessage` 的保存、checkpoint、abort、failure rollback 行为应保持。
- 现有 `agent-context` bridge query 行为不应被破坏。
- 文档和 `.trellis/spec/` 应更新，记录 workspace-defined runtime 的边界与 fallback 策略。

## Acceptance Criteria

- [x] 默认新存档的一轮 `sendMessage` 会使用 `agents/master/AGENT.md` 组装 master 模型消息。
- [x] 默认新存档的一轮 `sendMessage` 会使用 `agents/narrative/AGENT.md` 组装 narrative 模型消息。
- [x] Master 模型输入包含 master 的 context files、notes/session、轻量 skill index、recent history、stateRecords、turn 和玩家输入。
- [x] Narrative 模型输入包含 narrative 的 context files、notes/session、轻量 skill index、recent history、master brief 和玩家输入。
- [x] Skill index 仍为轻量 registry，不加载 `SKILL.md` detail。
- [x] 缺失的 declared context paths 会进入模型上下文的缺失提示，不导致正常回合崩溃。
- [x] workspace 为空的旧存档在回合运行前会初始化默认 workspace 文件。
- [x] workspace 已存在但缺失 `master` 或 `narrative` Agent 定义时，回合明确失败，不静默回退硬编码提示词。
- [x] `interaction.sendMessage` 仍保存 user/assistant history、更新 snapshot turn，并创建 after-turn checkpoint。
- [x] `npm run build:contracts` 通过，如本任务未改 contracts 可记录为不需要。
- [x] `npm run build:web` 通过。

## Validation Results

- `npm run build:web` passed.
- `npm run build:contracts` passed.
- In-memory runtime probe passed for AGENT.md prompt injection, context files, notes/session, missing context diagnostics, lightweight skill index, master brief handoff, and missing required Agent failure.

## Out Of Scope

- 不实现 `agent.call`。
- 不实现 action executor registry。
- 不执行 tool/action calls。
- 不自动加载 `skill-detail`。
- 不写回 `agents/<agent>/session.jsonl` 或 notes。
- 不迁移 `stateRecords` 到 workspace。
- 不做 Runtime Workspace / Agent / Skill UI。
- 不改变模型 provider 配置或 AI debug 面板。

## Open Questions

- 无阻塞性开放问题。fallback 策略已确认：空 workspace 自动初始化；非空 workspace 缺关键 Agent 明确失败。
