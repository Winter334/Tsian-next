# Implementation Plan

## Pre-Implementation Checks

- Use the user-approved strong SDK capability profile for the high-power browser script executor.
- Load `trellis-before-dev` before editing product code.
- Read the relevant platform-web specs listed in `implement.jsonl`.
- Re-scan existing executor code before changing constants or declaration shapes.

## Checklist

- [x] Implement the trusted browser script executor with the approved strong SDK capability profile.
- [x] Preserve existing built-in and `platform_action` behavior with reverse searches before edits.
- [x] Extend executor declaration normalization only as much as the chosen scope requires.
- [x] Add shared timeout/abort/error handling for async controlled execution.
- [x] Add or adapt a platform-host controlled execution capability while keeping `agent-runtime` platform-pure.
- [x] Implement the high-power browser-side Skill script executor or explicitly mark the risky capability portion deferred with the agreed reason.
- [x] Keep raw DOM, `window`, internal bridge, Vue app state, and platform-host internals out of the supported first-slice script API.
- [x] Ensure action trace records executor identity, status/error, and summarized input/output.
- [x] Ensure workspace mutations still sync local workspace file state and emit mutation trace.
- [x] Add focused verification for existing actions, invalid executor declarations, timeout/failure behavior, and the chosen new path.
- [x] Update `.trellis/spec/platform-web/frontend/type-safety.md` if executor contracts or boundaries change.
- [x] Update `docs/active/agent-framework-runtime-workspace-direction.md` and `docs/active/current-state-handoff.md` if the runtime direction changes.
- [x] Run `npm run build:web`.
- [x] Run `npm run build:contracts` if shared contracts are changed.
- [x] Run `git diff --check`.

## Risky Files

- `apps/platform-web/src/agent-runtime/workspace-tools.ts`
- `apps/platform-web/src/agent-runtime/index.ts`
- `apps/platform-web/src/platform-host/index.ts`
- `apps/platform-web/src/agent-runtime/trace.ts`
- `packages/contracts/src/runtime.ts`
- `apps/platform-web/src/storage/workspace.ts`
- `apps/platform-web/src/storage/db.ts`
- `apps/platform-web/src/storage/default-workspace` or equivalent default workspace seed files, if sample Skills/scripts are added

## Validation Plan

- Build: `npm run build:web`
- Contract build, only if contracts changed: `npm run build:contracts`
- Diff hygiene: `git diff --check`
- Focused runtime probe:
  - load a Skill with a default validation action and call it;
  - load a Skill with `platform_action/workspace-write` and verify workspace mutation plus trace;
  - call an unsupported executor and verify structured error;
  - trigger the trusted browser script executor and verify success, workspace access, network behavior when enabled, failure, timeout, and trace summary behavior.

## Rollback Points

- After declaration normalization changes, confirm existing built-in actions still work before touching platform-host.
- After platform-host capability changes, confirm workspace-write/delete still sync workspace file state.
- After the trusted script executor is added, disable it via allow-list if it fails validation while preserving the shared foundation.
