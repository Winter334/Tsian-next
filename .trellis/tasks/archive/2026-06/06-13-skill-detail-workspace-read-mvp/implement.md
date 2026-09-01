# Skill Detail Workspace Read MVP Implementation Plan

## Checklist

- [x] Refresh relevant specs before editing:
  - `.trellis/spec/guides/index.md`
  - `.trellis/spec/platform-web/frontend/index.md`
  - `.trellis/spec/contracts/frontend/index.md` if contracts change
- [x] Add pure runtime workspace tool helpers in or near `apps/platform-web/src/agent-runtime/`:
  - parse `<tsian-tool-call>` blocks;
  - normalize workspace file and directory paths;
  - execute `workspace.read`, `workspace.list`, and `workspace.search` against `WorkspaceFile[]`;
  - format success/error observations.
- [x] Add compact tool instructions to workspace Agent prompt assembly.
- [x] Replace direct master/narrative model calls with a bounded tool-loop helper:
  - preserve `debugLabel`;
  - preserve abort handling;
  - preserve legacy fallback when no `workspaceFiles` context exists;
  - strip tool blocks from final visible output.
- [x] Keep tools read-only:
  - no write/delete action;
  - no Skill action execution;
  - no script/remote execution.
- [x] Add or run an in-memory runtime probe:
  - workspace contains a shared Skill;
  - first model response requests `workspace.read`;
  - second model response uses the observation;
  - final result does not contain tool-call markup.
- [x] Run validation:
  - `npm run build:web`
  - `npm run build:contracts` only if shared contracts changed
- [x] Update relevant spec/docs if the implementation establishes a durable convention.
- [ ] Commit with a Chinese commit message after checks pass.

## Risky Files

- `apps/platform-web/src/agent-runtime/index.ts`
  - Main prompt/orchestration file; avoid making it too large if helpers can live in a sibling module.
- `apps/platform-web/src/agent-runtime/context.ts`
  - Should not need changes unless prompt context shape changes.
- `apps/platform-web/src/storage/workspace.ts`
  - Should not be imported into runtime; duplicate only small pure normalization/list/search behavior if needed.
- `packages/contracts/src/debug.ts`
  - Avoid changing `AiChatMessage` unless native tool roles become necessary, which is out of MVP scope.

## Validation Details

The in-memory probe can import `runAgentRuntimeTurn` directly and pass fake `workspaceFiles`. A fake `callModel` can return:

1. master first call: a `workspace.read` tool block;
2. master second call: final brief that references the loaded skill;
3. narrative call(s): either no tool call or another read call for an agent-local Skill.

This verifies the runtime loop without requiring AI credentials or a browser.

## Rollback Points

- If parser behavior gets brittle, keep the executor helpers but disable tool instruction injection.
- If additional model calls break debug assumptions, preserve direct calls and defer the tool loop to a dedicated runtime action task.
- If prompt behavior degrades, lower `MAX_TOOL_ROUNDS_PER_AGENT` to `1` or restrict tools to `workspace.read` only.
