# Research: Runtime and platform non-Spatial test audit

- Query: Audit non-Spatial tests in `apps/platform-web` under `agent-runtime`, `platform-host`, `storage`, `bridge`, `controllers`, `runtime-host`, and `views`, plus the four repository tests outside `platform-web`; classify them as KEEP, MERGE, or DELETE and identify stronger cross-layer replacements without editing source/tests.
- Scope: internal
- Date: 2026-08-08

## Findings

### Audit boundary and method

The requested boundary contains **67 files / 12,376 physical lines**: 63 files in the named `platform-web` layers and four external files. `src/spatial/**`, `controllers/play/spatial-play-controller-integration.test.ts`, and tests in unlisted `platform-web` areas (`config`, `composables`, `lib`, top-level `src`, and `components`) are outside this audit.

The classification applies the Test Maintenance Policy in `.trellis/spec/platform-web/frontend/quality-guidelines.md`: retain public behavior, state transitions, validation/security boundaries, persistence/rollback, cleanup, accessibility, release gates, and documented algorithmic invariants; remove source-shape, tunable numeric, exact internal-step, and stronger-boundary duplicates.

- **KEEP**: this file (or a renamed direct successor) remains a core contract anchor. Its row can still recommend pruning duplicate cases.
- **MERGE**: remove this file after moving its unique contract into the named stronger suite. The line estimate is net removal after allowing for replacement assertions/fixtures.
- **DELETE**: remove the test with no replacement because it protects no unique live contract.

Estimated steady-state result for this boundary: **43 files / about 8,700 lines**, a net removal of **24 files / about 3,650 lines (29%)**. Treat line estimates as planning values with roughly ±15% variance; implementation may reveal fixture-sharing constraints.

| Area | Current files / lines | KEEP | MERGE | DELETE | Estimated net lines removable |
|---|---:|---:|---:|---:|---:|
| Agent Runtime | 15 / 1,972 | 8 | 7 | 0 | ~670 |
| Bridge | 2 / 1,006 | 1 | 1 | 0 | ~410 |
| Controllers | 18 / 2,690 | 13 | 5 | 0 | ~765 |
| Platform Host | 17 / 3,366 | 12 | 5 | 0 | ~930 |
| Runtime Host | 3 / 348 | 2 | 1 | 0 | ~115 |
| Storage | 5 / 1,058 | 2 | 2 | 1 | ~290 |
| Views | 3 / 294 | 2 | 1 | 0 | ~95 |
| Four external tests | 4 / 1,642 | 3 | 1 | 0 | ~370 |

### File-by-file classification: Agent Runtime

