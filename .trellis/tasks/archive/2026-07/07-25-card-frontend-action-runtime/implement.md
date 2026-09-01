# Implementation Plan

## Pre-Implementation Context

Load this task PRD/design/research and `implement.jsonl`. Confirm the parent/equipment task remains planning. Record current dirty baseline and do not include existing `07-21-*` task edits.

Before dependency installation, run the concrete production CSP preflight: serve a production bundle with target CSP headers and execute representative Ajv 2020-12 compilation plus the actual browser-script Worker on supported browsers. Record `script-src`/`worker-src`/Blob requirements. If dynamic compilation is forbidden, stop and choose a CSP-compatible schema interpreter and Worker loading design; moving Ajv to another realm or weakening strict validation is not a fallback.

## Step 1: Shared Frontend Action contracts

Files:

- `packages/contracts/src/bridge.ts`
- `packages/contracts/src/index.ts` or existing export barrel

Tasks:

- Add strict `JsonValue`/plain JSON-facing Action request, result, discriminated runtime/domain public error and mutation event types without widening bridge data to arbitrary `unknown`.
- Include invocationId, saveId and sorted actual paths in mutation events.
- Add remote card run/abort methods and event payloads with session invocation id.
- Keep Frontend Action absent from Agent/Skill/Tool runtime contracts.

Validation:

- `npm run build:contracts`.

## Step 2: Play Bridge semantic API

Files:

- `packages/play-bridge/src/tsian-api.ts`
- `packages/play-bridge/src/bridge.ts`
- `packages/play-bridge/src/index.ts`

Tasks:

- Expose `tsian.card.runAction(actionId, input, { signal? })`.
- Validate SDK input as strict JSON before postMessage; generate invocation id before transport; map AbortSignal to dedicated abort call and remove listeners/pending entry on settle.
- Bind pending requests to accepted session; session replacement rejects old Promises and stale response/events are ignored.
- Accept bridge messages only from `window.parent` and pin the accepted parent origin where deployment permits.
- Expose path-only Workspace mutation subscription through the established SDK event pattern.
- Throw documented discriminated `FrontendActionError`: preserve strictly validated card-defined domain code/details as `kind:"domain"`; map ordinary throws and invalid envelopes to sanitized runtime errors.

Validation:

- Build the play-bridge workspace/package using its existing script.
- Type-check a minimal consumer call with JSON input and AbortSignal.

## Step 3: Registry, runtime-Agent path isolation and strict validation

Files:

- New `apps/platform-web/src/platform-host/frontend-action-registry.ts`
- New focused JSON/schema validation module under `platform-host/`
- Runtime game-Agent Workspace projection/operation and context macro/query entry points
- `apps/platform-web/package.json`
- lockfile

Tasks:

- Add Ajv Draft 2020-12 runtime dependency and strict configuration.
- Discover only exact `frontend-actions/<kebab-id>/action.json` paths and add shared `isFrontendActionPath` filtering.
- Reject runtime game-Agent direct read/list/search/glob/effective projection/contextPaths/macro/query access to that namespace; keep desktop assistant/resource-manager card-content authoring unchanged.
- Give only the dedicated bound-card loader an explicit internal capability to read Action resources; do not use actor-level escalation.
- Parse versioned manifest with closed fields/hard resource limits and root-confine executor/helpers/static importScripts.
- Reject unsupported/remote/async refs (allow only same-document JSON Pointer fragments), unsupported vocabulary/format features and excessive data.
- Add recursive strict JSON validator for input/output: dense arrays and plain Object/null-prototype records with enumerable string data properties only; reject cycles, sparse arrays, accessors, symbols/non-enumerable properties and exotic objects.
- Execute strict checks SDK-side, host-side, raw Worker-side before loose normalization, and host-side after clone.
- Cache compiled validators by manifest/schema content identity.
- Return fail-loud diagnostics for the addressed action; do not build an enumerable frontend registry API.

Validation:

