# Workflow Run Trace and Debug UI

## Goal

把现有“当前轮工作流节点输出快照”升级为可复盘的 workflow run trace，让用户和开发者能在调试页看清一次 AIRP 回合使用了哪个 workflow、节点如何执行、每个节点消费/产出了什么摘要、错误发生在哪里，以及后续记忆链条节点化前的观测基础是否可靠。

## What I Already Know

* 路线文档把近期顺序排为：存档级 workflow preset override → 节点输入/输出 schema 与语义槽 → workflow run trace 和调试 UI。
* 存档级 workflow preset override 已完成，并在 journal 中记录为 Session 4。
* 节点输入/输出 schema 与语义槽任务已完成，并在 journal 中记录为 Session 5。
* `packages/workflow-engine/src/scheduler.ts` 当前支持 `outputsHooks`，会在节点 init/start/succeed/fail/abort/result 时写入状态。
* `apps/platform-web/src/workflow-host/outputs-store.ts` 当前维护每轮 `WorkflowOutputsSnapshot`，包含节点状态、outputs、results、turn。
* `packages/contracts/src/debug.ts` 已有 `WorkflowOutputsSnapshot` / `NodeOutputState` 调试契约。
* `packages/contracts/src/bridge.ts` 的 `DebugBridge.subscribeWorkflow` 只暴露当前轮工作流输出快照，暂无 run-level trace API。
* `apps/platform-web/src/bridge/debug.ts` 已把内部 Vue ref 转成框架无关的 callback bridge。
* `apps/platform-web/src/views/DebugView.vue` 已有 `/debug` 页面，能显示 workflow 节点状态、outputs、results、retrieval debug、AI debug、patch 输出、history/events/archives/checkpoints。
* `apps/platform-web/src/platform-host/index.ts` 的 `resolveWorkflowForSave` 已返回 `source`，能区分 `save-override`、`mod-preset`、`legacy-mod-workflow`、`platform-default`，但执行路径目前只取 `def` 和 `isModWorkflow`。

## Assumptions (Temporary)

* MVP 应优先增强现有 `/debug` 和 `bridge.debug`，不新建独立调试系统。
* run trace 首版只保留当前激活存档的当前/最近一轮，不先做最近 N 轮历史或长期持久化历史库。
* trace 应避免把大型 prompt、完整 runtime snapshot、全量 archives 默认铺开；UI 可展示摘要，并允许按需展开已有 outputs。
* trace 是观测能力，不改变 workflow 执行语义、不强化 runtime schema 校验。

## Open Questions

* None.

## Requirements (Evolving)

* 记录 workflow run metadata：turn、run id 或等价唯一标识、save id、workflow source、workflow name/preset id、是否 mod workflow、开始/结束时间、总体状态。
* 记录节点级 trace：节点 id、节点 type、状态、开始/结束时间、耗时、输入摘要、输出摘要、错误信息。
* MVP 只保留当前/最近一轮 trace；后续再扩展为当前存档最近 N 轮或 IndexedDB 持久化历史。
* 节点卡片默认展示输入/输出摘要，包含端口名、值类型、长度/条目数等可快速扫描的信息。
* 节点原始 inputs/outputs 仍可按需展开查看 JSON，但不默认铺满页面。
* MVP 只追踪已经解析出 workflow definition 并进入执行阶段的 run；workflow preset 缺失等 pre-run 解析失败继续走现有 fail-loud 错误路径。
* 在 `/debug` 的 workflow 面板展示 run metadata，并让节点卡片更清楚地对应执行顺序、输入/输出和失败。
* 复用现有 `WorkflowOutputsSnapshot` / `outputsHooks` / `DebugBridge` 路径，保持 bridge 只读观测。
* 保持旧的 `bridge.query("workflow-debug")` 路径兼容，除非明确决定迁移。

## Acceptance Criteria (Evolving)

* [ ] 完成一轮工作流后，调试页能显示 workflow 来源（存档覆盖 / 模组预设 / 旧 manifest workflow / 平台默认）、turn、开始/结束时间、总体状态。
* [ ] 调试页能按节点展示执行状态、耗时、输入摘要、输出摘要和错误。
* [ ] 调试页默认不展开大型 inputs/outputs；用户可手动展开查看原始 JSON。
* [ ] 工作流失败时，trace 保留失败节点、错误信息和已完成节点状态；失败回滚 runtime 不会清空本轮失败 trace。
* [ ] 快速开始新一轮导致旧轮 abort 时，trace 不把已成功节点错误标记为 aborted。
* [ ] 缺失 workflow preset 等执行前解析失败不要求出现在 workflow run trace 中。
* [ ] `npm run build:web` 通过。
* [ ] 若 contracts 或 workflow-engine 类型变更，`npm run build:contracts` / `npm run build:workflow-engine` 通过。

## Definition of Done

* Tests added/updated where practical for trace shape or workflow debug bridge behavior.
* Lint / typecheck / relevant package builds pass.
* `.trellis/spec` reviewed before implementation.
* If the final design creates reusable debug/trace conventions, update relevant spec docs.

## Technical Approach Options

### Approach A: Extend Current Snapshot In Place (Recommended MVP)

Add run metadata and node input summaries to the existing workflow debug snapshot path. `createOutputsStore` or a nearby trace wrapper receives run metadata from `platform-host`, scheduler hooks update node state, and `/debug` renders the richer snapshot.

Pros:
* Lowest integration cost.
* Reuses current bridge subscription and UI update flow.
* Keeps the trace tied to the active run lifecycle.

