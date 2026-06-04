# 通用记忆模型先行

## Goal

设计并落地通用 memory schema / collection / operation 的模型层，让默认 AIRP 的事件-档案结构可以被表达为默认 schema/config，而不是继续固化在工作流节点类型或 `apply-patch` 兼容层里。

## What I Already Know

* 用户认可第二阶段采用“模型先行”，先稳定抽象，不直接做完整运行时纵向迁移。
* 上一阶段已明确：`apply-patch` / `MaintenancePatchDocument` 只是兼容写入层，不能扩展成通用记忆模型。
* 上一阶段 guardrails 要求：不新增 `event-query`、`archive-query`、`catalog-event-query` 等绑定默认结构的节点类型；不优先做子工作流；不恢复 mod workflow 写运行时记忆的权限禁令。
* `packages/contracts/src/runtime.ts` 当前已有 `MemoryRecord` 和 `MemoryWriteOperation`，但 operation 只覆盖 `upsert` / `delete` / `clear`，没有 schema 描述，也没有 `patch` 操作模型。
* `apps/platform-web/src/storage/memory.ts` 当前的 `memory-write` 存储只写 `localDb.memoryRecords`，通过 `namespace + collection + recordId` 定位自定义记忆记录。
* `apps/platform-web/src/workflow-host/executors/memory-write.ts` 当前只读取 workflow 输入中的 operation，并调用 `applyMemoryWriteOperationsForSave()`；没有 schema 校验层。
* 默认 AIRP 的 `events`、`archives`、`globals` 仍通过独立存储结构和 `MaintenancePatchDocument` 维护，不属于现有 generic memory collection 写入路径。
* `MemoryQueryNodeConfig` 仍然有 `source: "event-archive" | "collection"`；`event-archive` 分支会直接调用 `assembleRetrievalContext()`。
* `apps/platform-web/src/runtime-host/retrieval.ts` 仍包含事件排序、catalog event 选择、hint entity、prompt 拼装等默认 AIRP 硬编码算法。
* 当前 workspace 依赖中没有 zod / ajv 这类 schema validator；现有 workflow executor 与 storage 边界主要使用手写解析函数和 `throw new Error(...)` fail loud。

## Assumptions

* 本任务是模型层任务，不要求灰盐镇默认维护写入立即改走 generic `memory-write`。
* contracts 继续保持 type-only；默认 schema 常量和 validator 进入新的 `packages/memory-core`。
* Schema 校验应 fail loud，非法 collection、字段类型、缺失必填字段、非法关系引用不能静默吞掉。
* `apply-patch` 和 `memory-query(source: "event-archive")` 可以继续作为兼容入口存在，但新增模型不应依赖它们的结构假设。

## Requirements

* 定义通用 `MemorySchema` 模型，用来描述 namespace、collection、字段、关系、索引、渲染元数据和 schema 版本。
* 字段模型采用项目自定义的轻量字段描述，优先覆盖 `string` / `number` / `boolean` / `object` / `array` / `json`、`required`、`default`、`enum`、`description`、`render` 等基础能力。
* collection 间关系第一版作为字段元数据表达，例如 `relation: { targetCollection, targetField, cardinality }`。
* Operation 校验默认拒绝未知字段；collection 可以显式配置 `additionalFields` 来允许 JSON 额外字段。
* 轻量字段描述必须保留后续扩展空间，包括新增字段类型、约束、渲染元数据、版本迁移信息，以及未来 JSON Schema 导入/导出的可能性。
* 定义通用 `MemoryWriteOperation` 模型，覆盖 `upsert` / `patch` / `delete` / `clear`，并明确每类操作所需字段、默认 collection 解析规则和错误行为。
* `patch` operation 第一版采用浅层字段 patch：只更新 record 顶层字段，嵌套对象按整体替换；路径级 patch 留作后续扩展。
* 现有 custom `memoryRecords` 写入路径应支持 `patch` operation，避免 contracts 已声明但 `memory-write` executor 底层不识别。
* 在 `packages/memory-core` 中提供可导出的默认 AIRP 事件-档案 schema/config，覆盖 runtime memory 的 events、archives、globals 模型表达。
* 在 `packages/memory-core` 中提供 schema / operation 校验能力，供后续 workflow executor 和 UI 编辑器复用。
* 保持第一阶段兼容路径可用，不要求本任务替换 `MaintenancePatchDocument` 或重写 `runtime-host/retrieval.ts`。
* 文档中明确 `apply-patch` 是兼容层，后续通用写入应走 schema validate + memory write operation。

## Acceptance Criteria

