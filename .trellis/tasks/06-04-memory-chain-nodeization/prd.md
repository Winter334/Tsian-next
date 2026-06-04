# 记忆链条节点化

## Goal

将当前硬编码在平台运行链路中的记忆系统能力，逐步沉淀为工作流系统可以自然表达、配置、追踪和替换的节点能力。此次任务的目的不是简单把现有逻辑包成几个节点，而是补全工作流节点模型，使现有事件/档案记忆系统能作为官方参考实现融入工作流，并为玩家调整、更换、移除或自建其它记忆系统保留清晰边界。

## What I Already Know

* 当前已完成近期路线前三步：存档级 workflow preset override、节点输入/输出 schema 与语义槽选择、workflow run trace 和调试 UI。
* 第四步方向是将当前记忆链条逐步节点化，包括 retrieval、memory compose、maintenance、patch normalize、apply patch。
* prompt preset 不拆成独立工作流节点；prompt preset 继续作为资源，由 AI 节点通过 `presetId` 引用。
* 当前目标强调工作流系统能力完善，而不是为记忆系统新增第二套并行架构。
* 完成后，玩家应能在工作流层面对记忆系统进行调整、更换、移除，甚至实现另一套记忆链路。
* 当前默认工作流已经声明 `retrieval -> chat -> reply` 与 `chat/retrieval -> maintenance -> applyPatch` 链路，但 `retrieval` 仍通过 host 入口硬跑后注入 `__retrieval.raw` bypass。
* `apply-patch` 已经是正式节点，并与桥 API 共用 `applyMaintenancePatch`，但当前校验器禁止 mod workflow 注册 `apply-patch`，由 host 负责托管 patch 应用安全边界。
* 存档级 workflow preset override 以 `isModWorkflow=false` 运行，和 mod 打包声明的 workflow 有不同安全身份；这可能是支持玩家自定义写入节点，同时继续限制 mod 自动携带写入能力的关键边界。
* 用户确认：如果目标是允许更换记忆系统，模组开发者需要有能力改变记忆结构；未来不应只支持当前默认的事件/档案架构，也应能支持关键词/正文片段/摘要等其它结构。

## Assumptions (Temporary)

* MVP 会优先表达现有事件/档案记忆系统的官方链路，而不是同时实现通用 MemoryStore 插件平台。
* 新节点应能复用已有运行时状态、安全边界、debug trace、输入/输出语义槽和资源库引用能力。
* 现有默认工作流需要继续保持可运行，并以新节点替代硬编码阶段。

## Open Questions

* 无。

## Requirements (Evolving)

* 工作流必须能显式表示当前记忆链路的关键阶段。
* 记忆链路节点应具备可配置、可调试、可替换的输入/输出边界。
* AI 节点继续引用 prompt preset 资源，不新增单纯的 preset 节点。
* 平台必须保留存储、checkpoint、回滚、迁移和最终状态写入等安全边界。
* retrieval 不应继续依赖 `ai-call.bypass` 和 `__retrieval.raw` 这种 host 注入过渡机制。
* 新节点能力应服务于“官方事件/档案记忆系统可表达”，同时允许其它记忆结构通过受控存档级存储进入工作流，而不是强行塞进事件/档案内核。
* mod/workflow 需要能声明或使用自己的记忆结构，但写入必须经过平台受控 API，以便 checkpoint、回滚、迁移和 debug trace 仍然可靠。
* MVP 纳入最小通用 save-scoped memory store，用于支持非事件/档案架构；完整 MemoryStore 插件平台仍然不在本任务范围内。
* 工作流主要面向高级玩家/作者；MVP 优先提供可组合的底层节点原语，而不是同时维护底层节点和高层官方记忆节点两套抽象。
* 高层记忆能力未来更适合通过“工作流块/子图打包”提供，将一组已拼好的底层节点封装成可复用块；MVP 不实现工作流块打包。
* 默认事件/档案记忆链路迁移后要求功能等价，不要求 prompt 字符串、候选排序或 debug 细节完全逐字一致。
* MVP 底层节点集合包含 `memory-query`、`memory-write`、`template-compose`；现有 `ai-call`、`compute`、`apply-patch` 保留。
* `compute` 作为高级逃生口保留，但默认记忆链路不应依赖 compute 承担主要 compose 逻辑。

