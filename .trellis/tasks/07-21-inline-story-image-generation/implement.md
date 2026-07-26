# Implement — 正文内嵌文生图

## Phase 0: Shared Contract Gate

- [ ] Freeze the closed `IllustrationBriefV1` schema: exactly `title`, `description`, `sceneRef`, `entityRefs`, `additionalProperties:false`; title trim `1..80`, description `1..500`, refs total `1..120` UTF-16 code units; entityRefs array `0..12` with first-occurrence dedupe; exact-one-colon segments `1..80`, not `.`/`..`, no whitespace, `/`, `\\`, NUL, or extra colon; no coercion. Storyteller emits 1–3 and UI only makes the first 3 valid blocks interactive.
- [ ] Freeze one brief runtime validator for UI (prefer a narrow `@tsian/play-bridge` root-exported module, otherwise one card UI helper); Agent prompts self-contain the same contract, `@tsian/contracts` stays type-only, and platform storage/source-registration never parses the block.
- [ ] Freeze one runtime implementation at `packages/play-bridge/src/generated-media-identity.ts`, exported from package root: guard type/strict normalize, raw `$1|trim` projection UTF-8 fingerprint, NUL identity, asset path and golden vector. Because `InvokeAgentRequest` is a contracts wire shape, contracts may declare the necessary serializable guard shape, but all runtime normalization/hash/path algorithms remain play-bridge-only.
- [ ] Freeze `InvokeAgentRequest.generatedMediaSourceGuard?` and play-bridge `InvokeAgentOptions.generatedMediaSourceGuard?` with the same generic name/type semantics; SDK must forward it, remote bridge must strict-normalize it, and existing callers that omit it remain compatible.
- [ ] Freeze exact source guard `{ kind: "turn-projection", turn, projectionKey: "illustrations", index, fingerprint }`; UI must put helper-derived `assetId + sourceGuard` in Agent input and the same guard in invoke options. Host treats only the option as authoritative.
- [ ] Freeze invokeAgent runner semantics: host closes normalized option over `generate_image` as `requiredSourceGuard`; with it present, Tool omission, any guard-field mismatch, or wrong assetId yields pre-Provider `IMAGE_INVALID_ARGUMENTS`, zero Provider/zero write and no ordinary fallback; exact match uses the option guard for handoff. Without it, Tool guard remains optional: no guard ordinary write, valid self-guard guarded path; formal-turn direct Tool may be unguarded. No agentId/purpose hardcoding.
- [ ] Freeze platform Tool image modes: `generate_image` without `sourceImagePaths` uses `/images/generations`; with `1..4` verified ordinary workspace image paths uses no-mask `/images/edits` for visual consistency. `sourceImagePaths` is optional and never echoed; mask/local repaint stays out of MVP.
- [ ] Freeze result ownership: Tool success is only `{ path, mediaType }`; Agent echoes request `assetId/sourceGuard` and embeds Tool path/mediaType; frontend validates correlation but rereads only the shared-helper-derived path. Durable authority comes from invoke option closure plus source registration, not Agent echo.
- [ ] Freeze guarded staging split: child 1 outputs `{ identityKey, assetPath, blob, sourceGuard }`; child 2 owns generic source registration and the final storage contract `{ identityKey, assetPath, source:{path,expectedRevision} }` without `sourceGuard`.
- [ ] Freeze `GameCardRuntimeEntrypoints.imageGeneration?: { agentId:string, protocol:"tsian.image-director.v1" }`; local/package normalizers and host bridge preserve the object, old cards remain compatible, and frontend ready/init enables only exact v1 while reading Agent id only from `.agentId`.
- [ ] Freeze ready/init capability caching and whole-card paid consent: pending/missing/malformed/wrong/unknown protocol falls back from first render; one pointer/Enter/Space activation, `aria-label="生成插图：<title>"`, no extra confirmation modal or persistent cost/action row.
- [ ] Freeze UI child repack scope and root command `npm run repack:immersive-reader`: first fix `apps/platform-web/src/storage/game-card-packages.ts:685-689` so text workspace inventory uses `strToU8(file.content).byteLength` or equivalent `TextEncoder` UTF-8 bytes instead of `content.length`, and add ASCII/Chinese/emoji text plus binary entry regressions. Export/import inventory `size` means uncompressed ZIP entry payload `Uint8Array.byteLength`, not archive size; preserve existing field optionality and all other import behavior. Only then may the deterministic script/Playwright isolated browser path rely on real `buildFrontend` → `writeBackDist` → corrected `exportGameCardPackage`, atomic dist replacement, disk-regenerated workspace/frontend/cover inventory, stale hash cleanup, exported/checked-in/disk bidirectional comparison and packaged iframe verification. `npm run package:frontend` is explicitly not this authority; because UI child changes platform-web, it must run `npm run build:web`.
- [ ] Confirm all four child PRDs/designs/implementation plans use the same names and semantics; no UI-local canonicalization, Agent-side hashing, or duplicated helper.
- [ ] Do not start product implementation until this gate is complete.

