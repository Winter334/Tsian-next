# Implement — 异步图片存档一致性

## Phase 0: Contract and Baseline Gate

- [ ] Load all `implement.jsonl` specs with `trellis-before-dev`; inspect current dirty worktree and preserve unrelated changes.
- [ ] Re-read latest parent `07-21-inline-story-image-generation` PRD/design/implement and sibling `07-21-platform-image-generation` PRD/design before code changes.
- [ ] Record negative delivery boundary: the inline UI/repack tooling sibling owns `exportGameCardPackage` text inventory's UTF-8 ZIP-entry byte fix, ASCII/Chinese/emoji text and binary regressions, repack dependency, and its `build:web`; do not mix package inventory size work into save-runtime revision/CAS helpers or this storage test harness.
- [ ] Freeze sibling-to-this-task boundary:
  - optional `generatedMediaSourceGuard` on invoke request/options and optional `sourceGuard` at Tool input;
  - current card sends the same full guard in Agent input and invoke option; remote bridge strict-normalizes the option;
  - invokeAgent host captures option as authoritative `requiredSourceGuard`; Tool omission/field mismatch/wrong assetId fails `IMAGE_INVALID_ARGUMENTS` before Provider with zero writes and no ordinary downgrade;
  - sole runtime helper imported from `@tsian/play-bridge`, owning strict guard normalization, exact persisted raw-string fingerprinting, canonical V1 `identityKey`, and `save/assets/generated/<identityKey>` path;
  - Agent request/result echo is execution/correlation only; durable authority is host closure + source registration;
  - option absent + no Tool guard = ordinary Blob transaction write; option absent + legal Tool guard = guarded path;
  - guarded input to this task = `{ identityKey, assetPath, blob, sourceGuard }` host handoff whose guard already has a legal authority source;
  - source registration converts the handoff to exact-source storage metadata.
- [ ] Freeze final authoritative storage seam as `writeGeneratedMedia({ identityKey, assetPath, data, source:{path,expectedRevision} })`; sourceGuard never crosses into transaction/storage metadata and storage never parses projections.
- [ ] Freeze the negative boundary: this task does not consume card `imageGeneration:{agentId,protocol}` capability or the closed `IllustrationBriefV1` validator. Source registration only understands generic turn/projection raw strings; storage only understands exact path/revision, regardless of `additionalProperties`, length/ref grammar, dedupe or UI fallback rules.
- [ ] Confirm generated-media metadata can stay internal to `apps/platform-web`; change `@tsian/contracts` only if an actual cross-package consumer requires it.
- [ ] Record existing public call sites for formal commit, generic workspace commit/checkpoint, restore, trace formatter and context path. Do not begin with broad API edits without this call graph.

## Phase 1: Executable Storage Test Harness

- [ ] Add minimal `Vitest + fake-indexeddb` development test infrastructure owned by platform-web/root; expose one deterministic command such as `npm run test:storage`.
- [ ] Install fake IndexedDB before importing `localDb`; provide Web Crypto, Blob/TextEncoder support and reset all relevant tables between cases.
- [ ] Add fixtures/helpers for save rows, text/binary workspace rows, authoritative v2 turn files, checkpoint manifests and Blob rows.
- [ ] Add controllable async barriers around prepare/commit or injected transaction hooks so tests force exact formal/media/restore interleavings instead of relying on timing.
- [ ] Keep tests against real Dexie transactions and table state; pure helper tests alone are insufficient.
- [ ] Seed failing regression tests for the known formal full-replace lost update and future-workspace `current-turn-auto` contamination before changing implementation.

## Phase 2: Revision and Runtime Transaction Foundation

- [ ] Extract/reuse one complete-content SHA-256 helper for text and Blob; ensure checkpoint hash and CAS revision use identical bytes and lowercase hex.
- [ ] Extend internal Runtime Workspace changes with first-touch path expectations, exact directory-delete membership and optional generated-media metadata; do not add DB columns/audit fields.
- [ ] Update `createRuntimeWorkspaceTransaction` to preserve immutable baseline evidence on first touch while keeping staged read-after-write behavior.
- [ ] Convert staged directory deletes from commit-time prefix intents to baseline exact members plus membership expectations.
- [ ] Ensure repeated writes/deletes to one path retain the original baseline expectation and produce one canonical final change.
- [ ] Ensure `discard()` clears staged files, changes, expectations and generated-media metadata.
- [ ] Add validation that generated-media metadata has one corresponding same-path Blob write and canonical `identityKey ↔ assetPath` mapping.
- [ ] Add focused tests for missing/present expectations, text/Blob revisions, repeated writes, exact directory deletes, new-descendant conflicts and discard.

