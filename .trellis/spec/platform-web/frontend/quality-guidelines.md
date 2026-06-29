# Quality Guidelines

Quality for `platform-web` is mostly type safety, build success, and preserving cross-layer runtime contracts.

## Required Checks

- Run `npm run build:web` after any change under `apps/platform-web`.
- Run `npm run build:contracts` if a change imports or modifies contract shapes.

## Project Rules

- Prefer fail loud over hidden fallback for writes and runtime mutations.
- Do not expand scope opportunistically.
- Do not add migrations or compatibility layers for local IndexedDB without explicit approval.
- Keep bridge APIs framework-neutral.

## Review Checklist

- If runtime turn flow or turn-number derivation changes, verify storage, bridge, DebugView, and remote/packaged frontend contracts still agree.
- If query resources change, verify platform-host and remote/packaged bridge consumers use the same resource names.
- If `interaction.sendMessage` changes, verify failure rollback does not persist partial messages.
- If Dexie tables change, use a new database name unless a task explicitly chooses migration.

## Avoid

- Do not add broad catch blocks around Agent Runtime turns just to keep UI quiet.
- Do not create duplicate storage helpers for the same table.
- Do not restore retired workflow/prompt/event/archive surfaces as incidental dependencies.

## Known Tech Debt

- **Workspace search helpers live only in `agent-runtime/workspace-operations.ts`.** An earlier storage-side copy (`searchWorkspaceFilesForSave` / `searchWorkspaceFilesFromFiles` plus duplicated `createPreview` / `normalizeLimit` / `fileName` in `storage/workspace.ts`) was dead code with zero callers — UI search routes through `searchPlatformWorkspace` → `executeWorkspaceOperation` (agent-runtime), not the storage copy. The dead storage copy was deleted; the shared helpers were NOT extracted into a separate module because agent-runtime is now the only live caller, so an abstraction layer would have no second consumer. If a second consumer appears, extract `createPreview` / `normalizeSearchLimit` / `fileName` into `apps/platform-web/src/lib/workspace-search.ts` (or similar) rather than copying them again.
- **Workspace path normalization lives in `lib/workspace-path.ts`.** Three byte-identical `normalizePathBase` copies once lived in `storage/workspace.ts`, `agent-runtime/workspace-operations.ts`, and `agent-runtime/workspace-tools.ts`; they differed only in which domain error type they threw (`WorkspaceStorageError` / `workspaceOperationError` / `toolError`). They were collapsed into `apps/platform-web/src/lib/workspace-path.ts`, which returns a discriminated `NormalizePathResult` (no throw) so each call site wraps failures in its own error type — the core stays free of those dependencies and free of import cycles. The core also accepts `.` and `..` relative segments (the runtime workspace is root-bound, so `..` clamps at the root and cannot escape); see [AI-Facing Content Changes](../../guides/ai-facing-content-changes.md) for why accepting `.` matches model training conventions. Two other path validators stay strict and are **not** routed through the shared core: `agent-runtime/context.ts` (authored-config paths, returns `null` for `.`/`..` because an authoring typo should surface, not silently clamp) and the `MEMORY_MAINTENANCE_SCRIPT_JS` embedded `normalizePath` (a skill-sandbox string literal with its own target allowlist). When adding a fourth path-normalizing call site, route it through `lib/workspace-path.ts` rather than copying the algorithm again.

## Agent Runtime Message Cache Contract

When changing Agent Runtime turn composition or AI debug records, preserve cache-friendly message layering:

- Keep stable system/Agent identity text before semi-stable workspace context, and keep dynamic turn data (`current turn`, user input, agent_call request, tool observations) after those stable segments.
- Do not concatenate dynamic turn numbers with stable workspace context in the same message; a changing prefix inside one message prevents provider-side prefix cache reuse for the rest of that message.
- Native function-calling prompts should keep only short tool-use principles. Put concrete parameters in the `tools` schema, and avoid dynamic examples such as a concrete contact Agent id in the system prompt.
- Text tool-call mode remains a required fallback for providers without native tools. It may use a minimal `<tsian-tool-call>` example, but do not remove the protocol or make it depend on native schemas.
- Model-facing tool observations should be compact and resumable: small results may inline; large results should include preview plus path/ref/range/offset/limit/truncated/total metadata so the Agent can read a narrower slice. Debug/trace/UI output may keep fuller details.
- Native/text tool-call protocol is turn-local. Do not replay cross-turn saved `AgentContextToolCall[]` as native `assistant.toolCalls` + `role: "tool"`, or as text `<tsian-tool-call>` / `<tsian-tool-observation>` blocks. Historical tool calls should enter model context only as compact history summaries; full data may remain in UI/timeline/context storage.
- Keep narrative/master and task/assistant compression thresholds separate. Narrative can trigger near the context budget, but task/assistant should trigger earlier because tool exploration is dynamic and cache-hostile.
- `AiDebugRecord.messageSegments` is debug metadata only. It must not be sent to providers, and it should remain sufficient to inspect role, segment label, stability, and approximate size for cache analysis.
