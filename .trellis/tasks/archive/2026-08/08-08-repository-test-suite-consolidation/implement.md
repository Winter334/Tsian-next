# Implementation Plan — 全仓测试主干收敛

## Preconditions

- [ ] Planning artifacts and curated context manifests pass `task.py validate`.
- [ ] User explicitly approves the final planning summary in a new message.
- [ ] Run `task.py start` only after that approval; no production/test deletion begins while status is `planning`.
- [ ] Snapshot `git status --short`; keep `.codex/config.toml` excluded.
- [ ] Confirm the current inventory is 122 Vitest files plus 6 Go files and the only pre-existing task-related dirty files are the four Agent Runtime tests recorded in the PRD.

## Phase 1 — Establish the Frontend Action smoke

- [ ] Rewrite `apps/platform-web/src/bridge/remote-iframe-bridge.test.ts` to two scenarios only.
- [ ] Reuse the existing happy-dom iframe/message harness, but replace the synthesized service result with a thin adapter around a real `createFrontendActionExecutionService`.
- [ ] Seed card/save/Action/workspace state through production storage APIs and fake IndexedDB.
- [ ] Add a deterministic scripted Worker fixture that exercises real workspace reads/writes without claiming real Worker isolation.
- [ ] Success: prove durable write, exact actual mutation paths, and mutation event before success response.
- [ ] Conflict: mutate an observed dependency after snapshot and before commit; prove typed conflict, zero persisted delta/timestamp/checkpoint change, and no mutation/success.
- [ ] Run `npx vitest run apps/platform-web/src/bridge/remote-iframe-bridge.test.ts` and `npm run build:web`.

**Exit gate:** The retained file reaches real lifecycle/service/transaction/Dexie boundaries and passes without a mocked commit.

## Phase 2 — Establish the Assistant runtime smoke

- [ ] Add `apps/platform-web/src/integration/assistant-runtime.smoke.test.ts` with local happy-dom and `fake-indexeddb/auto` setup.
- [ ] Seed a real local card, active save, Assistant model config/files, baseline session/context and workspace via production APIs.
- [ ] Mock only provider HTTP, deterministic time/IDs where required, and unavailable browser globals.
- [ ] Success: native Tool write then read, final reply, same-turn staged observation visible in the next Provider request, durable save-runtime commit, conversation/context persistence, no raw Tool result persistence, and sanitized succeeded diagnostic.
- [ ] Failure: stage a save-runtime write, return an immediate non-retryable Provider error on the next round, then prove workspace/session/context baselines are unchanged and the failed sanitized diagnostic remains queryable.
- [ ] Do not mock `runAgentRuntimeTurn`, workspace commit, session/context writes or diagnostic persistence.
- [ ] Run `npx vitest run apps/platform-web/src/integration/assistant-runtime.smoke.test.ts` and `npm run build:web`.

**Exit gate:** Both Assistant scenarios pass through the production host entry and persistence boundaries.

## Phase 3 — Reduce the Server smoke

- [ ] Reduce `apps/platform-server/internal/server/market_test.go` to one `TestMarketSmoke` with unauthorized and authenticated transaction scenarios.
- [ ] Keep the real `httptest` router, login/session route, SQLite repository and temporary blob directory.
- [ ] Unauthorized: assert 401 plus unchanged DB row count and empty blob store.
- [ ] Authenticated: upload one valid package, list/detail it, download it and compare exact bytes.
- [ ] Delete helpers/imports used only by removed market matrices.
- [ ] Run `go -C ./apps/platform-server test ./internal/server -run TestMarketSmoke` and `go -C ./apps/platform-server build ./...`.

**Exit gate:** The only retained Go test is the real market transaction smoke.

## Phase 4 — Make verification entry points explicit

- [ ] Update root `package.json` exactly to the script contract in `design.md`.
- [ ] Remove `test:equipment`.
- [ ] Keep `test:frontend-actions:production-browser` unchanged.
- [ ] Narrow `test:frontend-actions` to the retained bridge smoke.
- [ ] Add all missing workspace build aliases, `build:server`, `build:all`, explicit Web/Server smoke scripts and `verify`.
- [ ] Point root `test` to `test:smoke`.
- [ ] Remove the unused play-bridge environment glob from `vitest.config.ts` only if no retained test uses it.
- [ ] Run `npm run test:smoke` before deleting old tests.

