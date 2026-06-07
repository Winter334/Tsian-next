# Journal - baisha (Part 1)

> AI development session journal
> Started: 2026-05-24

---



## Session 1: Visual resource editors

**Date**: 2026-05-29
**Task**: Visual resource editors
**Package**: platform-web
**Branch**: `master`

### Summary

Added visual prompt preset and world book editors, tightened shared resource payload contracts, verified web/contracts builds and prompt-engine tests, and updated Claude Code task metadata.

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `92bae05` | (see git log) |
| `75d2f8a` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 2: Wire workflow presets into runtime

**Date**: 2026-05-29
**Task**: Wire workflow presets into runtime
**Package**: platform-web
**Branch**: `master`

### Summary

Closed the workflow preset runtime loop and improved workflow editor resource/output configuration UX.

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `fa8be18` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 3: Record AIRP workflow platform direction

**Date**: 2026-05-29
**Task**: Record AIRP workflow platform direction
**Package**: platform-web
**Branch**: `master`

### Summary

Recorded Tsian's AIRP workflow platform direction, updated active docs and implementation plan, prepared the next save-level workflow preset override task, and archived the direction-recording task.

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `de962e5` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 4: Save-level workflow preset override

**Date**: 2026-05-31
**Task**: Save-level workflow preset override
**Package**: platform-web
**Branch**: `master`

### Summary

Added save-level workflow preset override with runtime precedence, resource-library apply/clear UI, contract guidance, and workflow-engine coverage. Verified build:web, build:contracts, build:workflow-engine, and workflow-engine tests.

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `23b8add` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 5: Workflow node schema slots

**Date**: 2026-06-04
**Task**: Workflow node schema slots
**Package**: platform-web
**Branch**: `master`

### Summary

Verified workflow node input/output schema slot implementation, archived the completed task, and left unrelated config/agent-skill changes untouched.

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `ccf9b65` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 6: Bootstrap Trellis coding specs

**Date**: 2026-06-04
**Task**: Bootstrap Trellis coding specs
**Package**: platform-web
**Branch**: `master`

### Summary

Replaced template Trellis spec files with source-backed package guidance, removed non-applicable template docs, marked bootstrap guidelines complete, and archived the bootstrap task.

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `93af90f` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 7: Workflow trace debug UI and time macro fix

**Date**: 2026-06-04
**Task**: Workflow trace debug UI and time macro fix
**Package**: platform-web
**Branch**: `master`

### Summary

Added workflow run trace and richer debug UI, fixed dotted prompt macro expansion for narrative time/user input, removed incorrect host-side time fallback, and relaxed chat timeout for slow upstream maintenance calls.

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `67af203` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 8: Memory chain nodeization

**Date**: 2026-06-04
**Task**: Memory chain nodeization
**Package**: platform-web
**Branch**: `master`

### Summary

Nodeized the memory chain into workflow-supported memory-query, memory-write, and template-compose nodes; added save-scoped memoryRecords storage with checkpoint/restore coverage; migrated default and grey-salt-town workflows off retrieval bypass; verified contracts, workflow engine, web build, tests, and browser smoke.

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `9ddaa93` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 9: Explicit mod memory write workflow

**Date**: 2026-06-04
**Task**: Explicit mod memory write workflow
**Package**: platform-web
**Branch**: `master`

### Summary

Allowed mod/default workflows to declare explicit apply-patch write nodes, moved grey-salt-town maintenance writes into the workflow DAG, removed platform-host hidden patch scanning, updated workflow/contracts specs, and passed contracts/workflow/web verification.

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `5e73ed0` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 10: Generic memory schema core

**Date**: 2026-06-04
**Task**: Generic memory schema core
**Package**: platform-web
**Branch**: `master`

### Summary

Added memory-core package with default AIRP runtime memory schema, validators, tests, contracts memory types, and custom memory patch support.

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `a823c6c` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 11: Schema-validated memory-write boundary

**Date**: 2026-06-05
**Task**: Schema-validated memory-write boundary
**Package**: platform-web
**Branch**: `master`

### Summary

Connected memory-write to memory-core schema normalization for built-in AIRP collections, preserved custom collection pass-through, added cross-layer proof coverage, and updated memory schema specs.

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `f23c377` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 12: Generic maintenance write migration

**Date**: 2026-06-05
**Task**: Generic maintenance write migration
**Package**: platform-web
**Branch**: `master`

### Summary

Completed the generic AIRP maintenance migration, switched default retrieval/write flow to generic memory, added regression coverage, and updated specs.

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `823e147` | (see git log) |
| `0da996b` | (see git log) |
| `815677e` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 13: AIRP 检索结构阶段抽象

**Date**: 2026-06-05
**Task**: AIRP 检索结构阶段抽象
**Package**: platform-web
**Branch**: `master`

### Summary

