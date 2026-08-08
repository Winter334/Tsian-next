# Design — 全仓测试主干收敛

## 1. Boundary and ownership

本任务只重构验证拓扑，不改变产品行为。最终验证分为四个责任层：

| Boundary | Owns | Does not own |
|---|---|---|
| Web transaction smoke | 两条真实跨层浏览器宿主事务在 Node/happy-dom/fake IndexedDB 中的编排、提交与回滚 | UI、真实 Worker 隔离、完整恶意输入矩阵 |
| Server transaction smoke | production HTTP router、认证、SQLite、blob store 的最小成功/拒绝路径 | OAuth、admin、announcement、presence、迁移和资源类型矩阵 |
| Production-browser gate | 生产 Vite bundle、Ajv、真实 Worker、opaque-origin 和 equipment domain failure | 完整应用 UI/E2E、远程 iframe 全流程 |
| Build gates | 全部 TypeScript/Vite workspace 与 Go server 可编译 | 运行时行为、视觉或交互正确性 |

UI 是消费端，验证责任由用户手工承担；本任务不把 UI 业务重新放进测试基础设施。

## 2. Final topology

```text
npm run verify
  -> npm run build:all
  -> npm run test:smoke
       -> remote-iframe-bridge.test.ts
       -> assistant-runtime.smoke.test.ts
       -> market_test.go::TestMarketSmoke
  -> npm run test:frontend-actions:production-browser
       -> Vite runtime-preflight bundle
       -> real Chrome / Edge / Chromium
```

最终仓库只有三个测试文件。生产浏览器脚本是 release gate，不计入测试文件数，也不能合并进 Vitest。

## 3. Smoke contracts

### 3.1 Frontend Action remote transaction

**File:** `apps/platform-web/src/bridge/remote-iframe-bridge.test.ts`

**Real path:**

```text
remote postMessage request
  -> mount/session/origin routing
  -> createRemoteFrontendActionLifecycle
  -> createFrontendActionExecutionService
  -> manifest/import/schema validation
  -> deterministic scripted Worker
  -> workspace adapter + RuntimeWorkspaceTransaction
  -> fake IndexedDB snapshot/read-set/CAS commit
  -> workspace-mutation event
  -> remote response
```

Only the Worker execution primitive is scripted because happy-dom cannot prove real Worker isolation. The injected `RemoteFrontendActionService` adapter must delegate to a real `createFrontendActionExecutionService`; it may not synthesize the result or commit.

Success seeds one card/save/Action and a baseline workspace file, sends `card.runAction`, performs a read plus staged write, and proves durable bytes, actual mutation paths, and event-before-success ordering.

Failure takes the real snapshot, changes an observed dependency before commit from the scripted Worker fixture, and proves a typed workspace conflict, unchanged workspace/save timestamp/checkpoints, and no mutation or success delivery.

### 3.2 Assistant runtime transaction

**File:** `apps/platform-web/src/integration/assistant-runtime.smoke.test.ts`

**Real path:**

```text
runAssistantChat
  -> active card/save + local Assistant files
  -> Agent registry/context/environment
  -> native provider adapter (mocked fetch only)
  -> Agent Runtime rounds
  -> workspace Tool dispatch + strict observation
  -> RuntimeWorkspaceTransaction
  -> conversation/context/workspace persistence
  -> provider trace recorder
  -> diagnostic Dexie query
```

The fixture uses happy-dom plus `fake-indexeddb/auto`, resets the production Dexie database around each scenario, and seeds through production storage APIs. Network responses, deterministic time/IDs where required, and unavailable browser globals are the only fakes.

Success returns native Tool calls that write then read a save-runtime path, followed by a final reply. The fixture inspects the follow-up provider request to prove the read observation saw the staged value, then verifies durable workspace content, persisted conversation/context, bounded presentation without raw Tool output, and a succeeded credential-scrubbed diagnostic record.

Failure lets the first provider round stage a save-runtime write and returns a non-retryable Provider failure on the following round. It verifies persisted workspace, session messages, and Assistant context remain at their baselines while the failed diagnostic remains independently queryable and contains no credential.

### 3.3 Server market transaction

**File:** `apps/platform-server/internal/server/market_test.go`

One top-level `TestMarketSmoke` owns two named subtests or equivalent phases over the existing real fixture:

- Unauthorized upload: no session, HTTP 401, no market row, no blob file.
- Authenticated flow: mock login through the production route, upload one valid package, list/detail it, download it, and compare bytes.

