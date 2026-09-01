# 标准化工作流节点定义

## Goal

将工作流节点从散落在类型、端口推导、节点注册表、编辑表单和 executor 中的硬编码形态，收束为一套标准节点定义模型。目标是让工作流编辑器更接近“节点是函数、连线是变量传递、工作流是 AIRP 核心内容处理程序”的心智模型，并为后续玩家自定义节点打基础。

## What I Already Know

* 当前用户认可直接移除 `semanticSlot`；项目处于原型期，不需要兼容旧数据或迁移旧 preset。
* 目标心智模型：节点类似函数/方法，`config` 是固定参数，`inputs` 是本轮接收到的变量，`outputs` 是节点产出的变量，边负责把某个输出端口连接到某个输入端口。
* 在标准化后，边不应再承担独立变量名配置；连接到目标输入端口即可表达 `target.inputs[inputPort] = source.outputs[outputPort]`。
* 自定义节点可理解为“compute 节点的标准封装”：一段脚本加一份节点定义清单，使其成为工作流编辑器中的可复用节点。
* 权限、安全沙箱、远程节点、社区审核机制暂不纳入当前实现，也不提前预留字段。
* 子工作流和自定义节点是两个不冲突的方向：自定义节点扩展原子能力，子工作流复用组合能力；本任务聚焦自定义/标准节点定义。
* 状态数据库节点和 AI 调用节点是特殊节点，需要单独讨论如何映射到标准节点定义。AI 调用背后还有从 SillyTavern 提取出来的提示词引擎。
* 用户希望顺带标准化资源锚点定义；状态数据库可视对象属于资源锚点而非真正可执行节点。
* 当前 `result` 节点从实现上是普通可执行节点，但从产品心智上更接近 workflow 输出锚点或 return/export 点。
* 用户预期的结果对象类似状态数据库：可在画布上有多个视觉锚点，但本质是一个 workflow 输出存储区；上游节点按需接入字段，前端从最终结果字段中读取数据并决定如何渲染。

## Assumptions

* MVP 先标准化现有内置节点，不立即开放完整玩家自定义节点创建 UI。
* 自定义脚本节点可以作为后续阶段使用同一标准定义模型承载，不必在第一步做完资源库、安装、分发。
* 状态数据库可视锚点属于工作流状态模型的作者 UI，不一定等同于普通可执行节点。
* AI 调用节点可以标准化外壳，但其 prompt-engine 配置体验可能需要保留专用表单。

## Open Questions

* 是否需要在本任务中定义资源锚点的最小 schema，还是仅将状态数据库锚点现有结构纳入标准术语和 UI 文案？

## Research References

* [`research/special-node-standardization.md`](research/special-node-standardization.md) — 状态数据库视觉节点是作者辅助锚点，不是可执行 DAG 节点；AI 调用、状态查询和状态写入应纳入标准 definition 外壳，但保留专用编辑器/内部执行逻辑。
* [`research/result-anchor-rewrite-impact.md`](research/result-anchor-rewrite-impact.md) — 当前 `result` 深度参与 contracts、validator、scheduler、outputs-store、platform-host、debug UI、默认工作流和测试；彻底改为输出资源锚点可行但属于中等偏大的跨层改造，不建议半迁移。

## Research Notes

### Feasible Approaches

**Approach A: 标准化外壳，保留专用内部** (Recommended)

* How: 所有可执行节点进入统一 definition registry；AI 调用、状态查询、状态写入保留 custom editor 和专用 executor；状态数据库锚点继续作为 `WorkflowStateModel` 作者 UI，不强行变成普通可执行节点。
* Pros: 覆盖核心 AIRP 节点，同时尊重状态模型和提示词引擎的特殊性；范围适中。
* Cons: 第一阶段不会让所有配置表单都完全通用化。

**Approach B: 尽量彻底标准化**

