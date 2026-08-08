# Research: Minimal cross-layer smoke suite

- Query: Given the explicit decision to delete all UI/Spatial/component/controller tests and all pure unit, validator, storage-seam, host-seam, bridge-seam, and algorithm tests, define the smallest coherent repository-wide automated suite; name each retained transaction, its layers, one success and at most one failure/rollback scenario, its source tests, broad deletion groups, and required root scripts.
- Scope: internal
- Date: 2026-08-08

## Findings

### Recommendation

The smallest coherent final shape is **three test files**, each with one success scenario and at most one critical failure/rollback scenario, plus the existing production-browser Frontend Action preflight and explicit builds:

1. Retain and rewrite `apps/platform-web/src/bridge/remote-iframe-bridge.test.ts` as the Frontend Action transaction smoke.
2. Add `apps/platform-web/src/integration/assistant-runtime.smoke.test.ts` as the combined Assistant/Agent Runtime/persistence/diagnostics smoke.
3. Retain and reduce `apps/platform-server/internal/server/market_test.go` as the server HTTP/auth/persistence/blob smoke.
4. Keep `scripts/test-frontend-action-production-browser.mjs` and its Vite preflight bundle as a release gate, not as a Vitest file.

This reduces the repository from **122 Vitest files + 6 Go test files = 128 files** to **2 Vitest files + 1 Go test file = 3 files**. It deletes 126 existing test files, adds one integration file, and leaves no automated UI behavior test. The current PRD baseline of 904 Vitest cases becomes at most four Vitest scenarios and two Go scenarios; browser-preflight assertions remain outside that count.

The previous `runtime-platform-test-audit.md` recommendation to retain exhaustive security, validator, migration, and lifecycle matrices is intentionally superseded by `prd.md:19-45`, especially R1, R3, R6, and R7. Those matrices remain technically valuable, but the user has explicitly accepted discovering those defects later.

### Files found

| Path | Description |
|---|---|
| `.trellis/tasks/08-08-repository-test-suite-consolidation/prd.md` | Authoritative aggressive-retention decision and acceptance criteria. |
| `.trellis/tasks/08-08-repository-test-suite-consolidation/research/runtime-platform-test-audit.md` | Earlier conservative audit and cross-layer flow candidates. |
| `package.json` | Root workspace build and test scripts; currently `test` auto-discovers all Vitest files. |
| `vitest.config.ts` | Node default environment; only package bridge tests are globally mapped to happy-dom. |
| `apps/platform-web/src/bridge/remote-iframe-bridge.test.ts` | Strongest existing remote iframe RPC test, but currently uses a mocked Action service. |
| `apps/platform-web/src/bridge/remote-iframe-bridge.ts` | Remote iframe mount, request dispatch, lifecycle composition, event ordering, and default real Action service wiring. |
| `apps/platform-web/src/bridge/remote-frontend-action-lifecycle.ts` | Invocation ownership, abort, commit barriers, stale-binding checks, and delivery suppression. |
| `apps/platform-web/src/platform-host/frontend-actions/service.ts` | Production Action orchestration from validation through Worker execution and workspace commit. |
| `apps/platform-web/src/storage/frontend-action-workspace.ts` | Fake/real IndexedDB snapshot and atomic CAS commit implementation. |
| `apps/platform-web/runtime-preflight/main.ts` | Browser page that runs production schema/Worker and equipment transport probes. |
| `scripts/test-frontend-action-production-browser.mjs` | Builds, serves, and opens the preflight in a real Chrome/Edge/Chromium process. |
| `apps/platform-web/src/platform-host/assistant-chat.ts` | Highest cross-layer non-UI Assistant entry: Agent Runtime, provider calls, workspace transaction, conversation/context persistence, commit/discard. |
| `apps/platform-web/src/runtime-host/ai/calls.ts` | Real provider-boundary calls, retries, and trace lifecycle. |
| `apps/platform-web/src/runtime-host/ai/trace-recorder.ts` | Diagnostic request lifecycle and failure isolation. |
| `apps/platform-web/src/storage/diagnostic-records.ts` | Dexie diagnostic persistence, sanitization, and query entry points. |
| `apps/platform-web/src/platform-host/diagnostics-query.ts` | Bounded controlled diagnostics query surface. |
| `apps/platform-web/src/platform-host/diagnostic-bundle.ts` | Export selection, second-pass sanitization, and bundle creation. |
| `apps/platform-server/internal/server/market_test.go` | Existing full HTTP market upload/list/download path with auth, SQLite, and filesystem blobs. |
| `apps/platform-server/internal/server/server.go` | Server router composition for auth, market, backup, announcement, presence, admin, and static routes. |

