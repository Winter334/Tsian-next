# 清理 AIRP 记忆工作流临时兼容债务

## Goal

系统性 review 今天 AIRP 记忆工作流迁移中留下的临时妥协，先把高风险兼容边界点名、分级，并在本任务内尽量集中清理或正式化，避免后续在默认工作流继续打磨时踩到隐藏地雷。这个任务作为 review 专项，可以比普通实现任务范围更宽，目标是减少为了 review 既有任务产出而继续拆出多个小任务。

## What I already know

* 当前没有 active task，`master` 工作树干净。
* 近期任务已经完成：workflow run trace/debug UI、记忆链条节点化、通用 memory schema/model、`memory-write` schema validation、默认维护写迁移、默认检索混合 workflow preset、`record-filter` / `record-merge` / `record-format` 发布。
* 用户明确担心此前任务因范围限制留下的临时妥协，例如“双写映射”，会在后续成为地雷；希望先 review 并逐个解决这些问题。
* 用户已确认本轮作为 review 专项任务可以扩大范围，尽量少开启任务来 review 之前的任务产出，避免又开启数个任务。
* 当前 default AIRP generic memory authority 是 save-scoped `memoryRecords` 中的 `airp/events`、`airp/archives`、`airp/globals/currentTime`。
* `apps/platform-web/src/storage/airp-memory.ts` 负责 AIRP memory projection、seed replacement、以及 `syncAirpCompatibilityStateForSave()`，这是目前“双写/兼容同步”最集中的实现。
* `platform-host/index.ts` 每轮开始从 `loadAirpMemoryProjectionForSave()` 读 generic AIRP memory，回合成功后调用 `syncAirpCompatibilityStateForSave()` 将 generic memory 投影回 legacy snapshot/events/archives，再创建 checkpoint。
* `createLocalSave` 当前先写 legacy events/archives，再调用 `replaceAirpMemoryForSave()` 生成 generic AIRP memory，初始 checkpoint 同时记录 legacy slices 和 `memoryRecords`。
* `memory-query { source: "event-archive" }` 仍存在于 contracts/executor/editor，当前定位是兼容高层 strategy node；默认工作流不应再依赖它作为黑盒。
* `apply-patch` 仍存在于 contracts/executor/editor/bridge 共享 patch applier，当前定位是 compatibility write node；默认维护链已经改走 `maintenance.operations -> memory-write.operations`。
* `ModManifest.workflow`、旧 prompt/world book manifest 字段、workflow missing `inputs` 等 legacy compatibility 仍在 contracts 和 resolver 中保留，但不一定属于本轮最高风险。
* `docs/active/implementation-plan.md` 明显落后于近期 Trellis 任务；新的真实约定主要在 `.trellis/spec/platform-web/frontend/state-management.md` 和 `.trellis/spec/memory-core/backend/memory-schema.md`。

## Assumptions (temporary)

* 本任务不应该把所有 legacy/compat 项一次性删除；先 review、分类，再在同一个任务内处理所有风险明确且范围可控的问题。
* 新工作流系统升级后，相关 UI/debug/resource/bridge 配套内容应该跟进，不应为了旧配套继续保留主链妥协。
* “清理”不等于无脑删除。仍被当前代码真实消费的兼容边界可以短期保留，但必须服务于明确过渡，而不是反过来约束新工作流主链。
* 第一优先级仍应是 AIRP generic memory 与 legacy runtime slices 的投影/同步，因为它同时影响存档创建、每轮持久化、checkpoint/debug/UI/bridge。
* `apply-patch` 和 `memory-query(event-archive)` 可能仍需要暂留给旧 workflow 或桥 API，但应明确它们不属于新默认 AIRP 主链。

## Open Questions

* None pending final confirmation.

## Requirements (evolving)

* 枚举近期任务留下的临时兼容边界，并区分：正式核心边界、必须暂留的兼容边界、可在本任务清理的临时债务。
* 本任务作为 review 专项，覆盖范围可以同时包含 AIRP memory projection/sync、`apply-patch` compatibility、`memory-query(event-archive)` compatibility、legacy mod/resource fields、debug/docs/spec drift。
* 每个被处理的兼容边界都要有明确 ownership、调用路径、失败行为、测试保护和后续退出条件。
* Review 发现的高风险问题应尽量在本任务内修复；低风险或依赖未来产品决策的问题可以文档化并留下退出条件。
* 本任务不应破坏默认 AIRP 记忆处理、存储、检索闭环。
* 本任务不应重新引入 retrieval bypass、host-managed hidden patch scan、或把普通 record filtering/merging/formatting 藏回 `compute`。
* 如果保留 legacy mirror / projection，应明确 generic AIRP memory 仍是权威，legacy slices 只是兼容投影。
* 如果调整 save seeding / after-turn persistence / checkpoint 行为，必须验证 checkpoint/restore、debug/bridge 读取和默认工作流仍一致。
* Review 时以新 workflow system 为基线：旧 UI、旧 debug、旧资源/manifest 形态如果不再匹配新基线，应优先改造配套内容；确实超出本任务时记录为后续任务候选。
* 不为了旧配套内容保留新的主链妥协；配套内容依赖旧入口时，应把依赖显式记录为待迁移问题。