## Acceptance Criteria (Evolving)

* [x] 默认工作流可以通过显式节点运行现有记忆链路。
* [x] 用户可以在工作流中看到并调整记忆相关节点。
* [x] workflow trace 能展示记忆相关节点的输入、输出和关键副作用。
* [x] 移除或替换记忆节点时，工作流行为有明确结果，不依赖静默 fallback。
* [x] 默认工作流不再需要 retrieval bypass 才能给 chat/maintenance 提供记忆上下文。
* [x] 工作流可以通过受控节点读写至少一种非事件/档案的自定义记忆 collection。
* [x] 自定义记忆 records 纳入 checkpoint/rollback 的一致性边界。
* [x] 迁移后的默认事件/档案链路保留核心信息处理能力：直接实体、当前事件、事件链、语义检索、相关档案、hint entities 和可诊断 debug 信息。
* [x] 工作流编辑器可以创建和配置 `memory-query`、`memory-write`、`template-compose` 节点，并展示其输入/输出语义槽。

## Definition of Done

* Tests added/updated where behavior changes.
* Lint / typecheck pass.
* Docs/notes updated if workflow or memory behavior changes.
* Rollout/rollback considered for default workflow migration.

## Out of Scope (Explicit)

* 不在本任务中把 prompt preset 拆成独立工作流节点。
* 不在本任务中建设完整 MemoryStore 插件平台或任意外部存储插件机制。
* 不在本任务中并行实现第二套完整记忆架构。
* 不在本任务中实现工作流块/子图打包，也不维护一套与底层原语平行的高层记忆节点体系。

## Decision (ADR-lite)

**Context**: 仅把当前事件/档案记忆链条节点化，无法满足“模组开发者可替换记忆结构”的目标；其它记忆模型如关键词/正文片段、摘要块、向量片段和规则状态表需要自己的存储结构。

**Decision**: 本任务 MVP 纳入最小通用 save-scoped memory store。事件/档案系统继续作为官方参考实现，但工作流应能通过受控平台 API 读写自定义记忆 collection。

**Consequences**: 任务范围从单纯节点化扩大到存储、checkpoint、rollback、trace 和节点能力的协同调整；但仍不做完整 MemoryStore 插件平台、外部存储适配器或任意自定义 executor。

### Node Abstraction Decision

**Context**: 同时维护底层通用记忆节点和高层官方记忆节点，会扩大实现与文档维护成本。工作流编辑本质面向高级玩家/作者，普通玩家更多只会调整参数、提示词或选择已有 workflow preset。

**Decision**: MVP 采用底层可组合节点原语优先的设计。官方记忆链路以 workflow preset / 示例链路体现；未来若需要降低使用门槛，再用工作流块/子图打包把一组节点封装成高层块。

**Consequences**: MVP 的编辑体验会更偏高级作者；但抽象层更少，替换记忆结构更自然，也避免过早固化官方事件/档案系统为专门高层节点。

### Compatibility Decision

**Context**: 当前事件/档案记忆系统的价值主要来自信息处理、存储和检索流程，而不是某个 prompt 字符串或候选排序的字面稳定性。

**Decision**: MVP 追求功能等价。迁移后应保留直接实体、当前事件、事件链、语义检索、相关档案、hint entities 和 debug 可诊断性，但不要求输出文本、排序和内部 debug 记录逐字一致。

**Consequences**: 实现可以围绕新的底层记忆原语重组，而不必机械拆分当前 `assembleRetrievalContext`；同时需要用测试覆盖核心信息类别，防止迁移后记忆效果明显退化。

### MVP Node Set Decision

**Context**: 如果只提供 `memory-query` / `memory-write`，默认链路很容易把 prompt 拼装和结构转换塞进 `compute`，导致关键链路不可读、不可配置、不可稳定调试。

