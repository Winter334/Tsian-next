# Runtime Workspace Storage/API MVP Implementation Plan

## Checklist

1. [x] Read implementation guidelines with `trellis-before-dev`.
2. [x] Add shared workspace contract types in `packages/contracts/src/runtime.ts`.
3. [x] Extend Dexie storage:
   - add `LocalWorkspaceFileRecord`;
   - add `workspaceFiles` table;
   - bump prototype DB name if needed;
   - export workspace helpers from `storage/index.ts`.
4. [x] Implement `apps/platform-web/src/storage/workspace.ts`:
   - path normalization and validation;
   - default workspace initialization;
   - list/read/write/delete/search helpers;
   - checkpoint helper shapes.
5. [x] Integrate save lifecycle:
   - initialize workspace during `createLocalSave`;
   - delete workspace during `deleteLocalSave`.
6. [x] Integrate checkpoints:
   - include workspace files in checkpoint records;
   - restore workspace files during checkpoint restore;
   - update checkpoint summaries only if a count is useful and contract-safe.
7. [x] Integrate bridge API:
   - add query cases for `workspace-list`, `workspace-read`, `workspace-search`;
   - add platform actions for `workspace-write`, `workspace-delete`;
   - reuse structured `PlatformActionError` for invalid inputs.
8. [x] Run validation:
   - `npm run build:contracts`;
   - `npm run build:web`.
9. [x] Update active docs or specs only if implementation reveals a reusable convention not already documented.

## Risk Points

- Checkpoint schema changes touch rollback behavior; verify restore still works for snapshot/history/stateRecords.
- Path normalization must allow `.tsian` but reject traversal.
- Bridge action errors must be structured and must not throw for user input mistakes.
- Prototype DB name bump may reset local browser data; this is acceptable only because current spec explicitly allows prototype resets.

## Review Gates

- Do not add workspace viewer/editor UI in this MVP.
- After implementation, inspect TypeScript errors before broad refactoring.
- Keep changes scoped to contracts, storage, and platform-host.
