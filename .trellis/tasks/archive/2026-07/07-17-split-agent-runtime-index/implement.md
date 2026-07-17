# Implementation Plan: 收敛 Agent Runtime 主编排文件

- [x] Wait until `07-17-split-agent-runtime-workspace-tools` is complete or explicitly deemed unnecessary.
- [x] Read frontend specs and module structure guide.
- [x] Record baseline commit and create `backup/split-agent-runtime-index-pre-split`.
  - Baseline commit / backup ref verified: `7d12a7cd33ca1a22dfa123260d08a57cbb50d2d5`.
- [x] Inventory helper clusters and public exports.
  - Public API preserved in `apps/platform-web/src/agent-runtime/index.ts`: type re-export block from `./turn-types` plus `runAgentRuntimeTurn` export remain unchanged.
  - High-level turn orchestration, delegated agent runner, native/text tool loops, trace emission helpers, collaboration policy normalization, and entry/delegated message builders remain in `index.ts`.
- [x] Extract history/message span helpers.
  - `apps/platform-web/src/agent-runtime/orchestration/history.ts`
- [x] Extract context injection formatting helpers.
  - `apps/platform-web/src/agent-runtime/orchestration/context-injections.ts`
- [x] Extract skill activation message helpers.
  - `apps/platform-web/src/agent-runtime/orchestration/skill-activation.ts`
- [x] Extract loop state helper types/functions only if they do not disturb orchestration readability.
  - No loop state extraction was performed; the native/text loops and turn state stay in `index.ts` to avoid disturbing orchestration semantics.
  - A safe message-formatting helper seam was extracted instead: `apps/platform-web/src/agent-runtime/orchestration/message-formatting.ts`.
- [x] Keep high-level orchestration in `index.ts`.
- [x] Check import cycles.
  - Helper modules import only contracts/runtime-host types, text-tool-protocol, or workspace-tools; none import `agent-runtime/index.ts` or a barrel that imports back into it.
- [x] Run `git diff --check`.
  - `git -C /f/workspace/Tsian diff --check -- apps/platform-web/src/agent-runtime/index.ts apps/platform-web/src/agent-runtime/orchestration` passed.
- [x] Run `npm run build:web` after each seam.
  - Consolidated after the extracted seams: `npm run build:web` passed (`vue-tsc -b && vite build`). Vite emitted existing Rollup PURE annotation and chunk-size warnings only.
- [x] Record moved module map and behavior compatibility notes.

## Module Map

- `apps/platform-web/src/agent-runtime/index.ts`
  - Main public Agent Runtime entry remains here.
  - Keeps `runAgentRuntimeTurn`, entry/delegated model orchestration, native/text tool loops, collaboration policy handling, trace metadata helpers, Agent call runner, and public type re-exports.
- `apps/platform-web/src/agent-runtime/orchestration/history.ts`
  - Extracted `buildAgentContextMessages`, `locateHistorySpan`, `replaceHistorySpan`, and task interaction span helpers used by in-turn compression.
  - Owns `LAYER_PREFIX` and `MessageLike` for span scanning without importing the runtime entry.
- `apps/platform-web/src/agent-runtime/orchestration/message-formatting.ts`
  - Extracted provider-call message cleanup helpers: `mergeConsecutiveRoleMessages` and `stripInternalMarkers`.
- `apps/platform-web/src/agent-runtime/orchestration/context-injections.ts`
  - Extracted context injection message building, Skill Index/context-meta rendering, and fixed layer tags: context meta, tool memory, turn runtime, player input.
- `apps/platform-web/src/agent-runtime/orchestration/skill-activation.ts`
  - Extracted activated Skill full-content message body/injection helpers for native and text tool loops.

## Compatibility Notes

- Runtime message skeleton preserved by inspection:
  - system prompt
  - prelude context meta and prelude injections
  - history messages
  - runtime injections
  - task-mode tool memory
  - turn runtime tag
  - before-input injections
  - player input tag/message
  - after-input injections
  - framing injections at tail
- Context injection position ordering preserved: `buildPreludeMessages`, `buildRuntimeMessages`, and tail `contextInjectionsToMessages(context.contextInjectionsByPosition.framing)` are called in the same positions as before.
- Tool memory / turn runtime / player input tags preserved by moving constants unchanged into `context-injections.ts`.
- Activated skill injection behavior preserved: native path still mutates the runtime message array after tool observations; text path still returns a new array appended after observations; both still use `collectActivatedSkillContents` and full `SKILL.md` content without truncation.
- History span replacement preserved: `locateHistorySpan` still skips `<!-- source: ... -->` and `<!-- tsian-layer: ... -->`, rejects flattened fallback/delegated history, and `replaceHistorySpan` still performs the same splice.
- Public exports preserved: existing consumers continue importing `runAgentRuntimeTurn` and turn types from `../agent-runtime`; no direct consumer import changes were needed.
- Risky seam intentionally left in `index.ts`: native/text tool-loop compression branches and Agent call runner remain in the main runtime entry because extracting them would mix orchestration state and increase semantic-drift risk.

## Validation Results

- `npm run build:web`: passed.
- `git -C /f/workspace/Tsian diff --check -- apps/platform-web/src/agent-runtime/index.ts apps/platform-web/src/agent-runtime/orchestration`: passed.
- Line count after split/check cleanup: `index.ts` reduced to 2013 lines; extracted helper modules total 392 lines.

## Rollback Artifacts

- Pre-child snapshot already exists: `.trellis/tasks/07-17-split-agent-runtime-index/rollback/pre-agent-runtime-index-split-worktree.patch`.
- Final product-source forward patch: `.trellis/tasks/07-17-split-agent-runtime-index/rollback/final-agent-runtime-index-split-forward.patch`.
- Final product-source revert patch: `.trellis/tasks/07-17-split-agent-runtime-index/rollback/final-agent-runtime-index-split-revert.patch`.
- Revert patch verification passed: `git -C /f/workspace/Tsian apply --check .trellis/tasks/07-17-split-agent-runtime-index/rollback/final-agent-runtime-index-split-revert.patch`.

## Check-Agent Review

- Result: PASS.
- Scope verified: child changed files are limited to `apps/platform-web/src/agent-runtime/index.ts`, `apps/platform-web/src/agent-runtime/orchestration/**`, and this task directory; other modified/untracked files in the worktree belong to prior completed child scopes and were not edited for this review.
- Public exports: current `apps/platform-web/src/agent-runtime/index.ts` exports match `HEAD` exactly (`runAgentRuntimeTurn` plus the existing turn/capability/collaboration/compression types).
- Import cycle check: orchestration helper modules do not import `agent-runtime/index.ts`, `./index`, `../index`, or an alias/barrel back into the runtime entry; dependent modules checked for back edges.
- Compatibility inspection passed: entry/delegated runtime skeleton order, context injection positions, tool-memory/turn-runtime/player-input tags, activated Skill full-content injection, history span replacement, and high-level turn orchestration retained in `index.ts`.
- Self-fixes made during review: removed dead exported context formatting helpers from `context-injections.ts`, regenerated final forward/revert rollback patches to match the cleaned split, and added the missing final newline to `task.json`.
- Verification passed: `git diff --check`; scoped patch-aware whitespace scan; `git -C /f/workspace/Tsian apply --check .trellis/tasks/07-17-split-agent-runtime-index/rollback/final-agent-runtime-index-split-revert.patch`; `npm run build:web`.
- Build warnings: existing Rollup warnings for two `/* #__PURE__ */` annotations in `@vueuse/core`, plus Vite chunk-size warnings for chunks over 500 kB.
