# Design — 异步图片存档一致性

## 1. Architecture and Ownership

```text
formal sendMessage
  → RuntimeWorkspaceTransaction(baseline revisions)
  → stage raw turn + context/state + trace
  → finalWorkspaceChanges()
  → prepare current DB + changes + hashes
  → touched-path CAS + atomic turn transaction
      blobs + workspaceFiles + checkpoint + save

invokeAgent + guarded generate_image
  → InvokeAgentRequest.generatedMediaSourceGuard strict-normalized
  → host closes it as requiredSourceGuard over image runner
  → Tool guard + assetId must match before Provider (or no option + legal Tool self-guard)
  → validated handoff uses authoritative guard
  → source registration reads exact authoritative turn file
  → writeGeneratedMedia(Blob + exact-source revision metadata)
  → guarded media commit
      source CAS + target CAS + asset Blob/workspace write
      + eligible checkpoint path patch + save touch

restoreCheckpointForSave
  → per-save lifecycle serializer
  → prefetch selected manifest blobs
  → atomic restore/prune transaction
  → workspace+manifest-aware Blob GC
```

Ownership is intentionally split:

| Layer | Owns | Must not own |
|---|---|---|
| inline UI/repack tooling sibling | Fix `exportGameCardPackage` text inventory to actual UTF-8 ZIP entry bytes, add ASCII/Chinese/emoji/binary size regressions, and make repack depend on the corrected exporter | Save-runtime content revision, checkpoint/restore CAS, or this task's storage harness |
| Card-agnostic platform-host source registration | Accept only platform handoff `{ identityKey, assetPath, blob, sourceGuard }` already produced by required-and-validated invoke option closure or, with no option, a legal Tool self-guard; exact turn-file read; generic assistant projection lookup; shared-helper raw fingerprint validation; complete turn-file revision | Reconstruct guard authority from Agent result, accept ordinary path inference, Dexie checkpoint patching, card runtime `{agentId,protocol}` capability, `IllustrationBriefV1`/`additionalProperties`/length/ref/fallback rules, or card UI |
| Runtime workspace transaction | Staged files, baseline touched-path expectations, exact directory delete membership, exact-source generated-media write/metadata pairing | Current DB reads, projection parsing, sourceGuard metadata, or retained checkpoint policy |
| Storage commit | Generic content revision CAS, atomic workspace/checkpoint/blob/save writes, per-save lifecycle serialization | `illustrations` schema, projection parsing, Provider logic |
| Checkpoint/restore | Thin manifest patch/restore/prune, Blob liveness | Reconstructing card business data |
| `invokeAgent` host | Canonical slot queue identity, trace invocation identity, commit-mode dispatch and `completed` ordering | Global generation queue or network cancellation |

No new table is needed. Expected revisions and source metadata are transaction-scoped commit inputs; the durable authorities remain `workspaceFiles`, `checkpoints`, `blobs`, and `saves`.

## 2. Authority and Invariants

| Data | Authority | Derived/temporary |
|---|---|---|
| Current save file | `workspaceFiles` row | `WorkspaceFile` projection, content revision |
| Turn source | exact `save/history/turns/turn-NNNNNN.json` contents | projection guard validation and source revision |
| Recoverable checkpoint state | retained checkpoint manifest | reconstructed files from Blob rows |
| Binary/text checkpoint content | `blobs[hash, ownerSaveId]` | manifest entry |
| Guarded target/commit authority | strict-normalized invoke option captured by host `requiredSourceGuard`, or legal Tool self-guard only when option absent; exact source registration | Agent request/result echo and Tool object under required mode are correlation/check data only |
| Invocation persistence identity | `invocationId` | trace filename component |
| Side-channel context isolation | canonical normalized slot | queue key and context path |

Required invariants:

1. A manifest entry never references a missing Blob after a successful commit.
2. A guarded asset workspace write and every required eligible checkpoint patch either all commit or none commit.
3. A formal accepted turn's raw turn/context/state/trace/save metadata/after-turn checkpoint are atomic.
4. No commit applies a touched path whose baseline content revision changed.
5. No old checkpoint is rebuilt from current workspace. Generated media only patches its one path.
6. Restore and guarded media commit have one per-save linearization order.
7. Blob GC never deletes a hash referenced by current workspace or a retained checkpoint.