* [ ] contracts 中存在可复用的 memory schema / collection / field / relation / index / render metadata 类型定义。
* [ ] contracts 中的 `MemoryWriteOperation` 能表达 `upsert` / `patch` / `delete` / `clear`，并避免事件-档案专用字段。
* [ ] 现有 custom memory collection 写入路径支持浅层 `patch`，但不迁移默认事件-档案写入链路。
* [ ] `packages/memory-core` 提供默认 AIRP 事件-档案 schema/config，而不是只存在于 `MaintenancePatchDocument` / retrieval 硬编码里。
* [ ] `packages/memory-core` 的 schema / operation 校验覆盖必填字段、字段类型、未知 collection、未知字段、非法操作类型等失败路径。
* [ ] 不新增事件-档案专用 workflow 节点类型。
* [ ] `apply-patch` 兼容层行为不被扩大。

## Definition of Done

* `packages/memory-core` has a Vitest test setup for schema and operation validation.
* `npm run build:contracts` passes.
* `npm run build:memory-core` passes.
* `npm run test --workspace @tsian/memory-core` passes.
* If platform-web imports default schema or validation helpers, `npm run build:web` passes.
* Specs/docs updated for the new memory schema and operation conventions.
* The first-stage grey-salt-town play path remains compatible by design; runtime migration is explicitly deferred if not implemented.

## Out of Scope

* 不在本任务中要求灰盐镇维护 AI 输出从 `MaintenancePatchDocument` 迁移到 generic `MemoryWriteOperation`。
* 不在本任务中拆分 `runtime-host/retrieval.ts` 或让默认检索 prompt 可编辑化。
* 不实现子工作流或高层节点打包。
* 不新增 `event-query`、`archive-query`、`catalog-event-query` 等默认结构专用节点。
* 不做 IndexedDB 物理存储迁移，除非模型定义需要最小测试夹具。
* 不恢复 mod workflow 写入限制。
* 不把 catalog events 纳入本任务 MVP；它属于后续 author-content schema 范围。

## Technical Approach

模型先行建议按小步落地：

1. PR1: 在 contracts 定义 schema 类型，保持 contracts type-only。
2. PR2: 扩展 `MemoryWriteOperation` 类型到 `patch`。
3. PR3: 新增 `packages/memory-core`，导出默认 AIRP schema/config、operation 规范化和校验 helper。
4. PR4: 给 `packages/memory-core` 增加 Vitest 测试配置，并覆盖 schema / operation 校验路径。
5. PR5: 将相关注释、spec 和 workflow node 文档更新为“schema validate + memory write”方向；保留当前 runtime 兼容路径。

## Decision Log

### Scope: Model First

**Context**: 第二阶段可以选择直接迁移灰盐镇运行链路，也可以先稳定通用 schema / operation 抽象。直接迁移会同时触碰维护 AI 输出、存储、workflow executor、retrieval 和 debug trace，风险过大。

**Decision**: 第二阶段采用模型先行。先定义 contracts-level 模型、默认 AIRP schema/config 和校验能力；运行时纵向迁移后续单独开任务。

**Consequences**: 本任务的主要产出是稳定契约和默认 schema 表达，而不是替换现有运行时写入路径。后续迁移任务可以基于这些契约改造 `memory-write` executor、维护 AI 输出和检索链路。

### Default Schema Ownership: Memory Core Built-in Constant

**Context**: 默认 AIRP schema 需要成为通用契约基准，而不是平台或灰盐镇私有实现。后续平台资源和模组配置可以覆盖或扩展它，但基础模型需要稳定、可测试、可跨包复用。

**Decision**: contracts 只定义 schema 类型；默认 AIRP 事件-档案 schema 值放在新的 `packages/memory-core` 中，作为可导出的 canonical built-in schema/config。

**Consequences**: contracts 保持 type-only，`memory-core` 承载默认 AIRP schema 值和 validator。平台资源化和模组覆盖留给后续任务。

### Field Model Shape: Lightweight Project Schema

**Context**: 当前 workspace 没有 zod / ajv 依赖，现有边界校验主要是手写解析和 fail-loud 错误。完整 JSON Schema 会引入新依赖或要求实现复杂子集解释器，容易让模型先行任务失焦。

**Decision**: Schema 字段模型采用项目自定义的轻量字段描述，而不是 JSON Schema 子集或完整 JSON Schema。

**Consequences**: 第一版模型更贴合现有代码风格，能支撑 UI 展示和 operation 校验。字段描述必须保持可扩展：后续可以添加更丰富的 constraint、render metadata、迁移信息，必要时再提供 JSON Schema 导入/导出适配，而不是现在绑定 JSON Schema validator 生态。

### Patch Semantics: Shallow Field Patch

**Context**: `MemoryWriteOperation` 需要新增 `patch` 类型。当前维护 patch 的 event/archive 更新主要是对象字段级 `set`，而 globals 桥 API 虽支持点路径，但会先转成嵌套对象再交给维护 patch applier。路径级 patch 会引入路径解析、数组处理、冲突规则和转义规则，超出模型先行 MVP。

**Decision**: 第一版 generic `patch` operation 采用浅层字段 patch，只更新目标 record 的顶层字段；嵌套对象作为整体替换。

