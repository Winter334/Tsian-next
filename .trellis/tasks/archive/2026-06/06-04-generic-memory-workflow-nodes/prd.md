# 通用化记忆工作流节点

## Goal

将默认 AIRP 记忆链路中适合工作流化的内容迁入可编辑工作流，并把事件-档案从节点层假设降级为默认 memory schema。工作流节点应表达通用的记忆查询、写入、转换、校验、模板拼装和 AI 调用能力，而不是迫使所有玩家使用事件-档案结构。

## What I Already Know

* 当前默认模组灰盐镇声明了 `manifest.workflow`，运行时会优先使用该 workflow，而不是平台 `defaultWorkflow`。
* 灰盐镇 workflow 当前只显式使用 `memory-query`、`ai-call`、`result`，维护 patch 由 `platform-host` 在 workflow 结束后扫描 `patch` 输出并直接应用。
* 当前 `apply-patch` 节点被 `isModWorkflow` 校验禁止出现在 mod workflow 中，但这种边界不符合目标：写运行时记忆是 AIRP 的基础能力。
* 当前 `memory-query(source: "event-archive")` 是一个高层硬编码检索算法节点；后续可以通过子工作流重新打包为高层节点，但本任务阶段应先拆成可编辑的基础/中层节点。
* 事件-档案是默认 AIRP 记忆系统的数据结构，不应绑定到节点类型。玩家应能通过配置 memory schema 改变记忆结构。

## Assumptions

* 本任务聚焦工作流与记忆系统的架构迁移，不优先处理子工作流能力。
* 默认事件-档案结构仍保留，但作为默认 schema/workflow 示例，而不是节点类型内置假设。
* 安全边界从权限限制转为数据完整性机制：schema 校验、fail loud、checkpoint、可回滚、debug trace。
* 当前 `MaintenancePatchDocument` / `apply-patch` 可作为兼容层保留，但长期应由通用 memory write 操作替代。

## Requirements (Evolving)

* MVP 第一阶段优先处理显式写入链路：取消隐式 host-managed patch 扫描，让默认 workflow 通过显式节点持久化运行时记忆。
* 第一阶段复用现有 `apply-patch` / `MaintenancePatchDocument` 作为兼容写入节点，不在本阶段直接引入通用 `memory-write` 操作形态。
* 工作流写运行时记忆应成为普通能力，不再因 mod workflow 来源被一刀切禁止。
* 默认工作流中的写入必须通过显式节点完成，不再依赖 host-managed patch 扫描。
* 节点类型必须围绕通用数据操作设计，避免新增 `event-query`、`archive-query` 这类绑定默认结构的节点。
* 默认 AIRP 的事件-档案记忆结构应被表达为可配置 memory schema。
* 默认检索 prompt 拼装从硬编码函数迁移到可编辑模板/拼装节点是后续任务，不纳入第一阶段 MVP。

## Acceptance Criteria (Evolving)

* [ ] 灰盐镇默认运行链路不再依赖 host 扫描 `patch` 输出来写运行时。
* [ ] mod/default workflow 可以显式声明运行时记忆写入节点。
* [ ] `apply-patch` 在第一阶段被记录为兼容层节点，后续不以它扩展通用记忆写入模型。
* [ ] 本阶段不新增事件-档案专用节点类型，也不扩大 `apply-patch` 的事件-档案耦合。
* [ ] 默认灰盐镇 play path 仍能生成回复、执行维护 patch，并持久化 snapshot/history。
* [ ] workflow-engine / platform-web 相关测试覆盖 resolver、validator、executor、默认 workflow 行为。

## Definition of Done

* Tests added/updated for contracts, workflow-engine, platform-web workflow host behavior.
* `npm run build:contracts` passes if contracts change.
* `npm run test --workspace @tsian/workflow-engine` passes if validator/scheduler behavior changes.
* `npm run build:web` passes if platform-web changes.
* Specs/docs updated for any new workflow node or memory schema convention.
* Existing grey-salt-town default play path still produces reply and persists memory.

## Out of Scope (For Now)

* 子工作流 / 高层节点打包能力。
* 完整第三方 mod marketplace 权限系统。
* 完全替换存储层为通用数据库模型，除非 MVP 必需。
* 为事件、档案、目录事件新增专用节点类型。
* 在第一阶段完整完成通用 memory schema/collection 模型；本阶段只为后续迁移保留方向。
* 默认检索 prompt 可编辑化、检索链路拆分、`runtime-host/retrieval.ts` 算法拆解。

## Decision Log

### MVP Priority: Explicit Write Chain First

**Context**: 当前灰盐镇 mod workflow 不含显式写入节点，platform-host 会在 workflow 结束后扫描任意节点的 `patch` 输出并应用，这让写入路径不透明，也阻碍默认链路完全工作流化。

**Decision**: 第一阶段优先处理显式写入链路。先取消 mod workflow 写入禁令与 host-managed patch 扫描，让默认 workflow 通过显式节点完成运行时记忆持久化。

**Consequences**: 通用 memory schema/collection 模型暂不作为第一阶段主目标，但新增或调整节点时必须避免进一步固化事件-档案结构。

### Write Node Shape: Reuse `apply-patch` As Compatibility Layer

**Context**: 直接引入通用 `memory-write` 操作会把第一阶段扩大到 schema/collection 设计、维护 AI 输出格式和存储迁移；但当前最大的运行时问题是写入路径隐藏在 platform-host 后置扫描中。