## 3. Content Revision and Touched-path Contract

### 3.1 Revision algorithm

Use one full-content SHA-256 helper for all CAS:

- text file: SHA-256 of `TextEncoder().encode(content)`;
- binary file: SHA-256 of exact Blob bytes;
- serialized form: 64 lowercase hex characters.

This matches checkpoint content addressing. `updatedAt`, `createdAt`, MIME, path, Blob size and object identity do not participate. A missing path uses an explicit missing expectation rather than a magic hash.

```ts
type WorkspacePathExpectation =
  | { path: string; state: "missing" }
  | { path: string; state: "present"; revision: string }

interface RuntimeWorkspaceChanges {
  writtenFiles: WorkspaceFile[]
  deletedPaths: string[]        // exact staged files, not directory prefixes
  expectedPaths: WorkspacePathExpectation[]
  directoryDeletes: Array<{
    path: string
    expectedMembers: WorkspacePathExpectation[]
  }>
  generatedMedia: GeneratedMediaCommitMetadata[]
}
```

The exact TypeScript factoring may differ, but the information and behavior are mandatory. These fields are internal to `platform-web`; do not persist them.

### 3.2 First-touch semantics

`createRuntimeWorkspaceTransaction(baselineFiles)` builds a baseline map. On first write/delete of a normalized save-runtime path, capture its baseline expectation. Later staged rewrites of the same path retain the original expectation. This ensures the whole transaction compares against its start state, not its own intermediate writes.

Writing a new path captures `missing`; overwriting captures the baseline full-content hash. Because hashing is async, either:

- precompute baseline revisions when creating an async transaction factory; or
- preserve immutable baseline content in the changes object and compute revisions during commit preparation.

Prefer keeping transaction mutation APIs synchronous and computing hashes from immutable baseline snapshots in the commit preparation layer. Do not use `updatedAt` as an optimization that changes correctness.

### 3.3 Directory delete

Current staging already discovers baseline descendants. Export those descendants as exact deletes plus expectations. Commit must also compare current directory membership with the captured baseline membership:

- a baseline member changed or disappeared unexpectedly → conflict;
- a new descendant appeared → conflict;
- only when membership and revisions match may all exact rows be deleted atomically.

Never run a current-DB prefix delete from an old directory intent. This prevents a stale transaction from deleting an image or file created after invocation start.

### 3.4 Generic CAS result

Use a stable internal conflict class/code such as:

- `WORKSPACE_PATH_CONFLICT`;
- `WORKSPACE_DIRECTORY_CONFLICT`;
- `WORKSPACE_SOURCE_STALE`;
- `WORKSPACE_TURN_STALE`.

Errors should include safe paths/retry intent only, not file content. A conflict aborts the entire Dexie transaction.

## 4. Guard Conversion and Target Binding

### 4.1 Shared target identity

Import the sole implementation from `@tsian/play-bridge` (`packages/play-bridge/src/generated-media-identity.ts`). This task does not copy canonical encoding, fingerprint, normalization, or path logic. The helper hashes the exact persisted raw projection string produced by `$1|trim` as UTF-8; it never parses JSON, sorts fields, normalizes Unicode/whitespace, or re-serializes before fingerprinting.

The platform host has already strict-normalized `InvokeAgentRequest.generatedMediaSourceGuard` when supplied, captured it as a `requiredSourceGuard` closure, required the Tool guard to match every field, and rejected incoming `assetId !== identityKey` before the paid Provider request. Tool omission/mismatch/wrong assetId never reaches Provider or this seam and cannot downgrade to ordinary write. If the invoke option was absent, a legal Tool self-guard may still create a guarded handoff; no option + no Tool guard remains ordinary. Source registration and transaction pairing re-use the same helper defensively for `identityKey ↔ assetPath`:

```text
preimage = UTF-8(
  "tsian-generated-media-turn-projection-v1" + NUL +
  decimal(turn) + NUL +
  projectionKey + NUL +
  decimal(index) + NUL +
  fingerprint
)
identityKey = "tp-v1-" + lowercaseHex(SHA-256(preimage))
assetPath = "save/assets/generated/" + identityKey
```

Before this task's seam runs, the platform image host has already applied the three-mode rule. In required-option mode it derives identity from the authoritative `requiredSourceGuard` closure and requires the Tool `assetId` plus every Tool guard field to match before the paid Provider request; in no-option self-guard mode it derives from the valid Tool guard; no-option/no-guard remains ordinary and never reaches source registration. Transaction/storage reassert the `identityKey ↔ assetPath` mapping defensively.

### 4.2 Card-agnostic platform-host source registration

After the platform image task has validated invocation authority, Provider output and the Blob, it passes exactly:

```ts
{ identityKey, assetPath, blob, sourceGuard }
```

This object is transient platform-host handoff data, not transaction/storage metadata. Its `sourceGuard` must already come from either (a) the invocation-authoritative required option closure after exact Tool comparison or (b) a valid Tool self-guard when no required option existed. Agent input/final-result echoes never create or alter this object. The source-registration seam:

1. Strictly normalize the guard and re-derive canonical `identityKey/assetPath` with `@tsian/play-bridge`; require exact handoff equality.
2. Derive exact path `save/history/turns/turn-${pad6(turn)}.json`.
3. Read that exact authoritative turn file from the invocation transaction's baseline/current staged view.
4. Parse only the generic v2 turn envelope in platform-host, find the assistant item, then read `assistant.projections[projectionKey]` and exact `index`.
5. Require a raw string value and call shared `fingerprintProjectionRaw(raw)`; compare exact guard fingerprint. Never parse or normalize that raw projection JSON.
6. Hash the complete turn-file UTF-8 contents as `expectedRevision`.
7. Call the storage-facing transaction seam:

```ts
writeGeneratedMedia({
  identityKey,
  assetPath,
  data: blob,
  source: {
    path,
    expectedRevision
  }
})
```

The layer understands generic turn/projection structure but not `illustrations` fields or card schema. `projectionKey` remains guard data. It never reads card runtime `imageGeneration` capability and never imports the illustration brief validator; closed-object fields, UTF-16 lengths, ref grammar, dedupe and UI fallback remain protocol/UI concerns. Storage receives exact path/revision only and never receives `sourceGuard`. This task's exact-source shape and `writeGeneratedMedia` signature are authoritative for final storage integration.

### 4.3 Transaction pairing

`writeGeneratedMedia({ identityKey, assetPath, data, source })` performs one logical staged operation:

- require Blob data;
- require `assetPath === save/assets/generated/${identityKey}`;
- stage/replace the same path via the ordinary write machinery;
- upsert one metadata item keyed by asset path;
- ensure `finalWorkspaceChanges()` contains exactly one Blob write for every metadata path.

A normal `write()` to the generated path remains a normal write and does not gain checkpoint patch semantics. Metadata is capability, not path inference. `writeGeneratedMedia` may only be reached through the validated handoff/source-registration seam; required guard mismatches must have already terminated with zero Provider and zero writes, while no-option/no-guard generic generation stays on normal `write()`.

## 5. Formal-turn Commit Algorithm

### 5.1 Host handoff

`runtime-turn.ts` changes from full snapshot handoff to:

```ts
await commitSuccessfulRuntimeTurnForSave(activeSaveId, {
  changes: workspaceTransaction.finalWorkspaceChanges(),
  expectedTurn: nextTurn,
  reason: "after-turn",
})
```

`history: nextHistory` is no longer a storage input because raw turn files are the history authority and `saves` has no history field. The host may keep `nextHistory` only for runtime computation before commit.

### 5.2 Preparation outside Dexie transaction

For each bounded attempt:

1. Read current save workspace and relevant save/checkpoint state.
2. Verify transaction expectations against current workspace.
3. Apply explicit changes in memory to form `mergedWorkspace`.
4. Verify append-only turn semantics:
   - new exact raw turn path is present in changes;
   - current max turn + 1 equals `expectedTurn`;
   - no overwrite of an existing authoritative turn file.