| Test file | Class | Contract and consolidation action | Est. net lines removable |
|---|---|---|---:|
| `apps/platform-web/src/agent-runtime/environment.test.ts` | MERGE | Capability/trust downgrade is security-critical, but the single environment-shape test at line 20 duplicates the real entry/delegated Agent flow. Move game/desktop/delegated capability assertions into `assistant-chat.frontend-action-isolation.test.ts`; avoid pinning the exact environment object. | ~40 |
| `apps/platform-web/src/agent-runtime/frontend-action-isolation.test.ts` | MERGE | Preserve exact-root/near-match classification and registry/context/read-list-search-glob denial (lines 94-221), but exercise them through one entry-Agent plus delegated-Agent model loop. Absorb into the Platform Host isolation anchor and browser-script row below. | ~130 |
| `apps/platform-web/src/agent-runtime/orchestration/message-formatting.test.ts` | MERGE | Tool-call ID independence at line 6 is a provider wire contract; the ordinary adjacent-string merge at line 22 is local implementation behavior. Move the ID case into the four-provider correlation matrix and drop the standalone file. | ~20 |
| `apps/platform-web/src/agent-runtime/request-budget.test.ts` | KEEP | Keep one provider-preflight test proving oversized input blocks the call (line 36). Fold the estimator-only numeric probe at line 25 into that behavior assertion instead of testing a heuristic threshold separately. | ~10 |
| `apps/platform-web/src/agent-runtime/skill-delivery-loop.test.ts` | KEEP | This is the strongest `use_skill` native/Text end-to-end delivery test (lines 67 and 102). Table-drive the two modes with shared assertions; retain full content, exactly-once delivery, and no synthetic user injection. | ~35 |
| `apps/platform-web/src/agent-runtime/staged-workspace-coherence.test.ts` | KEEP | Keep both cross-layer invariants: local-assistant contact isolation and custom Tool write/delete visibility through the live staged array (lines 132 and 153). These protect security and atomic turn persistence, not implementation shape. | ~20 |
| `apps/platform-web/src/agent-runtime/text-tool-protocol.test.ts` | MERGE | The no-second-compaction assertion at line 5 belongs in the native/Text Tool loop matrix; the standalone XML extraction fixture is duplicate protocol plumbing. | ~25 |
| `apps/platform-web/src/agent-runtime/tool-schemas.test.ts` | MERGE | Controlled tool exposure requires both authored config and Environment capability (lines 5 and 26), but schema presence is one facet of the environment security matrix. Merge there; do not retain exact schema-array snapshots. | ~25 |
| `apps/platform-web/src/agent-runtime/workspace-operations-copy.test.ts` | KEEP | Virtual-directory recursion, complete paging, metadata consistency, eager-copy compatibility, and all-target collision preflight (lines 81-343) protect data completeness and no-partial-write behavior. Table-drive malformed continuation cases and share fixtures. | ~90 |
| `apps/platform-web/src/agent-runtime/workspace-operations-retrieval.test.ts` | KEEP | Keep normalized scoping, diagnostics exclusion, recoverable ranges, and Agent producer bounds (lines 23-88). Merge the three range variants into a compact behavior matrix. | ~20 |
| `apps/platform-web/src/agent-runtime/workspace-tools/observations.test.ts` | KEEP | Strict JSON acceptance, fixed 32-KiB fail-loud rejection, circular/exotic rejection, and independent `agent_call` presentation cap (lines 10-97) are security/resource contracts. Use a table for invalid shapes. | ~20 |
| `apps/platform-web/src/agent-runtime/workspace-tools/skill-actions.test.ts` | MERGE | Oversize-before-activation and hidden-file script isolation (lines 10 and 53) are already naturally exercised by the Skill delivery loop and the runtime isolation flow. Move one negative case to each anchor. | ~55 |
| `apps/platform-web/src/agent-runtime/workspace-tools/specialized-delivery.test.ts` | MERGE | Inspector producer bounds are legitimate explicit caps (lines 6, 68, 110), but belong beside workspace producer delivery and the shared acceptance gate. Merge into a single producer-budget matrix, keeping omission of undefined/raw fields. | ~90 |
| `apps/platform-web/src/agent-runtime/workspace-tools/tool-execution.test.ts` | KEEP | Keep normalized `ask_user`, strict result JSON, terminal UI/trace agreement, and raw-response non-leakage (lines 11-217). Consolidate answer variants and parse/oversize failures into tables. | ~45 |
| `apps/platform-web/src/agent-runtime/workspace-tools/workspace-delivery.test.ts` | KEEP | Keep bounded list/search/glob/diff/mutation delivery and schema-cap alignment (lines 14-185); these are the producer side of the observation security contract. Share one cap/continuation assertion helper. | ~45 |

### File-by-file classification: Bridge

| Test file | Class | Contract and consolidation action | Est. net lines removable |
|---|---|---|---:|
| `apps/platform-web/src/bridge/remote-frontend-action-lifecycle.test.ts` | MERGE | Its 14 cases enumerate duplicate/abort/dispose/binding/commit barriers (lines 72-496). Preserve a small deterministic race matrix, but run it through `mountRemoteIframeFrontend` plus the real execution service and Dexie commit. Remove helper-internal assertion-count/phase tests that restate implementation. | ~250 |
| `apps/platform-web/src/bridge/remote-iframe-bridge.test.ts` | KEEP | Keep as the host bridge anchor: origin/session method exposure, current binding, event-before-success, disposal, typed validation failure, and display-name forwarding (lines 155-508). Absorb the lifecycle matrix and delete duplicated mocked save-switch/dispose cases. | ~160 |

### File-by-file classification: Storage

| Test file | Class | Contract and consolidation action | Est. net lines removable |
|---|---|---|---:|
| `apps/platform-web/src/storage/assistant-conversations.test.ts` | MERGE | Raw Tool output must not survive persistence while bounded presentation does (lines 16-47). Move this fake-IndexedDB round trip into `assistant-message-mappers.test.ts`, which already owns the serialization boundary. | ~35 |
| `apps/platform-web/src/storage/diagnostic-records.test.ts` | KEEP | Keep union round trip, cursor pagination/relations, credential and binary sanitization, retention/running exemption, interrupted recovery, and schema-add preservation (lines 72-227). These are persistence/security contracts not replaceable by controller tests. | ~30 |
| `apps/platform-web/src/storage/frontend-action-workspace.test.ts` | KEEP | Keep CAS read-set/resource/binding validation, concurrent-path preservation, forged-baseline rejection, atomic rollback, final commit barrier, no-op timestamp/checkpoint behavior, and blind-write baselines (lines 88-706). Collapse the many conflict permutations into dependency-kind matrices. | ~170 |
| `apps/platform-web/src/storage/local-assistant-knowledge.test.ts` | MERGE | DELETE the raw authored-text/order assertions at lines 25-43. Preserve only the user-file non-overwrite refresh contract at lines 45-64, merged into the Assistant config mutation flow. | ~45 |
| `apps/platform-web/src/storage/workspace-templates/files.test.ts` | DELETE | The sole assertion checks absence of a retired path in an in-memory source array (lines 5-8). The diagnostics spec already requires reverse-search/build validation; this is historical negative source-shape coverage. | ~10 |