**Decision**: MVP 新增三个底层工作流节点：

* `memory-query`: 查询 save-scoped memory collection，支持默认事件/档案源与自定义 collection。
* `memory-write`: 通过平台受控 API 写入自定义 memory records，并纳入 checkpoint、rollback 和 trace。
* `template-compose`: 将 query 结果、上下文变量和输入值组合成 prompt 片段、文本或 JSON 输出。

**Consequences**: 默认记忆链路能以低层原语表达，不需要新增高层官方记忆节点；高级作者仍可用 `compute` 做特殊转换，但默认链路应保持可读。

## Technical Approach

* Add a save-scoped memory records storage layer with namespaced collections for custom memory structures.
* Extend checkpoint/rollback to include custom memory records.
* Extend workflow contracts, validator, executor registry, editor registry, node schema and trace outputs for `memory-query`, `memory-write`, and `template-compose`.
* Remove the default workflow's retrieval bypass by expressing retrieval context production through workflow nodes.
* Preserve current event/archive memory behavior at functional-equivalence level.
* Keep prompt preset as a resource referenced by `ai-call`; do not add preset nodes.

## Implementation Plan

* PR1: Add contracts/storage/checkpoint support for save-scoped memory records.
* PR2: Add workflow node types, executors, validation, editor registry/schema, and trace support for `memory-query`, `memory-write`, `template-compose`.
* PR3: Rework default workflow to use explicit memory nodes and remove retrieval bypass.
* PR4: Add focused tests for storage rollback, node execution, workflow validation, and functional-equivalence memory outputs.

## Technical Notes

* Direction doc: `docs/active/airp-workflow-platform-direction.md`.
* `ai-call` 当前通过 `config.presetId` 引用 prompt preset 资源。
* `apps/platform-web/src/platform-host/index.ts` 当前在 `sendMessage` 入口加载 history/events/archives/snapshot 后调用 `assembleRetrievalContext`，并将 retrieval prompt/debug 写入宏和 debug map。
* `apps/platform-web/src/runtime-host/retrieval.ts` 的 `assembleRetrievalContext` 已经聚合 direct/present/catalog/event-chain/semantic/bridge/hint entity，并返回 `{ prompt, debug }`。
* `apps/platform-web/src/workflow-host/default-workflow.ts` 已有 `retrieval` 节点形态，但它是 `ai-call` bypass，不是真正 retrieval executor。
* `apps/platform-web/src/workflow-host/executors/apply-patch.ts` 已经是可复用节点 executor，输出 `appliedArchives/appliedEventIds/globalsChanged/currentTimeChanged`。
* `packages/workflow-engine/src/validator.ts` 当前只允许内置节点类型集合，并禁止 mod workflow 包含 `apply-patch`。
* `apps/platform-web/src/platform-host/index.ts` 中，save-level workflow preset override 会作为 `save-override` 来源运行，并标记 `isModWorkflow=false`；mod manifest 引用的 workflow preset 则标记 `isModWorkflow=true`。
* 当前 IndexedDB schema 只有 events、archives、embeddings、prompt/world/workflow resources 等固定表；没有通用 save-scoped memory records，因此非事件/档案记忆结构目前缺少一等存储位置。

## Implementation Notes

* 默认工作流和灰盐镇内置 workflow seed 已迁移为 `memory-query { source: "event-archive" }`，不再依赖 `__retrieval.raw` bypass。
* 新增 save-scoped `memoryRecords` 表和 `memory-write` 受控写入 helper；自定义记忆 records 已纳入 checkpoint、restore、save deletion 和 patch/write-runtime checkpoint 边界。
* 新增 `template-compose`，避免默认或示例链路把提示片段拼装继续塞进 `compute`。
* 工作流编辑器已支持三个新增节点的 registry、schema、拖拽创建和 inspector 配置。
* 浏览器 smoke 使用 `http://localhost:5177/#/resources` 验证资源预览、全屏编辑器、节点拖拽和 inspector；控制台无错误，网络请求为 200/304。