**Consequences**: operation 语义简单、可预测，方便 contracts-level validator 覆盖。未来如果需要嵌套路径更新，可新增 `path-patch` operation 或 `patchMode: "path"`，不改变第一版浅层 patch 的含义。

### Relation Model: Field Metadata

**Context**: 默认 AIRP 结构已经有关系字段，例如 `events.entityArchiveIds -> archives.id`、`archives.linkedArchiveIds -> archives.id`。第一版需要给后续关系展开和 UI 链接留下模型基础，但不应提前实现独立图存储或复杂图查询。

**Decision**: Collection 间关系作为字段元数据表达，不在 schema 顶层单独建 relation graph。

**Consequences**: 关系定义贴近现有存储字段，validator 和 UI 可以基于字段元数据识别可链接字段。后续如需图查询或关系索引，可以从字段 relation metadata 派生，而不是现在维护独立关系表。

### Unknown Fields: Strict by Default With Collection Opt-in

**Context**: Schema 校验需要能捕获拼错字段和非法输出，但 AIRP 记忆也需要支持模组扩展。当前 `ArchiveRecord` 允许额外 JSON 字段，说明完全严格会压缩扩展空间；完全宽松又会削弱 schema 的错误发现能力。

**Decision**: Operation 校验默认拒绝未知字段；collection 可以显式配置 `additionalFields`，允许额外 JSON 字段进入该 collection。

**Consequences**: 默认行为更安全，模组或默认 archive 这类需要扩展的 collection 可以明确 opt in。Validator 必须分别测试 unknown field reject 与 additional fields allow 两条路径。

### Default Schema MVP: Exclude Catalog Events

**Context**: `CatalogEventRecord` 属于 `ModStaticContent.eventCatalog`，是作者/模组静态内容。当前默认检索会读取 catalog events，但它们不是存档运行时 memory 写入对象，生命周期不同于 events / archives / globals。

**Decision**: 默认 AIRP schema 第一版只覆盖 runtime memory 的 events、archives、globals；catalog events 不纳入本任务 MVP。

**Consequences**: 本任务保持聚焦，不把 runtime memory schema 与 author content schema 混在一起。Catalog events 留到后续“静态内容 schema / author content schema”任务中处理。

### Runtime Schema Ownership: Memory Core Package

**Context**: `packages/contracts` 明确是 type-only 包，规范禁止 runtime helper、validator、依赖或导出的运行时常量。`packages/runtime-core` 当前也是 `RuntimeEngine` 接口包，不适合承载通用 memory 实现逻辑。

**Decision**: 新增 `packages/memory-core`。contracts 定义类型；memory-core 依赖 contracts，导出默认 AIRP schema/config、schema/operation validator，并拥有 Vitest 测试。

**Consequences**: 保留跨包 canonical schema 与 validator，同时不破坏 contracts 的 type-only 边界。Definition of Done 增加 `npm run build:memory-core` 和 `npm run test --workspace @tsian/memory-core`。

## Technical Notes

* Previous PRD: `.trellis/tasks/archive/2026-06/06-04-generic-memory-workflow-nodes/prd.md`
* `packages/contracts/src/runtime.ts` defines current `JsonValue`, `MemoryRecord`, `MemoryWriteOperation`, `MaintenancePatchDocument`, `EventRecord`, and `ArchiveRecord`.
* `packages/contracts/src/workflow.ts` defines current `memory-query` / `memory-write` node config shapes.
* `apps/platform-web/src/storage/memory.ts` applies existing generic memory operations to `memoryRecords`.
* Existing custom memory operation storage is updated to recognize shallow `patch` so runtime behavior stays aligned with the expanded operation contract.
* `apps/platform-web/src/workflow-host/executors/memory-write.ts` is the current generic memory write executor boundary.
* `apps/platform-web/src/workflow-host/executors/memory-query.ts` still branches on `event-archive`.
* `apps/platform-web/src/runtime-host/retrieval.ts` remains the hardcoded default AIRP retrieval and prompt assembly path.
* Root/package dependencies do not include zod or ajv; introducing JSON Schema validation would add a new dependency or require a custom subset interpreter.
* Current `MaintenancePatchDocument` semantics are mostly object field-level `set/create` for events and archives; `bridge.updateGlobals()` accepts a dot path but lowers it into nested `globals.set` before calling the same patch applier.
* `CatalogEventRecord` lives under `ModStaticContent.eventCatalog`, so it is author/static mod content rather than runtime memory.
* `packages/contracts` is explicitly type-only: `CLAUDE.md` and `.trellis/spec/contracts/backend/*` both say not to add runtime helpers, validators, dependencies, or exported values there.
* `packages/runtime-core` is also a tiny interface package for `RuntimeEngine`; it is not currently a general runtime implementation package.

## Open Questions

* None.
