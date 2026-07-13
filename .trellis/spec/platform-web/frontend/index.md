# platform-web Frontend Specs

`apps/platform-web` is the browser platform shell. It owns the Vue app, local platform host, Agent Runtime MVP implementation, Dexie persistence, bridge implementation, AI client/debug records, and remote/packaged frontend loading.

Use these specs when changing `apps/platform-web/src/**`.

| Guide | Use When | Status |
|-------|----------|--------|
| [Directory Structure](./directory-structure.md) | Choosing where code belongs | Filled |
| [Component Guidelines](./component-guidelines.md) | Writing Vue route views and UI primitives | Filled |
| [Hook Guidelines](./hook-guidelines.md) | Writing composables | Filled |
| [State Management](./state-management.md) | Updating Vue refs, Dexie state, and bridge state | Filled |
| [Quality Guidelines](./quality-guidelines.md) | Pre-commit checks and forbidden patterns | Filled |
| [Type Safety](./type-safety.md) | Runtime boundary normalization and contract use | Filled |

## Required Checks

- Run `npm run build:web` for any platform-web change.
- Run `npm run build:contracts` when imported contract shapes change.

## Source References

- `apps/platform-web/src/agent-runtime/index.ts`
- `apps/platform-web/src/agent-runtime/trace.ts`
- `apps/platform-web/src/agent-runtime/diagnostics.ts`
- `apps/platform-web/src/agent-runtime/macro-engine.ts`
- `apps/platform-web/src/platform-host/index.ts`
- `apps/platform-web/src/views/LobbyView.vue`
- `apps/platform-web/src/views/DebugView.vue`

## Context Injection Composer

`contextPaths` in `agent.json` supports three entry forms (see `ContextPathEntry` in contracts):
- **String** `"path"` — backward-compatible: one `user` message per file, content macro-expanded, injected at `workspace-context`
- **Path object** `{path, role, position}` — one file, inject as specified role and message-sequence position, content macro-expanded
- **Template object** `{template, role, position}` — inline template string, macro-expanded, inject as specified role and message-sequence position

`position` is optional and defaults to `"workspace-context"`. Legal values, in runtime skeleton order, are `"before-history"` (system prompt 后、history 前), `"workspace-context"` (history 后、turn-runtime 前), `"after-input"` (玩家输入后、tail 前), and `"tail"` (消息序列绝对末尾，PREFILL.md 兼容迁移层). The message builder consumes `AgentContextEntry.contextInjectionsByPosition`; `contextInjections` is only the `workspace-context` alias retained for debug metadata.

**Macro engine** (`macro-engine.ts`): `expandMacros()` processes `{{file:path}}`, `{{file:path?enabled}}`, `{{file:dir/*.md?enabled}}` (1-layer glob, no recursion), `{{random:A,B,C}}`, then implicit whitespace cleanup. Relative paths resolve against the injected file's directory (template objects use the agent directory). `enabledModules: string[]` on `AgentConfig` controls `?enabled` inclusion by file stem; absent defaults to include all (backward-compatible), while an explicitly configured empty array means include none.

**Compilation flow**: `registry.ts` parses entries → `context.ts` `assembleAgentContext` resolves files + expands macros + groups by position → `index.ts` emits one `RuntimeChatMessage` per injection (with role + source label) at the declared skeleton position. Empty compiled content is skipped. `AgentContextEntry.contextInjectionsByPosition` is the authoritative message-building field.

**Cache**: pure-string entries preserve the existing one-file-per-message split (prefix cache stable). `{{random}}` causes per-turn cache miss — use sparingly.

## Trace Diagnostics

Runtime traces (`.tsian/save/traces/turns/turn-NNNNNN.jsonl`) are append-only per-save logs (see storage spec). They feed two layers:

- **`diagnostics.ts`** builds `RuntimeDiagnosticSummary` (facts + health) from parsed trace files — the aggregated issue/health view consumed by the `runtime-diagnostics` query resource and DebugView's "最近问题" panel. The trace path pattern must match `formatRuntimeTracePath` (`.tsian/save/traces/turns/turn-*.jsonl`); a mismatch silently makes diagnostics return empty.
- **`trace.ts`** owns the human-readable renderer (`formatTraceForHuman` / `formatTraceEventForHuman`) — a pure logfmt/rust-tracing-style formatter that flattens event `data` to `key=value` with friendly-name mapping, time offsets, and ok/FAIL markers. This is a **rendering layer only** — it does not change JSONL storage.

**Trace collection principle**: trace records **metadata only** (event type, identifiers like agentId/skill/tool name, counts/duration/token numbers/finishReason/usage, result status ok/failed + error/stack). It does **not** record business content fragments — no `outputPreview`/`resultPreview` of reply text or tool results. Truncated content fragments are insufficient for diagnosis and overlap with turn files (full replies) and workspace files (full tool results). Developers know their architecture; players who can't read a trace hand it to the assistant agent (which reads JSONL via `runtime-diagnostics` and has workspace tools for full content). No "where to see full text" guidance lines in trace data either.

- `errorToTraceDataWithStack(error)` extends `errorToTraceData` with a truncated `errorStack` (`TRACE_ERROR_STACK_LIMIT = 1000`); use it for failed-event trace emits.
- The `runtime-trace` query resource returns raw trace events for a turn (`loadRuntimeTraceEvents`) — DebugView's "运行日志" section fetches it and renders via `formatTraceForHuman`, defaulting to the latest turn.

## Related Specs

- [Storage specs](../storage/index.md) — Dexie schema, checkpoint storage model, content-addressing, `.tsian/` layout (trace path prefix). Read when changing `src/storage/**` or any Dexie table.
