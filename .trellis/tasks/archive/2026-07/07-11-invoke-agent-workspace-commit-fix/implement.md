# 修复 invokeAgent 覆盖前端写入 — Implementation Plan

## Pre-Implementation Context

Before editing code, load pre-dev context for:

- `platform-web/frontend`
- `platform-web/storage`
- shared guides:
  - cross-layer thinking
  - AI-facing content changes
  - module structure

This task intentionally does not change formal `interaction.sendMessage` main turn commit semantics.

## Phase 2 Checklist

### Step 1 — Transaction changeset API

Files:

- `apps/platform-web/src/storage/workspace-types.ts`
- `apps/platform-web/src/storage/workspace.ts`

Tasks:

- Add `RuntimeWorkspaceChanges` type.
- Add `finalWorkspaceChanges()` to `RuntimeWorkspaceTransaction`.
- Track written paths from `write` and `writePlatformFile`.
- Track deleted paths from `delete`.
- Ensure returned `writtenFiles` are cloned and sorted.
- Ensure write-after-delete and delete-after-write produce sensible final changes.

Validation notes:

- No Dexie schema change.
- Existing `finalWorkspaceFiles()` behavior remains unchanged.

### Step 2 — Side-channel partial commit helpers

Files:

- `apps/platform-web/src/storage/saves.ts`

Tasks:

- Add `commitWorkspaceChangesForSave(saveId, changes)`.
- Add `commitWorkspaceChangesWithCheckpointForSave(saveId, changes, input)`.
- Preserve existing full-snapshot helpers for current callers.
- Implement path delete matching exact path or directory prefix.
- Upsert only `changes.writtenFiles`.
- Build `workspace-with-checkpoint` checkpoint from merged current DB rows, not transaction snapshot.
- Preserve protected frontend debug checkpoint behavior.
- Preserve same-turn after-turn replacement in checkpoint mode.
- Prune checkpoints after checkpoint mode commit.

Validation notes:

- Carefully handle `saveRuntimeFilesFromEffectiveWorkspace` and `.tsian/local/**` exclusion.
- Do not accidentally checkpoint append-only logs.

### Step 3 — Switch invokeAgent commit dispatch

Files:

- `apps/platform-web/src/platform-host/index.ts`

Tasks:

- Import new partial commit helpers.
- After staging context/trace, call `workspaceTransaction.finalWorkspaceChanges()`.
- Use changes helper for both `workspace` and `workspace-with-checkpoint` modes.
- Keep `emitAgentInvocation({ type: "completed" })` after commit returns.
- Keep failure trace fallback unchanged unless type changes require adjustment.

Validation notes:

- Confirm side-channel trace file is included as a written platform file.
- Confirm persisted assistant context file is included when `persist:true` and `contextUpdate` exists.

### Step 4 — Generic bridge activity wait for inspect_frontend

Files:

- `apps/platform-web/src/platform-host/frontend-inspector.ts`

Tasks:

- Extend internal runtime chain state with trigger metadata if useful.
- Replace `waitForSendAfter` action gate with `waitForBridgeActivityAfter`.
- Create a generic bridge chain for any post-action bridge activity.
- Preserve send-specific `sendCount` updates.
- Update error message for no-trigger case to mention bridge activity.

Validation notes:

- `waitForRuntimeSettled` should continue to wait on bridge in-flight + quiet.
- No-action continuation behavior should remain compatible.

### Step 5 — AI-facing descriptions and specs

Files likely involved:

- `apps/platform-web/src/agent-runtime/tool-schemas.ts`
- `apps/platform-web/src/storage/local-assistant-files.ts`
- `.trellis/spec/platform-web/frontend/type-safety.md`
- `.trellis/spec/platform-web/storage/index.md`

Tasks:

- Update `runtime-settled` wording to bridge activity.
- Update `INSPECT_RUNTIME_NOT_TRIGGERED` concept from “no send” to “no bridge activity”.
- Update storage spec for `invokeAgent` side-channel changeset/merge commit.
- Grep for stale `interaction.sendMessage`-only wording around `inspect_frontend` runtime-settled.

### Step 6 — Validation

Required commands:

```bash
npm run build:web
```

Conditional command if `packages/contracts` changes:

```bash
npm run build:contracts
```

Manual browser validation:

1. Reset/prepare `/play` setup import state with a selected novel file.
2. Ask Desktop Assistant to use `inspect_frontend` to click “导入”.
3. Confirm inspect result:
   - `ok:true`
   - activity includes completed `workspace.write`
   - no `INSPECT_RUNTIME_NOT_TRIGGERED` for pure import flow
4. After assistant reply completes, inspect persisted workspace:
   - `save/source/chapters.index.json`
   - `save/source/chapters/*.md`
   - ready `save/source/manifest.json`
5. Switch chapter preview and confirm content loads.
6. If possible, exercise `workspace-with-checkpoint` side-channel path or review via targeted code-level sanity.

## Risk / Rollback Points

- If checkpoint helper becomes too large, keep `workspace` partial helper first and implement checkpoint helper as a careful merged variant rather than modifying full commit helper in place.
- If generic bridge wait causes unexpected waits on background polling, narrow trigger methods while preserving `workspace.write`.
- If type propagation becomes broad, avoid changing shared contracts unless absolutely necessary.

## Done Definition

- PRD acceptance criteria pass.
- `npm run build:web` passes.
- Relevant specs/docs updated.
- Browser reproduction no longer deletes frontend-written workspace files.
