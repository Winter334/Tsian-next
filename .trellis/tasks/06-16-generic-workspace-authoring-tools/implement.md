# Generic Workspace Authoring Tools Implementation Plan

## Pre-Start Checklist

1. Run `trellis-before-dev` before editing code.
2. Read platform-web frontend specs and contracts specs.
3. Re-check current runtime workspace tool behavior and prompt/Skill references so the breaking migration updates every caller intentionally.
4. Confirm operation exposure defaults before `task.py start`.

## Implementation Steps

1. Contracts and shared shapes
   - Add generic workspace scope and operation payload/result shapes if they are shared across platform-host, Studio UI, iframe bridge, runtime tools, browser Skill SDK, or future packages.
   - Add access-level shape only if it crosses package boundaries.
   - Keep runtime validation in platform-web, not contracts.

2. Access-level resolver
   - Parse `workspaceAccess.level` from `AGENT.md` frontmatter or Agent context metadata.
   - Default invalid/missing Agent level to `1`.
   - Define default target levels for `card-content`, `save-runtime`, and `platform-meta`.
   - Add path override resolver shape, even if MVP starts with default-only behavior.

3. Operation exposure resolver
   - Define generic operation names: list/search/read/diff/patch/write/move/delete/validate.
   - Add platform/UI mode profiles for ordinary play, studio/authoring, maintainer, and platform-internal contexts.
   - Parse optional Agent-requested/default operation exposure from `AGENT.md` frontmatter if included in MVP.
   - Allow loaded Skill actions to expose narrower workspace operations through a `workspace_operation` executor shape.
   - Reject unexposed operations before path/scope mutation logic runs.

4. Storage authoring helpers
   - Add card content list/read/search/write/patch/move/delete helpers that mutate `LocalGameCardRecord.contentFiles`.
   - Reuse existing save runtime helpers where possible for `save-runtime`.
   - Add read-only effective-view helpers for runtime-visible list/read/search when callers do not intend to mutate.
   - Preserve existing path normalization and reserved path rules.
   - Ensure writes target an explicit scope.

5. Diff and patch
   - Add a diff preview helper for current vs proposed content.
   - Add structured patch/write behavior with optimistic conflict detection through `expectedContent` or equivalent.
   - Keep failures clear and structured.

6. Generic tool execution surface
   - Add generic list/search/read/diff/patch/write/move/delete/validate handling.
   - Route runtime Agent workspace tools through the generic implementation.
   - Add `workspace_operation` Skill action executor support so loaded Skills can wrap a generic operation without exposing the raw operation directly.
   - Route browser Skill SDK workspace operations through the generic implementation.
   - Route frontend bridge workspace actions through the generic implementation.
   - Remove old tool/action names and update their callers directly; do not add compatibility aliases for the prototype unless a bootstrap blocker appears.

7. Validation hooks
   - Add generic validators first: path, JSON parse, frontmatter parse.
   - Add Agent/Skill validators only as optional named validators, not as hardcoded behavior of every edit.

8. Runtime and UI integration slice
   - Update runtime tool prompts/examples to prefer generic operation names.
   - Expose enough for the next Workspace Studio / authoring Agent task to call the same tools.
   - Do not build the full Studio UI unless this task is explicitly expanded.

9. Docs/spec updates
   - Update `.trellis/spec/platform-web/frontend/type-safety.md`.
   - Update `.trellis/spec/platform-web/frontend/state-management.md` if storage behavior changes.
   - Update contracts specs if shared types are added.
   - Update active handoff docs.

## Validation Commands

Run when contracts change:

```bash
npm run build:contracts
```

Run for platform-web changes:

```bash
npm run build:web
```

Run before completion:

```bash
git diff --check
python3 ./.trellis/scripts/task.py validate 06-16-generic-workspace-authoring-tools
```

## Focused Checks

- Actor below `readLevel` cannot read/list/search a target.
- Actor below `editLevel` cannot patch/write/move/delete a target.
- Unexposed operations are rejected even if the actor level is sufficient.
- Operation exposure can differ between play, studio/authoring, maintainer, and platform-internal contexts.
- Loaded Skill `workspace_operation` actions can call only their declared operation/scope/path envelope.
- Loaded Skill `workspace_operation` actions still fail when actor level is below target read/edit level.
- Missing Agent `workspaceAccess.level` behaves as level `1`.
- `card-content` writes cannot create reserved `save/...` or `.tsian/...` card files.
- `save-runtime` writes cannot escape active save runtime semantics.
- `.tsian/...` requires platform-internal level by default.
- Existing ordinary runtime play behavior still works through the generic implementation.
- Old runtime tool names are removed or rewritten to the generic names in prompts, Skills, SDK, and platform actions.
- Browser Skill SDK and bridge workspace actions do not fork their own path/scope rules.
- Diff/patch detects stale expected content when applicable.
- Validation failures are structured and do not mutate storage.

## Risky Areas

- `apps/platform-web/src/storage/workspace.ts`
- `apps/platform-web/src/storage/game-cards.ts`
- `apps/platform-web/src/platform-host/index.ts`
- `apps/platform-web/src/agent-runtime/context.ts`
- `apps/platform-web/src/agent-runtime/registry.ts`
- `apps/platform-web/src/agent-runtime/workspace-tools.ts`
- `apps/platform-web/src/agent-runtime/actions.ts` if action executor logic is extracted during implementation
- `apps/platform-web/src/platform-host/browser-skill-script-executor.ts`
- `apps/platform-web/src/bridge/remote-iframe-bridge.ts`
- `packages/contracts/src/runtime.ts`
- `packages/contracts/src/bridge.ts`

## Rollback Points

- Keep access-level resolver separate from storage mutation helpers.
- Keep generic operation implementation separate from platform/UI profile selection.
- Keep UI integration minimal until the tool backend is stable.
- If patch semantics become too large, land read/search/diff first and defer mutation tools.