### File-by-file classification: Controllers

| Test file | Class | Contract and consolidation action | Est. net lines removable |
|---|---|---|---:|
| `apps/platform-web/src/controllers/assistant/use-assistant-config-controller.test.ts` | KEEP | Keep the shared draft/apply mutation contract for Skill/config/workspace edits (line 37). Absorb the official-knowledge refresh preservation case; avoid exact callback counts. | ~20 |
| `apps/platform-web/src/controllers/assistant/use-assistant-controller.test.ts` | KEEP | Background ask ownership/session scroll and unmount-only abort (lines 81-165) protect concurrent sessions and lifecycle cleanup. Consolidate repeated session scaffolding. | ~30 |
| `apps/platform-web/src/controllers/game-cards/use-game-card-detail-controller.test.ts` | KEEP | Keep latest-route ownership, object URL cleanup, builtin mutation restriction, original-card pinning, duplicate delete guard, and close-veto safety (lines 69-193). These prevent wrong-entity writes and resource leaks. | ~45 |
| `apps/platform-web/src/controllers/game-cards/use-game-card-library-controller.test.ts` | MERGE | Keep one newest-refresh race and one irreversible-operation duplicate guard (lines 61 and 113), but merge them with detail-controller entity ownership. DELETE exact toast/call-count behavior and the generic copy-error state case. | ~70 |
| `apps/platform-web/src/controllers/market/use-app-market-controller.test.ts` | KEEP | Keep uploader authorization and duplicate upload protection (lines 48 and 87); both guard privileged/irreversible operations. Table-drive identity variants and avoid presentation strings. | ~25 |
| `apps/platform-web/src/controllers/market/use-market-catalog.test.ts` | MERGE | Three separate generation-counter races (lines 55-109) repeat the same stale-response pattern. Keep one detail identity case and one pagination invalidation case in a unified market flow; drop a separate counts race. | ~60 |
| `apps/platform-web/src/controllers/market/use-market-inventory.test.ts` | KEEP | Keep editable install targets, stable dedupe, binary preservation, complete source identity, and stale inventory ownership (lines 37-105). These protect upload/install data boundaries. | ~20 |
| `apps/platform-web/src/controllers/play/retro-play-controller-integration.test.ts` | KEEP | This is real happy-dom behavior, not source inspection: iframe attachment/navigation and trusted file-picker/download URL cleanup/component emits (lines 112-240). Keep lifecycle cleanup and one user flow; remove redundant exact router/callback counts. | ~60 |
| `apps/platform-web/src/controllers/play/use-game-launcher-controller.test.ts` | KEEP | Keep save-version confirmation, cloud conflict/overwrite ordering, and duplicate mutation suppression (lines 116-223). Collapse routine create/rename/import/export call-shape checks into the Retro user flow. | ~55 |
| `apps/platform-web/src/controllers/play/use-play-controller.test.ts` | KEEP | Keep bridge target registration/cleanup, mount-generation stale callback rejection, failure invalidation, rebuild, and visible-only Escape ownership (lines 124-291). These are the Play mainline lifecycle. | ~75 |
| `apps/platform-web/src/controllers/settings/model-parameter-helpers.test.ts` | MERGE | Provider-branch preservation is a config contract (line 6), but testing helper-by-helper object rewrites is implementation detail. Assert it once through Settings save/probe behavior; delete the helper file. | ~20 |
| `apps/platform-web/src/controllers/settings/use-settings-controller.test.ts` | KEEP | Keep debounced complete-config persistence, branch merge, minimum model/probe config, and disposal/late-result suppression (lines 69-171). Avoid pinning exactly 800 ms unless product compatibility requires it; assert coalescing and eventual save. | ~45 |
| `apps/platform-web/src/controllers/system-monitor/monitor-controller.test.ts` | MERGE | Refresh/restore/subscription/disposal cases (lines 58-153) overlap the trace controller and host diagnostics tests. Move one restore-and-refresh flow and one disposed-confirm guard into the trace/monitor UI anchor. | ~80 |
| `apps/platform-web/src/controllers/system-monitor/trace-controller.test.ts` | KEEP | Keep paging/selection, stale response rejection, subscription cleanup, and object URL ownership (lines 68-221). Absorb monitor refresh/restore; remove exact query-object and 30-count assertions unless the page size is documented UX. | ~65 |
| `apps/platform-web/src/controllers/workspace/workspace-explorer-helpers.test.ts` | MERGE | DELETE the tunable menu coordinate `192` assertion (line 24). Move path/name behavior into Explorer operations and editable/CodeMirror shortcut protection into a DOM interaction test; remove the helper-only file. | ~30 |
| `apps/platform-web/src/controllers/workspace/use-workspace-media-controller.test.ts` | KEEP | Keep object URL replacement/revocation, binary-only handling, and stale route read rejection (lines 16-79). This is lifecycle/resource safety. | ~15 |
| `apps/platform-web/src/controllers/workspace/use-workspace-explorer-controller.test.ts` | KEEP | Keep persisted empty directory, cross-root source/target identity, and root-return stale-read invalidation (lines 43-112). These guard persistence and wrong-root mutation. | ~20 |
| `apps/platform-web/src/controllers/workspace/use-workspace-editor-controller.test.ts` | KEEP | Keep active-window save ownership, binary rejection, close veto on persistence conflict, and create-to-edit draft preservation (lines 80-175). These prevent data loss and wrong-window writes. | ~30 |

