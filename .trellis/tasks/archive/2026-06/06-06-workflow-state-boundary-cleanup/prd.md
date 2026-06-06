# 公开工作流状态边界收敛

## Goal

围绕 workflow-as-system 方向，继续收紧公开 workflow node surface：把仍以 `memory-query` 命名的公开读取节点迁移为通用的 `state-query`，并同步默认 AIRP 工作流、编辑器、测试和当前维护文档，避免后续任务继续把“记忆系统”误当成平台节点语义。

## What I Already Know

- Tsian 的长期方向是 workflow-as-system：事件/档案只是默认 AIRP preset 的一种 schema/state 配置，不是通用节点语义。
- `state-write` 已完成公开写入节点迁移；旧 `memory-write` 不保留 alias，旧 workflow 应按未知节点失败。
- `memory-query` 当前已经是 collection-only 行为，主要问题是公开节点命名、类型契约、编辑器入口和文档搜索仍保留 memory 语义。
- `apply-patch` 已从 workflow node surface 退场；桥/API patch 兼容写入口仍作为平台兼容能力保留。
- `docs/active/deferred-work.md` 中 `DW-002` 明确登记了 `memory-query -> state-query`，建议下一任务为 `state-query-boundary-mvp`。
- 当前代码中 `memory-query` 涉及 contracts、workflow-engine validator/tests、platform-web executor/registry/editor、默认 AIRP workflow 和静态防回归测试。
- 多处 `CLAUDE.md` / active docs 仍会被搜索命中旧 `memory-query` 或旧 `memory-write` 说法，容易影响后续 Agent 判断。

## Requirements

- 将公开 workflow 读取节点从 `memory-query` 迁移为 `state-query`。
- 不为旧 `memory-query` 保留 alias；旧 workflow 使用该节点时应 fail loud 为 `UNKNOWN_NODE_TYPE` / unknown type。
- 保持现有行为不扩张：仍是 save-scoped generic records 的 collection query，保留 `namespace`、`collection`、`queryVarName`、`query`、`limit` 等能力。
- 更新 contracts 中公开节点类型与 config 命名，例如 `StateQueryNodeConfig`。
- 更新 workflow-engine validator、默认 AIRP workflow、相关测试，让默认 preset 不再包含 `"memory-query"`。
- 更新 platform-web workflow host：executor 文件/导出/注册从 memory-query 迁移到 state-query，错误信息使用新节点名。
- 更新 workflow editor：新建节点默认配置、palette/registry、节点 schema、inspector 组件与用户可见 label 使用 state query 语义。
- 更新静态防回归测试：覆盖 retired `memory-query` fail loud、`state-query` 通过、默认 workflow 和 authoring surface 不再出现公开旧节点名。
- 同步当前维护文档：
  - `docs/active/current-state-handoff.md`
  - `docs/active/airp-workflow-platform-direction.md`
  - `docs/active/deferred-work.md`
  - 相关 `CLAUDE.md` 中明显过时的公开节点列表或默认工作流描述。
- 对已完成的 deferred item `DW-002` 标记为 resolved 或移出 active deferred 队列，并保留必要历史说明。

## Acceptance Criteria

- [ ] `WorkflowNodeType` 包含 `state-query`，不再包含 `memory-query`。
- [ ] validator 接受 `state-query`，拒绝旧 `memory-query`，且拒绝原因清晰。
- [ ] 默认 AIRP workflow 的读取节点均使用 `state-query`，写入仍使用 `state-write`。
- [ ] platform-web executor registry 注册 `state-query`，不注册 `memory-query`。
- [ ] workflow editor 能创建和编辑 `state-query` 节点，默认配置等价于旧 collection query。
- [ ] 相关测试覆盖旧节点退役、新节点可用、默认 workflow 和 authoring surface 的字符串回归。
- [ ] 文档搜索不再把 `memory-query` 表述为当前公开节点；只允许在历史/退役说明或测试用例中出现。
- [ ] 验证命令通过：contracts build、workflow-engine build/test、memory-core build、web build（若其中某项因环境失败，需要记录原因）。

## Technical Approach

采用“公开 surface 迁移，内部存储暂不迁移”的方式：

- 对外命名从 memory query 收敛到 state query。
- 运行时行为基本复制原 collection-only executor，只替换公开类型、注册名和错误消息。
- 默认 AIRP 事件/档案仍通过 `namespace: "airp"` + collection query 表达，不引入事件/档案节点。
- 用测试继续防止 `apply-patch`、`memory-write`、`memory-query` 回到公开 workflow surface。

## Decision (ADR-lite)

Context: `state-write` 已经把持久写入节点从默认 AIRP 记忆语义中抽离，但读取侧仍叫 `memory-query`，与 workflow-as-system 方向不一致，也会让未来地图、关键词、正文后处理等系统显得必须套用 memory 节点。

Decision: 本任务迁移公开读取节点为 `state-query`，不引入兼容 alias，保持现有 collection query 行为，并同步 authoring surface 与当前维护文档。

Consequences: 旧 workflow preset 会明确失败，需要作者迁移为 `state-query`；内部 `memoryRecords` 等存储命名继续保留，避免把本任务扩大成存储契约迁移。

## Out of Scope

- 不重命名 Dexie 表、checkpoint slice、storage helper 或 `memoryRecords` 内部存储词汇；该工作仍由 `DW-001` 跟踪。
- 不新增 query DSL、相似度检索、排序/过滤语言或 schema-aware query planner。
- 不实现 schema resources、schema UI 或 renderer adapters。
- 不删除桥/API `applyPatch` 兼容写入口。
- 不维护或迁移 `openspec/`；该目录属于 Claude Code 工作流材料，若搜索噪声影响本任务，可选择忽略或删除，但不作为本任务必做项。

## Technical Notes

- 方向文档：`docs/active/airp-workflow-platform-direction.md`
- 暂缓登记：`docs/active/deferred-work.md`
- 当前状态入口：`docs/active/current-state-handoff.md`
- 主要 contracts 入口：`packages/contracts/src/workflow.ts`
- 主要 validator 入口：`packages/workflow-engine/src/validator.ts`
- 当前旧 executor：`apps/platform-web/src/workflow-host/executors/memory-query.ts`
- workflow host 注册：`apps/platform-web/src/workflow-host/index.ts`
- 编辑器入口：
  - `apps/platform-web/src/composables/useWorkflowEditor.ts`
  - `apps/platform-web/src/components/workflow/node-registry.ts`
  - `apps/platform-web/src/components/workflow/node-schema.ts`
  - `apps/platform-web/src/components/workflow/NodeInspector.vue`
  - `apps/platform-web/src/components/workflow/inspector/MemoryQueryForm.vue`
- 默认 workflow：`builtin/mods/default-airp-workflow.ts`
- 相关测试：
  - `packages/workflow-engine/test/sc-crit.test.ts`
  - `packages/workflow-engine/test/mixed-airp-default-workflow.test.ts`