### Current architecture and strongest boundaries

- Root `npm test` is currently `vitest run`, so every matching file is collected (`package.json:19`). Focused scripts separately enumerate equipment and Frontend Action piles (`package.json:20-22`).
- Vitest defaults to Node (`vitest.config.ts:15-20`). The retained remote iframe smoke already declares happy-dom in-file; the new Assistant smoke should also declare happy-dom and import `fake-indexeddb/auto` so it can use browser storage APIs without adding a new test runner.
- The remote iframe production path composes the real Action service by default (`apps/platform-web/src/bridge/remote-iframe-bridge.ts:717-848`), and dispatches `card.runAction` through the mount-owned lifecycle before posting success (`apps/platform-web/src/bridge/remote-iframe-bridge.ts:882-976`).
- The Action service validates input, resolves and inlines the Action, runs the Worker, validates output, commits, emits mutation, and discards staging in `finally` (`apps/platform-web/src/platform-host/frontend-actions/service.ts:151-257`). The storage commit uses one Dexie transaction, validates live dependencies before writes, and emits stable actual paths (`apps/platform-web/src/storage/frontend-action-workspace.ts:1344-1447`).
- `runAssistantChat` is the strongest non-UI runtime entry (`apps/platform-web/src/platform-host/assistant-chat.ts:292`). It creates the real workspace transaction (`:407`), invokes Agent Runtime (`:470`), persists conversation/context and commits workspace only on success (`:778-802`), and discards on failure (`:814-831`).
- Every real provider call begins a diagnostic trace (`apps/platform-web/src/runtime-host/ai/calls.ts:81-166`, `:171-270`, `:275-536`, `:558-796`). Diagnostic records are sanitized and written/queryable through `prepareDiagnosticRecord`, `putDiagnosticRecord`, and cursor-backed query functions (`apps/platform-web/src/storage/diagnostic-records.ts:166-360`).
- The existing server market fixture opens real SQLite, mounts the production router, and uses a real cookie jar (`apps/platform-server/internal/server/market_test.go:108-173`). Its upload/list/download case already begins at HTTP and verifies downloaded bytes (`:176-304`). The router itself composes auth middleware, market handler/repository, and filesystem blob storage (`apps/platform-server/internal/server/server.go:32-80`).
- The production-browser gate compiles the representative Draft 2020-12 schema and executes the production Worker (`apps/platform-web/src/platform-host/frontend-actions/preflight.ts:90-148`). It also runs the real equipment Action source and verifies a domain failure stages zero writes (`apps/platform-web/src/platform-host/equipment-scripts/equipment-worker-preflight.ts:44-94`). The harness launches a real browser and checks opaque-origin capability removal (`scripts/test-frontend-action-production-browser.mjs:134-198`).

### Final smoke 1: Frontend Action remote transaction

**File:** retain and rewrite `apps/platform-web/src/bridge/remote-iframe-bridge.test.ts`.

**Why this existing file:** its happy-dom iframe/message harness is already the highest entry point on the host side. It should be reduced from its current seven Action cases plus Tool forwarding to two cases, while replacing the mocked `RemoteFrontendActionService` with `createFrontendActionExecutionService` configured with a deterministic scripted Worker and real fake-IndexedDB snapshot/commit dependencies. A new file is unnecessary if the existing harness is upgraded this way.

