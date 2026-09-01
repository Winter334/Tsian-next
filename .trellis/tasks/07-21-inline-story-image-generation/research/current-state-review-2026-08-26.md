# Current-State Review — Inline Story Image Generation

Date: 2026-08-26

## Review Scope

This review compares the July 21 parent/child plans with the current platform, card, frontend, persistence, and packaging code. It does not authorize implementation. The goal is to identify preserved product intent, stale assumptions, and the smallest design refresh needed before any child task starts.

## Original Product Goal

The product goal is still coherent: the storyteller declares inline illustration opportunities, the player explicitly starts generation from the narrative, image work does not block story progression, and successful media remains consistent across reload and checkpoint restore.

The four-child ownership split is also still useful:

1. platform image capability;
2. generated-media persistence consistency;
3. card illustration protocol and Agent;
4. inline illustration UI.

The split should be retained, but every child plan needs a convergence pass against current code.

## Confirmed Current State

### Platform image capability is still absent

- `AgentPlatformToolName` has no `generate_image`: `packages/contracts/src/runtime.ts:432-440`.
- `PlatformConfig` has no image-generation section: `apps/platform-web/src/config/platform-config.ts:78-97`.
- The current provider model is a multi-kind, multi-preset chat configuration rather than the simpler July configuration model: `apps/platform-web/src/config/ai/types.ts:1-176`.
- No source implementation currently defines `generate_image`, `imageGeneration`, generated-media guards, or illustration briefs outside the dormant task documents.

Conclusion: the platform child is still required, but its configuration design must be reconsidered instead of copying the old `{baseUrl, apiKey, model}` section blindly.

### Generic workspace/media foundations are stronger

- `WorkspaceFile` already supports binary `Blob` data and image media metadata: `packages/contracts/src/runtime.ts:239-252`.
- Agent-facing image reads already expose an independent image content channel: `packages/contracts/src/runtime.ts:262-286`.
- The card frontend already has a proven Object URL load/revoke pattern in `CharacterPortrait.vue`.
- Same-turn staged workspace coherence and strict Tool observation delivery were completed in the August Agent Tool Observation task.

Conclusion: image output should reuse the current workspace Blob path and Tool delivery contracts. The July plans must not recreate media transport or generic observation machinery.

### Reply Projection still fits, but the frontend drops needed metadata

- Formal turn persistence already stores `content`, `displayContent`, and generic `projections`: `apps/platform-web/src/platform-host/runtime-turn.ts:333-361`.
- Projection append semantics remain available: `apps/platform-web/src/platform-host/reply-projection.ts:375-445`.
- The current card projection config has choices/opening rules but no illustration rule: `cards/沉浸阅读器.tsian-card/workspace/config/reply-projection.json:1-29`.
- The card frontend converts persisted/live assistant items into a `StreamItem` containing only display text and tokens; it drops `projections` and the authoritative turn number: `cards/沉浸阅读器.tsian-card/frontend/src/composables/useTsian.ts:43-48`, `:86-106`, `:191-205`, `:392-420`.

Conclusion: the old UI plan assumed source identity was already available at the rendering boundary. The refreshed design must first preserve `{turn, content, displayContent, projections}` or an equivalent closed view model from both live completion and history reload.

### Opening publication changed materially

- Opening setup is now a staged, resumable workflow with separate entity, graph, state, and publish phases: `cards/沉浸阅读器.tsian-card/workspace/agents/world-architect/skills/开局建模/SKILL.md:116-171`.
- The final delegation currently asks storyteller for prose plus choices, then `publish_opening` projects and writes turn 0.
- The July plan refers to older `commit_play_setup` / `expectedOutput` assumptions and different opening files.

Conclusion: opening and formal turns may still share one illustration marker schema, but the integration point must be the current storyteller delegation plus `publish_opening`; old file references and test fixtures must be replaced.

### Persistence foundations are partial, not complete

- `RuntimeWorkspaceTransaction` already exports explicit written/deleted changes: `apps/platform-web/src/storage/workspace.ts:620-695`.
- Side-channel `invokeAgent` commits already use explicit changes, and checkpoint-producing side-channel commits reprepare/retry on concurrent workspace changes: `apps/platform-web/src/storage/saves.ts:323-348`, `:431-572`.
- Formal successful turns still build a full workspace snapshot and delete/rewrite every save workspace row: `apps/platform-web/src/storage/saves.ts:130-193`.
- No generated-media source validation or path-level checkpoint patch exists.

Conclusion: the consistency child remains necessary, but much of its July scope is stale. It should focus on formal-turn merge safety, source-bound generated-media commit, checkpoint patching, restore serialization, and Blob liveness. It should remove already-delivered generic side-channel/checkpoint work.

### Packaging work is already complete

- The exporter now uses UTF-8 bytes rather than JavaScript string length: `apps/platform-web/src/storage/game-card-packages.ts:691-725`.
- The repository now has the deterministic card packaging command and browser harness: `package.json:31-33`, `scripts/package-immersive-reader-card.mjs`, and `apps/platform-web/card-package-harness/main.ts`.
- The packager validates ASCII/Chinese/emoji/binary byte sizes and import round trip.