## Phase 1: Child Readiness Gate

Before starting each child:

- [ ] `prd.md` has passed convergence: no temporary brainstorm sections, duplicate facts, or resolved open questions.
- [ ] `design.md` defines architecture, data flow, failures, compatibility and rollback.
- [ ] `implement.md` contains ordered steps and executable validation.
- [ ] `implement.jsonl` and `check.jsonl` each contain at least one real spec/research entry; seed `_example` rows are removed.
- [ ] `task.py list-context <child>` and `task.py validate <child>` pass.
- [ ] Relevant package specs are loaded through `trellis-before-dev` before code is written.
- [ ] Worktree status and baseline commit are recorded; unrelated task trees are preserved.

## Phase 2: Recommended Delivery Order

### 2.1 Platform image generation

Task: `07-21-platform-image-generation`

- [ ] Add local image config + settings UI.
- [ ] Implement OpenAI-compatible adapter and in-memory test generation. Adapter supports `/images/generations` plus no-mask `/images/edits` when Tool callers provide verified `sourceImagePaths`; Settings test remains generations-only.
- [ ] Implement/export the single shared runtime identity helper in `@tsian/play-bridge`; add platform-web dependency/path wiring.
- [ ] Register explicitly authorized host-owned Tool; extend contracts/play-bridge invoke request/options and remote strict normalization; bind invokeAgent's authoritative `requiredSourceGuard` closure without agentId/purpose routing.
- [ ] Keep Tool success `{ path, mediaType }`; no option + no Tool guard uses ordinary transaction write, no option + legal Tool guard emits guarded handoff, and required option + exact Tool match emits an option-authoritative `{ identityKey, assetPath, blob, sourceGuard }` handoff to child 2's seam. Validate both generations and no-mask edits modes, including source-image-path pre-Provider validation and no path/byte leaks.
- [ ] Add pre-paid fail-closed tests: required option + Tool missing guard / each wrong guard field / wrong assetId all produce `IMAGE_INVALID_ARGUMENTS`, zero Provider calls, zero ordinary/generated-media writes; exact match succeeds. Also prove no option + no guard remains ordinary write and formal-turn direct Tool can be unguarded.
- [ ] Validate secret boundaries, URL/base64 responses, aspect mapping and errors.

Provider/config/adapter work can proceed while child 2 builds the guarded source-registration seam; guarded transaction integration waits for child 2's final storage contract.

### 2.2 Card illustration Agent and protocol

Task: `07-21-card-illustration-agent-protocol`

- [ ] Add storyteller/opening output guidance and projection rule.
- [ ] Add the protocol-versioned card image capability and image-director Agent.
- [ ] Make storyteller/opening/image-director prompts self-contained for the exact closed brief schema and consume the sole UI runtime validator contract; do not place runtime validation in contracts/storage.
- [ ] Consume the shared helper contract; Agent only validates/forwards frontend `assetId` + input guard and never hashes or invents an id. Agent result echo remains UI correlation only; it cannot establish host commit authority.
- [ ] Ensure UI/protocol integration sends the same guard through both channels: Agent request JSON and `InvokeAgentOptions.generatedMediaSourceGuard`; absence of the host option is a current-card failure, not permission to use unguarded ordinary write.
- [ ] Implement fixed-style prompt orchestration and exact Tool/Agent result split.
- [ ] Update card package manifest and validate turn 0/formal turn projection.

Can proceed after the shared helper/request/result contract is frozen; it must not create a second implementation.

