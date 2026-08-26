# Design — 异步图片存档一致性

## 1. Data Shapes

```ts
interface ResolvedGeneratedMediaBinding {
  saveId: string
  target: GeneratedMediaTurnProjectionTarget
  sourcePath: string
  expectedSourceRevision: string
  expectedBranchEpoch: number
  assetPath: string
}

interface GeneratedMediaWriteInput {
  assetPath: string
  data: Blob
  source: {
    path: string
    expectedRevision: string
    expectedBranchEpoch: number
    sourceTurn: number
  }
}
```

Target normalization/path helper is shared with the platform child. Binding resolution is platform-host. Storage receives only exact-source data.

## 2. Source Resolution

For target turn N, Host resolves the canonical turn file path and parses the persisted turn envelope using the existing turn reader. It selects the assistant item and checks `projections[projectionKey]` is an array whose `index` value is a string.

The opaque source revision is derived from the stored record, including content and record lifecycle fields. It is not a JSON canonicalization of the projection and is never sent to Agent/UI.

Resolution happens before `runAgentInvocation`. A bound Tool runner cannot be created from unresolved coordinates.

## 3. Stable Path

```text
save/assets/generated/turn-projection/<turn>/<projectionKey>/<index>
```

The path deliberately excludes source hash. Rewriting/regenerating the same logical slot replaces one asset. Authority comes from source revision + epoch CAS, so reusing a path after a branch rewrite is safe.

## 4. Formal Commit Algorithm

1. Runtime exports explicit changes.
2. Storage reads current workspace and applies changes in memory.
3. It computes checkpoint Blob hashes outside transaction.
4. In transaction, it compares current workspace signature with the read signature.
5. On match, apply only explicit writes/deletes and put the checkpoint.
6. On mismatch, rebuild from the new current workspace and retry.

This generalizes the already-proven side-channel checkpoint retry pattern. It does not restore full-replace semantics.

## 5. Branch Epoch

`LocalSaveRecord.branchEpoch?: number` defaults to 0 on read. Restore increments it inside the restore transaction before returning success. Epoch is intentionally unaffected by ordinary turn advancement.

If future code introduces another branch-rewrite operation, that operation must share the same increment helper.

## 6. Checkpoint Coverage

`LocalCheckpointRecord.historyFileCount?: number` is populated by all current builders. The value comes from actual contiguous turn files in the merged workspace:

| State | turn | historyFileCount |
|---|---:|---:|
| New save initial | 0 | 0 |
| Opening published | 0 | 1 |
| Formal turn 1 | 1 | 2 |
| Formal turn N | N | N+1 |

Generated media eligibility is based only on `historyFileCount >= sourceTurn + 1`. This avoids compatibility `reason` strings and turn-0 ambiguity.

## 7. Generated Media Transaction

Before transaction:

1. verify Blob and compute content hash;
2. prepare the workspace record and replacement manifest entry.

Inside one transaction over saves/workspace/checkpoints/blobs:

1. read save; compare branch epoch;
2. read source record; compare opaque revision;
3. put Blob if absent;
4. put workspace asset record;
5. read checkpoints and replace/add asset entry for eligible records;
6. put changed checkpoint records and save timestamp.

After commit, reference-scan GC may delete the previous hash if no workspace/checkpoint references remain. On CAS failure no Blob is inserted.

## 8. Concurrency

- Different paths commute inside Dexie transactions.
- Formal turn changes are merged/retried, so they do not delete media paths.
- Same-path regeneration serializes on the database transaction. Each valid commit updates workspace and every eligible manifest together.
- Restore changes epoch and workspace in one transaction; either restore wins first and image CAS fails, or image wins first and restore deterministically restores/prunes its target snapshot.
- New checkpoints created while Provider runs are discovered at commit and patched if eligible.

## 9. Restore and GC

Restore reconstructs manifest state, prunes future turn files/checkpoints, increments epoch and then runs existing orphan GC. Because all post-source checkpoints carry the media entry, restoring to any eligible checkpoint reconstructs the image; restoring before source removes it.

## 10. Errors

Host maps unresolved target and stale source to stable generated-media errors. These are per-invocation failures and do not fail the already-persisted story. Diagnostics may record target coordinates and failure category, but not projection raw content or Blob bytes.