Conclusion: remove exporter repair and packager construction from the image task tree. The UI child should only consume the existing `npm run package:card` / `npm run repack:immersive-reader` workflow and update task-owned card files.

### Several July verification assumptions are obsolete

- The repository test surface was consolidated into smoke/integration commands in `package.json`.
- Many file-specific test commands listed in the July plans refer to files removed by the smoke-suite consolidation.
- The old consistency plan's trace filename work is obsolete because Runtime Trace files were retired in favor of unified diagnostics.
- The old consistency plan's context-slot canonicalization and test harness setup have already been delivered elsewhere.

Conclusion: every `implement.md`, `implement.jsonl`, and `check.jsonl` needs to be regenerated from current specs/tests before task activation.

## Design Classification

### Keep

- Inline, click-to-generate, non-blocking experience.
- Card-owned illustration semantics and art direction.
- Host-owned image Provider secret and `generate_image` capability.
- Explicit Tool enablement; no default access for storyteller or unrelated Agents.
- Reply Projection as the generic persistence lane.
- Fail-soft invalid illustration blocks.
- Stable save-runtime media paths, reload recovery, regeneration replacement, and checkpoint correctness.
- Four independently verifiable child deliverables.

### Rewrite

- Image Provider configuration and Settings UX.
- Generated-media authority/identity contract.
- Opening integration references and tests.
- Frontend assistant view model so turn/projection metadata survives.
- Persistence child scope and transaction design.
- Validation commands and context manifests.

### Remove From Scope

- UTF-8 package inventory bug fix.
- Building the card packager/repack harness.
- New Vitest/fake-indexeddb test harness setup.
- Runtime Trace filename uniqueness work.
- Generic invokeAgent context-slot canonicalization.
- Reimplementation of Agent Tool observation sizing or same-turn workspace coherence.

## Recommended Simplification

The July double-channel `assetId + sourceGuard` design is too elaborate for the current runtime. It makes the frontend compute a hash, sends the same guard through Agent input and invoke options, requires the Agent to echo it into Tool arguments and final output, and then validates all copies before commit.

Prefer one host-authoritative invocation target:

1. The frontend retains the authoritative source turn and illustration projection index.
2. The frontend calls `invokeAgent` with a closed optional generated-media target such as `{ kind: "turn-projection", turn, projectionKey, index }`.
3. At invocation start, the host reads the exact persisted projection and captures its source revision. The host derives the stable asset path; the frontend and Agent do not hash raw JSON.
4. `image-director` receives only the brief/prose needed to compose the prompt. It calls `generate_image` with Provider-neutral image arguments; it does not control the durable target.
5. The host runner binds the generated Blob to the captured target and, at commit, revalidates the source revision. A restore/prune/rewrite makes a late result stale.
6. The durable commit writes the asset and patches only eligible retained checkpoint manifests. The Tool result remains a short `{path, mediaType}` reference.

This preserves the old security and race guarantees while removing duplicated identity algorithms and Agent/UI correlation fields. The final design still needs compatibility tests for an unbound generic `generate_image` invocation if generic non-inline generation remains in MVP.

## Recommended Task Refresh

### Parent

Retain the parent as the cross-child contract and integration owner. Replace its Phase 0 with the simplified target, current timeline metadata contract, current opening flow, and current packaging command.

### Platform image generation

Keep as child 1. Re-plan Provider configuration, adapter, Tool visibility, host binding, safe errors, and Settings test generation. Decide whether reference-image editing belongs in MVP before freezing the adapter.

### Generated-media consistency

Keep child 2 but narrow it. Remove delivered/retired generic work; own only formal-turn merge safety plus source-bound media/checkpoint/restore/GC behavior.

### Card protocol and Agent

Keep child 3. Update current storyteller/opening files, define the illustration brief and projection, add the discoverable image-director capability, and make the Agent consume host-authoritative invocation context instead of forwarding identity data.

### Inline UI

Keep child 4. Start with the assistant view-model correction, then ordered segmentation, states, invocation, Blob/Object URL handling, restore/reload, accessibility, and existing card packaging workflow.

## Open Product Decisions

1. Whether MVP must include reference-image image-to-image generation for visual consistency, or ship text-to-image first.
2. Whether image Provider credentials should be an independent configuration or reference an existing Provider preset.
3. Whether every formal turn must contain 1-3 illustration briefs, or briefs are optional with a recommended maximum.

Resolve these one at a time before rewriting the final PRD/design/implementation plans.

## Decision Resolution

The planning discussion resolved all three questions before the task tree was rewritten:

1. MVP includes both text-to-image and reference-image image-to-image for visual continuity.
2. Image and embedding service variables use one `.tsian/local/desktop.env`; no new Provider type or Tool Settings UI is added.
3. Opening turn 0 and every formal turn require 1–3 briefs, normally one; projection and commit remain fail-soft when output is missing or malformed.
