# Durable State Foundation Cleanup

## Goal

把公开 workflow 节点已经完成的 `state-query` / `state-write` 语义，向下收敛到内部持久状态底座：存储、checkpoint、helper、测试和维护文档不再把通用持久状态称为 memory，避免后续 schema resources、renderer adapters、地图/关系/关键词系统继续被默认 AIRP 记忆语义牵引。

## What I Already Know

* 当前方向文档确认 Tsian 是 workflow-as-system 平台，事件/档案只是默认 AIRP reference preset，不是平台通用语义。
* 公开 workflow surface 已迁移为 `state-query` / `state-write`，旧 `memory-query` / `memory-write` 不保留 alias，应 fail loud。
* `docs/active/deferred-work.md` 的 `DW-001 Rename Internal Memory Storage Vocabulary` 明确登记了本任务，并提示它触及 Dexie table shape、checkpoint slices、restore paths、save deletion、storage helpers、docs 和 tests。
* 代码扫描显示内部仍有 `memoryRecords`、`MemoryWriteOperation`、`applyMemoryWriteOperationsForSave`、`listMemoryRecordsForSave`、`LocalMemoryRecord` 等命名。
* 主要影响区域包括 `apps/platform-web/src/storage/db.ts`、`storage/memory.ts`、`storage/checkpoints.ts`、`storage/saves.ts`、`workflow-host/executors/state-query.ts`、`workflow-host/executors/state-write.ts`、`runtime-host/patch-applier.ts`、`platform-host/index.ts`、`packages/contracts/src/runtime.ts`、`packages/contracts/src/memory.ts`、`packages/memory-core/src/validation.ts` 和 workflow-engine 静态回归测试。

## Requirements

* 将内部通用持久状态记录词汇从 memory-oriented 命名迁移到 state-oriented 命名。
* 旧本地 IndexedDB prototype 数据不做迁移；允许通过 Dexie schema 升级后重建 state records，用户需要新建/重建原型存档来获得新底座。
* 迁移 storage helper API，使 `state-query` / `state-write` executor 不再调用 memory-named helper。
* 迁移 checkpoint 输入、存储切片、restore 路径、save deletion 和创建存档初始 checkpoint 中的通用状态记录命名。
* 迁移 contracts / memory-core 中用于 durable state write 的 operation 类型命名，或至少建立新的 state 命名公开类型并移除 workflow-facing memory 依赖。
* 更新默认 AIRP workflow 相关 prompt / tests / docs 中已经不适合的 `MemoryWriteOperation` 文案，使默认维护 AI 产物也称为 state write operation。
* 保持当前行为不扩展：仍然是 save-scoped、namespace + collection + recordId 定位、collection-only query、schema validation boundary 仍在 `state-write` executor。
* 保持 retired workflow syntax fail loud：不重新引入 `memory-query` / `memory-write` / `event-archive`。
* 更新 `docs/active/current-state-handoff.md`、`docs/active/deferred-work.md` 和相关 `.trellis/spec/`，让 `DW-001` 在完成后标记 resolved。

## Acceptance Criteria

* [ ] 公开 workflow、editor、executor、default workflow 和测试中不再要求作者理解 `MemoryWriteOperation` 或 `memoryRecords` 作为通用持久状态名称。
* [ ] `state-query` / `state-write` 仍能读写默认 AIRP 的 `airp/events`、`airp/archives`、`airp/globals` collection。
* [ ] checkpoint 创建、restore、save deletion 和 patch/write-runtime 兼容路径仍包含通用状态记录。
* [ ] 旧 `memory-query` / `memory-write` workflow node 仍按未知节点失败，不提供兼容 alias。
* [ ] 项目现有 contracts、memory-core、workflow-engine、platform-web 构建和相关测试通过。

## Definition Of Done

* Tests added/updated where contracts, storage, checkpoint, and workflow behavior are renamed.
* `npm run build:contracts`
* `npm run build:memory-core`
* `npm run build:workflow-engine`
* `npm run test --workspace @tsian/workflow-engine`
* `npm run build:web`
* Active docs and Trellis specs updated when behavior or naming contracts change.

## Technical Approach

推荐采用“语义重命名 + 行为冻结”的方式推进：

1. 先迁移 contracts / core types，使 state operation 成为 workflow-facing 名称。
2. 再迁移 platform storage helper 和 executor import，保持读写逻辑等价。
3. 接着处理 checkpoint/save/bridge/runtime-host 的 state records 切片命名。
4. 最后更新测试、docs、spec，并用静态回归测试防止公开 surface 重新泄露 memory 词汇。

## Decision (ADR-lite)

Context: 公开节点已经迁移到 `state-query` / `state-write`，但内部仍大量使用 memory 词汇。继续保留会让未来非记忆系统，例如地图、关系、关键词片段、正文后处理，也被迫继承默认 AIRP 记忆系统语义。

Decision: 本任务聚焦 durable state foundation 的命名和契约收敛，不扩展查询 DSL、schema resource、renderer adapter 或新的状态模型能力。旧本地 IndexedDB prototype 数据选择清空/重建策略，不实现旧 `memoryRecords` 到新 state records 的迁移。

Consequences: 这会触及较多文件和测试，但行为变更应保持最小。已有浏览器本地原型存档可能需要重建；换来的是不保留长期双读/双写或旧表兼容逻辑，避免把 memory 词汇继续留在状态底座里。

## Out Of Scope

* 不新增 schema resource 存储或引用 UI。
* 不新增 renderer adapters。
* 不新增 query DSL、索引策略或复杂过滤能力。
* 不改变 `state-query` collection-only 行为。
* 不改变 `state-write` 的 schema validation boundary。
* 不重做 default AIRP 事件/档案 schema 本身。
* 不做完整旧数据迁移框架、旧 `memoryRecords` 兼容读取或长期双写模型。

## Open Questions

* 无。

## Technical Notes

* Direction source: `docs/active/airp-workflow-platform-direction.md`
* Deferred source: `docs/active/deferred-work.md#DW-001`
* Current handoff: `docs/active/current-state-handoff.md`
* Search commands used:
  * `rg "memoryRecords|MemoryWriteOperation|applyMemoryWrite|listMemoryRecords|saveMemoryRecords" -n`
  * `rg "state-write|state-query|StateWrite|StateQuery|stateWrite" -n packages apps builtin .trellis docs`
  * `rg "checkpoint.*memory|memory.*checkpoint|memoryRecords" -n apps packages .trellis docs`
