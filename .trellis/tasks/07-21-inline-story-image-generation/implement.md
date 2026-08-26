# Implement — 正文内嵌插图生成

## Phase 0: Planning Gate

- [ ] Re-read the parent and four child PRD/design files; all use `generatedMediaTarget` with no duplicated caller authority in Agent or Tool messages.
- [ ] Confirm `.tsian/local/desktop.env` is the only image/embedding connection source and no image Settings UI remains.
- [ ] Confirm current opening files use `开局建模` + `publish_opening`.
- [ ] Confirm delivered packaging, diagnostics and generic checkpoint retry work is excluded.
- [ ] Run `task.py validate` and `list-context` for all five task directories.
- [ ] Do not run `task.py start` until the user approves implementation.

## Phase 1: Shared Contract Freeze

- [ ] Freeze `IllustrationBriefV1`, marker, first-three-valid UI behavior and mandatory 1-3 Prompt rule.
- [ ] Freeze `GeneratedMediaTurnProjectionTarget` and stable target path helper.
- [ ] Freeze `generate_image {prompt,aspect,sourceImagePaths?}` and `{path,mediaType}`.
- [ ] Freeze bound invocation one-call limit and Host source binding fields.
- [ ] Freeze env keys and destructive RAG switch.
- [ ] Freeze eligible checkpoint rule: retained `checkpoint.historyFileCount >= sourceTurn + 1`; initial checkpoint count is 0 and published opening count is 1.

## Phase 2: Recommended Child Order

### 2.1 Platform capability

Task: `07-21-platform-image-generation`

- [ ] Add desktop env storage/parser/resolvers.
- [ ] Remove old embedding config/UI and switch embedding client.
- [ ] Add generated-media invoke wire contract and strict normalization.
- [ ] Implement image adapter and explicitly enabled Tool.
- [ ] Provide a bound-runner handoff to the consistency child.

### 2.2 Persistence consistency

Task: `07-21-image-save-consistency`

- [ ] Resolve source binding at invocation start.
- [ ] Replace formal full-snapshot commit with explicit merge.
- [ ] Add branch epoch, generated-media CAS and checkpoint path patch.
- [ ] Cover regeneration, restore races and Blob GC.

### 2.3 Card protocol

Task: `07-21-card-illustration-agent-protocol`

- [ ] Add shared brief validator, marker and projection rule.
- [ ] Update current opening delegation/publication.
- [ ] Add entrypoint and `image-director` with fixed style and reference images.
- [ ] Package current card workspace using existing workflow.

### 2.4 Inline UI

Task: `07-21-card-inline-illustration-ui`

- [ ] Preserve authoritative assistant metadata.
- [ ] Add ordered parser and accessible illustration states.
- [ ] Invoke with target-only options, probe durable path, handle reload/restore.
- [ ] Repack and validate the distributed card.

## Phase 3: Parent Integration Matrix

- [ ] turn 0 and formal turn each project 1, 2 and 3 valid briefs correctly.
- [ ] malformed/missing marker never blocks commit or leaks marker JSON into Markdown.
- [ ] text-to-image and image-to-image both produce a validated Blob.
- [ ] explicit Tool permission and complete env are independently required.
- [ ] different illustrations complete concurrently while a later formal turn commits.
- [ ] generation started at turn N may finish after N+K and patches all retained checkpoints N..N+K.
- [ ] restore during generation increments epoch and rejects the late result.
- [ ] regenerate success replaces eligible manifests; failure retains old media.
- [ ] reload/restore reconstruct UI from projection target + workspace path with no Object URL leak.
- [ ] old card without image entrypoint remains playable.

## Phase 4: Verification

Use current repository commands, not retired file-specific tests:

```powershell
npm run build:contracts
npm run build --workspace @tsian/play-bridge
npm run build:web
npm run build --workspace play-frontend-dev
npm run test:smoke
npm run test:integration
npm run repack:immersive-reader
git diff --check
```

- [ ] Adjust the exact smoke/integration command set to the repository at implementation time; do not recreate removed harnesses.
- [ ] Inspect diagnostics to prove prompts, keys, URLs and image bytes are absent.
- [ ] Review packaged iframe behavior on desktop and mobile viewports.
- [ ] Run Trellis check before completion.

## Rollback

- Disabling/removing `imageGeneration` entrypoint restores ordinary prose rendering.
- Removing `generate_image` permission disables generation without affecting story turns.
- Generated media paths are additive save-runtime assets; old saves require no migration.
- RAG env switch is destructive by decision and has no legacy fallback to restore.