### File-by-file classification: Platform Host

| Test file | Class | Contract and consolidation action | Est. net lines removable |
|---|---|---|---:|
| `apps/platform-web/src/platform-host/assistant-chat.frontend-action-isolation.test.ts` | KEEP | Make this the runtime isolation anchor. It already reaches the model/tool loop for ordinary, runtime, delegated, and trusted assistant paths (lines 247-468). Absorb environment, registry/context, browser-script, and diagnostics visibility matrices while reducing module-mock boilerplate. | ~140 |
| `apps/platform-web/src/platform-host/browser-skill-script-executor.test.ts` | MERGE | Script SDK read/list/search/glob/helper isolation and trusted authoring visibility (lines 158-212) are required, but duplicate the same root filter. Move one Skill-script case into the isolation anchor and one trusted-helper case into the execution-service flow. | ~140 |
| `apps/platform-web/src/platform-host/diagnostic-bundle.test.ts` | KEEP | Keep failure anchoring, 50-record older window plus relation closure, stable archive layout, complete text, and second-pass credential redaction (lines 88-205). This is an export/security boundary. | ~30 |
| `apps/platform-web/src/platform-host/diagnostics-query.test.ts` | MERGE | Bounded snippets, summary field caps, and selected-section paging (lines 20-81) should be exercised through the Agent `query_diagnostics` Tool in the integrated diagnostics flow. Retain exact bounds as protocol contracts, not duplicated direct helper cases. | ~50 |
| `apps/platform-web/src/platform-host/diagnostics-workspace-adapter.test.ts` | KEEP | Keep lazy virtual discovery, ID reads/search, complete copy-out, hidden-without-adapter behavior, owner-only mount, mutation/copy-in rejection, reserved namespace authority, and cursor early-stop (lines 156-527). This is a security boundary. | ~100 |
| `apps/platform-web/src/platform-host/diagnostics.test.ts` | MERGE | Facet/overview arithmetic at line 26 is a pure derived projection duplicated by monitor behavior. Assert the public overview once in the integrated diagnostics UI flow and remove this file. | ~40 |
| `apps/platform-web/src/platform-host/equipment-scripts/equipment-scripts.test.ts` | KEEP | Keep production strict-JSON fixture compatibility, internal/formal resource parity, non-normalization of abort/SDK failures, and fixture distribution results (lines 23-120). These are release and cross-runtime parity gates. | ~20 |
| `apps/platform-web/src/platform-host/frontend-actions/errors.test.ts` | MERGE | Public error envelope validity/accessor safety (lines 16-62) is security-sensitive but duplicated at Worker, service, and play SDK boundaries. Move the valid/ordinary/accessor matrix into strict-JSON plus end-to-end public error tests. | ~40 |
| `apps/platform-web/src/platform-host/frontend-actions/imports.test.ts` | KEEP | Keep call-site/branch/function timing, duplicate-call execution with dependency dedupe, static import dependency validation, and invalid dynamic usage (lines 66-210). This protects a nontrivial code transform and read-set integrity. | ~45 |
| `apps/platform-web/src/platform-host/frontend-actions/json.test.ts` | KEEP | Keep strict JSON accepted/rejected shapes and byte/depth/node/source limits (lines 13-103). This is the canonical exhaustive malformed-value matrix; integration tests should only sample it. | ~20 |
| `apps/platform-web/src/platform-host/frontend-actions/registry.test.ts` | KEEP | Keep exact publication path/provenance, missing/ambiguous/near-match rejection, closed manifest, helper/path/timeout/aggregate limits (lines 50-223). This is the canonical manifest security matrix. | ~50 |
| `apps/platform-web/src/platform-host/frontend-actions/schema.test.ts` | KEEP | Keep Draft 2020-12 behavior, same-document refs, strict keyword rejection, bounded errors, and LRU reuse/eviction (lines 21-115). This is an explicit compatibility/security contract. | ~25 |
| `apps/platform-web/src/platform-host/frontend-actions/service.test.ts` | KEEP | Make this the execution-service core: fail-closed preflight, exact resource dependencies, staged write/rollback, output validation, abort barriers, double commit assertion, late-abort durability, and CAS conflict (lines 125-456). Absorb one real Dexie happy path and remove seam-duplicate permutations. | ~110 |
| `apps/platform-web/src/platform-host/frontend-actions/worker.test.ts` | KEEP | Keep opaque-origin Worker construction, storage/nested-Worker taming, domain envelope transport, sanitization, malformed output, timeout/abort cleanup (lines 28-154). Unit fakes do not replace the production-browser gate. | ~30 |
| `apps/platform-web/src/platform-host/frontend-actions/workspace-adapter.test.ts` | KEEP | Keep read-your-writes/dependency recording, list/glob/delete ranges, missing-read dependency, operation/scope/binary/text restrictions, and Action-resource non-exposure (lines 37-141). These are least-privilege rules. | ~30 |
| `apps/platform-web/src/platform-host/platform-actions.test.ts` | KEEP | Keep table-driven closed allowlist and trusted assistant actor separation (lines 85-175), including a synthetic future action. This is an explicit privilege contract. | ~35 |
| `apps/platform-web/src/platform-host/turn-timeline-collector.test.ts` | MERGE | Display-name carry-forward at lines 5-36 is public event metadata, but duplicates bridge SDK and assistant presentation tests. Move one loading-to-success case into a full Tool event/persistence flow. | ~25 |