* How: 尽量把 AI 调用和状态相关表单也迁到 definition-driven config fields，只把极复杂子区域保留为 custom editor。
* Pros: 更接近未来玩家自定义节点模型。
* Cons: 首轮范围更大，状态模型感知 selector 和 prompt-engine 资源选择器会拉高复杂度。

**Approach C: 先排除特殊节点**

* How: 只标准化 compute/template/record/switch/result 等普通函数节点，AI 和状态节点后续单独处理。
* Pros: 实现风险最低。
* Cons: 核心 AIRP 节点留在旧模型，无法验证标准定义是否覆盖真实主链。

## Requirements (Evolving)

* 移除端口模型和 UI 中的 `semanticSlot` 概念。
* 定义标准节点 definition，至少描述节点类型、显示信息、输入端口、输出端口、配置字段、默认配置和 executor 引用。
* 将现有节点的散落定义收束到统一 registry，减少 `node-registry`、`node-schema`、`defaultNodeConfig`、diagnostics、inspector form 之间的重复来源。
* 采用“标准化外壳，保留专用内部”方案：所有可执行节点进入统一 definition registry；复杂节点可以声明 custom editor。
* AI 调用节点进入统一 definition registry，但本任务不专项重做其 prompt-engine 配置体验；后续另行优化。
* 状态数据库视觉锚点暂不作为普通可执行函数节点处理；本任务标准化真正参与 DAG 的 `state-query` 和 `state-write`。
* 定义资源锚点标准模型，用于描述画布上非执行、但参与作者编辑和端口绑定的资源对象。初始覆盖状态数据库锚点；评估是否覆盖 workflow 输出/结果锚点。
* 明确 workflow 输出的目标心智模型：它是前端最终渲染数据来源，字段由上游节点写入，前端读取字段并自行决定展示方式。
* 不在本任务中重做 `result` 为 workflow 输出资源锚点；当前重做收益主要是分类更正确，付出涉及跨层 runtime/validator/debug/editor 改造，性价比不足。
* `result` 保留为现有可执行终端输出节点，并纳入标准节点 definition registry。
* 输入端口名和 executor 实际读取的变量名保持一致；例如 `record-filter` 的输入端口名应与 `config.inputVarName` 同步。
* 输出端口名和 executor 实际输出 key 保持一致；例如 `template-compose` 的输出端口名应与 `config.outputName` 同步。
* 边的核心数据结构应收敛为源输出端口到目标输入端口的连接，不再让边独立配置目标变量名。
* 移除边级 `condition` 配置；边只负责传值，条件判断和路由统一由 `switch` 或其它节点表达。
* 保留复杂节点使用专用编辑表单的能力；标准 definition 不应强迫所有节点立刻完全自动表单化。

## Technical Approach

* Introduce a standardized executable node definition registry as the single source for display metadata, default config, input/output port definitions, executor references, and optional custom editor keys.
* Move existing builtin executable nodes into the definition registry. Custom inspector forms can remain, but they should be keyed by the definition instead of being the only source of node behavior metadata.
* Remove `semanticSlot` from contracts, normalization, node display, built-in workflow presets, and output editor UI.
* Collapse edge semantics to port-to-port data flow. A workflow edge should express source output port to target input port only; condition routing belongs in nodes.
* Keep state database visual anchors as resource anchors under `WorkflowStateModel`; standardize their terminology and boundaries without converting them into executable nodes.
* Keep `result` as an executable terminal output node for this task and standardize it like other executable nodes.

## Implementation Plan

* PR1: Add node definition registry and route editor display/defaults/port resolution through it.
* PR2: Remove `semanticSlot`, simplify edge model, and update diagnostics/import/export/runtime scheduler accordingly.
* PR3: Standardize resource anchor terminology for state database and verify builtin workflow/editor/runtime behavior.

## Acceptance Criteria (Evolving)