**Decision**: 第一阶段复用现有 `apply-patch` / `MaintenancePatchDocument`，只把隐藏写入路径显式化到 workflow 图中。

**Consequences**: 改动范围保持在 validator、默认 workflow、platform-host 和相关测试内。`apply-patch` 只作为兼容层保留，不继续扩展为通用记忆写入模型；后续通用化时将由 `schema-validate -> memory-write` 替代。

### Stage 1 Scope: Defer Retrieval Prompt Editability

**Context**: 默认检索 prompt 可编辑化会牵涉 `memory-query(source: "event-archive")`、`runtime-host/retrieval.ts`、模板能力、默认 prompt 资源和 debug 输出，会显著扩大第一阶段范围。

**Decision**: 第一阶段只处理显式写入链路。默认检索 prompt 可编辑化和检索链路拆分放到后续任务。

**Consequences**: 本阶段保留现有 `memory-query(event-archive)` 高层节点和硬编码检索 prompt；只确保写入路径从 host 隐式扫描迁入显式 workflow 节点。

## Technical Approach

第一阶段以兼容迁移为主：

1. 放宽 workflow validator，让 mod/default workflow 可以显式使用 `apply-patch`。
2. 在灰盐镇默认 workflow 中加入 `applyPatch` 节点，并连接 `maintenance.patch -> applyPatch.patch`。
3. 移除 platform-host 在 workflow 结束后扫描 `patch` 输出并直接应用的逻辑。
4. 更新 contracts 注释、默认模组注释和相关测试，明确 `apply-patch` 是兼容写入节点。
5. 保持 `applyMaintenancePatch()`、维护 AI 输出格式、存储结构和检索逻辑不变。

## Implementation Plan

* PR1: validator/contracts/test 更新，取消 mod workflow 禁止 `apply-patch` 的静态约束。
* PR2: 灰盐镇 workflow 显式加入 `apply-patch`，platform-host 移除 host-managed patch 扫描。
* PR3: 回归测试与构建，确认默认 play path、workflow debug trace、snapshot/history 持久化正常。

## Future Phase Guardrails

第二阶段重新开任务/新会话时，应先读取本 PRD 的 Decision Log 和本节，避免把第一阶段兼容迁移误解为最终架构。

### Phase 2 Intended Goal

设计并落地通用 memory schema / collection / operation 模型，让事件-档案成为默认 schema，而不是节点类型假设。

### Phase 2 Decision Order

1. 定义 memory schema 如何描述 collection、字段、关系、索引、渲染元数据。
2. 定义通用 `MemoryWriteOperation` 如何表达 upsert / patch / delete / clear。
3. 定义通用查询、关系展开、结构转换、schema 校验、模板拼装节点。
4. 将默认事件-档案结构迁移为 schema/config。
5. 再处理默认检索 prompt 可编辑化和 `runtime-host/retrieval.ts` 拆分。
6. 最后再考虑子工作流，把可编辑链路重新打包为高层节点。

### Phase 2 Non-Goals

* 不新增 `event-query`、`archive-query`、`catalog-event-query` 等绑定默认结构的节点类型。
* 不把 `apply-patch` 扩展成通用记忆写入模型；它只作为第一阶段兼容层。
* 不优先做子工作流；子工作流应在基础节点和 schema 模型稳定后再做。
* 不恢复 mod workflow 写入权限限制；写运行时记忆是 AIRP 基础能力。

### Suggested Phase 2 Task Prompt

> 基于 `.trellis/tasks/06-04-generic-memory-workflow-nodes/prd.md` 的 Future Phase Guardrails，设计通用 memory schema / collection / operation 模型，并规划如何把默认事件-档案结构迁移为配置，而不是节点类型假设。

## Technical Notes

* `apps/platform-web/src/platform-host/index.ts`
  * `resolveWorkflowForMod()` 当前优先 `manifest.workflowPresetId`，再 `manifest.workflow`，最后平台默认 workflow。
  * `findHostManagedWorkflowPatch()` 当前会在 mod workflow 无 `apply-patch` 时扫描任意节点的 `patch` 输出并调用 `applyMaintenancePatch()`。
* `builtin/mods/grey-salt-town/src/index.ts`
  * `greySaltTownWorkflow` 当前包含 `memory-query -> chat -> reply` 和 `maintenance`，不含 `apply-patch`。
  * `manifest.workflow` 仍是 legacy 字段，`workflowPresetId` 未使用。
* `apps/platform-web/src/workflow-host/default-workflow.ts`
  * 平台默认 workflow 含 `apply-patch`，但灰盐镇不会走该默认 workflow。
* `packages/contracts/src/workflow.ts`
  * 当前节点类型包括 `ai-call`、`result`、`switch`、`apply-patch`、`compute`、`memory-query`、`memory-write`、`template-compose`。
  * `MemoryQueryNodeConfig` 仍内置 `source: "event-archive" | "collection"`，需要评估是否拆分/泛化。
* `apps/platform-web/src/workflow-host/executors/memory-query.ts`
  * `event-archive` 分支直接调用 `assembleRetrievalContext()`，输出 `prompt/directEntities/archives/debug`。
* `apps/platform-web/src/runtime-host/retrieval.ts`
  * 当前检索排序、catalog event 选择、hint entity、prompt 拼装仍是硬编码算法。
* `apps/platform-web/src/workflow-host/executors/memory-write.ts`
  * 当前写入的是 custom memory collection，不覆盖 `events/archives/globals` 这套维护 patch 写入。

## Open Questions

* 最终确认：第一阶段按上述技术方案进入实现吗？
