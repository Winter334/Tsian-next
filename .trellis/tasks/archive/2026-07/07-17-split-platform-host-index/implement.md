# Implementation Plan: 拆分 platform-host 入口聚合文件

- [x] Read frontend directory/quality specs before implementation.
- [x] Record baseline commit and create `backup/split-platform-host-index-pre-split`.
  - Baseline commit: `8466711c295ff93cd82a44baddb74611ca845c65`.
  - Backup ref: `backup/split-platform-host-index-pre-split`.
- [x] Inventory remaining responsibilities in `platform-host/index.ts`.
  - Found bridge assembly/barrel, workspace action execution, bridge workspace RPCs, resource query dispatch, runtime trace staging/write helpers, formal `interaction.sendMessage` turn lifecycle, bypass `interaction.invokeAgent` queue/adapter, and event finish-reason mapping.
- [x] Compare with existing modules before creating new ones.
  - Existing `workspace-ops.ts` owns resource-manager/studio workspace operations, not active-save bridge/runtime action glue.
  - Existing `host-state.ts`, `game-cards.ts`, `assistant-chat.ts`, `history-turns.ts`, `turn-timeline-collector.ts`, and `workspace-volumes.ts` were reused where applicable.
- [x] Extract runtime trace helpers if still embedded.
- [x] Extract resource query handlers if still embedded.
- [x] Extract workspace action normalization/execution glue if not already in `workspace-ops.ts`.
- [x] Extract AI invocation queue/adapter if it forms a cohesive seam.
- [x] Keep `playFrontendBridge` assembly in `index.ts`.
- [x] Check import cycles and event ordering.
- [x] Run `git diff --check`.
- [x] Run `npm run build:web` after each seam.
  - This child was implemented as one structural extraction seam. Final isolated-worktree build passed after temporarily linking the existing dependency install because the child worktree does not carry `node_modules`.
- [x] Record compatibility notes.

## Final Module Map

- `apps/platform-web/src/platform-host/index.ts`
  - `playFrontendBridge` assembly, public barrel/re-export boundary, and small bridge wiring only.
- `apps/platform-web/src/platform-host/runtime-events.ts`
  - Shared `finishReasonToKind()` mapping for `turn-round-end` / agent invocation events.
- `apps/platform-web/src/platform-host/runtime-traces.ts`
  - Runtime trace JSONL staging/write helpers and workspace file sync for failed trace writes.
- `apps/platform-web/src/platform-host/workspace-actions.ts`
  - Active-save workspace action normalization/execution glue plus bridge `workspace.read/list/search/write` RPC handlers.
- `apps/platform-web/src/platform-host/platform-actions.ts`
  - `platform.runAction` execution for checkpoint actions and workspace action dispatch/error normalization.
- `apps/platform-web/src/platform-host/resource-queries.ts`
  - `query.query` resource dispatch for history, checkpoints, registries, diagnostics, runtime trace, AI debug, and frontend build status.
- `apps/platform-web/src/platform-host/runtime-turn.ts`
  - Formal `interaction.sendMessage` active-save turn lifecycle and abort/stop state.
- `apps/platform-web/src/platform-host/ai-invocation.ts`
  - Bypass `interaction.invokeAgent` queue, invocation adapter, trace path writes, context persistence, and commit-mode handling.

## Compatibility Notes

- `playFrontendBridge` public shape is unchanged; the same methods are wired under `platform`, `query`, `workspace`, `card`, `interaction`, and `debug`.
- Runtime trace path helpers still use `formatRuntimeTracePath()` for formal turns and `formatAgentTracePath()` for bypass calls; trace payload serialization remains `serializeRuntimeTraceEvents()`.
- `interaction.sendMessage` keeps the existing active turn abort behavior, ask-user rejection, staged workspace transaction lifecycle, trace staging before `commitSuccessfulRuntimeTurnForSave()`, after-turn checkpoint behavior, auto-backup scheduling, embedding enqueue, and `turn-debug-ready` emit.
- `interaction.invokeAgent` keeps the same per-agent/slot queue key, bypass no-turn semantics, workspace commit modes, optional context persistence, agent trace path, scene cleanup before workspace-with-checkpoint commits, and failure trace best-effort behavior.
- `platform.runAction` restore/create checkpoint semantics, debug baseline guard, and workspace action actor-level resolution are preserved.
- No focused submodule imports `platform-host/index.ts` or a barrel that imports it back.

## Validation Notes

- `npm --prefix F:/workspace/Tsian-worktrees/platform-host-index run build:web` passed after creating a temporary local `node_modules` junction to `F:/workspace/Tsian/node_modules` for dependency resolution, then removing the junction.
- The build emitted only the existing Rollup/Vite warnings about `@vueuse/core` pure annotations and large chunks.
- Rollback artifacts are generated under `.trellis/tasks/07-17-split-platform-host-index/rollback/` for product source changes only.

## Check-Agent Review

- Result: PASS.
- Scoped changed files confirmed under `apps/platform-web/src/platform-host/**` and `.trellis/tasks/07-17-split-platform-host-index/**`; `task.json` status dirty is expected from task start.
- `platform-host/index.ts` remains the `playFrontendBridge` assembly plus public re-export boundary; public export names match the pre-split export surface.
- Focused modules do not import `platform-host/index.ts`, `./index`, `../index`, or a barrel that imports back.
- Extracted behavior-sensitive bodies were compared against the original `platform-host/index.ts`: `playFrontendBridge` method wiring, `interaction.sendMessage`, `interaction.invokeAgent`, workspace actions, resource queries, runtime trace helpers, checkpoint actions, and event finish-kind mapping are unchanged.
- Rollback patch `.trellis/tasks/07-17-split-platform-host-index/rollback/platform-host-index-revert.patch` applies with `git apply --check`.
- `git diff --check` passed.
- Whitespace scan passed for untracked new files under `apps/platform-web/src/platform-host` and this task directory; `.patch` blank context marker lines were treated as valid unified-diff syntax.
- `npm --prefix F:/workspace/Tsian-worktrees/platform-host-index run build:web` passed using a temporary `node_modules` junction to `F:/workspace/Tsian/node_modules`; the junction was removed after the build.