### File-by-file classification: Runtime Host

| Test file | Class | Contract and consolidation action | Est. net lines removable |
|---|---|---|---:|
| `apps/platform-web/src/runtime-host/ai/calls.test.ts` | KEEP | Keep as provider-boundary diagnostics anchor: persisted success, redaction, HTTP/parse/stream/cancel classification, and partial stream preservation (lines 58-128). Add one retry case and absorb recorder integration. | ~20 |
| `apps/platform-web/src/runtime-host/ai/providers/native-tool-correlation.test.ts` | KEEP | Keep the four-provider `toolCallId`/`call_id` correlation matrix (lines 39-73). Absorb the Agent Runtime message-formatting guard; table-drive provider adapters. | ~15 |
| `apps/platform-web/src/runtime-host/ai/trace-recorder.test.ts` | MERGE | Move retry/previous/parent correlation, storage-failure isolation, abort/timeout classification, and concurrent ID uniqueness (lines 38-143) into `calls.test.ts` plus storage diagnostics. Remove duplicate direct parsing/classifier tests already observed at the provider boundary. | ~80 |

### File-by-file classification: Views

| Test file | Class | Contract and consolidation action | Est. net lines removable |
|---|---|---|---:|
| `apps/platform-web/src/views/assistant-message-mappers.test.ts` | KEEP | Keep the persistence boundary: ordinary Tools store identity/status only, `agent_call` presentation is bounded, and ask/process metadata survives (lines 9-104). Absorb the fake-IndexedDB conversation round trip. | ~20 |
| `apps/platform-web/src/views/assistant/assistant-baseline.test.ts` | KEEP | Keep one DOM-level accessible ask flow and one ordered process fold with direct Tool rows (lines 26-124). This is stronger than pure label/summarizer unit tests. | ~30 |
| `apps/platform-web/src/views/assistant/process-presentation.test.ts` | MERGE | Move timeline identity/order, display-name fallback, running/failure accessibility labels, and thought segmentation (lines 28-63) into the DOM baseline. Remove direct tests of small presentation helpers and exact translated strings where DOM semantics suffice. | ~45 |