### 2.3 Async image save consistency

Task: `07-21-image-save-consistency`

- [ ] Convert formal turn persistence to safe merged changes.
- [ ] Implement platform-host generic turn-projection source registration and convert guarded handoff to exact-source storage metadata.
- [ ] Implement storage `writeGeneratedMedia({ identityKey, assetPath, data, source:{path,expectedRevision} })` + checkpoint path patch; storage never receives sourceGuard or parses projections.
- [ ] Handle restore races, regeneration replacement, blob GC and stale results.
- [ ] Canonicalize slots and make invocation trace paths unique.
- [ ] Run concurrency/checkpoint behavior tests before frontend enables background play continuation.

Depends on the transaction contract from 2.1 and must complete before end-to-end UI acceptance.

### 2.4 Inline illustration frontend

Task: `07-21-card-inline-illustration-ui`

- [ ] Build ordered narrative segment rendering through the sole closed-schema validator; only the first 3 valid blocks are interactive, later valid blocks are fallback-only, and invalid fallback never coerces title/description or displays refs.
- [ ] At frontend ready/init, load/cache `{agentId,protocol}`; only exact `tsian.image-director.v1` enables interaction, Agent id comes only from `.agentId`, and pending/missing/invalid/unknown protocol falls back from first render.
- [ ] Use shared helper on raw projection body to derive guard/identity/path; put `assetId + sourceGuard` in Agent input and the same guard in `InvokeAgentOptions.generatedMediaSourceGuard` for every attempt.
- [ ] Treat Agent result `assetId/sourceGuard/path` as correlation only: mismatch fails the current card, while successful reload uses pending helper-derived path and durable authority remains host option closure + source registration.
- [ ] Implement whole-card pointer/Enter/Space paid consent with `aria-label="生成插图：<title>"`, no modal or persistent fee/action copy, and per-card in-flight dedupe.
- [ ] Load/revoke Blob Object URLs, implement fullscreen viewing and regeneration.
- [ ] Handle streaming markers, invalid blocks, history/reload/restore and natural parallelism.
- [ ] Synchronize only task-owned development/card source files; preserve setup and intentional differences.
- [ ] Before using exported inventory, fix platform `exportGameCardPackage` text workspace size from UTF-16 `content.length` to UTF-8 ZIP entry byte length (`strToU8(...).byteLength` or equivalent), and add ASCII/Chinese/emoji text plus binary size regressions that lock import/export inventory to actual entry bytes.
- [ ] Implement root `npm run repack:immersive-reader` in UI tooling scope and rebuild checked-in card through isolated real browser builder/write-back/corrected-exporter, deterministic unpack, atomic dist replacement and full disk inventory regeneration; compare exported/checked-in/disk inventories bidirectionally and validate the packaged iframe. Do not treat dev dist or `npm run package:frontend` as authority; run `npm run build:web` for the platform exporter change.

Static UI can start after shared protocol freeze; real integration depends on 2.1–2.3.

## Phase 3: Cross-Child Integration Scenarios

- [ ] Provider configured → test generation succeeds without workspace/checkpoint writes.
- [ ] Provider missing/invalid → one inline card fails softly;正文 and other cards remain usable.
- [ ] Turn 0 includes inline cards and loads correctly on first entry.
- [ ] Formal turn includes 1, 2 and 3 blocks at distinct paragraph positions.
- [ ] Three cards are clicked quickly: invocations truly overlap, asset paths/traces remain distinct, Composer stays enabled.
- [ ] While image generation runs, complete another formal turn; late image is not erased by formal turn commit.
- [ ] Restore to before source turn while generation runs; late result is discarded.
- [ ] Generate image, advance turns, restore to source/later checkpoints; expected image is restored.
- [ ] Regenerate succeeds: current and applicable checkpoint manifests point to new hash, old unreferenced blob is collected.
- [ ] Regenerate fails: old image remains in workspace, checkpoints and UI.
- [ ] Reload/restore repeatedly and verify Object URLs are revoked/rebuilt without stale images.
- [ ] Malformed JSON, closed-schema/type/length/ref/extra-field violations, non-coercing fallback, entityRefs dedupe/bounds, missing refs and incomplete streaming marker never expose raw UI markers or block正文.
- [ ] Capability exact-v1/missing/malformed/wrong/unknown protocol is decided at ready/init; only the exact-v1 object allows any call and Agent id is never hardcoded.
- [ ] Every interactive attempt carries the same helper guard in Agent input and `invokeAgent.generatedMediaSourceGuard`; remove/alter the host option or Tool guard/assetId in fixtures and assert only that card fails with `IMAGE_INVALID_ARGUMENTS`, zero Provider calls and zero writes.
- [ ] Host matrix proves exact required match succeeds; no invoke option + no Tool guard remains ordinary write; no option + valid Tool guard remains guarded; formal-turn direct Tool may omit guard; no behavior branches on agentId/purpose.
- [ ] Agent final result guard/path mismatch is rejected by UI correlation and never changes the helper-derived reread target or durable commit authority.
- [ ] Repack evidence first shows exporter ASCII/Chinese/emoji text and binary inventory sizes equal actual ZIP entry payload bytes, then follows card `frontend/src/**` → `buildFrontend` → `writeBackDist` → corrected `exportGameCardPackage` → exported/checked-in/disk bidirectional inventory compare → packaged iframe; stale dist and inventory mismatches are rejected.

