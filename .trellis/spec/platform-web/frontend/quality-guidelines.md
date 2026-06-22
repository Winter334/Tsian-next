# Quality Guidelines

Quality for `platform-web` is mostly type safety, build success, and preserving cross-layer runtime contracts.

## Required Checks

- Run `npm run build:web` after any change under `apps/platform-web`.
- Run `npm run build:contracts` if a change imports or modifies contract shapes.
- Run `npm run build:runtime-core` if `RuntimeEngine` changes.

## Project Rules

- Prefer fail loud over hidden fallback for writes and runtime mutations.
- Do not expand scope opportunistically.
- Do not add migrations or compatibility layers for local IndexedDB without explicit approval.
- Keep bridge APIs framework-neutral.

## Review Checklist

- If runtime snapshot shape changes, verify storage, bridge, DebugView, and remote/packaged frontend contracts still agree.
- If query resources change, verify platform-host and remote/packaged bridge consumers use the same resource names.
- If `interaction.sendMessage` changes, verify failure rollback does not persist partial messages.
- If Dexie tables change, use a new database name unless a task explicitly chooses migration.

## Avoid

- Do not add broad catch blocks around Agent Runtime turns just to keep UI quiet.
- Do not create duplicate storage helpers for the same table.
- Do not restore retired workflow/prompt/event/archive surfaces as incidental dependencies.

## Known Tech Debt

- **Workspace search helpers live only in `agent-runtime/workspace-operations.ts`.** An earlier storage-side copy (`searchWorkspaceFilesForSave` / `searchWorkspaceFilesFromFiles` plus duplicated `createPreview` / `normalizeLimit` / `fileName` in `storage/workspace.ts`) was dead code with zero callers — UI search routes through `searchPlatformWorkspace` → `executeWorkspaceOperation` (agent-runtime), not the storage copy. The dead storage copy was deleted; the shared helpers were NOT extracted into a separate module because agent-runtime is now the only live caller, so an abstraction layer would have no second consumer. If a second consumer appears, extract `createPreview` / `normalizeSearchLimit` / `fileName` into `apps/platform-web/src/lib/workspace-search.ts` (or similar) rather than copying them again.
