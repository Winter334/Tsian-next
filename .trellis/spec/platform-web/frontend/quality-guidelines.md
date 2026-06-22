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

- **`storage/workspace.ts` search helpers are dead code with duplicated logic.** `searchWorkspaceFilesForSave` / `searchWorkspaceFilesFromFiles` (plus `createPreview` / `normalizeLimit` / `fileName` copied from `agent-runtime/workspace-operations.ts`) have **zero callers** across the codebase — UI search routes through `searchPlatformWorkspace` → `executeWorkspaceOperation` (agent-runtime), not the storage copy. They were left behind when workspace search moved to the agent-runtime operation path. A follow-up task should delete them and extract the genuinely shared helpers (`createPreview`, `normalizeSearchLimit`, `fileName`) into a shared module both layers can import, rather than keeping two copies that drift. Do not add new callers to the storage-side `searchWorkspaceFilesForSave` / `searchWorkspaceFilesFromFiles`.