* [x] 工作流编辑器不再显示或编辑 `semanticSlot`。
* [x] 新建/加载工作流时端口展示来自统一节点 definition 或其动态端口解析。
* [x] 现有内置节点仍可在编辑器中创建、连线、配置、导出和执行。
* [x] 边连接到目标输入端口即可决定运行时输入变量名。
* [x] 工作流边不再有条件配置；现有条件路由能力由节点表达。
* [x] `record-filter`、`record-format`、`record-merge`、`state-write` 等读取指定输入变量的节点，不再出现“连线变量名”和“节点实际读取变量名”分裂。
* [x] AI 调用节点和状态数据库相关 UI 有明确的标准化策略或显式 MVP 边界。
* [x] 资源锚点与可执行节点在类型、定义和 UI 文案上有清晰区分。
* [x] 相关 build/typecheck/tests 通过。

## Definition of Done

* Tests added/updated where behavior changes.
* Lint/typecheck/build checks pass for touched packages.
* Specs or task notes updated if the workflow authoring model changes.
* Any intentionally breaking workflow schema changes are documented in the task.

## Out of Scope

* 权限模型、安全沙箱、社区审核、远程节点执行。
* 子工作流封装。
* 完整玩家自定义节点资源库和分发机制。
* 文生图、语音、外部 API 等新能力节点。
* 为旧工作流/preset 做兼容迁移。
* 将 `result` 重做为 workflow output resource anchor。
* 在边上继续保留条件、脚本、转换等逻辑。

## Technical Notes

* Current task: `.trellis/tasks/06-08-workflow-node-definition-standardization`.
* Current display registry: `apps/platform-web/src/components/workflow/node-registry.ts`.
* Current port resolution: `apps/platform-web/src/components/workflow/node-schema.ts`.
* Current node defaults and edge import/export mapping: `apps/platform-web/src/composables/useWorkflowEditor.ts`.
* Current node editor shell: `apps/platform-web/src/components/workflow/WorkflowNodeEditorDialog.vue`.
* Current inspector forms: `apps/platform-web/src/components/workflow/inspector/*.vue`.
* Current executors: `apps/platform-web/src/workflow-host/executors/*.ts`.
* Current contract comments explicitly say `semanticSlot` is metadata only and not an execution constraint.
* Current scheduler collects edge values into `inputs[edge.to.varName]`; this is the runtime behavior to simplify after edge-to-port semantics are finalized.
* `ai-call` executor currently combines platform macros and node inputs into prompt-engine macros, assembles prompt preset/world books through `@tsian/prompt-engine`, calls AI, then extracts declared output ports from raw text.
* State database visual anchors are represented by `WorkflowStateModel` and are not executable workflow nodes; state query/write executable nodes are compiled from state model links.
* Current `result` executor simply returns `{ value: inputs.value }`; the scheduler then collects each result node's `config.name -> outputs.value` into `WorkflowResult.results`. Platform host currently requires `workflowResult.results.reply` to be a string before appending the assistant message.

## Decision (ADR-lite)

**Context**: AI 调用和状态数据库都是核心 AIRP 编辑对象，但二者特殊性不同。AI 调用是可执行节点，只是配置和执行内部依赖 prompt-engine；状态数据库视觉锚点是状态模型/schema/collection port 的作者 UI，不消耗输入也不产出普通运行时输出。

**Decision**: MVP 采用“标准化外壳，保留专用内部”。所有可执行节点进入统一 definition registry；AI 调用、状态查询、状态写入可以继续使用 custom editor 和专用 executor。状态数据库视觉锚点继续作为 `WorkflowStateModel` 作者辅助资源节点，不强行变成普通可执行函数节点。`result` 保留为可执行终端输出节点，不在本任务重做为输出资源锚点。

**Consequences**: 核心工作流函数模型保持清晰，状态读写由 `state-query` / `state-write` 表达；AI 调用配置体验暂不在本任务重做，后续可专项优化。画布上会存在两类对象：可执行工作流节点，以及作者辅助资源锚点。结果输出继续沿用稳定的 `result -> WorkflowResult.results` 路径，避免为了分类正确引入大范围重写。