Cons:
* Less suitable for multi-run history unless extended later.
* Snapshot shape becomes broader and needs careful contract naming.

### Approach B: Separate WorkflowRunTrace Store

Create a separate in-memory trace store keyed by save id / turn / run id. The existing outputs store remains node-output focused, and `bridge.debug` gains a `getWorkflowRunTrace` / `subscribeWorkflowTrace` path.

Pros:
* Cleaner domain boundary between live outputs and replayable trace.
* Easier to support recent N runs later.

Cons:
* More plumbing and UI state.
* Requires bridging old `workflow-debug` and new trace data.

### Approach C: Persisted Trace History

Store workflow traces in IndexedDB per save and expose recent history in debug UI.

Pros:
* Best replay/debug value across reloads.
* Supports comparing runs.

Cons:
* Larger storage/privacy/sanitization surface.
* Premature before trace shape stabilizes.

## Recommended Decision

Start with Approach A. The MVP keeps only the current/latest run trace, which matches the existing live debug architecture and keeps this task focused on observability rather than persistence infrastructure.

## Decision (ADR-lite)

**Context**: The existing debug path already exposes the current turn's workflow output snapshot. Multi-run history would require a separate trace store and more UI navigation before the trace shape has stabilized.

**Decision**: MVP keeps only the current/latest workflow run trace. Recent N runs and persisted history are explicitly deferred.

**Consequences**: Implementation can reuse the current subscription/query path. Users can inspect the latest run, including failures, but cannot compare older runs after a newer turn replaces the snapshot.

## Decision (ADR-lite): Node Data Display

**Context**: AIRP workflow node values can include large prompt text, history slices, retrieval payloads, and maintenance patches. Showing everything inline by default would make the debug page hard to scan.

**Decision**: Node inputs/outputs display summarized values by default, with manual expansion for raw JSON.

**Consequences**: The UI remains readable for normal debugging while still allowing detailed inspection when a node-level prompt, patch, or transformed value must be examined.

## Decision (ADR-lite): Pre-run Failures

**Context**: Missing workflow preset errors occur before `executeWorkflow` starts and before node output state exists. Folding them into run trace would require a separate pre-run error model.

**Decision**: MVP does not include workflow resolution failures in run trace. The trace starts once a workflow definition has resolved and execution is about to begin.

**Consequences**: The task stays focused on execution observability. Pre-run failures remain visible through existing fail-loud surfaces and can be unified later if error UX becomes a priority.

## Technical Approach

Use Approach A: extend the current live workflow debug snapshot path.

* Add run metadata to the workflow debug snapshot contract: run id, save id, turn, workflow source, workflow name/preset id, `isModWorkflow`, started/finished timestamps, and overall status.
* Extend node state or adjacent trace state to capture summarized inputs plus raw input/output payloads for optional expansion.
* Pass workflow source metadata from `resolveWorkflowForSave` into the output/trace store when creating the current turn store.
* Extend scheduler hooks or the run-node plumbing so target node inputs are visible to the trace writer before executor execution.
* Update `DebugView.vue` to show run metadata and summarized node inputs/outputs while preserving raw JSON expansion.
* Keep `bridge.debug.subscribeWorkflow` and legacy `bridge.query("workflow-debug")` compatible with the richer snapshot shape.

## Implementation Plan

1. Contracts and store shape: extend debug contracts and outputs store with run metadata plus value-summary helpers.
2. Scheduler/platform plumbing: capture node inputs at execution time and pass workflow source metadata from platform-host into the store.
3. Debug UI: render run metadata, execution order, node input summaries, output summaries, errors, and raw JSON expanders.
4. Verification: run package builds/tests required by touched layers and adjust specs if new reusable trace conventions emerge.

## Expansion Sweep

### Future Evolution

* Recent N run history could compare different workflow presets or failed/successful attempts.
* Declared input/output schema can later label trace inputs/outputs with semantic slot names and value types.

### Related Scenarios

* Resource-library workflow preset preview/edit mode should eventually benefit from the same node labels and metadata.
* Future memory nodeization work should use this trace as the primary validation surface.

### Failure and Edge Cases

* Workflow failure currently rolls runtime state back and clears retrieval debug; failure trace should remain visible enough to diagnose.
* Node outputs may contain large prompt text or patch documents; UI should avoid making the panel unusable by default.
* Missing workflow preset errors can happen before `executeWorkflow`; decide whether those pre-run failures belong in this trace task or existing error surfaces.

## Out of Scope (Proposed)

* Long-term persisted trace history across app reloads.
* Full workflow replay.
* Workflow resolution / pre-run failure trace for missing workflow presets.
* Runtime type enforcement or JSON Schema validation.
* Replacing retrieval / maintenance / apply-patch with first-class workflow nodes.
* New visual graph debugger beyond the existing `/debug` page.

## Technical Notes

* Direction docs: `docs/active/airp-workflow-platform-direction.md`, `docs/active/implementation-plan.md`.
* Current debug contracts: `packages/contracts/src/debug.ts`, `packages/contracts/src/bridge.ts`.
* Current scheduler/hooks: `packages/workflow-engine/src/scheduler.ts`, `packages/workflow-engine/src/types.ts`.
* Current output state: `apps/platform-web/src/workflow-host/outputs-store.ts`.
* Current debug bridge: `apps/platform-web/src/bridge/debug.ts`.
* Current debug UI: `apps/platform-web/src/views/DebugView.vue`.
* Workflow resolution source metadata: `apps/platform-web/src/platform-host/index.ts`.