5. Filter append-only logs from checkpoint state.
6. Hash every merged checkpoint state file and create content-addressed Blob records in memory. Do not write them yet.
7. Build the after-turn checkpoint record from this merged state.
8. Capture a preparation signature/revision set sufficient to repeat the same validations in the transaction.

### 5.3 Atomic Dexie transaction

Open one `rw` transaction over `saves`, `workspaceFiles`, `checkpoints`, and `blobs`:

1. Re-read current workspace rows required for full preparation validity. A whole-workspace signature is acceptable for after-turn manifest preparation because any unrelated current change must cause reprepare; touched-path CAS remains the semantic conflict boundary.
2. Re-run touched-path, directory membership and turn append checks.
3. If current state differs from preparation, return retry without writing.
4. Put all newly referenced Blob rows if absent.
5. Apply exact deletes/writes only.
6. Put after-turn checkpoint.
7. Touch save metadata.

If any operation throws, Dexie rolls back all four tables. Retry preparation for benign unrelated changes up to a small bounded limit; a true touched-path conflict fails immediately. Prune and GC may run afterward as a separate lifecycle operation, but the accepted turn and its checkpoint are already atomic and GC must use the new workspace+manifest liveness rule.

This ordering solves both interleavings:

- media commits during turn execution before formal preparation → media exists in current DB and enters the after-turn manifest;
- media commits after formal turn → guarded media commit patches the newly retained checkpoint.

## 6. Generic Side-channel and `current-turn-auto`

### 6.1 Ordinary no-checkpoint commit

`commitWorkspaceChangesForSave` uses touched-path CAS and exact directory deletes. It can rebase unrelated paths, so different-path calls both succeed. It includes `blobs` only when ordinary checkpoint content-addressing requires it; a plain unguarded workspace Blob row does not automatically patch checkpoints.

### 6.2 Generic checkpoint options

`create`/`overwrite` remain current-state snapshot operations. They prepare a merged current workspace manifest outside transaction, then repeat CAS/signature checks and atomically apply explicit changes + checkpoint + Blob rows + save metadata. Existing protected-checkpoint rules remain.

### 6.3 `current-turn-auto`

The captured invocation turn becomes an expected branch condition, not unconditional target metadata:

1. During preparation, recompute current max turn from authoritative turn files.
2. Require it equals captured `input.turn`.
3. Repeat that equality in the final transaction.
4. On mismatch return `WORKSPACE_TURN_STALE`; apply neither workspace changes nor checkpoint.
5. When equal, build the checkpoint from current workspace + explicit changes and canonicalize same-turn automatic checkpoints as today.

Guarded media metadata is incompatible with the generic checkpoint builder. Its dispatch must route to the guarded path patch algorithm; if a guarded changeset also asks for `create/overwrite/current-turn-auto`, reject before transaction unless a later explicit product contract defines composition.

## 7. Guarded Media Commit Algorithm

### 7.1 Precompute

For each generated media item (MVP invocation should normally contain one; if multiple are allowed, validate all atomically):

1. Require metadata path has a corresponding Blob write in `writtenFiles` and no delete overlaps it.
2. Reassert stable path/identity mapping.
3. Hash asset Blob to `assetHash`.
4. Build its Blob record in memory.
5. Parse source turn number from the exact canonical path for checkpoint eligibility; reject any noncanonical path.

Do not write Blob rows during precompute.

### 7.2 Per-save lifecycle section

Enter the per-save lifecycle serializer only after Provider/Agent work and hash precomputation. Then execute one Dexie transaction across `saves`, `workspaceFiles`, `checkpoints`, `blobs`:

1. Read exact source workspace row; require present and full-content hash equals `expectedRevision`.
2. Validate touched target baseline expectation. Source CAS is separate from target CAS.
3. Validate all remaining ordinary touched paths and directory expectations.
4. Read current retained checkpoints for the save.
5. For each checkpoint with `turn >= sourceTurn`, clone its manifest and only upsert the asset path entry `{ path, hash: assetHash, createdAt, updatedAt }`.
6. Put asset Blob row(s) if absent.
7. Apply exact workspace changes.
8. Put only checkpoint records that still exist and were read in this transaction; do not synthesize a missing checkpoint.
9. Touch save metadata.

