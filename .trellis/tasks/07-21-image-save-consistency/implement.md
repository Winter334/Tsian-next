# Implement — 异步图片存档一致性

## Phase 0: Gate

- [ ] Load storage/frontend/type-safety specs.
- [ ] Freeze target/path/binding with platform sibling.
- [ ] Confirm source resolver remains schema-agnostic.
- [ ] Record existing generic side-channel checkpoint behavior; do not duplicate it.

## Phase 1: Checkpoint coverage and branch epoch

- [ ] Add optional `branchEpoch` to save records with default 0 normalization.
- [ ] Add optional `historyFileCount` to checkpoint records/summaries only where internally needed.
- [ ] Populate count in initial, create, overwrite, formal and current-turn-auto builders.
- [ ] Increment epoch in restore transaction and centralize helper for future branch rewrites.
- [ ] Test initial/opening/turn-N counts and legacy missing-field behavior.

## Phase 2: Formal turn merge

- [ ] Change runtime-turn to pass `finalWorkspaceChanges()`.
- [ ] Refactor formal commit to merge explicit changes into current workspace.
- [ ] Build auto checkpoint from merged state with signature retry.
- [ ] Preserve unrelated concurrent paths and formal explicit deletes.
- [ ] Remove full-table workspace delete from the formal success path.

## Phase 3: Source binding

- [ ] Resolve strict target before Agent invocation.
- [ ] Read exact turn assistant projection and capture record revision/epoch.
- [ ] Derive stable asset path with the shared helper.
- [ ] Bind the platform image runner; unresolved target must never become unbound.
- [ ] Add target missing/wrong-index/non-string tests.

## Phase 4: Generated media commit

- [ ] Implement exact-source storage API.
- [ ] Hash/prepare Blob outside transaction.
- [ ] CAS branch epoch + source revision inside transaction.
- [ ] Atomically put Blob/workspace path and patch every eligible checkpoint by `historyFileCount`.
- [ ] Preserve old asset on Provider/stale/transaction failure.
- [ ] Integrate completion ordering so frontend `completed` fires after durability.

## Phase 5: Concurrency and GC

- [ ] Cover image vs formal turn, image vs restore, different images, same-path regenerations and checkpoint creation during Provider wait.
- [ ] Ensure restore/prune/delete and replacement reference-scan GC.
- [ ] Prove CAS failure inserts no Blob and successful replacement removes only unreferenced hashes.

## Phase 6: Verification

```powershell
npm run build:web
npm run test:smoke
npm run test:integration
git diff --check
```

- [ ] Scan storage code for card-specific `illustrations`, brief fields and Agent ids; only generic projection coordinates may appear in host resolver.
- [ ] Scan formal commit for full workspace delete/replace.
- [ ] Verify initial checkpoint never receives opening image.
- [ ] Run Trellis check before completion.

## Rollback

Generated-media fields are optional internal record additions. Tool/UI can be disabled independently, but formal merge safety should not be rolled back once deployed.
