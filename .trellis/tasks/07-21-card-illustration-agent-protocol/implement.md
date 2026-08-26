# Implement — 卡内插图 Agent 与输出协议

## Phase 0: Gate

- [ ] Re-read parent and sibling contracts; use `generatedMediaTarget` without duplicating durable identity through Agent or Tool messages.
- [ ] Confirm current opening integration is `开局建模` + `publish_opening`.
- [ ] Confirm package infrastructure already exists and is not modified here.
- [ ] Do not start until the parent planning review is approved.

## Phase 1: Brief Contract

- [ ] Add the single runtime `IllustrationBriefV1` validator in the agreed card-consumable shared module.
- [ ] Cover closed keys, non-coercing strings, length limits, ref grammar, entity count and stable dedupe.
- [ ] Export normalized/invalid results needed by UI without adding card semantics to storage.
- [ ] Add focused validator tests for boundary and malformed cases.

## Phase 2: Reply Projection

- [ ] Add the illustration marker rule to the actual card projection config.
- [ ] Verify content removal, display preservation and ordered raw append for 1/2/3 blocks.
- [ ] Verify invalid complete bodies still retain deterministic projection indexes.
- [ ] Verify illustration failures never reject opening or formal turn commit.

## Phase 3: Storyteller and Opening

- [ ] Update storyteller output instructions with the self-contained closed schema.
- [ ] Require 1–3 briefs for every opening/formal response and state that one is normal.
- [ ] Update the current `开局建模` storyteller delegation.
- [ ] Verify `publish_opening` projects and persists turn 0 with the same rule.

## Phase 4: Entrypoint

- [ ] Add optional `imageGeneration` v1 shape to shared Game Card contracts.
- [ ] Propagate the closed object through local/package normalization, Host bridge and play-bridge entrypoint reads.
- [ ] Declare the actual card entrypoint.
- [ ] Test missing, exact v1, malformed, extra-field and unknown-protocol behavior.

## Phase 5: Image Director

- [ ] Add `agent.json`, `AGENT.md` and fixed style context.
- [ ] Enable only `workspace_read` and `generate_image`; keep storyteller and other Agents unprivileged.
- [ ] Implement the request/result Prompt contract with no target/path/guard fields.
- [ ] Read latest scene/entity files, collect at most four trusted raster reference paths and compose a Provider-neutral prompt.
- [ ] Enforce exactly zero or one Tool call per invocation and return the closed asset result.
- [ ] Test text-only, reference-image, partial-ref and insufficient-context paths.

## Phase 6: Card Inventory and Verification

- [ ] Update actual card workspace inventory for all added/changed files.
- [ ] Coordinate the single final card version bump with the UI child.
- [ ] Run current focused tests plus:

  ```powershell
  npm run build:contracts
  npm run build --workspace @tsian/play-bridge
  npm run build:web
  npm run test:smoke
  npm run package:card
  git diff --check
  ```

- [ ] Validate actual package inventory and packaged entrypoint behavior.
- [ ] Run Trellis check before completion.

## Rollback

- Removing `imageGeneration` disables interactive generation while leaving prose playable.
- Removing `generate_image` from the director's explicit Tool list prevents paid calls.
- Projection and Prompt changes can be reverted with the added Agent workspace files as one card-protocol unit.