A stale source or target conflict throws before step 6. Dexie rollback guarantees zero writes on later failure. `completed` remains after this function returns.

### 7.3 Regeneration

Same identity means same asset path. Normal calls use the same canonical `contextSlot`, so the existing invocation queue serializes generation and commit for that identity. The second invocation begins after the first and observes its version as baseline.

If callers bypass queue or race across contexts, both may generate but only the writer whose target expectation still matches can commit; the other gets a retryable path conflict. Silent LWW is forbidden. A failed Provider call never stages a write and therefore leaves old asset/manifests intact.

## 8. Restore Linearization

Use one module-level keyed serializer, e.g. `withSaveLifecycleLock(saveId, operation)`. It is an internal persistence lock, not an image job queue:

- keys by save id;
- chains after predecessor failure (`catch` then continue);
- cleans only if map still points at current promise;
- wraps guarded media commit and the entire restore operation;
- does not wrap image network generation, generic different-path staging, UI, or Composer.

`restoreCheckpointForSave` acquires it before reading the checkpoint and holds it through Blob prefetch and final transaction. This prevents the selected manifest from being patched between prefetch and restore.

Linearization:

- guarded media wins lock first: source valid, asset and eligible manifests commit; restore then reads the patched target and restores the image;
- restore wins first: it prunes future turn files/checkpoints and rewrites workspace; late media then reads a missing/different source and aborts with zero writes.

Both `platform-actions.ts` and `frontend-inspector.ts` call the shared storage helper, so no caller-specific lock is needed.

Generic checkpoint mutation/prune/GC operations that can alter the same manifests should reuse the lifecycle seam when implementation analysis finds they can overlap restore/media. At minimum guarded commit, restore, checkpoint prune/delete/overwrite and their GC must not interleave into an invalid manifest/Blob state.

## 9. Blob Liveness and GC

Create one storage helper for referenced hashes:

1. Read all current save workspace rows.
2. Hash their complete content (text/Blob) outside a Dexie transaction.
3. Read all retained checkpoints and add every manifest hash.
4. Union both sets and delete only same-save Blob rows outside the union.

Why include workspace: a current generated asset may not belong to an older checkpoint, and temporary ordering between checkpoint operations must not make a current workspace Blob collectible.

Because current workspace hash calculation can race mutations, GC should run inside the same per-save lifecycle chain and use a read/verify/delete approach: prepare hashes, then in a short transaction recheck workspace/checkpoint signature before deleting, or retry. Never delete based on a stale liveness snapshot.

Use this helper after prune, delete, overwrite, restore, current-turn-auto canonicalization, and successful regeneration where an old asset hash may become unreferenced. Do not maintain refcounts or add audit rows.

## 10. Trace and Slot Identity

### 10.1 Trace path

Change the formatter to take invocation id:

```ts
formatAgentTracePath(agentId, timestamp, invocationId)
```

Use path-safe collision-resistant components. Agent id may retain existing sanitization for readability, but invocation id must be encoded injectively for accepted input (for example UTF-8 lowercase hex) or hashed to lowercase SHA-256. Do not replace arbitrary characters with `_` and claim uniqueness. Include the component in both success transaction trace and failure best-effort trace.

Example layout:

```text
.tsian/save/traces/agents/<safe-agent>-<timestamp>-<invocation-token>.jsonl
```

### 10.2 Canonical slot

Add one boundary normalizer used before queue construction:

```ts
normalizeInvokeAgentContextSlot(input: unknown): string | undefined
```

Rules:

- omitted → `undefined` and legacy `context.json`;
- present must be a non-empty canonical string matching `[A-Za-z0-9_-]+` within a bounded length;
- any trim change, slash, dot escape, whitespace or unsupported character → reject; do not lossy-sanitize;
- queue identity uses a structured/prefixed key so omitted differs from explicit strings, e.g. `JSON.stringify([agentId, slot ?? null])`;
- the same normalized value is passed to `readAgentContextFromWorkspace`, `stageAgentContextFile`, and `agentContextPath`;
- validation occurs even when `persist:false`.

