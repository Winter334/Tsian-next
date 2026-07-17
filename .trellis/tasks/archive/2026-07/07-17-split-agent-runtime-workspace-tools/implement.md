# Implementation Plan: 拆分 Agent Runtime workspace tools

- [x] Read frontend specs and module structure guide.
- [x] Record baseline commit and create `backup/split-agent-runtime-workspace-tools-pre-split`.
- [x] Inventory current exports and internal clusters.
- [x] Extract pure parsing/normalization helpers first.
- [x] Extract tracing helpers.
- [x] Extract observation formatting helpers.
- [x] Extract controlled action executor helpers.
- [x] Extract agent-call helpers.
- [x] Extract skill-action helpers.
- [x] Convert old file to facade/barrel or keep only orchestration glue.
- [x] Check for circular imports.
- [x] Run `git diff --check`.
- [x] Run `npm run build:web` after each risky seam.
- [x] Record behavior compatibility notes.

## Module Map

- `apps/platform-web/src/agent-runtime/workspace-tools.ts` — compatibility facade preserving the original direct import path and public exports.
- `apps/platform-web/src/agent-runtime/workspace-tools/index.ts` — public barrel for the split workspace-tools modules.
- `apps/platform-web/src/agent-runtime/workspace-tools/types.ts` — re-export bridge to existing `workspace-tools-types.ts`.
- `apps/platform-web/src/agent-runtime/workspace-tools/shared.ts` — shared constants, `toolError`, record guard, string/path normalization, trace base helper, and session-state factory.
- `apps/platform-web/src/agent-runtime/workspace-tools/parsing.ts` — text think-block strip/extract helpers.
- `apps/platform-web/src/agent-runtime/workspace-tools/tracing.ts` — workspace/action/agent trace event payload construction and emission.
- `apps/platform-web/src/agent-runtime/workspace-tools/observations.ts` — turn-tool output shaping plus native/model observation compaction.
- `apps/platform-web/src/agent-runtime/workspace-tools/action-executors.ts` — browser_script executor validation, action policy checks, schema validation, path/helper resolution, timeout/abort handling, Skill and user Tool browser-script execution.
- `apps/platform-web/src/agent-runtime/workspace-tools/agent-call.ts` — `agent_call` argument normalization and history-mode validation.
- `apps/platform-web/src/agent-runtime/workspace-tools/skill-actions.ts` — `tsian-actions` fence parsing, Skill activation/session registration, activated Skill content collection, and `run_script` orchestration.
- `apps/platform-web/src/agent-runtime/workspace-tools/tool-execution.ts` — workspace tool dispatch, ask_user/test/inspect normalization, workspace operation bridge, execution ordering/concurrency policy, and tool event callbacks.

## Validation Notes

- Export/consumer inventory: original consumers continue importing from `./workspace-tools` or `../agent-runtime/workspace-tools`; no consumer import changes were required.
- Circular import check: split submodules do not import `./index`, `../index`, `./workspace-tools`, or `../workspace-tools`; only the compatibility facade imports `./workspace-tools/index`.
- Compatibility inspection: tool names remain sourced from `RUNTIME_WORKSPACE_TOOL_NAMES`; validation/error-code branches were moved without semantic edits; trace event types/data shape (`workspace_tool_called`, `action_called`, `agent_called`, `action_executor_policy_checked`, `skill_loaded`) were preserved; observation compaction and turn-tool output shaping were preserved; execution grouping policy still uses parallel read/use_skill group, concurrent `agent_call` group, and serial stateful group; `agent_call` history/depth/call behavior remains delegated through the existing context runner.
- Rollback artifacts: `rollback/workspace-tools-split-forward.patch` and `rollback/workspace-tools-split-revert.patch` created for this child product-source scope. `git apply --check rollback/workspace-tools-split-revert.patch` passed.
- Commands: `git diff --check` passed. `npm run build:web` passed after one type-only split fix (`InspectDomAction.to` literal cast restored).

## Main-Agent Review

- Rechecked actual changed files: this child touched `apps/platform-web/src/agent-runtime/workspace-tools.ts` plus new `apps/platform-web/src/agent-runtime/workspace-tools/**`; previous child product files were not edited by this child after handoff.
- Compared public export names against `HEAD`: `44/44`; no missing or added public export names.
- Rechecked split module boundaries: no submodule imports the public facade/barrel or `./index`/`../index`.
- Rechecked rollback: `workspace-tools-split-revert.patch` applies cleanly with `git apply --check`.
- Rechecked whitespace: `git diff --check` and extra scan of untracked workspace-tools/task files passed.
- Rechecked debug leftovers: no `console.log`, `debugger`, `TODO`, or `FIXME` in the new workspace-tools modules.
- Re-ran `npm run build:web`: PASS. Vite/Rollup emitted the same pure-comment and chunk-size warnings; command exited successfully.