## Phase 3: Shared CAS Preparation/Commit Primitives

- [ ] Refactor storage helpers around explicit changes, current records and generic CAS validation rather than full snapshots.
- [ ] Implement conflict distinction for touched path, directory membership, stale source and stale turn without leaking content.
- [ ] Make ordinary `commitWorkspaceChangesForSave` rebase unrelated current paths while rejecting same-path/directory conflicts atomically.
- [ ] Ensure write timestamps/record construction are chosen at commit preparation and do not become the CAS authority.
- [ ] Keep hash computation outside Dexie transaction, but repeat all state/signature/CAS checks inside the final short transaction before any put/delete.
- [ ] Put newly referenced Blob rows inside the same transaction as references; do not pre-write orphan Blob records.
- [ ] Add deterministic different-path success, same-path conflict, directory conflict and injected rollback tests.

## Phase 4: Formal-turn Atomic Merge

- [ ] Change `runtime-turn.ts` to pass `finalWorkspaceChanges()` plus expected next turn to `commitSuccessfulRuntimeTurnForSave`; stop passing `finalWorkspaceFiles()`/redundant history to storage.
- [ ] In formal commit preparation, read current DB state, verify touched expectations, enforce append-only exact raw turn path and compute `mergedWorkspace = current + changes`.
- [ ] Build after-turn manifest only from that merged state; exclude append-only turn/trace files under existing rules.
- [ ] Precompute all manifest hashes/Blob records outside the transaction, then open one transaction across `saves`, `workspaceFiles`, `checkpoints`, and `blobs`.
- [ ] Re-read/revalidate current state inside the transaction; retry preparation for unrelated state changes, fail immediately for true touched-path conflicts.
- [ ] Atomically write raw turn/context/state/trace changes, Blob rows, after-turn checkpoint and save metadata.
- [ ] Preserve `completed`/turn return only after commit; do not schedule accepted-turn dependent work before durability.
- [ ] Update any embedding enqueue input to read/derive committed merged state rather than the stale transaction snapshot when needed.
- [ ] Test formal/media both orders, full atomic rollback and ordinary same-path conflict.

## Phase 5: Host Guard Registration and Storage Metadata

- [ ] Import the sibling-owned runtime helper from `@tsian/play-bridge`; do not duplicate guard type normalization, raw fingerprint, NUL identity, or path encoding in platform-host/storage/contracts.
- [ ] Add a card-agnostic platform-host source-registration helper that accepts only already authority-validated `{ identityKey, assetPath, blob, sourceGuard }`: required option paths use host closure guard after exact Tool comparison; option-absent self-guard paths use a legal normalized Tool guard. Agent final result and ordinary path writes cannot call this seam.
- [ ] Derive exact `turn-NNNNNN.json`, read the authoritative turn, generically find assistant projection key/index, and validate `fingerprintProjectionRaw(raw)` on the exact persisted string.
- [ ] Never JSON.parse/re-serialize the projection body or sort fields/normalize Unicode/whitespace before fingerprinting.
- [ ] Compute `expectedRevision` from complete turn-file UTF-8 contents, not `updatedAt` or projection fragment.
- [ ] Convert the valid handoff into `writeGeneratedMedia({ identityKey, assetPath, data: blob, source:{path,expectedRevision} })` before data reaches storage transaction code.
- [ ] Keep `projectionKey` data-driven and storage-generic; do not import illustration block/schema validator, card runtime entrypoint capability, or UI fallback logic.
- [ ] Make source-registration/identity/source mismatch fail before staging; verify sibling's required option matrix (Tool omitted/guard mismatch/wrong assetId) fails even earlier with zero Provider calls/zero ordinary or generated-media writes and never calls this seam.
- [ ] Update sibling runner integration only at the agreed handoff seam; option-absent no-guard image writes continue through ordinary `write()` with no generated-media metadata, while option-absent legal Tool guards may call this guarded seam.
- [ ] Test exact six-digit source path, complete-content revision, updatedAt independence, raw projection mismatch, source missing, helper golden vector, metadata/Blob mismatch, and authority ingress: required option exact match reaches seam with option guard; required missing/mismatch never reaches seam; option-absent legal self-guard does.

