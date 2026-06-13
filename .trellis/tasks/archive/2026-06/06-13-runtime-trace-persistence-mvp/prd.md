# Runtime Trace Persistence MVP

## Goal

为 AIRP Agent Runtime 增加轻量、结构化、存档级 trace 持久化，使平台能回答“本回合哪些 Agent 运行了、加载了哪些 Skill、调用了哪些工具/action、改了哪些 workspace 文件、哪里失败了”。

Trace 采用“平台拥有、工作区承载、默认隐藏”的形态，写入 Runtime Workspace 的 `.tsian/traces/`，但不进入普通 Agent 上下文，也不污染普通 workspace list/search。

## User Value

- 默认状态维护 Skill、`platform_action`、未来 `agent_call` 和脚本/远程 executor 出问题时可回溯。
- 作者能定位哪个 Agent / Skill / action 改了角色、地图、线索、任务等 AIRP 状态文件。
- 平台保留调试链路，但不把完整 prompt、全文文件读取或每个 token 塞进可维护的普通 workspace。
- Trace 随存档存在，符合 Runtime Workspace 作为存档级数据容器的方向。

## Confirmed Facts

- 方向文档已将 `.tsian/` 定义为平台 metadata、trace、checkpoint、索引和缓存空间。
- 默认工作区已包含 `.tsian/traces/README.md`。
- 当前 `interaction.sendMessage` 在 `platform-host/index.ts` 中调度 `runAgentRuntimeTurn`，成功后保存 snapshot/history 并创建 checkpoint；失败时恢复内存 snapshot 并抛出错误。
- 当前 Agent Runtime 每轮固定运行 `master-agent` 和 `narrative-agent`。
- 当前工具循环可产生 `skill_load`、`action_call`、`workspace_read`、`workspace_list`、`workspace_search` observation。
- `platform_action` 当前可通过 platform-host allow-list 调用 `workspace-write` / `workspace-delete`，并会同步同轮 `workspaceFiles`。
- 当前 workspace storage 的 `listWorkspaceEntriesForSave` / `searchWorkspaceFilesForSave` 会遍历所有 workspace 文件，尚未默认排除 `.tsian/traces/`。
- 当前 runtime workspace tool 的 `workspace_list` / `workspace_search` 也会遍历传入的所有 `WorkspaceFile[]`，尚未默认排除 `.tsian/traces/`。
- 当前 checkpoint 会保存完整 workspace 文件集合。

## Requirements

- 每个玩家回合生成一份结构化 JSONL trace 文件，推荐路径：`.tsian/traces/turns/turn-000001.jsonl`。
- Trace 文件由平台写入，Agent 默认不注入、Skill Index 不暴露、普通 `agent-context` 不加载。
- 普通 workspace list/search 默认排除 `.tsian/traces/`，包含平台桥查询和 Agent Runtime workspace 工具。
- `workspace_read` 是否能按精确路径读取 `.tsian/traces/` 可先保持现状；MVP 不新增 `trace_read` / `trace_search` 专用工具。
- Trace 记录事件级摘要，不默认记录完整 prompt、完整 workspace_read 内容、完整 SKILL.md 正文或 token 级日志。
- Trace 必须至少记录：
  - `turn_started`
  - `agent_step_started`
  - `model_call_completed`，记录 agent/debugLabel、messageCount、outputLength、hasToolCalls、toolCallCount；
  - `skill_loaded`，记录 agent、skill name/path/scope、actionCount、declarationErrorCount；
  - `workspace_tool_called`，记录 agent、tool、path/query/limit 摘要、ok、resultCount 或 error code；
  - `action_called`，记录 agent、skill、action、executor、input 摘要、status、output 摘要或 error code；
  - `workspace_mutation`，记录由 allow-listed `platform_action` 引发的 write/delete path、mediaType、size 或 deletedPaths；
  - `agent_step_completed` / `agent_step_failed`
  - `turn_completed` / `turn_failed`
- Trace 写入失败不应伪装成业务 action 成功；实现必须有清晰错误处理策略并在设计中写明。
- Trace event shape 应保持 JSON-compatible，便于后续 debug UI、导出和回放工具读取。
- 更新方向文档、current handoff 和 platform-web type-safety spec。
- 不做 UI。

## Trace Event MVP Shape

每行 JSON 事件建议包含：

```json
{
  "type": "action_called",
  "timestamp": 1710000000000,
  "turn": 1,
  "agentId": "master",
  "debugLabel": "master-agent",
  "ok": true,
  "data": {
    "skill": "world-state",
    "action": "write_world_note",
    "executor": { "type": "platform_action", "name": "workspace-write" },
    "inputSummary": { "keys": ["path", "content"], "jsonLength": 64 },
    "status": "executed",
    "outputSummary": { "jsonLength": 120 }
  }
}
```

## Acceptance Criteria

- [x] Successful turns write one `.tsian/traces/turns/turn-*.jsonl` file with valid JSONL events.
- [x] Failed turns write a `turn_failed` trace event when a trace writer is available.
- [x] Trace includes per-Agent step start/completion events for master and narrative.
- [x] Trace includes model call summary events without storing full prompt/messages by default.
- [x] Trace includes `skill_loaded` events when `skill_load` succeeds.
- [x] Trace includes `workspace_tool_called` events for workspace read/list/search, with path/query summaries and no full file content.
- [x] Trace includes `action_called` events for builtin and platform action executors.
- [x] Trace includes `workspace_mutation` events for `workspace-write` and `workspace-delete` platform actions.
- [x] `workspace-list` and `workspace-search` bridge queries do not return `.tsian/traces/` entries by default.
- [x] Runtime `workspace_list` and `workspace_search` tools do not return `.tsian/traces/` entries by default.
- [x] Existing default Agent context does not include trace files.
- [x] `npm run build:web` passes.
- [x] `git diff --check` passes.

## Confirmed Scope Decision

Trace 与 checkpoint / restore 的关系：

MVP 中 trace 作为 Runtime Workspace 文件，随 checkpoint 一起保存和恢复。成功回合在创建 checkpoint 前写入 trace，使该 checkpoint 包含本回合 trace。

产品判断：回滚代表玩家认为这部分内容有问题或不满意，想丢掉并重新来；对应分支的 trace 也自然失去价值，应随回滚一起消失。Tsian trace 不是 append-only 安全审计日志，而是 AIRP 分支调试材料。

## Out Of Scope

- Trace UI。
- `trace_read` / `trace_search` Agent 工具。
- 完整 raw prompt / raw message 归档。
- token 级日志。
- OpenClaw 式重型权限审计。
- trace 压缩、保留策略和清理 UI。
- 脚本/远程 executor trace 的完整规范。
- 将 trace 自动转成剧情 timeline 或 memory。
