# platform-web Frontend Specs

`apps/platform-web` is the browser platform shell. It owns the Vue app, local platform host, Agent Runtime MVP implementation, Dexie persistence, bridge implementation, unified diagnostics, and remote/packaged frontend loading.

Use these specs when changing `apps/platform-web/src/**`.

| Guide | Use When | Status |
|-------|----------|--------|
| [Directory Structure](./directory-structure.md) | Choosing where code belongs | Filled |
| [Component Guidelines](./component-guidelines.md) | Writing Vue route views and UI primitives | Filled |
| [Hook Guidelines](./hook-guidelines.md) | Writing composables | Filled |
| [State Management](./state-management.md) | Updating Vue refs, Dexie state, and bridge state | Filled |
| [Quality Guidelines](./quality-guidelines.md) | Pre-commit checks and forbidden patterns | Filled |
| [Type Safety](./type-safety.md) | Runtime boundary normalization and contract use | Filled |
| [AI Provider Caching](./ai-provider-caching.md) | Claude stable-prefix/automatic caching, compatibility, and diagnostics | Filled |
| [Spatial HTML-in-Canvas UI](./spatial-ui.md) | Curved HTML rendering, projected input, environment passes, and experimental API boundaries | Filled |

## Required Checks

- Follow the project-wide [Validation Scope And Evidence Guide](../../guides/validation-strategy.md) before choosing commands.
- Run `npm run build:web` when executable platform-web source or configuration can affect type-checking, bundling, or runtime behavior.
- For prose-only docs/comments or non-executable metadata, use diff/reference checks instead of a build unless a parser, generator, or runtime loader consumes the changed text.
- Run `npm run build:contracts` when imported contract shapes change.

## Source References

- `apps/platform-web/src/agent-runtime/index.ts`
- `apps/platform-web/src/runtime-host/ai/trace-recorder.ts`
- `apps/platform-web/src/storage/diagnostic-records.ts`
- `apps/platform-web/src/agent-runtime/macro-engine.ts`
- `apps/platform-web/src/platform-host/index.ts`
- `apps/platform-web/src/views/LobbyView.vue`
- `apps/platform-web/src/views/DebugView.vue`

## Context Injection Composer

`contextPaths` in `agent.json` accepts a string path, a `{path, role, position}` entry, or an inline `{template, role, position}` entry. Paths and templates use the shared macro engine; that engine does not interpret a card's save schema.

Current positions are `prelude` (system prompt after, history before), `runtime` (history after, before the current input), and `framing` (after the input, at the end). Omitted positions default to `runtime`. `registry.ts` normalizes declarations; `context.ts` compiles them into `AgentContextEntry.contextInjectionsByPosition`, consumed by the message builder. Do not use the retired position names or the removed `contextInjections` alias.

The macro engine supports file includes, single-level globs, enabled module selection, and random alternatives. Relative includes resolve against the injected file's directory (inline templates use the Agent directory). An explicitly empty `enabledModules` selects no modules; missing configuration preserves all. Random alternatives invalidate stable prefix caching.

For specialized semantic input, change the card-owned preparation code and injected files, not the generic composer. The immersive reader prepares its stage-manager material in `apps/play-frontend-dev/src/lib/maintenance-context.ts`; see the [card source README](../../../../cards/沉浸阅读器.tsian-card/README.md).

## Unified Diagnostics

Provider requests and unhandled frontend errors use the global `diagnosticRecords` table. Runtime Trace JSONL and AI Debug writers/readers are retired and must not be restored as compatibility paths. See [Unified Diagnostics Storage and Collection](../storage/diagnostics.md) for the cross-layer schema, recorder, sanitization, pagination, retention, and verification contract.

## Related Specs

- [Storage specs](../storage/index.md) — Dexie schema, checkpoint storage model, content-addressing, `.tsian/` layout, and unified diagnostics. Read when changing `src/storage/**` or any Dexie table.