**Exit gate:** The root commands select only the intended three-file suite and all package builds are reachable.

## Phase 5 — Delete the retired suites in reversible groups

Use the exact inventory in `research/minimal-smoke-suite.md`; verify resolved paths before each deletion and use `apply_patch` for file removals.

### 5.1 UI and presentation group

- [ ] Delete all `apps/platform-web/src/spatial/**/*.test.ts`.
- [ ] Delete all controller, component, view and composable tests, including both play controller integration files.
- [ ] Delete miscellaneous platform-web config/lib/top-level unit tests and both play-frontend tests.
- [ ] Run `npm run test:smoke:web` and `npm run build:web`.

### 5.2 Runtime, host, storage and bridge seams

- [ ] Delete all Agent Runtime, Runtime Host, Platform Host and Storage tests.
- [ ] Delete `remote-frontend-action-lifecycle.test.ts`, retaining only the rewritten bridge smoke.
- [ ] Delete both play-bridge tests.
- [ ] Confirm the four pre-existing dirty Agent Runtime test files are gone and not separately staged as edits.
- [ ] Run `npm run test:smoke:web`, `npm run build:contracts`, `npm run build:play-bridge` and `npm run build:web`.

### 5.3 Extra Go suites

- [ ] Delete `server_test.go`, `admin_features_test.go`, both auth tests and `config/envfile_test.go`.
- [ ] Run `npm run test:smoke:server` and `npm run build:server`.

**Exit gate:** `rg --files -g '*.test.ts' -g '*.test.tsx' -g '*_test.go'` returns exactly the three approved paths.

## Phase 6 — Quality check and spec synchronization

- [ ] Run a full-scope `trellis-check` against PRD/design/implementation artifacts.
- [ ] Use `trellis-update-spec` in required Phase 3.3; do not hand-wave contradictory exhaustive-test requirements.
- [ ] Update the Test Maintenance Policy to the smoke-only admission model.
- [ ] Sweep all `Tests Required`, test-matrix and named-suite references under `.trellis/spec/platform-web/**` and `.trellis/spec/contracts/**`.
- [ ] Keep product behavior matrices as normative documentation while mapping verification to the retained smoke, build, production-browser or manual UI gate.
- [ ] Explicitly mark UI/Spatial/component/controller validation as manual.
- [ ] Re-run the grep sweep and confirm no deleted suite is still mandatory.

## Phase 7 — Final validation

Run focused checks during implementation, then the final authoritative gate:

```powershell
npm run test:smoke:web
npm run test:smoke:server
npm run build:all
npm run test:frontend-actions:production-browser
npm test
npm run verify
git diff --check
python ./.trellis/scripts/task.py validate 08-08-repository-test-suite-consolidation
```

- [ ] Inventory is exactly 2 Vitest files and 1 Go test file.
- [ ] Vitest has at most four accepted scenarios; Go has exactly two accepted smoke scenarios under `TestMarketSmoke`.
- [ ] Record before/after counts in the task result or journal: 128 files to 3, 122 Vitest files/904 cases to 2 files/at most 4 cases, and 6 Go files to 1 file/2 scenarios.
- [ ] Confirm no product source was changed to satisfy removed tests.
- [ ] Confirm `.codex/config.toml` remains unstaged and outside the task diff.
- [ ] Do not report automated UI validation; hand UI/Spatial verification back to the user.

## Rollback points

1. If either new Web smoke cannot cross the required real boundaries, revert that smoke change and return to planning before deleting any source test.
2. If root scripts fail before deletion, restore the previous script block and repair the smoke selection first.
3. If a deletion group breaks a retained smoke/build, restore only that group, identify the hidden fixture/import dependency, and move only the indispensable setup into the owning smoke.
4. Never restore broad suites as a reflex, add production test seams, or modify product behavior to make a retired assertion pass.

No implementation, deletion, task start, commit or push is authorized by this document alone.