## Phase 4: Validation

At minimum:

```bash
npm run build:contracts
npm run build --workspace @tsian/play-bridge
npm run build:web
npm run build --workspace play-frontend-dev
npm run repack:immersive-reader

git diff --check
```

`play-frontend-dev` build is only the TypeScript/Vite development check. Before repack, UI child must fix `exportGameCardPackage` text workspace inventory from UTF-16 `content.length` to actual UTF-8 ZIP entry byte length and pass ASCII/Chinese/emoji text plus binary size regressions; `npm run build:web` is mandatory for that `apps/platform-web` change. The repack command must then exercise the isolated real browser chain `frontend/src/**` → `buildFrontend` (`engine.ts:272`) → `writeBackDist` (`write-back.ts:55`) → corrected `exportGameCardPackage` (`game-card-packages.ts:660`), deterministically unpack and atomically replace checked-in dist, regenerate all three disk inventories, compare exported/checked-in/disk inventories bidirectionally, and validate the packaged iframe. `npm run package:frontend` may be run only as an auxiliary standalone source-package check and is not card repack/builder evidence.

Also run every child-specific behavior test/check documented in its `implement.md`, then inspect:

```bash
python ./.trellis/scripts/task.py list-context 07-21-inline-story-image-generation
python ./.trellis/scripts/task.py list-context 07-21-platform-image-generation
python ./.trellis/scripts/task.py list-context 07-21-image-save-consistency
python ./.trellis/scripts/task.py list-context 07-21-card-illustration-agent-protocol
python ./.trellis/scripts/task.py list-context 07-21-card-inline-illustration-ui

python ./.trellis/scripts/task.py validate 07-21-inline-story-image-generation
python ./.trellis/scripts/task.py validate 07-21-platform-image-generation
python ./.trellis/scripts/task.py validate 07-21-image-save-consistency
python ./.trellis/scripts/task.py validate 07-21-card-illustration-agent-protocol
python ./.trellis/scripts/task.py validate 07-21-card-inline-illustration-ui
```

## Phase 5: Parent Completion Gate

- [ ] All four children are completed, checked and archived.
- [ ] Parent acceptance criteria AC1–AC10 are mapped to passing child/integration evidence.
- [ ] No product code was implemented directly under the parent task scope outside integration-only fixes.
- [ ] No API key outside the explicit `.tsian/local/platform-config.json` platform-meta configuration entry, no prompt content, and no base64 image leaked into trace/turn/save-runtime text.
- [ ] No unfinished queue, task persistence, image version gallery or role portrait UI entered scope.
- [ ] `trellis-check` passes and results are recorded before parent archival.

## Rollback Points

- Child 1: remove host image adapter/config/Tool while leaving card protocol unavailable but harmless.
- Child 3: remove card entrypoint/Agent/projection/Prompt; old stories remain plain text.
- Child 4: restore NarrativeMessage-only renderer; persisted media remains inert.
- Child 2: roll back by tested commits/seams only. Do not restore the known unsafe full-workspace overwrite behavior without explicitly reopening the consistency requirement.

No commit, push, destructive reset, or task start is implied by this planning document.
