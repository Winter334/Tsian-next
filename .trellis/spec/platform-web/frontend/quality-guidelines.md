# Quality Guidelines

Quality for `platform-web` is mostly type safety, build success, and preserving cross-layer runtime contracts.

## Required Checks

- Run `npm run build:web` after any change under `apps/platform-web`.
- Run `npm run build:contracts` if a change imports or modifies contract shapes.
- **`build:web` passing does NOT mean the frontend-build runtime loop works.** The esbuild-wasm build engine (`src/frontend-build/`) has three runtime-only traps that `vue-tsc` + `vite build` cannot catch — they only surface when a real build runs in the browser:
  - **esbuild plugin objects may only carry `name` + `setup`.** Attaching extra fields (e.g. a `result` handle for post-build reads) throws `Invalid option on plugin "<name>": "<field>"` at runtime. A TS intersection type (`Plugin & { result }`) lies to tsc but esbuild rejects it. Return extra data as a sibling on a wrapper object (`{ plugin, result }`), not on the Plugin itself. See `cdn-external-plugin.ts`.
  - **`esbuild.initialize` is "call exactly once" per page lifetime.** esbuild-wasm guards it internally (`Cannot call "initialize" more than once`) and reuses one long-lived service for all `esbuild.build` calls. Cache the init promise on `globalThis` (NOT a module-level variable — vite HMR reloads the module and resets module state, diverging from esbuild-wasm's surviving module state). Wrap `initialize` to swallow the "more than once" error (it means a service is already alive = success), and clear the cache only on genuine failure. See `engine.ts` `ensureEsbuildInitialized`.
  - **esbuild `outputFiles[i].path` may carry a leading slash** (`/assets/stdin.js`). Concatenating a prefix (`frontend/dist/` + `/assets/...`) yields a double slash (`frontend/dist//assets/...`). The storage layer normalizes it on write, but any in-memory `Set` of "newly written paths" holds the un-normalized form — a later stale-file cleanup that compares against normalized stored paths won't match and will delete the freshly-written files. Strip the leading slash before concatenating. See `write-back.ts`.
- After touching `src/frontend-build/`, manually verify the full loop in the browser (create default card → /play renders the placeholder shell → edit `frontend/src/main.ts` → ~800ms later dist rebuilds and /play reloads). The build command alone is insufficient evidence.

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

- Keep stable system/Agent identity text first, then the cross-turn-stable history (already-occurred narrative turns, byte-stable), then workspace context, then dynamic turn data (`current turn`, user input, agent_call request, tool observations). Do not place workspace context before history, or its change shifts the cache breakpoint forward and makes all following history miss. Within workspace context, `buildAgentContextMessages_split` (task `06-30-workspace-context-cache-split`) splits it into a meta message (header/skillIndex/notes/missingPaths, semi-stable) plus one message per `contextFile`. Each file is its own cache boundary: a stable file (docs/README) that doesn't change across turns hits the prefix cache; a dynamic file (`runtime.json`/brief) misses only its own message and does not drag stable files down with it. No cross-turn state is needed — splitting itself is the full lever; the provider caches unchanged bytes automatically. Keep the `contextPaths` declaration order (do not reorder stable files ahead of dynamic ones) — real declarations already put docs first and state last, and provider prefix cache matches on tokens not message boundaries, so reordering has no extra benefit but breaks agent authors' context organization.
- Do not concatenate dynamic turn numbers with stable workspace context in the same message; a changing prefix inside one message prevents provider-side prefix cache reuse for the rest of that message.
- Native function-calling prompts should keep only short tool-use principles. Put concrete parameters in the `tools` schema, and avoid dynamic examples such as a concrete contact Agent id in the system prompt.
- Text tool-call mode remains a required fallback for providers without native tools. It may use a minimal `<tsian-tool-call>` example, but do not remove the protocol or make it depend on native schemas.
- Model-facing tool observations should be compact and resumable: small results may inline; large results should include preview plus path/ref/range/offset/limit/truncated/total metadata so the Agent can read a narrower slice. Debug/trace/UI output may keep fuller details.
- Cross-turn saved `AgentContextToolCall[]` is replayed as the provider's native function-calling history form (`assistant.toolCalls` + `role:"tool"` for native; `<tsian-tool-call>`/`<tsian-tool-observation>` blocks for text). This is the API-expected, byte-stable, cacheable prefix form — do **not** rewrite it into a `role:"user"` text summary, which breaks the native history structure and does not improve cache hit (historical observations are immutable bytes already part of the cacheable prefix). Volume control of old turns is the compression layer's job (summarize early turns into `AgentContextSnapshot.summary`), not the history-replay layer's.
- OpenAI Responses provider is still a **local stateless replay** provider in Tsian: build `input` from local messages plus replayed `function_call` / `function_call_output` items, default `store: false`, and do not use `previous_response_id` unless a future task designs the server-side response-id lifecycle, checkpoint rollback behavior, and debug visibility. The `NativeToolCall.id` for Responses is the provider `call_id` (not the output item `id`) because tool observations must be returned as `function_call_output.call_id`.
- Keep narrative/master and task/assistant compression thresholds separate. Narrative can trigger near the context budget, but task/assistant should trigger earlier because tool exploration is dynamic and cache-hostile.
- `AiDebugRecord.messageSegments` is debug metadata only. It must not be sent to providers, and it should remain sufficient to inspect role, segment label, stability, and approximate size for cache analysis.
- `AiDebugRecord` carries provider-reported cache usage (`usage.cached` / `usage.cacheCreation`) extracted per-provider by `extractUsageFromPayload` (OpenAI Chat Completions `prompt_tokens_details.cached_tokens`, OpenAI Responses `input_tokens_details.cached_tokens`, DeepSeek `prompt_cache_hit_tokens`, Claude `cache_read_input_tokens`/`cache_creation_input_tokens`, Gemini `usageMetadata.cachedContentTokenCount`). DebugView shows the real `cached/prompt_tokens` hit rate from these fields — do not reintroduce local char-based cache estimation (`stablePrefixChars` etc. were removed in task `06-30-debugview-cache-hit-display` as inaccurate vs the provider's own numbers). Records persist in Dexie meta key `ai-debug-records` (global, 7-day TTL, cleared on card switch since different cards' hit rates aren't comparable); `getAiDebugRecords` always hydrates from Dexie so a card-switch clear is reflected without a cross-layer cache-reset call.
