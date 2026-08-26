# Implement — 平台图像生成与桌面环境变量

## Phase 0: Gate

- [ ] Load Trellis specs before code.
- [ ] Confirm parent contracts: target-only invoke metadata, no Tool target/guard, no Settings UI.
- [ ] Coordinate the binding callback signature with `07-21-image-save-consistency`.
- [ ] Record baseline git status/build failures.

## Phase 1: Desktop environment

- [ ] Add `.tsian/local/desktop.env` storage helpers and volume routing using the existing `meta` table.
- [ ] Implement strict dotenv-subset parser and safe diagnostics.
- [ ] Add image and embedding typed resolvers.
- [ ] Document canonical keys in desktop-assistant knowledge or the discoverable local file template.
- [ ] Cover persistence across saves and exclusion from checkpoint/package paths.

## Phase 2: RAG destructive switch

- [ ] Remove `BrowserEmbeddingConfig` from config types/defaults/clone/normalize.
- [ ] Remove old get/save/resolve functions and all imports.
- [ ] Remove `SemanticSearchScreen`, Settings hub route and spatial equivalent controls.
- [ ] Switch embedding client/index enqueue/search readiness to the env resolver.
- [ ] Keep structured recall tunables in platform config.
- [ ] Update smoke fixtures with no compatibility branch.

## Phase 3: Shared target contract

- [ ] Add target type to contracts and optional request field.
- [ ] Add play-bridge option forwarding and stable target path helper.
- [ ] Strict-normalize remote iframe requests; reject extra/malformed shapes.
- [ ] Verify ordinary `invokeAgent` callers are unchanged when omitted.

## Phase 4: Image adapter

- [ ] Implement URL normalization, aspect mapping and request builders.
- [ ] Implement generations JSON and edits multipart without mask.
- [ ] Resolve/validate 1..4 reference images before Provider fetch.
- [ ] Normalize base64/URL responses into one Blob verifier.
- [ ] Add sanitized errors and Abort behavior.
- [ ] Use mocked fetch and raster fixtures; do not add an interactive configuration test call.

## Phase 5: Platform Tool

- [ ] Register `generate_image` in contracts/registry/permissions/controls/schemas/executor.
- [ ] Keep it out of defaults and independent of `workspace_write`.
- [ ] Bind the common runner in formal turn, invokeAgent and assistant paths.
- [ ] Enforce one paid call for bound invocation.
- [ ] Stage Host-generated unique path for unbound invocation.
- [ ] Return only `{path,mediaType}`; add metadata-only diagnostics.

## Phase 6: Verification

```powershell
npm run build:contracts
npm run build --workspace @tsian/play-bridge
npm run build:web
npm run test:smoke
npm run test:integration
git diff --check
```

- [ ] Prove old `embeddingConfig` and `SemanticSearchScreen` references are zero.
- [ ] Prove `generate_image` schema contains no target/path/secret/mask fields.
- [ ] Prove bound second call causes zero additional fetches/writes.
- [ ] Prove diagnostics contain no sensitive values.

## Rollback

Tool registration and env/RAG switch are separate commits where practical. Rolling back the Tool must not restore old embedding configuration implicitly.