## Acceptance Criteria (evolving)

* [x] 形成临时兼容债务清单，至少覆盖 AIRP memory projection/sync、`apply-patch` compatibility、`memory-query(event-archive)` compatibility、legacy mod workflow fields、stale docs/spec drift。
* [x] 选定 review 专项的处理策略，并记录为什么本轮选择集中 review 而不是拆出多个子任务。
* [x] 高风险临时兼容边界在代码中要么被清理，要么被正式化为清晰命名的兼容边界。
* [x] 中低风险兼容债务被记录为留存项，包含保留原因、退出条件和未来触发点。
* [x] 发现旧 UI/debug/resource/bridge 配套内容依赖新工作流已废弃路径时，能改则改，不能改则记录为后续任务候选。
* [x] 最终 PRD 或任务记录中包含 follow-up candidate list，避免 review 发现的问题散落在聊天里。
* [x] 新增或更新测试/static proof，防止 generic AIRP memory authority 与 legacy compatibility slices 再次混淆。
* [x] 相关 specs/docs 更新，记录哪些临时妥协已经清掉、哪些仍保留以及退出条件。
* [x] 相关 build/test 通过。

## Definition of Done

* Tests added/updated for changed behavior.
* `npm run build:web` passes for platform-web changes.
* `npm run build:contracts` passes if contract shapes or deprecations change.
* `npm run build:workflow-engine` and `npm run test --workspace @tsian/workflow-engine` pass if workflow validation/static proof changes.
* `npm run build:memory-core` and `npm run test --workspace @tsian/memory-core` pass if schema/default memory behavior changes.
* Specs/docs updated for any compatibility boundary or authority change.
* Rollout/rollback considered for save persistence/checkpoint changes.

## Out of Scope (explicit)

* 不一次性重做完整 MemoryStore/schema resource 系统。
* 不在本任务发布大批新 workflow 节点，除非是 review 发现的兼容债务清理所必需的最小修复。
* 不提前删除所有 legacy bridge/UI/debug consumers。
* 不重写默认 AIRP 检索排名/关系算法，除非 review 证明它和本任务兼容边界直接耦合。
* 不做 IndexedDB 旧数据迁移；原型期仍优先清库/重种。

## Review Areas

### A. AIRP memory projection / compatibility sync

Review and stabilize `replaceAirpMemoryForSave()`、`loadAirpMemoryProjectionForSave()`、`projectSnapshotFromAirpMemory()`、`syncAirpCompatibilityStateForSave()` and new-save seeding/checkpoint paths.

Why first: it is the named "dual write/mirror" concern, it is cross-layer, and mistakes here can make future workflow/debug work observe the wrong authority.

### B. Compatibility workflow nodes and editor surface

Review `apply-patch` and `memory-query(event-archive)` as compatibility nodes: editor visibility, docs, validation, tests, and whether new workflows should be nudged away from them. If editor/debug/resource UI still exposes them as ordinary first-class choices after the new workflow baseline, update the supporting surface or record a follow-up.

### C. Deprecated mod/resource fields

Review legacy `ModManifest.workflow` / prompt preset / world book fields and resource resolution fallback. This is real compatibility debt, but less directly tied to today's AIRP memory authority transition.

### D. Docs/spec drift

Update stale `docs/active/*` route documents or add a current-state handoff that reflects Trellis/spec reality after today's workflow-memory migration. Do not let stale docs become a reason to preserve old runtime behavior.

## Scope Decision (ADR-lite)

**Context**: The previous migration tasks intentionally left some temporary compatibility structures because each task had a narrow implementation boundary. Opening a separate task for every leftover would create too much planning overhead and could hide cross-layer interactions between those leftovers.

**Decision**: Treat this task as a broad review专项. Review the main compatibility/debt areas together, fix high-risk and clearly bounded issues in this task, and document any lower-risk or future-dependent leftovers with explicit ownership and exit conditions.

**Consequences**: The task is wider than a normal single-slice implementation task, so it needs disciplined issue classification and focused fixes. The benefit is that compatibility boundaries can be reviewed as one system instead of being scattered across several small tasks.

## Compatibility Policy Decision (ADR-lite)

**Context**: The workflow system has moved forward. Some adjacent surfaces were left behind because prior tasks were scoped around runtime/workflow migration rather than every UI/debug/resource integration.

**Decision**: Use the upgraded workflow system as the baseline. Do not keep main-chain compromises merely to protect old supporting surfaces. When supporting surfaces lag behind, either update them in this task if bounded, or record a follow-up task candidate with the dependency and desired end state.

**Consequences**: This may expose more follow-up work, but keeps the core architecture from being shaped by stale compatibility. The review should distinguish "must preserve because a current runtime consumer still needs it" from "old surface should migrate."

## Implementation Plan