**Layers traversed:** remote iframe `postMessage` protocol → mount/session/origin ownership → `createRemoteFrontendActionLifecycle` → `createFrontendActionExecutionService` → manifest/registry/import/schema validation → deterministic Worker boundary → workspace SDK adapter → `RuntimeWorkspaceTransaction` → Dexie snapshot/read-set/CAS commit → workspace-mutation event → remote success/error response.

**Success scenario:** seed one card, active save, Action manifest/executor, and baseline workspace row; send one `card.runAction`; the scripted Worker reads then stages one write; assert the row is durably changed, the mutation payload contains only actual paths, and the mutation event is posted before the success response.

**Critical failure/rollback scenario:** change an observed workspace dependency or active save/card binding immediately before the final commit assertion; assert a typed workspace conflict, zero writes/timestamp/checkpoints, and no mutation/success delivery. This single conflict represents abort/domain/output/CAS rollback without preserving a matrix for every cause.

**Source tests retired by this smoke and the browser gate:**

- `apps/platform-web/src/bridge/remote-frontend-action-lifecycle.test.ts`.
- All eight files under `apps/platform-web/src/platform-host/frontend-actions/*.test.ts`.
- `apps/platform-web/src/storage/frontend-action-workspace.test.ts`.
- `packages/play-bridge/test/frontend-action.test.ts` and `packages/play-bridge/test/tool-event.test.ts`.
- The Frontend Action portions of `apps/platform-web/src/platform-host/browser-skill-script-executor.test.ts`, `platform-actions.test.ts`, `assistant-chat.frontend-action-isolation.test.ts`, and `apps/platform-web/src/agent-runtime/frontend-action-isolation.test.ts`.
- Real Worker/schema/equipment obligations from `worker.test.ts`, `schema.test.ts`, `equipment-scripts.test.ts`, and both `apps/play-frontend-dev` equipment tests move to the production-browser sample; their exhaustive matrices are deliberately lost.

**Acceptance guard for implementation:** if the rewritten test still injects a mocked service or mocked commit, it remains a bridge seam and does not qualify. The service, transaction, and Dexie commit must be real; only the unavailable Node Worker implementation may be deterministic because the production-browser gate owns the real Worker.

### Final smoke 2: Assistant turn, persistence, rollback, and diagnostics

**File:** add `apps/platform-web/src/integration/assistant-runtime.smoke.test.ts`.

**Why a new integration file is needed:** no existing file crosses the full boundary. `agent-runtime/staged-workspace-coherence.test.ts` stops at an in-memory transaction, `runtime-host/ai/calls.test.ts` stops at provider diagnostics, and `assistant-chat.frontend-action-isolation.test.ts` mocks nearly every storage/host dependency. Combining their strongest behavior at `runAssistantChat` creates one real product transaction instead of preserving any seam file.

**Layers traversed:** platform-host Assistant entry → active card/save and local Assistant storage → Agent registry/context/environment → native provider adapter with fetch as the only external fake → Agent Runtime round loop → Tool schema/dispatch/observation → workspace transaction/read-your-writes → conversation/context/workspace Dexie persistence → provider trace recorder → diagnostic Dexie query → bounded diagnostics query or export bundle.

**Success scenario:** seed a real local card/save and local Assistant; return one native `write` Tool call, one following `read`, then a final reply from the mocked HTTP provider; assert same-turn read observes the staged value, the turn commits it, the conversation persists only the bounded presentation (not raw Tool output), and a succeeded credential-scrubbed diagnostic record is queryable.

**Critical failure/rollback scenario:** let a first model round stage a workspace write, then make the next provider request fail; assert the workspace, Assistant session, and context are not committed, while the failed provider diagnostic survives independently and its controlled query/export contains no credential. This one scenario proves both transaction rollback and failure observability.

**Source tests retired by this smoke:**