- Focused tests for valid/invalid ids, paths, schemas, nested validation, additionalProperties, enum/bounds and strict JSON edge cases.

## Step 4: Generalize browser-script execution

Files:

- `apps/platform-web/src/platform-host/browser-skill-script-executor.ts`
- Existing call sites for Skill/Tool execution
- New `apps/platform-web/src/platform-host/frontend-actions.ts`

Tasks:

- Replace Skill-specific root metadata with owner-neutral browser-script owner while preserving existing Skill/Tool behavior.
- Parse importScripts statically with `@babel/parser`; reject dynamic/mixed calls and paths outside declared action helpers.
- Add frontend Action execution context with actor level 1, only read/list/glob/write/delete, no `reply.project`/other SDK capability except dedicated `tsian.action.fail`, text-only JSON-safe results, and save-runtime-only writes.
- Validate domain-error envelopes (bounded code/message/strict-JSON details) and preserve valid card code/details as `kind:"domain"`; invalid envelope/ordinary throw becomes runtime execution failure.
- Resolve manifest/script/helpers/business reads from the bound-card atomic snapshot, not live effective Workspace.
- Run input validation before Worker, output strict-JSON/schema validation before commit.
- Propagate timeout/abort and always terminate Worker/discard staged transaction on non-success.
- Document that Worker network/time/random capabilities are not a deterministic sandbox.

Validation:

- Existing Skill/Tool browser scripts continue to run.
- Focused Action Worker tests cover success, validated domain error pass-through, invalid envelope/ordinary throw sanitization, malformed output, timeout, abort and forbidden operations.

## Step 5: Read-set-aware transaction

Files:

- `apps/platform-web/src/storage/workspace-types.ts`
- `apps/platform-web/src/storage/workspace.ts`
- `apps/platform-web/src/storage/saves.ts`
- Action execution adapter

Tasks:

- Add an atomic invocation-start snapshot loader over meta/save/bound-card/content/frontend/save-workspace rows with file provenance.
- Add normalized file/list/glob plus blind-write/delete-range dependency records.
- Record actual save-runtime dependency inputs/results against the invocation-start snapshot; staged read-after-write uses the overlay without replacing baseline signatures.
- Record exact Action resource row signatures and mounted gameCardId/session binding.
- Add no-checkpoint optimistic commit helper.
- In one Dexie transaction, validate active save/card/session binding, exact Action resources and every file/list/glob/write/delete dependency.
- Validate even read-only/no-op actions; do not retry after a related conflict.
- Merge only actual staged delta into current Workspace; preserve unrelated concurrent edits; reject relevant conflict with zero writes.
- Normalize overlapping write/delete operations; new descendants under a deleted prefix conflict; byte-identical writes disappear.
- Nonempty commit updates updatedAt; empty final delta changes no DB row, checkpoint or event.

Validation:

- fake-indexeddb integration tests: unrelated concurrent write survives; read/write/delete dependency changes conflict; success is atomic; failure creates no checkpoint.

## Step 6: Host/remote bridge lifecycle and privilege fix

Files:

- `apps/platform-web/src/platform-host/index.ts`
- `apps/platform-web/src/bridge/remote-iframe-bridge.ts`
- `apps/platform-web/src/platform-host/platform-actions.ts`
- Related bridge normalization/event code

Tasks:

- Compose Frontend Action service without routing through generic `platform.runAction`.
- Bind mount to expected gameCardId and maintain `(sessionId, invocationId)` lifecycle state; duplicate active id fails, unknown/completed abort is idempotent, dispose/session replacement aborts/rejects all old work.
- Define abort-versus-commit barrier: abort before committing prevents commit; durable commit wins over late abort; every terminal path cleans controller/pending/listener.
- Replace remote generic platform-action prefix denial with a host-enforced `play-frontend` caller and closed allowlist; unknown/future actions fail closed while desktop assistant remains trusted.
- Ensure caller cannot supply actor level, scope, save/card/session identity or caller role.
- Project stable typed public errors and no completion/mutation event for failed calls.