### File-by-file classification: four tests outside `platform-web`

| Test file | Class | Contract and consolidation action | Est. net lines removable |
|---|---|---|---:|
| `apps/play-frontend-dev/src/composables/useEquipmentManagement.test.ts` | KEEP | Keep preview abort/generation, relevant mutation invalidation, dialog cleanup, immutable accepted commit identity, mutation-before-success reconciliation, unrelated-event tolerance, discovery invalidation, and authoritative reload (lines 170-409). These cases are explicitly required by the equipment coordinator spec; combine permutations into four lifecycle scenarios. | ~70 |
| `apps/play-frontend-dev/src/lib/equipment-data.test.ts` | KEEP | Keep canonical refs, parser limits/closed shapes, corruption distinction, inventory graph cycle/diamond accounting, safe integers, and request/output identity (lines 62-448). Use parser error tables and shared fixtures; do not delete graph/data-integrity invariants. | ~90 |
| `packages/play-bridge/test/frontend-action.test.ts` | KEEP | Keep SDK transport security: strict JSON and exact resource limits, public error sanitization/bounds, pre/active abort, session replacement, mutation subscriber isolation, parent/origin pinning, stale traffic (lines 171-714). Absorb the separate Tool display-name event and delete duplicated host-validator permutations. | ~160 |
| `packages/play-bridge/test/tool-event.test.ts` | MERGE | Non-empty `displayName` normalization at lines 24-67 belongs in the existing bridge session/event suite. Add it to `frontend-action.test.ts` or a renamed bridge-events anchor and remove this file. | ~50 |

### Stronger cross-layer flows that replace seam-by-seam piles

#### 1. Card Frontend Action transaction mainline

Build one deterministic integration fixture that starts at `tsian.card.runAction`, passes through the remote iframe session, lifecycle, execution service, real fake-IndexedDB snapshot/CAS commit, mutation event, and SDK subscriber. The production path is visible in:

- service orchestration and strict input/output validation: `apps/platform-web/src/platform-host/frontend-actions/service.ts:151-257`;
- lifecycle commit barriers: `apps/platform-web/src/bridge/remote-frontend-action-lifecycle.ts:295-389`;
- bridge wiring to the real service: `apps/platform-web/src/bridge/remote-iframe-bridge.ts:822-848`;
- atomic binding/dependency validation and two commit assertions: `apps/platform-web/src/storage/frontend-action-workspace.ts:1344-1447`;
- SDK mutation subscriber isolation: `packages/play-bridge/src/tsian-api.ts:323-328`.

Use four scenarios: successful write/event-before-response; abort before commit; durable commit wins over late abort; session/binding replacement suppresses stale delivery. This can absorb most repetitions in lifecycle, bridge, service, storage, and play-bridge tests. Keep exhaustive pure security matrices (`json`, `schema`, `registry`, `imports`, `worker`, workspace adapter, remote platform allowlist), because one integration happy path cannot enumerate malicious object shapes, schema dialects, path escapes, or Worker ambient-global attacks.

#### 2. Unified diagnostics product flow

Run a real provider-boundary call (mock network only), persist through `beginAiRequestTrace`, query summary/detail, expose it through bounded `query_diagnostics` and the read-only virtual adapter, then build the monitor/bundle result. Boundary references:

- provider entry points: `apps/platform-web/src/runtime-host/ai/calls.ts:81`, `:171`, and `:558`;
- recorder: `apps/platform-web/src/runtime-host/ai/trace-recorder.ts:129`;
- cursor-backed storage query: `apps/platform-web/src/storage/diagnostic-records.ts:274` and `:360`;
- bounded Agent query: `apps/platform-web/src/platform-host/diagnostics-query.ts:109-180`;
- virtual adapter: `apps/platform-web/src/platform-host/diagnostics-workspace-adapter.ts:206`;
- bundle layout: `apps/platform-web/src/platform-host/diagnostic-bundle.ts:256`.

This replaces duplicate derived aggregate, direct query projection, recorder classifier, and controller refresh assertions. Retain storage migration/retention, recursive credential/binary sanitization, running-record exemption, owner-only adapter mount, mutation/copy-in denial, bounded pagination/snippets, relation closure, and second-pass export redaction.

#### 3. Agent Tool delivery and persistence flow

Run one runtime turn in a native/Text parameter matrix, producing a bounded workspace/Skill result, passing the strict acceptance gate, and verifying provider-bound IDs plus persisted UI projection. Relevant boundaries:

- runtime preserves the live workspace array and Environment capabilities: `apps/platform-web/src/agent-runtime/index.ts:1936-1978`;
- grouped Tool execution retains original call order: `apps/platform-web/src/agent-runtime/workspace-tools/tool-execution.ts:705-777`;
- producer projection: `apps/platform-web/src/agent-runtime/workspace-tools/workspace-delivery.ts:394`;
- fail-loud acceptance: `apps/platform-web/src/agent-runtime/workspace-tools/observations.ts:120`;
- Text serialization: `apps/platform-web/src/agent-runtime/text-tool-protocol.ts:315`;
- provider message correlation: `apps/platform-web/src/agent-runtime/orchestration/message-formatting.ts:29` and the four adapters covered by `native-tool-correlation.test.ts:39-73`.

This replaces standalone schema exposure, text formatting, message merging, Skill action, and specialized producer files. Retain fixed 32-KiB strict JSON rejection, no second compaction, exact tool-call ID correlation, raw-output non-persistence, controlled-tool least privilege, same-turn staged write visibility, and runtime path filtering.

#### 4. Controller-to-persistence ownership flows

For entity-bound controllers, replace repeated generation-counter and exact mock-call tests with one stronger flow per domain:

- Game Card/Workspace: change route while a read is pending, then save/delete; assert the old card/path never receives the mutation and a persistence conflict vetoes close.
- Market: switch resource/filter while detail/page requests are pending; assert only current scope is published, then exercise uploader authorization on the mutation path.
- Play: launch/replace/dispose one iframe mount and operate one save/cloud conflict through the visible Retro presentation.
- Diagnostics: restore/export one selected failure through monitor/controller/host, including disposal and object URL cleanup.

Generic `busy` flags, exact callback counts, exact toast text, and one generation-counter test per method are not independent contracts. Wrong-entity writes, destructive duplicate submissions, conflict confirmation, close veto, object URL cleanup, and stale iframe callbacks remain.

#### 5. Equipment preview-to-commit flow

The two play-frontend tests are already close to the desired boundary. Preserve the coordinator lifecycle documented in `apps/play-frontend-dev/src/composables/useEquipmentManagement.ts:42-180`: preview generation/abort, conservative mutation invalidation, immutable accepted identity, no commit retry, and authoritative reread. Merge the eight coordinator cases into four event-sequence scenarios, while retaining parser/graph invariants separately. Do not replace this with platform-host Frontend Action tests; client event ordering is an independent failure dimension.

### Security and persistence contracts that must remain

1. **Frontend Action least privilege and transaction integrity**
   - Exact publication root/id/provenance and root-confined text resources.
   - Strict JSON at SDK, host input, Worker output, cloned host output, and public error details.
   - Draft 2020-12 strict schema behavior and hard byte/depth/node/helper/timeout limits.
   - Opaque-origin Worker, blocked IndexedDB/Cache/nested Worker/storage-manager globals, timeout/abort cleanup, and sanitized ordinary failures.
   - Runtime/delegated Agent invisibility across context, registry, model prompt, Tool, and script SDK; trusted authoring remains visible.
   - Read-set/resource/binding CAS, no forged baselines, no partial writes/checkpoints, no-op timestamp stability, abort-before-commit, durable-commit-wins, event-before-success, origin/session/stale-traffic handling.
   - Closed remote platform-action allowlist including a synthetic future action.

2. **Diagnostics confidentiality and durability**
   - Recursive credential/URL-secret stripping and binary replacement before persistence, plus second-pass export text redaction.
   - Cursor-bounded pagination, relation closure, 7-day/100-MiB retention, running exemption, interrupted recovery, and additive schema upgrade.
   - Owner-only virtual adapter, ordinary runtime/delegated invisibility, reserved read-only namespace, copy-out allowed but copy-in/mutation denied.
   - One logical record per model call with retry attempts, previous/parent correlation, partial stream preservation, cancellation/timeout distinction, and storage failure isolation.

3. **Agent Runtime boundaries**
   - Environment capability intersection; delegated/game Agents never inherit desktop controlled tools or high-level mutation rights.
   - Producer-owned bounded delivery, strict fail-loud observation gate, native/Text parity, exact parallel call ID correlation, and no raw result persistence.
   - Request budget rejects before provider call.
   - Live staged workspace identity, same-turn read-your-writes, runtime file filters on top-level and script SDK paths, atomic commit/discard.
   - Recursive virtual copy completeness and all-target collision preflight.