- All 15 `apps/platform-web/src/agent-runtime/**/*.test.ts` files.
- All three `apps/platform-web/src/runtime-host/**/*.test.ts` files.
- `apps/platform-web/src/platform-host/assistant-chat.frontend-action-isolation.test.ts`, `diagnostic-bundle.test.ts`, `diagnostics-query.test.ts`, `diagnostics-workspace-adapter.test.ts`, `diagnostics.test.ts`, and `turn-timeline-collector.test.ts`.
- `apps/platform-web/src/storage/assistant-conversations.test.ts`, `diagnostic-records.test.ts`, and `local-assistant-knowledge.test.ts`.
- Assistant mapper/presentation, monitor/controller, and config behavior tests are deleted under the UI/controller rule; only the non-UI persistence result sampled here remains.

**Acceptance guard for implementation:** seed storage through production host/storage APIs and mock only the network/provider response, time, and unavoidable browser globals. A file that mocks `runAgentRuntimeTurn`, `commitWorkspaceChangesForSave`, diagnostic writes, or conversation persistence is a seam test and does not qualify.

### Final smoke 3: Server market/auth/persistence/blob path

**File:** retain and reduce `apps/platform-server/internal/server/market_test.go`.

**Why this existing file:** `TestMarketUploadListDownload` is already the only Go case that naturally traverses the router, auth session, middleware, handler, SQLite repository, filesystem blob store, and public download. Keep its packaging helpers, remove every unrelated matrix, and leave one success plus one authorization failure, preferably as two named subtests.

**Layers traversed:** `httptest` HTTP client → production `Server.Handler` router → mock-login/session cookie → auth middleware → market handler/package parsing → SQLite repository → filesystem blob store → public list/detail/download HTTP response.

**Success scenario:** mock-login, upload one valid package, list/get it, download it, and assert the bytes match the upload. Detailed cover normalization, pagination, search, ownership, migration, and resource-type variants are not retained.

**Critical failure scenario:** attempt the same upload without a session; assert HTTP 401 and verify neither a market row nor blob was created. This is the only retained server failure branch.

**Source tests retired by this smoke:** simplify the rest of `market_test.go` and delete `server_test.go`, `admin_features_test.go`, `auth/handler_test.go`, `auth/discord_test.go`, and `config/envfile_test.go`. Auth mock login is sampled only as setup for the market success; Discord OAuth, admin, announcements, presence, static serving, env parsing, validation matrices, and migrations become build/manual/production-discovery risks.

### Retained production-browser gate

**Files:** keep `apps/platform-web/runtime-preflight/**`, `apps/platform-web/vite.runtime-preflight.config.ts`, `apps/platform-web/src/platform-host/frontend-actions/preflight.ts`, `apps/platform-web/src/platform-host/equipment-scripts/equipment-worker-preflight.ts`, and `scripts/test-frontend-action-production-browser.mjs`.

**Layers traversed:** production Vite bundle → local HTTP server → real Chrome/Edge/Chromium → page-origin IndexedDB/Cache sentinels → production Ajv schema compiler → production data-URL Worker factory → opaque-origin isolation/tamed globals → real packaged equipment Action manifest/imports/source → public domain-error transport.

**Success scenario:** production schema compiles, representative valid data passes, invalid data fails, and a real Worker runs with opaque origin and blocked ambient storage/Worker capabilities.

**Critical failure/rollback scenario:** real equipment Action receives a stale expected reference, transports `EQUIPMENT_EXPECTED_REF_MISMATCH`, and performs zero workspace writes.

This gate stays separate because fake IndexedDB, happy-dom, and scripted Workers cannot prove production bundling, opaque origin, or ambient-global removal. The existing root command at `package.json:22` can remain byte-for-byte.

### Exact broad deletion groups