Validation:

- Remote invocation/abort/session replacement tests with barriers before commit and after durable commit.
- Table-driven regression enumerates all current platform actions: only explicit remote allowlist succeeds; workspace/unknown/future-default actions cannot reach assistant privilege.

## Step 7: Durable mutation notifications

Files:

- `apps/platform-web/src/lib/workspace-events.ts` or a dedicated runtime event module
- Host/remote bridge event dispatch
- play-bridge SDK event subscription

Tasks:

- Emit one path-only mutation event after durable nonempty commit with invocationId/saveId/source/actionId and sorted actual written/concrete deleted paths.
- Deliver only to the session still bound to the committed save/card, before successful response; local subscriber errors are isolated.
- Never emit on no-op, rollback, conflict, invalid output, abort, timeout or stale/disposed session.

Validation:

- Test event ordering after commit and zero events on all failure paths.

## Step 8: Test harness and executable coverage

Files:

- `apps/platform-web/package.json`
- Vitest config/setup and focused `*.test.ts` files
- lockfile

Tasks:

- Add a root Vitest project covering platform-web and play-bridge, fake-indexeddb, and a DOM environment; update lockfile.
- Inject Worker factory for executor tests rather than relying on emulator Worker support.
- Cover registry/resource limits, schema/strict JSON boundaries, valid/invalid domain-error envelope propagation, runtime-Agent filesystem isolation, Worker lifecycle/capabilities, atomic snapshot/read-only/no-op CAS, rollback, notification, SDK session pending state and privilege regression.
- Keep test fixtures small and use production exports rather than duplicate logic.

Validation:

- Run the new focused/full test script twice to catch leaked Workers/listeners/DB state.

## Step 9: Documentation and executable specs

Files:

- `docs/reference/tool-vs-skill.md`
- `docs/sdk/play-frontend-api.md`
- New `docs/sdk/frontend-actions.md`
- `docs/active/play-frontend-sdk-direction.md`
- `.trellis/spec/contracts/frontend/type-safety.md`
- `.trellis/spec/platform-web/frontend/type-safety.md`
- `.trellis/spec/platform-web/storage/index.md`

Tasks:

- Document Tool vs Skill vs Frontend Action audience/publication/calling boundaries.
- Document manifest hard limits/schema subset, strict JSON at each boundary, discriminated runtime/domain SDK errors, domain-envelope sanitization, abort state machine/mutation events and no-checkpoint default.
- Document that existing `tsian.workspace.write` remains a separate immediate API outside Action atomicity; do not imply Action is the only frontend mutation path.
- Record actor/read-set/CAS/runtime-Agent path invisibility/remote caller allowlist as executable scenarios with validation matrices and tests.
- State Worker network/time/random limitation accurately; do not promise a deterministic sandbox.

## Final Validation

```bash
npm run build:contracts
npm run <play-bridge-build-script>
npm run <platform-web-test-script>
npm run build:web
git diff --check
```

Also verify:

- no Frontend Action type/path appears in Agent/Skill/Tool Registry output or model context, and runtime Agent read/list/search/glob/context macro cannot discover it while desktop authoring can;
- no new hidden configurable DB field/table was introduced;
- no `workspace.*` remote generic action can use assistant actor resolution;
- no checkpoint is created by Action commit;
- only runtime-child and shared spec/doc files changed, apart from pre-existing dirty files.

## Rollback Points

- Contract/SDK methods can be removed without changing current methods.
- Owner-neutral executor refactor must be independently revertible if Skill/Tool parity fails.
- Optimistic commit helper is additive; do not replace existing Agent checkpoint commit paths.
- If strict schema/CSP cannot be reconciled, stop before exposing the RPC rather than ship shallow validation.

## Completion Criteria

All runtime PRD acceptance criteria and tests pass; security regression is proven; documentation/specs match shipped behavior; task can be committed and archived before equipment implementation starts.