`agentContextPath` may defensively call the same validator or accept a branded canonical slot, but it must not apply a second different normalization.

## 11. Test Architecture and Behavior Matrix

### 11.1 Harness

The repository currently has Playwright UI E2E only and no platform-web unit test script. Add the smallest executable storage test harness:

- `vitest` and `fake-indexeddb` as development dependencies;
- a `test:storage` script at the narrow owning package/root;
- test setup that installs fake IndexedDB before importing `localDb`, clears tables between tests, and supplies Web Crypto/Blob APIs;
- controllable barriers/deferred promises around preparation/transaction seams to force deterministic interleavings.

Tests should call public/internal storage commit helpers against real Dexie tables. Pure helper tests supplement but do not replace transaction assertions.

### 11.2 Required matrix

| ID | Interleaving/input | Required assertion |
|---|---|---|
| T1 | formal turn starts, different-path media commits, formal commits | both paths survive; after-turn manifest includes media |
| T2 | formal commits, then guarded media | media patches after-turn checkpoint |
| T3 | two different guarded paths from same baseline | both workspace rows and both manifest entries survive |
| T4 | same-path writers bypass queue | one succeeds; stale writer conflict; no silent LWW |
| T5 | queued same-path regeneration succeeds | workspace + all eligible retained checkpoints use newest hash |
| T6 | regeneration Provider/stage/commit fails | old workspace, manifests and Blob remain |
| T7 | source turn content changes or disappears | stale error; zero Blob/workspace/checkpoint/save writes |
| T8 | media commits before restore | restore returns media version from patched manifest |
| T9 | restore completes before late media commit | source CAS fails; restored branch stays clean |
| T10 | checkpoints before/equal/after source | only equal/after retained checkpoints patched |
| T11 | future checkpoints pruned before media commit | no deleted checkpoint recreated |
| T12 | current-turn-auto sees a later current turn | zero workspace/checkpoint writes and stale-turn error |
| T13 | injected failure after Blob put in transaction | transaction rollback leaves no partial Blob/workspace/checkpoint/save state |
| T14 | directory delete staged, new descendant appears | directory conflict; new descendant and baseline files preserved |
| T15 | GC with current-workspace-only and manifest refs | live hashes survive; old unreferenced regeneration hash deleted |
| T16 | two invocation ids, same agent and timestamp | trace paths differ; success/failure call sites use invocation id |
| T17 | canonical, omitted, `default`, empty and unsafe slots with persist true/false | queue/path identity matches; invalid values reject before queue |
| T18 | invoke option absent + Tool guard absent Blob write | no generated-media checkpoint patch; existing generic commit semantics preserved |
| T18a | invoke option absent + legal Tool guard | guarded source registration/patch occurs |
| T18b | required invoke option + Tool guard omitted/mismatched or wrong assetId | upstream `IMAGE_INVALID_ARGUMENTS`; zero Provider, zero ordinary/generated-media write; storage seam not called |
| T18c | required invoke option + exact Tool guard/assetId | upstream handoff guard is option-authoritative; source registration and commit succeed |
| T19 | source file `updatedAt` changes only | source revision remains valid; content change invalidates |
| T20 | ordinary touched path changed during formal turn | whole formal accepted state aborts; no partial turn/checkpoint |

## 12. Compatibility, Failure, and Rollback

- No DB schema/name change: all new CAS/metadata types are transient internal data.
- Existing callers with no generated-media metadata continue through ordinary paths, but gain safe touched-path CAS and directory conflict handling.
- Existing omitted slot remains `context.json`; callers sending formerly sanitized unsafe slots now fail loud. This deliberate tightening removes alias races.
- Existing trace readers discover files by directory/extension and should tolerate the extra filename component; verify any parser assumptions.
- Checkpoint record shape remains unchanged; only manifest construction/patch and GC semantics change.
- Rollback should be by implementation seams: transaction expectations, formal commit, guarded patch, lifecycle serializer, GC, trace/slot. Never restore formal full-table replacement or guarded `current-turn-auto` as a shortcut.