| Group | Exact boundary | Current files | Final files | Action |
|---|---|---:|---:|---|
| UI and Spatial | `apps/platform-web/src/spatial/**/*.test.ts` | 43 | 0 | Delete all. |
| Controllers | `apps/platform-web/src/controllers/**/*.test.ts` | 19 | 0 | Delete all, including the two play integration files. |
| Components/views/composables | `apps/platform-web/src/components/**/*.test.ts` (1), `views/**/*.test.ts` (3), `composables/**/*.test.ts` (2) | 6 | 0 | Delete all. |
| Play frontend | `apps/play-frontend-dev/src/**/*.test.ts` | 2 | 0 | Delete both equipment data/coordinator files. |
| Miscellaneous platform-web unit tests | `apps/platform-web/src/config/**/*.test.ts` (3), `lib/**/*.test.ts` (2), and top-level `src/*.test.ts` (3) | 8 | 0 | Delete all. |
| Agent Runtime | `apps/platform-web/src/agent-runtime/**/*.test.ts` | 15 | 0 | Delete all; replace with the new Assistant transaction smoke. |
| Bridge | `apps/platform-web/src/bridge/**/*.test.ts` | 2 | 1 | Delete lifecycle test; rewrite remote iframe test. |
| Platform Host | `apps/platform-web/src/platform-host/**/*.test.ts` | 17 | 0 | Delete all; sample only through the two web transaction smokes/browser gate. |
| Runtime Host | `apps/platform-web/src/runtime-host/**/*.test.ts` | 3 | 0 | Delete all; provider/diagnostics sampled through Assistant smoke. |
| Storage | `apps/platform-web/src/storage/**/*.test.ts` | 5 | 0 | Delete all; Dexie sampled through both web transaction smokes. |
| Play Bridge package | `packages/play-bridge/test/**/*.test.ts` | 2 | 0 | Delete both; retain package build only. |
| Go server | `apps/platform-server/**/*_test.go` | 6 | 1 | Retain reduced `internal/server/market_test.go`; delete five files. |
| **Total** | Repository | **128** | **3** | Delete 126 existing files and add one new file. |

The paths above account for every current test file. There are no current test files under `apps/admin-web`, `packages/contracts`, or `packages/web-utils`; those packages are build-gated only.

### Required `package.json` script updates

Only the root `package.json` requires script changes. Package-local build scripts already exist.

Recommended final script block additions/replacements:

```json
{
  "build:play-frontend": "npm run build --workspace play-frontend-dev",
  "build:play-bridge": "npm run build --workspace @tsian/play-bridge",
  "build:web-utils": "npm run build --workspace @tsian/web-utils",
  "build:server": "go -C ./apps/platform-server build ./...",
  "build:all": "npm run build:contracts && npm run build:play-bridge && npm run build:web-utils && npm run build:web && npm run build:admin && npm run build:play-frontend && npm run build:server",
  "test": "npm run test:smoke",
  "test:smoke:web": "vitest run apps/platform-web/src/bridge/remote-iframe-bridge.test.ts apps/platform-web/src/integration/assistant-runtime.smoke.test.ts",
  "test:smoke:server": "go -C ./apps/platform-server test ./...",
  "test:smoke": "npm run test:smoke:web && npm run test:smoke:server",
  "test:frontend-actions": "vitest run apps/platform-web/src/bridge/remote-iframe-bridge.test.ts",
  "test:frontend-actions:production-browser": "npm exec vite build -- --config apps/platform-web/vite.runtime-preflight.config.ts && node scripts/test-frontend-action-production-browser.mjs",
  "verify": "npm run build:all && npm run test:smoke && npm run test:frontend-actions:production-browser"
}
```

Required removals/behavior changes:

- Remove `test:equipment`; the dedicated equipment suites no longer exist, and the one retained equipment failure is in the production-browser preflight.
- Replace broad auto-discovery in `test` with the explicit smoke list. This makes adding a file insufficient by itself; a future test must also be admitted into `test:smoke:web` or `test:smoke:server`.
- Replace the current long `test:frontend-actions` file list with the one transaction smoke. Keep the production-browser command unchanged.
- Add all missing workspace builds plus Go build to `build:all`; current root scripts cover only contracts, platform-web, and admin (`package.json:16-18`).
- Make `verify` the pre-commit/release gate. No repository CI workflow was found, so any external CI must be updated separately to invoke `npm run verify`.

