# Implement — 正文内嵌插图交互

## Phase 0: Gate

- [ ] Re-read parent, protocol, platform and consistency contracts.
- [ ] Confirm shared brief validator, entrypoint, generated-media target and stable path helper are available or coordinate their sibling order.
- [ ] Confirm current package/repack commands exist; do not modify packaging tooling.
- [ ] Do not start until the parent planning review is approved.

## Phase 1: Assistant View Model

- [ ] Define the settled assistant view with turn/content/displayContent/projections.
- [ ] Use one normalizer for live completion and history hydration.
- [ ] Preserve opening turn 0 through setup publication/injection.
- [ ] Update StoryView/window keys without changing choice extraction or token display.
- [ ] Test live, reload, turn 0 and history window remount identity.

## Phase 2: Parser and Streaming Safety

- [ ] Add the pure ordered settled parser using the shared brief validator.
- [ ] Preserve marker ordinal as projection index and require marker/projection raw equality for interactivity.
- [ ] Limit interactivity to first three valid briefs while keeping later descriptions.
- [ ] Implement bounded invalid fallback with no JSON/ref leakage.
- [ ] Add streaming marker buffering/sanitization; never construct interactive cards from deltas.
- [ ] Test 1/2/3/4+, malformed, mismatch, incomplete, isolated and cross-delta cases.

## Phase 3: Capability and Stable Probe

- [ ] Cache exact-v1 imageGeneration entrypoint during ready/init.
- [ ] Derive target keys and paths through shared helpers only.
- [ ] Probe valid raster workspace Blobs on settled card mount/remount/reload.
- [ ] Add Object URL create/revoke and decode guards.
- [ ] Test missing/invalid entrypoint, absent path, bad media and successful reload recovery.

## Phase 4: Independent Generation State

- [ ] Add per-target state registry and same-key in-flight exclusion.
- [ ] Invoke cached Agent with `{brief,prose}` and target-only options.
- [ ] Validate closed Agent result, then read helper-derived stable path after durable completion.
- [ ] Keep formal turn/Composer independent and allow different targets to overlap.
- [ ] Implement retry and regeneration with old-image retention and atomic URL replacement.
- [ ] Test per-card failure isolation, same-card dedupe and different-card concurrency.

## Phase 5: Inline UI and Lightbox

- [ ] Render prose and illustration segments in original order.
- [ ] Implement keyboard/touch whole-card activation, focus, busy and safe error states.
- [ ] Add ready image, accessible regenerate icon/tooltip and alt text.
- [ ] Add dialog lightbox with focus trap, Escape/backdrop/close, focus return and cleanup.
- [ ] Verify mobile, landscape, desktop, 200% zoom, dark contrast and reduced motion.

## Phase 6: Restore and Stale Async

- [ ] Increment UI lifecycle epoch at restore start and invalidate callbacks.
- [ ] Close lightbox, revoke mounted URLs and rebuild from current platform state after restore success/failure.
- [ ] Compare epoch + attempt/load tokens before every async state write.
- [ ] Prune targets absent from rebuilt history.
- [ ] Test restore-before-commit, commit-before-restore, repeated restore and window unmount/remount.

## Phase 7: Source Sync and Package

- [ ] Mirror only task-owned files between development and actual card source.
- [ ] Preserve documented source differences and review per-file diffs.
- [ ] Coordinate one final version bump and full manifest update with protocol child.
- [ ] Run the existing package/repack workflow; verify packaged iframe and no stale dist assets.

## Phase 8: Verification

Run current focused tests plus:

```powershell
npm run build:contracts
npm run build --workspace @tsian/play-bridge
npm run build --workspace play-frontend-dev
npm run build:web
npm run test:smoke
npm run package:card
git diff --check
```

- [ ] Review desktop/mobile screenshots and keyboard flow in the packaged iframe.
- [ ] Inspect logs to ensure brief/prose, Provider payloads and image bytes are not emitted.
- [ ] Run Trellis check before completion.

## Rollback

- Missing/removing the `imageGeneration` entrypoint leaves ordinary prose and noninteractive brief fallbacks.
- Illustration segmentation/components can be removed without changing persisted turn data.
- Durable assets remain ordinary save-runtime workspace files and require no UI-state migration.