## Phase 6: Guarded Media Commit and Checkpoint Path Patch

- [ ] Add a dedicated guarded changeset commit path selected by presence of generated-media metadata; reject incompatible generic checkpoint options rather than route to `current-turn-auto`.
- [ ] Precompute asset hash/Blob record outside transaction without writing it.
- [ ] In one transaction over `saves`, `workspaceFiles`, `checkpoints`, `blobs`:
  - [ ] validate exact source row exists and content hash equals expected revision;
  - [ ] validate target and all other touched-path/directory expectations;
  - [ ] write asset Blob/workspace row;
  - [ ] patch only the asset path in every currently retained checkpoint where `turn >= sourceTurn`;
  - [ ] leave all other manifest entries byte-for-byte/structurally unchanged;
  - [ ] touch save metadata.
- [ ] Never synthesize a missing/pruned checkpoint and never rebuild an old manifest from current workspace.
- [ ] Ensure same-path regeneration switches all eligible retained manifests to the new hash in the same transaction.
- [ ] Keep `emitAgentInvocation(completed)` after the durable helper returns.
- [ ] Test eligibility boundaries, pruned checkpoint absence, stale source zero writes, metadata mismatch, atomic failure and regeneration success/failure.

## Phase 7: Restore and Lifecycle Serialization

- [ ] Implement a small keyed per-save lifecycle serializer with predecessor-failure recovery and identity-safe cleanup.
- [ ] Wrap guarded media durable commit and the whole `restoreCheckpointForSave` read/prefetch/transaction sequence; do not wrap Provider/Agent generation.
- [ ] Ensure both `platform-actions.ts` and `frontend-inspector.ts` automatically use the shared protected restore helper with no caller-specific lock.
- [ ] Audit checkpoint prune/delete/overwrite/current-turn-auto and GC for overlap with guarded commit/restore; route manifest-mutating critical sections through the same lifecycle seam where required.
- [ ] Test media-before-restore and restore-before-media using barriers; assert exactly one linearization outcome and no half-patched state.
- [ ] Verify Composer/normal formal turns are not held during image network generation and different image invocations can still overlap before commit.

## Phase 8: `current-turn-auto` Safety

- [ ] Treat invocation-start `turn` as an expected current branch turn.
- [ ] Recompute current max turn from authoritative turn files during preparation and again inside transaction; mismatch returns stale-turn conflict.
- [ ] On mismatch, commit neither workspace changes nor checkpoint changes.
- [ ] On match, preserve create/overwrite/current-turn-auto semantics using commit-time current workspace + explicit changes.
- [ ] Preserve protected frontend-debug checkpoint rules and same-turn auto canonicalization.
- [ ] Assert guarded generated media can never enter this branch.
- [ ] Test stale future-turn rejection and valid same-turn maintenance behavior.

## Phase 9: Workspace-aware Blob GC

- [ ] Replace duplicate manifest-only GC collectors with one liveness helper that unions hashes from current workspace contents and all remaining checkpoint manifests.
- [ ] Serialize or signature-check GC so a concurrent workspace/checkpoint change cannot make a stale liveness set delete a live Blob.
- [ ] Use the helper after checkpoint prune/delete/overwrite/restore/current-turn-auto and generated-media regeneration.
- [ ] Preserve owner-save isolation and avoid refcount/new table design.
- [ ] Test workspace-only live Blob, manifest-only live Blob, shared hash, old regenerated hash removal, stale GC retry and cross-save isolation.

## Phase 10: Trace and Context-slot Concurrency

- [ ] Extend `formatAgentTracePath` with `invocationId` using collision-resistant path-safe encoding/hash.
- [ ] Update both successful transaction trace and failed best-effort trace call sites to pass the same invocation id.
- [ ] Add one `contextSlot` normalizer/validator at `invokeAgent` boundary before queue lookup.
- [ ] Reject present empty/noncanonical slots; do not lossy-sanitize aliases.
- [ ] Build queue keys so omitted slot and explicit `"default"` differ; pass the same canonical slot to context read/write/path.
- [ ] Apply slot validation for `persist:false` as well as `persist:true`.
- [ ] Update relevant frontend type-safety spec during implementation if established behavior changes from sanitization to rejection.
- [ ] Test trace collision, omitted/default distinction, same canonical slot serialization, different canonical slot overlap and unsafe/empty rejection.