* [x] PR1: Audit and classify compatibility/debt areas across AIRP memory projection/sync, compatibility workflow nodes, legacy resource/manifest paths, debug/editor surfaces, and docs/spec drift.
* [x] PR2: Fix or formalize high-risk issues that are bounded enough for this task, prioritizing authority confusion around generic AIRP memory versus legacy slices.
* [x] PR3: Update tests/static proofs and specs/docs, including a follow-up candidate list for issues intentionally deferred.

## Review Findings Fixed

* `apply-patch` compatibility writes previously relied on bridge callers to resync generic AIRP memory. The applier now owns `replaceAirpMemoryForSave()` before optional checkpoint creation, so checkpoint memoryRecords cannot lag behind legacy events/archives.
* `apply-patch` and `memory-write` no longer imply node-local checkpoints by default. Their config defaults to `none`; platform after-turn persistence remains the normal checkpoint boundary.
* Built-in Grey Salt Town no longer carries current workflow through deprecated `manifest.workflow`. It references an explicit built-in workflow preset seed by `workflowPresetId`, and resource seeding no longer scans built-in `manifest.workflow`.
* Mod detail preview resolves the workflow preset resource by `workflowPresetId`, so UI follows the new resource baseline instead of the legacy manifest field.
* Workflow editor/debug surfaces now label `apply-patch` and `memory-query(event-archive)` as compatibility paths, expose collection query outputs separately, and show maintenance write outputs from maintenance / memory-write / apply-patch nodes.
* Current Trellis specs, current OpenSpec specs, `apps/platform-web/CLAUDE.md`, and `docs/active/current-state-handoff.md` now state the new baseline and remaining compatibility boundaries.

## Follow-up Candidates

* Migrate prompt preset and world book built-in fields away from deprecated `manifest.presets`, `manifest.worldBooks`, and `ModStaticContent.worldBooks`. Keep current fields until the resource-library import/export and built-in seed path can fully replace them.
* Decide the exit path for `memory-query { source: "event-archive" }`. It remains a compatibility/high-level source for old workflows; remove or quarantine it only after no shipped preset/save path depends on it.
* Decide the exit path for deprecated `ModManifest.workflow`. The current resolver keeps it for historical mods, but built-in mods should not use it. Removal should be paired with a migration/import story.
* Refresh or retire the older long-form `docs/active/*` implementation route docs. The handoff now has a current delta, but several route documents still predate Trellis workflow/memory migration and should not be treated as architectural truth.
* Revisit bridge/frontend manual checkpoint UX. Runtime bridge writes intentionally do not checkpoint; if frontends need explicit manual checkpoints, add a platform action instead of overloading `applyPatch`.

## Verification

* `npm run build:contracts` passed.
* `npm run build:memory-core` passed.
* `npm run test --workspace @tsian/memory-core` passed: 1 file, 10 tests.
* `npm run build:workflow-engine` passed.
* `npm run test --workspace @tsian/workflow-engine` passed: 8 files, 36 tests.
* `npm run build:web` passed. Vite reported only existing third-party `@vueuse/core` PURE annotation warnings.
* Browser smoke passed on `http://127.0.0.1:5174/#/` after starting Vite with the correct package-level args:
  * Lobby rendered.
  * Debug route rendered the "维护写入（maintenance / memory-write / apply-patch）" panel.
  * Grey Salt Town detail workflow tab rendered the seeded mixed AIRP workflow preview with 14 nodes / 24 edges and collection `memory-query` nodes.
  * Console showed only `favicon.ico` 404; no app runtime errors.

## Technical Notes

* Current task: `.trellis/tasks/06-05-airp`.
* Previous task records:
  * `.trellis/tasks/archive/2026-06/06-05-publish-retrieval-primitives/prd.md`
  * `.trellis/tasks/archive/2026-06/06-05-airp-retrieval-workflow-boundary/prd.md`
  * `.trellis/tasks/archive/2026-06/06-05-generic-maintenance-write-migration/prd.md`
  * `.trellis/tasks/archive/2026-06/06-05-airp-workflow-core-coverage/prd.md`
  * `.trellis/tasks/archive/2026-06/06-04-memory-chain-nodeization/prd.md`
  * `.trellis/tasks/archive/2026-06/06-04-generic-memory-model-first/prd.md`
* Relevant specs:
  * `.trellis/spec/platform-web/frontend/state-management.md`
  * `.trellis/spec/memory-core/backend/memory-schema.md`
  * `.trellis/spec/workflow-engine/backend/index.md`
  * `.trellis/spec/contracts/frontend/type-safety.md`
* Candidate code files inspected:
  * `apps/platform-web/src/storage/airp-memory.ts`
  * `apps/platform-web/src/platform-host/index.ts`
  * `apps/platform-web/src/storage/saves.ts`
  * `apps/platform-web/src/workflow-host/default-workflow.ts`
  * `apps/platform-web/src/workflow-host/executors/memory-query.ts`
  * `packages/contracts/src/workflow.ts`
  * `builtin/mods/default-airp-workflow.ts`
  * `builtin/mods/grey-salt-town/src/index.ts`