Refactored default AIRP retrieval into internal structural stages, added static proof coverage, and documented the internal-stage convention for the next workflow-publication phase.

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `2559901` | (see git log) |
| `27f2a26` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 14: 发布检索基础节点并替换默认 AIRP 检索

**Date**: 2026-06-05
**Task**: 发布检索基础节点并替换默认 AIRP 检索
**Package**: platform-web
**Branch**: `master`

### Summary

发布 record-filter、record-merge、record-format 三个记录处理节点，将默认 AIRP 检索替换为 collection query + record nodes + bounded compute 的混合工作流，并更新相关规格与回归验证。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `5afa0a2` | (see git log) |
| `279d549` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 15: Stabilize AIRP workflow compatibility boundaries

**Date**: 2026-06-05
**Task**: Stabilize AIRP workflow compatibility boundaries
**Package**: platform-web
**Branch**: `master`

### Summary

Reviewed and stabilized AIRP workflow compatibility debt: moved apply-patch sync ownership into the applier, removed implicit node-local checkpoint defaults, moved Grey Salt Town to explicit workflow preset seeding, updated debug/editor/docs surfaces, and verified builds/tests/browser smoke.

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `c8d2394` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 16: Workflow-as-system direction refresh

**Date**: 2026-06-05
**Task**: Workflow-as-system direction refresh
**Package**: platform-web
**Branch**: `master`

### Summary

Refreshed active platform direction around workflow-as-system, archived stale active docs, and recorded the Trellis task for the documentation cleanup.

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `ba857c1` | (see git log) |
| `34b6af6` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 17: Retire event-archive memory query source

**Date**: 2026-06-05
**Task**: Retire event-archive memory query source
**Package**: platform-web
**Branch**: `master`

### Summary

Made memory-query collection-only across contracts, platform executor, workflow editor slots/forms, tests, and current specs/docs. Verified contracts, workflow-engine, workflow-engine tests, and web build.

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `a8d5c09` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 18: 退役 apply-patch 工作流节点

**Date**: 2026-06-05
**Task**: 退役 apply-patch 工作流节点
**Package**: platform-web
**Branch**: `master`

### Summary

完成 workflow-as-system 下一阶段 A2：从 contracts、workflow-engine、platform-web workflow host/editor 和测试中退役 apply-patch 工作流节点；保留 bridge/runtime patch 兼容 API 与 applyMaintenancePatch；同步 Trellis specs、方向文档和任务归档。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `dc3813f` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 19: 迁移持久状态写入节点

**Date**: 2026-06-06
**Task**: 迁移持久状态写入节点
**Package**: platform-web
**Branch**: `master`

### Summary

将公开 durable write 节点从 memory-write 迁移为 state-write，默认 AIRP 工作流改为节点携带 schema，并更新验证、编辑器、测试、spec 与方向文档。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `eeea261` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 20: 新增暂缓事项登记表

**Date**: 2026-06-06
**Task**: 新增暂缓事项登记表
**Package**: platform-web
**Branch**: `master`

### Summary

新增 docs/active/deferred-work.md，用结构化条目记录刻意暂缓的后续工作，并更新 active docs README、方向文档和 handoff 入口。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `9fae461` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 21: 公开状态读取节点迁移为 state-query

**Date**: 2026-06-06
**Task**: 公开状态读取节点迁移为 state-query
**Package**: platform-web
**Branch**: `master`

### Summary

将公开 workflow 读取节点从 memory-query 迁移为 state-query，更新默认 AIRP workflow、platform-web executor/editor、workflow-engine validator/tests、active docs 与 Trellis spec，并保持旧 memory-query fail loud。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `0732b11` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 22: 持久状态底座迁移为 state records

**Date**: 2026-06-06
**Task**: 持久状态底座迁移为 state records
**Package**: platform-web
**Branch**: `master`

### Summary

将通用持久状态底座从 memoryRecords/MemoryWriteOperation 收敛为 stateRecords/StateWriteOperation，更新 Dexie、checkpoint、state-query/state-write executor、默认维护 prompt、测试、active docs 与 Trellis specs；旧 IndexedDB 原型数据按新库名重建，不做迁移。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `2026593` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 23: 升级工作流编辑器画布化编辑体验

**Date**: 2026-06-06
**Task**: 升级工作流编辑器画布化编辑体验
**Package**: platform-web
**Branch**: `master`

### Summary

完成工作流编辑器画布优先改造：右键添加节点，节点/边弹窗编辑，底部诊断抽屉，JSON 导入导出，并验证构建与浏览器烟测。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `561a0e9` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 24: Workflow-carried state contract authoring wrap-up

**Date**: 2026-06-07
**Task**: Workflow-carried state contract authoring wrap-up
**Package**: platform-web
**Branch**: `master`

### Summary

Completed workflow-carried state contract authoring, removed retired OpenSpec materials, recorded frontend rendering as workflow/frontend convention, and archived the completed task.

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `f4f9048` | (see git log) |
| `74c970d` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete
