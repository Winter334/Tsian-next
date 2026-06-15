# Directory Structure

`packages/contracts/src/index.ts` re-exports every public module. Add contract files only when a shape has a clear cross-package owner.

## File Ownership

- `runtime.ts` owns runtime snapshots, conversation messages, JSON value types, Runtime Workspace shapes, diagnostics, message interaction, deep query, platform context, and platform action shapes.
- `bridge.ts` owns `PlayFrontendBridge`, bridge namespace interfaces, and the shared remote play bridge RPC envelope types for iframe/postMessage consumers.
- `debug.ts` owns AI debug and checkpoint summary types exposed to play frontends.
- `frontend-package.ts` owns play frontend manifest metadata.
- `game-card.ts` owns game card manifest metadata, frontend binding, package manifest metadata, assistant metadata, and workspace template file shapes shared by platform-web and future game-card tooling.
- `memory.ts` owns generic memory schema type contracts only.

## Export Rules

- Every public type must be exported through `src/index.ts`.
- Keep the package type-only. Do not add runtime helpers, validators, storage code, or browser-specific APIs.
- Prefer a single source of truth. If `platform-web` and a frontend package both need a shape, define it in contracts and import it.

## Avoid

- Do not restore mod, preset, workflow, event/archive, or maintenance patch contracts as active public modules without a new accepted design.
- Do not put UI-only labels or local storage metadata here unless intentionally shared across packages.
- Do not make a field optional to hide a caller bug.
