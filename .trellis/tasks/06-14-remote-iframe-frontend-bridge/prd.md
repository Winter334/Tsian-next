# Remote Iframe Frontend Bridge

## Goal

Load the active game card's remote game frontend in an isolated iframe and expose Tsian platform/runtime capabilities through a thin postMessage bridge.

## Parent

- `.trellis/tasks/06-14-remote-game-frontend-foundation`

## Requirements

- Resolve the active save's game card frontend binding.
- Mount remote webpage frontends in a sandboxed iframe or equivalent isolated container.
- Use a permissive URL policy for common remote webpages, including ordinary public `http://`, while rejecting clearly dangerous schemes such as `javascript:`.
- Use a compatibility-first iframe sandbox for this first slice: include `allow-scripts`, `allow-same-origin`, and common web-app permissions such as forms, while still keeping remote code out of the platform JS realm.
- Do not run remote frontend code in the platform's own JS realm.
- Implement a postMessage-style bridge with handshake/session filtering.
- Expose bridge methods for platform context, runtime snapshot, sending player messages, history/checkpoint queries, workspace read/list/search, workspace write/delete, and checkpoint restore.
- Remote frontend workspace writes/deletes should be immediate platform actions and remain outside Agent Runtime turn transactions.
- Ordinary workspace path rules must still reject `.tsian/*` metadata reads/writes/deletes.
- Do not expose raw AI debug records to arbitrary remote game frontends by default.
- Provide loading/error states that do not mutate save data.

## Acceptance Criteria

- [x] Play route can mount an active game card remote frontend URL in an iframe.
- [x] Iframe bridge handshake succeeds only for the mounted iframe/session.
- [x] Remote frontend can call platform context, query history/checkpoints, send a player message, and observe turn completion.
- [x] Remote frontend can read/list/search ordinary workspace files.
- [x] Remote frontend can write/delete ordinary workspace files and later read the result.
- [x] Remote frontend cannot read/write/delete `.tsian/*` through ordinary bridge methods.
- [x] `javascript:` frontend URL is rejected before iframe creation.
- [x] Public `http://`, `https://`, and local dev URLs are accepted when the browser can load them.
- [x] Raw AI debug records are not part of the default remote frontend bridge.
- [x] Failed iframe load leaves the save instance untouched.
- [x] Builds pass for contracts/runtime-core/platform-web.

## Dependencies

- Depends on `06-14-game-card-library-save-model` for active game card frontend binding.

## Out Of Scope

- Full lobby/library/workshop UI.
- Import/export package format.
- Remote frontend trust UI or account moderation.
- Packaged/offline frontend runtime.

## Resolved Questions

- First iframe sandbox should include `allow-same-origin` for compatibility and development ergonomics. This weakens sandbox isolation compared with an opaque origin, so the implementation should still rely on bridge capability limits, source/session filtering, and no same-realm execution.