## Phase 11: Executable Behavior Matrix

Run and keep automated coverage for all rows:

- [ ] Formal turn vs different-path media, media commits first.
- [ ] Formal turn vs media, formal commits first.
- [ ] Multiple different-path media commits from overlapping baselines.
- [ ] Same-path regeneration queue order and bypass-queue CAS conflict.
- [ ] Successful regeneration updates workspace and all eligible retained checkpoints.
- [ ] Provider/staging/commit failure preserves prior asset and manifests.
- [ ] Source content changed/deleted after generation starts gives zero persistent writes.
- [ ] Media-before-restore and restore-before-media linearization.
- [ ] No patch to checkpoints before source turn.
- [ ] No recreation of pruned/deleted checkpoint.
- [ ] Stale `current-turn-auto` rejects workspace and checkpoint together.
- [ ] Injected transactional failure leaves no partial Blob/workspace/checkpoint/save state.
- [ ] Directory delete rejects a new/changed descendant without deleting it.
- [ ] GC preserves workspace/manifests and deletes only unreferenced old Blob.
- [ ] Trace path differs by invocation id at same Agent/timestamp.
- [ ] Slot queue/path identity is canonical and collision-free for persist true/false.
- [ ] Invoke authority matrix: required option + Tool missing guard / each guard mismatch / wrong assetId yields upstream `IMAGE_INVALID_ARGUMENTS`, zero Provider/zero write and zero source-registration calls; exact match reaches guarded commit with option guard.
- [ ] Option absent + no Tool guard remains ordinary write with no patch; option absent + legal Tool guard reaches guarded patch; formal-turn direct Tool may remain unguarded.
- [ ] Agent result echo/path never creates generated-media metadata or overrides source guard authority.

## Phase 12: Validation and Review

Run from repository root:

```bash
npm run test:storage
npm run build --workspace @tsian/play-bridge
npm run build:web
# Only when @tsian/contracts changed:
npm run build:contracts

git diff --check -- .trellis/tasks/07-21-image-save-consistency apps/platform-web packages/contracts package.json package-lock.json
```

Then review:

- [ ] `rg "finalWorkspaceFiles\(\)" apps/platform-web/src/platform-host/runtime-turn.ts` does not feed formal storage commit.
- [ ] `rg "current-turn-auto|generatedMedia" apps/platform-web/src` confirms guarded media never rebuilds an old full manifest.
- [ ] `rg "formatAgentTracePath" apps/platform-web/src` shows invocationId at every call site.
- [ ] `rg "contextSlot|agentContextPath" apps/platform-web/src/platform-host/ai-invocation.ts apps/platform-web/src/agent-runtime/context-lifecycle.ts` shows one canonical slot value.
- [ ] `rg "generatedMediaSourceGuard|requiredSourceGuard|sourceGuard|generatedMedia" apps/platform-web/src packages/play-bridge/src packages/contracts/src` confirms the optional invoke wire field/host closure end before source registration; storage generated-media code contains no `sourceGuard`, `illustrations`, card Agent id, Provider or UI concepts; only platform-host source registration imports the guard/helper.
- [ ] No new Dexie table/DB-name bump, job row, cancellation framework, queue, refcount or unused audit metadata was introduced.
- [ ] `completed` remains after durable commit.
- [ ] All Provider/UI/Agent Prompt/card source changes remain outside this task.
- [ ] Run `trellis-check` before commit when implementation is eventually completed.

## Rollback Points

- Revision/transaction expectation changes.
- Formal-turn explicit commit and atomic checkpoint.
- Host guard-to-exact-source conversion.
- Guarded checkpoint path patch.
- Per-save restore/media lifecycle serializer.
- Workspace-aware GC.
- Trace and slot identity tightening.

Each seam should remain independently reviewable with green storage tests. Do not roll back by restoring full-workspace replacement, manifest-only GC or guarded `current-turn-auto`.

No task start, commit or product implementation is implied by this planning document.
