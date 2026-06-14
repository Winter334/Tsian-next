# Runtime Workspace Completeness Implementation Plan

## Checklist

- [x] Load implementation specs with `trellis-before-dev` before editing code.
- [x] Add or consolidate workspace metadata helpers in `apps/platform-web/src/storage/workspace.ts`:
  - platform metadata path detection;
  - ordinary visibility filtering;
  - ordinary read/list/search protection;
  - ordinary write/delete protection at storage entry points.
- [x] Update `apps/platform-web/src/platform-host/index.ts` so bridge workspace reads/actions use ordinary-safe helpers while diagnostics/checkpoint internals keep raw platform access.
- [x] Update Agent Runtime workspace tools in `apps/platform-web/src/agent-runtime/workspace-tools.ts` so read/list/search all hide or reject `.tsian/*`, not only traces.
- [x] Update browser-script SDK workspace read/list/search behavior to match ordinary workspace visibility.
- [x] Review default workspace seeded README/manifest wording in `storage/workspace.ts`; update content only where it clarifies platform metadata ownership, index/cache replaceability, and text-only content assumptions.
- [x] Add shared contract query param types only if implementation needs typed cross-package query params.
- [x] Update specs/docs:
  - `.trellis/spec/platform-web/frontend/type-safety.md`;
  - `.trellis/spec/contracts/frontend/type-safety.md` or backend specs if contracts change;
  - `docs/active/current-state-handoff.md`;
  - `docs/active/agent-framework-runtime-workspace-direction.md`.
- [x] Run validation:
  - `npm run build:contracts` if contracts changed;
  - `npm run build:web`;
  - focused probe for visibility, metadata mutation protection, diagnostics, and checkpoint preservation;
  - `python3 ./.trellis/scripts/task.py validate 06-14-runtime-workspace-completeness`;
  - `git diff --check`.
- [x] Commit implementation and archive only the child task after checks pass; keep the parent task active until all roadmap items are complete or explicitly deferred.

## Implementation Notes

- No new shared contract query parameter types were needed.
- `npm run build:contracts` was still run as a cross-layer safety check.

## Risky Files

- `apps/platform-web/src/storage/workspace.ts`: central path normalization, visibility, default seed files, and mutation helpers.
- `apps/platform-web/src/platform-host/index.ts`: bridge query/action boundary and runtime turn commit path.
- `apps/platform-web/src/agent-runtime/workspace-tools.ts`: pure live Agent tool behavior.
- `apps/platform-web/src/platform-host/browser-skill-script-executor.ts`: SDK read/list/search behavior for Skill scripts.
- `packages/contracts/src/runtime.ts`: only if shared query parameter types are added.

## Rollback Points

- Visibility filtering can be reverted independently from write/delete protection if an existing consumer depends on raw `.tsian` listing.
- Direct bridge write/delete protection can be narrowed to `.tsian/traces` only if an approved platform-owned caller currently uses generic workspace actions for metadata, but the preferred rollback is adding an explicit platform helper.
- Seed README wording changes can be reverted without touching runtime behavior.

## Review Gates Before `task.py start`

- [x] User confirms the `.tsian/*` ordinary-query visibility decision.
- [x] PRD, design, and implementation plan have no unresolved code-answerable questions.
- [x] The planned scope still excludes UI, `stateRecords` migration, binary files, and gameplay schemas.