4. **User data and resource ownership**
   - Editor close veto on failed save, active-window save ownership, binary rejection, and create/edit draft preservation.
   - Cross-card/cross-root operation identity, builtin mutation restrictions, cloud conflict confirmation/delete ordering, market uploader authorization.
   - Blob/object URL revocation and stale route/mount callback suppression.
   - Assistant concurrent session ask ownership and raw Tool output exclusion from conversation storage.
   - Equipment corruption signaling, graph cycle/diamond termination, safe integer/closed output, immutable preview identity, and authoritative post-commit reconciliation.

### Low-value cases to delete even when the owning file stays

- Raw authored knowledge text/order assertions in `storage/local-assistant-knowledge.test.ts:25-43`; preserve only refresh non-overwrite behavior.
- Historical absence of `.tsian/save/traces/**` in `storage/workspace-templates/files.test.ts:5-8`; use the documented reverse-search/build gate.
- Tunable menu pixel `192` in `controllers/workspace/workspace-explorer-helpers.test.ts:21-25`.
- Exact toast/callback invocation totals in routine controller CRUD, such as `use-game-launcher-controller.test.ts:141-165`, when the visible user flow already proves success/failure.
- Repeated generic stale-response tests for list/count/detail methods; keep only wrong-entity mutation and pagination-scope representatives.
- Direct helper output/translated-label tests in `views/assistant/process-presentation.test.ts` once the accessible DOM fold asserts identity, order, and status semantics.
- Direct error-classifier and JSON response parsing tests in `runtime-host/ai/trace-recorder.test.ts:97-135` once real provider boundary calls assert the persisted classification.

### External references and local versions

No web research was required. The audit uses the repository's configured stack:

- Vitest `^4.1.10`, happy-dom `^20.11.1`, fake-indexeddb `^6.2.5` (`package.json:26-28`).
- Ajv `^8.20.0` and Dexie `^4.0.11` (`package-lock.json:65-69`).
- Default Vitest environment is Node; `packages/play-bridge/**/*.test.ts` uses happy-dom (`vitest.config.ts:12-16`).
- Existing focused gates are `test:equipment`, `test:frontend-actions`, and `test:frontend-actions:production-browser` (`package.json:20-22`). The production-browser Frontend Action gate is not replaceable by fake Worker unit tests.

### Related specs

- `.trellis/spec/platform-web/frontend/quality-guidelines.md` — Test Maintenance Policy, AI retry contract, and required build/browser gates.
- `.trellis/spec/platform-web/frontend/type-safety.md:79-159` — Frontend Action host/security boundary and required matrices.
- `.trellis/spec/platform-web/frontend/type-safety.md:202-262` — equipment preview/commit coordinator contract.
- `.trellis/spec/platform-web/frontend/type-safety.md:460-496` and `:879` — Tool delivery, staged workspace coherence, fixed strict observation gate, and native correlation.
- `.trellis/spec/platform-web/frontend/state-management.md:330-336` — per-mount bridge and Tool timeline behavior.
- `.trellis/spec/platform-web/frontend/state-management.md:338-395` — Assistant concurrent-session/presentation/persistence behavior.
- `.trellis/spec/platform-web/frontend/state-management.md:755-780` — cross-scope ownership and live staged workspace invariants.
- `.trellis/spec/platform-web/storage/index.md:245-342` — Frontend Action snapshot/read-set CAS commit.
- `.trellis/spec/platform-web/storage/diagnostics.md` — unified diagnostics storage, query, adapter, retention, and export contracts.
- `.trellis/spec/contracts/frontend/type-safety.md:126-225` — shared Frontend Action SDK/bridge transport contract.

## Caveats / Not Found

- This is a static audit; no tests were edited or executed. Runtime duration/flakiness data was not available, so consolidation priorities are based on contract overlap and maintenance shape, not measured wall time.
- The 67-file boundary follows the user's named directories literally. A full repository AC1 audit still needs the excluded non-Spatial `platform-web` tests in `config`, `composables`, `lib`, top-level `src`, and `components`, plus Spatial tests in a separate pass.
- MERGE means “remove the current file only after its stated unique contract exists at the stronger boundary,” not immediate deletion. Frontend Action and diagnostics suites are especially unsafe to prune in one commit.
- Integration tests with fake IndexedDB/Worker can prove orchestration and atomicity but cannot prove browser origin isolation, ambient-global taming, real `postMessage` origin behavior, or production Ajv/Worker bundling. Keep the production-browser gate.
- Exact malformed-value/schema/path matrices remain valuable even when a cross-layer test samples the same rejection. Their independent fault dimension is adversarial input coverage, not duplicate layering.
- Broad replacement suites should stay split by contract (transaction, validator, adapter, UI flow), not become one monolithic “everything works” file; otherwise failure localization would worsen and negate the task goal.