The smoke keeps `httptest`, production `Server.Handler`, SQLite and a temporary filesystem blob directory. Helpers that only support deleted matrices are removed.

## 4. Script contract

Root `package.json` becomes the single verification interface:

```json
{
  "build:play-frontend": "npm run build --workspace play-frontend-dev",
  "build:play-bridge": "npm run build --workspace @tsian/play-bridge",
  "build:web-utils": "npm run build --workspace @tsian/web-utils",
  "build:server": "go -C ./apps/platform-server build ./...",
  "build:all": "npm run build:contracts && npm run build:play-bridge && npm run build:web-utils && npm run build:web && npm run build:admin && npm run build:play-frontend && npm run build:server",
  "test": "npm run test:smoke",
  "test:smoke:web": "vitest run apps/platform-web/src/bridge/remote-iframe-bridge.test.ts apps/platform-web/src/integration/assistant-runtime.smoke.test.ts",
  "test:smoke:server": "go -C ./apps/platform-server test ./internal/server -run TestMarketSmoke",
  "test:smoke": "npm run test:smoke:web && npm run test:smoke:server",
  "test:frontend-actions": "vitest run apps/platform-web/src/bridge/remote-iframe-bridge.test.ts",
  "verify": "npm run build:all && npm run test:smoke && npm run test:frontend-actions:production-browser"
}
```

`test:frontend-actions:production-browser` remains byte-for-byte unchanged. `test:equipment` is removed. Explicit Web file paths and the named Go smoke prevent ordinary test-file naming from silently expanding the main gate.

## 5. Deletion and admission model

The exact inventory in `research/minimal-smoke-suite.md` accounts for all 128 current files. Implementation deletes every current test except the two retained files, then adds the Assistant smoke. No deleted assertion is migrated unless it is necessary for one of the six accepted smoke scenarios.

Future tests follow this admission rule:

1. First show which existing smoke cannot express the regression.
2. Prefer extending or replacing one of the existing success/failure scenarios.
3. A new independent automated file requires an explicit product/risk decision and a corresponding explicit `test:smoke` entry.
4. UI/Spatial findings remain manual unless the user changes the strategy.

## 6. Spec synchronization

Behavior and Validation/Error Matrix sections remain normative product knowledge. They are not deleted merely because exhaustive tests are deleted. During the required `trellis-update-spec` phase:

- Rewrite the global Test Maintenance Policy as smoke-only admission policy.
- Treat `Tests Required` matrices as verification guidance, not automatic authorization for dedicated unit/component tests.
- Replace references to deleted test files/suites with the owning smoke, build, production-browser or manual gate.
- Mark UI/Spatial/component/controller behavior as manual verification.
- Sweep `.trellis/spec/platform-web/**` and `.trellis/spec/contracts/**` with `rg` so no obsolete exhaustive-test requirement remains.

Primary affected documents are frontend quality/type/state/spatial specs, storage index/diagnostics, and contracts frontend type-safety.

## 7. Compatibility and migration

- No product data or session migration is required.
- No production API, schema, database version or runtime behavior changes are planned.
- Deleting tests does not preserve their fixtures or compatibility helpers.
- External CI is unknown; the repository provides `npm run verify` as the new authoritative command but does not mutate systems outside the repo.
- `vitest.config.ts` may remove the now-unused play-bridge environment glob as cleanup; no new runner or environment is introduced.

## 8. Rollout and rollback

Rollout is additive-first:

1. Build and pass the two Web smokes while old suites still exist.
2. Reduce and pass the Go smoke.
3. Switch root scripts to explicit smoke/build gates.
4. Delete old tests in audited groups, running focused gates after each group.
5. Synchronize specs and run the full `verify` gate.

Each completed smoke is a rollback point. If a later deletion exposes a missing import/fixture dependency, restore only that group and repair the owning smoke before continuing. If a smoke requires product behavior changes or a forbidden mock, stop and return to planning instead of weakening the contract.

The unrelated `.codex/config.toml` change is excluded throughout. The four existing uncommitted test edits are intentionally consumed by deletion and are not a separate rollback target.

## 9. Accepted risks

- Provider parity, malformed-input/security matrices, migrations, retention, lifecycle races, resource cleanup, UI behavior and most server features lose direct automated protection.
- Builds cannot prove runtime/UI correctness; the production-browser gate proves only its Frontend Action preflight scope.
- A three-file suite has coarser failure localization than seam tests.
- These are explicit user-owned trade-offs, not omissions to be silently repaired by adding more tests.