`vitest.config.ts` needs no functional change because both surviving web files can declare their environments locally. Its now-unused `packages/play-bridge/**/*.test.ts` happy-dom match may be removed as cleanup, but it is not required.

### Suggested consolidation order

1. Build the new Assistant smoke and upgrade the remote iframe smoke while all source tests still exist; prove each new success/failure pair independently.
2. Reduce `market_test.go` to the HTTP success/unauthorized pair and run `go test ./...`.
3. Update root scripts so `npm test` runs exactly the three-file suite and `npm run verify` runs builds plus the real-browser gate.
4. Delete by the exact groups above, rerunning `test:smoke:web`, `test:smoke:server`, relevant builds, then the browser gate after each major web/server batch.
5. Finish with `npm run verify` and a manual UI/Spatial checklist; do not add automated UI assertions in response to manual findings unless the product decision changes.

### External references and local versions

No web research was necessary. The design uses the checked-in toolchain:

- Vitest `^4.1.10`, happy-dom `^20.11.1`, and fake-indexeddb `^6.2.5` (`package.json:25-28`).
- Vite `^6.0.5`, Vue `^3.5.x`, Ajv `^8.20.0`, and Dexie `^4.0.11` from workspace manifests/lockfile.
- Go `1.24.0` (`apps/platform-server/go.mod`).

### Related specs

- `.trellis/spec/platform-web/frontend/quality-guidelines.md:3-25` — build requirements and current Test Maintenance Policy.
- `.trellis/spec/platform-web/frontend/type-safety.md:79-159` — Frontend Action host/security boundary.
- `.trellis/spec/platform-web/frontend/type-safety.md:583-675` — Agent Runtime request/tool/workspace behavior.
- `.trellis/spec/platform-web/storage/index.md:245-342` — Frontend Action snapshot/CAS transaction and event ordering.
- `.trellis/spec/platform-web/storage/diagnostics.md:55-119` — diagnostic persistence, query/export, and the current exhaustive test matrix.
- `.trellis/spec/contracts/frontend/type-safety.md:126-225` — shared Frontend Action transport contract.
- `.trellis/spec/contracts/backend/quality-guidelines.md:5-20` — contract build requirements.

## Caveats / Not Found

- This is a static architecture proposal; no tests or builds were run and no code/tests were edited.
- The final suite intentionally does **not** prove UI startup/behavior, Spatial rendering/input/resource cleanup, controller ownership, provider parity, validator/adversarial matrices, migrations/retention, SDK origin/session edge cases, OAuth/admin/presence/announcement behavior, or most server/package validation. Builds catch syntax/type/bundle breakage only.
- The real-browser gate is not a full application E2E. It proves the production Frontend Action schema/Worker isolation path and one equipment domain failure, but it does not mount the actual app, remote iframe SDK, Assistant UI, or server.
- The retained remote iframe smoke will still use a scripted Worker because Node/happy-dom cannot prove real Worker isolation. The real-browser gate is therefore mandatory and must never be replaced by that smoke.
- `packages/play-bridge` receives only a build gate after deletion. A protocol-compatible but behaviorally wrong SDK can ship until manual/production discovery; this is part of the accepted risk.
- Several current specs still explicitly require exhaustive storage, diagnostics, provider, and Frontend Action matrices. Implementing this plan without a subsequent `trellis-update-spec` pass would leave `.trellis/spec/` contradictory to the PRD. This research role cannot edit specs; the main session should reconcile those requirements and add the new test-admission rule from AC6.
- No checked-in CI workflow was found. The proposed `verify` script creates one authoritative local/release command, but external CI configuration, if any, must be located outside this repository.
- If the new Assistant smoke needs mocks for runtime, transaction commit, conversation storage, or diagnostic persistence, the current architecture does not expose a sufficiently testable cross-layer entry. In that case, do not keep the mocked test as a substitute; either seed production storage APIs successfully or reduce the retained claim and explicitly accept that the transaction has no automated smoke.
