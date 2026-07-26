# Implement — 平台图像生成能力

## Phase 0: Contract and Boundary Gate

- [ ] Re-read this task's converged `prd.md` and `design.md`; confirm no unresolved product choice remains.
- [ ] Freeze the shared names and shapes before product edits:
  - Tool name: `generate_image`;
  - input: `{ prompt, aspect, assetId, sourceImagePaths?, sourceGuard? }`;
  - optional source guard: `{ kind: "turn-projection", turn, projectionKey: "illustrations", index, fingerprint }`;
  - aspect: `landscape | portrait | square`;
  - image endpoints: no `sourceImagePaths` uses `/images/generations`; `1..4` verified workspace image reference paths use `/images/edits` without mask; mask/local repaint is out of MVP;
  - size map: `1536x1024 | 1024x1536 | 1024x1024`;
  - sole runtime helper: `packages/play-bridge/src/generated-media-identity.ts`, exported from `@tsian/play-bridge`, owning strict guard normalization, exact raw-string UTF-8 fingerprinting, NUL identity, path, and golden vector;
  - invoke contract: optional same-name `generatedMediaSourceGuard` on contracts `InvokeAgentRequest` and play-bridge `InvokeAgentOptions`; SDK forwards it and remote bridge strict-normalizes the closed V1 object;
  - authority: invokeAgent host captures normalized option as `requiredSourceGuard`; Agent input/result echo is correlation only;
  - identity/path modes: no option+no Tool guard uses `identityKey = assetId` ordinary write; no option+valid Tool guard uses self-guarded handoff; required option demands exact Tool guard + derived assetId before Provider and uses closure guard for handoff;
  - fail-closed: required Tool omission/field mismatch/wrong assetId → `IMAGE_INVALID_ARGUMENTS`, zero Provider/zero write, no ordinary downgrade; no agentId/purpose routing;
  - Tool result: exactly `{ path, mediaType }`, with no guard echo;
  - persistence handoff: unguarded write uses ordinary transaction `write`; guarded success passes `{ identityKey, assetPath, blob, sourceGuard }` to the consistency-owned source-registration seam, which alone converts it to `{ identityKey, assetPath, source:{path,expectedRevision} }` storage metadata;
  - image config: MVP root `PlatformConfig.imageGeneration = { baseUrl, apiKey, model }` for the single OpenAI-compatible mode; future Provider modes are Settings/internal-adapter choices, not Provider-specific Tool names;
  - independent card capability: `GameCardRuntimeEntrypoints.imageGeneration?: { agentId:string, protocol:"tsian.image-director.v1" }` belongs to protocol/UI manifest discovery and does not alter this task's config, Tool, adapter, request, or result.
- [ ] Confirm this child does not validate the closed `IllustrationBriefV1`; UI/Agent Prompt own that schema, while host/source-registration/storage continue to treat projections as generic raw strings.
- [ ] Record sibling delivery boundary: `07-21-card-inline-illustration-ui` owns the `exportGameCardPackage` UTF-8 ZIP-entry size fix, ASCII/Chinese/emoji text and binary regressions, repack dependency, and resulting `npm run build:web`; this Provider/Tool task must not duplicate that exporter work.
- [ ] Coordinate the exact guarded handoff/source-registration/storage contract with sibling `07-21-image-save-consistency`; do not add sourceGuard metadata to `RuntimeWorkspaceTransaction`, parse authoritative turn projections here, or absorb sibling CAS/checkpoint algorithms.
- [ ] Load the curated Trellis contexts with `trellis-before-dev` before implementation.
- [ ] Record baseline `git status`; preserve unrelated worktree changes and do not edit parent/sibling task artifacts as part of this child.

## Phase 1: Shared Platform Tool Contract

Expected files:

- `packages/contracts/src/runtime.ts` (`AgentPlatformToolName`, serializable guard shape, `InvokeAgentRequest.generatedMediaSourceGuard?`)
- `packages/play-bridge/src/generated-media-identity.ts`
- `packages/play-bridge/src/tsian-api.ts` (`InvokeAgentOptions` + RPC forwarding)
- `packages/play-bridge/src/index.ts` or current package-root export
- `packages/play-bridge/package.json` / package TS config as required
- `apps/platform-web/package.json` and its TypeScript path configuration
- `apps/platform-web/src/bridge/remote-iframe-bridge.ts` (strict invoke guard normalizer)
- `apps/platform-web/src/agent-runtime/permissions.ts`
- `apps/platform-web/src/agent-runtime/registry.ts`
- `apps/platform-web/src/agent-runtime/tool-controls.ts`
- `apps/platform-web/src/agent-runtime/tool-schemas.ts`
- `apps/platform-web/src/agent-runtime/workspace-tools-types.ts`

Steps:

1. Add `generate_image` to `AgentPlatformToolName` and every runtime accepted-name map/set.
2. Deliberately leave it out of `DEFAULT_AGENT_PLATFORM_TOOLS`.
3. Add the serializable optional guard shape and `InvokeAgentRequest.generatedMediaSourceGuard?` in contracts. Keep contracts algorithm-free.
4. Implement the sole identity runtime module under play-bridge and export it at package root. It owns the strict guard type/normalizer, `fingerprintProjectionRaw(raw)`, NUL-delimited identity derivation, generated asset path, and the design golden vector. Raw fingerprint input is the exact persisted `$1|trim` string encoded as UTF-8; never parse, field-sort, normalize Unicode/whitespace, or re-serialize it.
5. Add `InvokeAgentOptions.generatedMediaSourceGuard?` and explicitly forward it to RPC params; add remote iframe strict normalization that rejects malformed/extra/noncanonical guards rather than dropping the field.
6. Add a real `@tsian/play-bridge` dependency and TypeScript path to platform-web. Keep `@tsian/contracts` limited to required shared data shapes and do not place runtime algorithms there.
7. Add one common Studio/Assistant “costly media” capability control with provider-cost wording.
8. Add one Tool schema with required `prompt`, enum `aspect`, canonical `assetId`, optional `sourceImagePaths` (`1..4` bounded workspace image paths) and optional closed `sourceGuard`; set `additionalProperties: false` at both levels and do not include mask/local repaint fields.
9. Gate schema insertion exclusively on `enabledPlatformTools` containing `generate_image`.
10. Add typed runner input/result declarations and the execution-context callback seam with optional host-only `requiredSourceGuard`; do not add a new RPC method.

Checks before continuing:

- [ ] Empty `platformTools.enabled` does not expose `generate_image`.
- [ ] Explicit enabled exposes it in native and Text Tool Protocol schema rendering.
- [ ] `disabled` wins over `enabled`.
- [ ] Tool authorization does not depend on `workspace_write`.
- [ ] API key/base URL/model/size/output path are absent from model-callable arguments; optional `sourceImagePaths` contains only bounded workspace paths, optional sourceGuard contains only bounded source coordinates and a SHA-256 fingerprint, and no mask/url/data/base64 field exists.
- [ ] Shared-helper golden vector hashes exact raw projection `{"title":"雨夜","description":"重逢","sceneRef":"scene:station","entityRefs":[]}` to `sha256:d5d01760ea67ebb81076c3d7e7a34d966e3766d4f3b51f5927441292c3ea54a4`, then derives exactly `tp-v1-9ddcb65606a53538f1eb2cba492e8874519a29d0f3065f378ccafe4b5318f2b3` for turn 12 / `illustrations` / index 0.
- [ ] Unguarded generic callers may use any pattern-valid `assetId`; no option + valid Tool guard must use canonical identity; required option callers must supply an exact matching Tool guard and canonical assetId.
- [ ] SDK forwarding preserves every guard field, remote normalizer rejects malformed/extra values, and omission remains backward-compatible.

## Phase 2: Image Configuration Module

Expected files:

- `apps/platform-web/src/config/platform-config.ts`
- `apps/platform-web/src/storage/local-platform-config.ts`
- `apps/platform-web/src/platform-host/workspace-volumes.ts`
- new or existing narrow files under `apps/platform-web/src/config/image-generation/` (prefer a small module; do not enlarge chat Provider types)

Steps:

1. Add `PlatformImageGenerationConfig` and root `imageGeneration` section.
2. Update `PlatformConfigSectionKey`, defaults, defensive merge, and deep clone in the same change.
3. Keep `imageGeneration.apiKey` in platform-local config and the explicit `.tsian/local/platform-config.json` platform-meta management entry. Do not redact that entry: advanced Agent/tools with platform-meta permission may read, set, clear or rotate the key through it.
4. Harden generic platform-meta write/delete of `.tsian/local/platform-config.json`: parse/normalize the full config, including `imageGeneration.apiKey`; writes may set/clear/rotate the key and delete resets it to the empty default as an explicit privileged configuration operation.
5. Add strict image base URL normalization for fixed `{baseUrl}/images/generations` and `{baseUrl}/images/edits` composition.
6. Add normalized get/resolve/save helpers backed by existing `getPlatformConfig()` / `savePlatformConfig()` cache flow.
7. Make resolve return `null` unless all three fields are complete and the URL is valid.
8. Keep the secret in raw platform-local config / `.tsian/local/platform-config.json` platform-meta only; do not add a Dexie table, environment fallback, chat-preset reference, bridge query, save-runtime/card mirror, Tool payload, trace field or alternate Agent-visible projection.

Behavior probes:

- [ ] Old file missing `imageGeneration` loads empty defaults.
- [ ] Saving image config preserves provider/checkpoint/rag/ai/assistant/cloud sections.
- [ ] Saving another section preserves image config.
- [ ] Bare host, trailing slash and pasted `/images/generations` or `/images/edits` normalize once.
- [ ] non-HTTP(S), credential-bearing, query/hash and empty URLs fail clearly.

## Phase 3: Shared OpenAI-Compatible Adapter

Expected files:

- new or existing narrow files under `apps/platform-web/src/runtime-host/image-generation/` or equivalent host-owned runtime directory

Steps:

1. Define `ImageAspect`, the total aspect-size map, generated Blob metadata and sanitized error code/class.
2. Validate config, prompt and aspect before fetch.
3. Implement exact requests:
   - no verified source images: `POST {baseUrl}/images/generations` with Bearer authorization and JSON body only `model`, `prompt`, `size`;
   - `1..4` verified source images: `POST {baseUrl}/images/edits` with Bearer authorization and multipart form fields only `model`, `prompt`, `size`, and `image[]` blobs;
   - never send `mask`, local repaint controls, URLs, base64, source paths or guard data to the Provider.
4. Parse unknown JSON and accept `data[0].b64_json` first or `data[0].url` second.
5. Strictly decode base64; for URL, allow only HTTP(S), download immediately and never forward Authorization to the returned host.
6. Route both branches through one bounded raster Blob verifier:
   - non-empty / maximum bytes;
   - byte-signature MIME detection;
   - supported raster allowlist;
   - MIME/signature consistency;
   - `createImageBitmap` decode and positive dimensions;
   - bitmap cleanup.
7. Map provider policy/auth/status/network/response/content failures to stable sanitized errors.
8. Preserve external abort semantics.
9. Ensure no raw Provider body/message, key, prompt, response URL or binary payload is attached to thrown errors/logs.

Required behavior matrix:

- [ ] Generations sends JSON `model/prompt/size` to `/images/generations`; edits sends multipart `model/prompt/size/image[]` to `/images/edits`; no mask field is sent.
- [ ] Three aspects produce exact modern GPT Image request sizes for both generations and edits; no `1792x1024` / `1024x1792` DALL-E 3 dimensions are sent.
- [ ] Invalid aspect makes zero fetch calls.
- [ ] Valid PNG/JPEG/WebP/GIF/AVIF base64 succeeds with canonical MIME; valid workspace reference images for edits must pass the same verifier before Provider fetch.
- [ ] Valid URL response is downloaded and succeeds.
- [ ] Both fields present uses base64.
- [ ] Missing `data[0]`, bad base64, non-HTTP URL, URL download error, empty body, HTML/JSON masquerade, signature mismatch and decode failure return the correct safe code.
- [ ] 401/403 auth and allowlisted policy rejection remain distinguishable without exposing Provider text.
- [ ] Abort remains abort.

If the repository still has no unit-test runner, keep adapter seams pure/injectable enough for deterministic manual harness probes and record the behavior results during check; do not introduce a test framework only for this task.

## Phase 4: Tool Normalization, Dispatch and Trace

Expected files:

- `apps/platform-web/src/agent-runtime/turn-types.ts`
- `apps/platform-web/src/agent-runtime/index.ts`
- `apps/platform-web/src/agent-runtime/workspace-tools-types.ts`
- `apps/platform-web/src/agent-runtime/workspace-tools/tool-execution.ts`
- `apps/platform-web/src/agent-runtime/workspace-tools/tracing.ts`
- `apps/platform-web/src/agent-runtime/workspace-tools/observations.ts`
- `apps/platform-web/src/agent-runtime/tool-memory.ts`

Steps:

1. Thread `runGenerateImage` from capabilities into both native and text Tool execution contexts, with host-only optional `requiredSourceGuard` supplied by runner binding rather than model args.
2. Add boundary normalization for non-empty prompt, exact aspect enum, `assetId` regex/length, optional `sourceImagePaths` (`1..4` bounded ordinary workspace image paths, no `.tsian/local/**`, URL, data URL, base64 or inline bytes), and optional closed turn-projection Tool source guard (non-negative integer coordinates, exact `projectionKey: "illustrations"`, `sha256:<64-lowercase-hex>` fingerprint).
3. Resolve authority before Provider: no required option + no Tool guard retains normalized `assetId` ordinary mode; no required option + Tool guard derives canonical identity and guarded mode; required option demands Tool guard present/field-equal and `assetId === deriveTurnProjectionIdentityKey(requiredSourceGuard)`. Tool omission/mismatch/wrong assetId returns `IMAGE_INVALID_ARGUMENTS`; do not include guard values, source image paths or prompt in trace or Tool result.
4. Dispatch as a platform built-in before user Tool fallback; if no runner, return `IMAGE_RUNTIME_UNAVAILABLE`.
5. Keep `generate_image` out of the read-only parallel set so same-round stateful calls stay serial.
6. Return only the host result `{ path, mediaType }` in observation/Tool events/memory. A valid guard remains only in the guarded handoff and is never Tool output or storage metadata.
7. Add a dedicated image trace branch that constructs an allowlisted metadata object. Do not call `summarizeTraceValue(call.arguments)` or generic raw-error serializers for this Tool.
8. Verify existing model-call completion trace remains name + argument keys only.
10. Add deterministic spies/counters proving required option + missing Tool guard / each field mismatch / wrong assetId make zero adapter/Provider calls and zero ordinary/guarded writes; exact match continues to adapter. Add source-image probes proving invalid path / missing file / non-image / decode failure / `.tsian/local` path fail before Provider and exact valid references route to edits.

Security probes:

- [ ] Search runtime trace files/debug output for a distinctive test prompt, source image path and key; all have zero matches outside the explicit platform-config file for the key.
- [ ] Tool event/memory contains path/MIME or concise code/message only.
- [ ] Provider body, returned URL, base64 and Blob do not enter observation or trace.

## Phase 5: Host Runner and Guarded Source-registration Handoff

Expected files:

- `packages/contracts/src/runtime.ts`
- `packages/play-bridge/src/tsian-api.ts`
- `apps/platform-web/src/bridge/remote-iframe-bridge.ts`
- new shared runner/factory under `apps/platform-web/src/platform-host/`
- the consistency-owned platform-host source-registration seam consumed by the runner
- `apps/platform-web/src/platform-host/runtime-turn.ts`
- `apps/platform-web/src/platform-host/ai-invocation.ts`
- `apps/platform-web/src/platform-host/assistant-chat.ts`

Steps:

1. Import strict guard normalization, raw fingerprint/identity, and path helpers from `@tsian/play-bridge`; do not duplicate their encoding or place algorithms in contracts/storage.
2. Extend contracts `InvokeAgentRequest` and play-bridge `InvokeAgentOptions` with optional `generatedMediaSourceGuard`; forward it in `createTsian`, strict-normalize it in remote iframe bridge, and reject malformed/extra values rather than omitting them.
3. Implement a single host runner factory closed over current transaction, consistency-owned guarded handoff callback, abort signal, and optional host-only `requiredSourceGuard`.
4. In `invokeAgent`, capture the already normalized `input.generatedMediaSourceGuard` and pass it to the runner factory. Formal turn/Desktop Assistant pass no required guard. Do not inspect agentId/purpose.
5. Resolve target before paid fetch using the three-mode matrix: ordinary no-option/no-Tool-guard; self-guarded no-option/legal-Tool-guard; required option demanding exact Tool guard and required-derived assetId. All required omissions/mismatches are `IMAGE_INVALID_ARGUMENTS`, zero adapter/write/handoff.
6. Resolve image config from the preheated module cache only after the pre-paid guard/asset checks.
7. Resolve optional `sourceImagePaths` against the current Runtime Workspace before Provider fetch: each reference must be a normal workspace image file with `binary`/`imageMimeType` and pass the shared raster verifier; reject `.tsian/local/**`, URL/data/base64/inline bytes, missing files, non-images and decode failures with zero Provider/write/handoff.
8. Call the shared adapter with config/prompt/aspect plus verified source images when present (edits), or without source images (generations).
9. After success, stage ordinary `transaction.write({ path: assetPath, data: blob })` only for no option/no Tool guard. Otherwise submit exactly `{ identityKey, assetPath, blob, sourceGuard }` to the consistency-owned source-registration seam, using required closure guard when present.
10. Return exactly `{ path: assetPath, mediaType }` and never echo guard, source image paths or assetId.
11. Bind the same generic runner semantics to formal turn, `invokeAgent`, and desktop Assistant capability objects; only invokeAgent can supply required option.
12. Confirm delegated `agent_call` inherits the capability rather than creating a parallel implementation.
13. Do not parse the authoritative turn projection, trust Agent input/result echo, define durable `GeneratedMediaCommitMetadata`, extend `RuntimeWorkspaceTransaction` with sourceGuard metadata, call checkpoint helpers, or edit commit/checkpoint algorithms here.

Handoff probes:

- [ ] No option + no Tool guard produces one ordinary `writtenFiles` Blob at `save/assets/generated/<assetId>` and no generated-media metadata; with valid source image paths it routes to edits before the same ordinary write.
- [ ] No option + legal Tool guard requires canonical `assetId` and sends one guarded handoff after complete Provider/Blob validation.
- [ ] Required option + exact Tool guard/derived assetId sends one handoff whose guard object/value comes from the invocation closure, not Tool authority.
- [ ] Required option + Tool missing guard, each guard-field mismatch, malformed guard, or wrong assetId returns `IMAGE_INVALID_ARGUMENTS` before config/fetch, with adapter/Provider call count 0, ordinary write count 0 and handoff count 0; existing asset remains.
- [ ] Any invalid `sourceImagePaths` entry (missing, non-image, undecodable, `.tsian/local/**`, URL/data/base64/inline form) fails before Provider with zero write/handoff; valid paths never appear in trace/tool memory/result.
- [ ] The consistency seam, not this runner, reads/validates the exact turn projection and stages final `{ identityKey, assetPath, source:{path,expectedRevision} }` metadata.
- [ ] Provider/validation/abort failure performs neither write nor handoff and preserves an existing asset.
- [ ] Direct formal-turn unguarded calls remain in the after-turn transaction; unguarded `invokeAgent` uses ordinary workspace commit only and does not patch old checkpoints.
- [ ] Agent input/result echoes cannot satisfy or overwrite a missing/mismatched host required guard.
- [ ] Missing active save/transaction/config returns a stable error.
- [ ] An Agent with only `generate_image` authorization can call it without `workspace_write`.

## Phase 6: Settings UI

Expected files:

- `apps/platform-web/src/components/settings/SettingsHub.vue`
- new `apps/platform-web/src/components/settings/ImageGenerationScreen.vue`
- `apps/platform-web/src/views/SettingsView.vue`

Steps:

1. Add the independent hub card, screen union, title, enter/back routing and screen rendering.
2. Implement the three-field draft with password API-key input and section-merge save.
3. Add a selectable copy-from-chat-preset action that copies only address/key and never creates a live reference.
4. Add paid-test warning, an action backed by exact constant `A red sailboat on a calm blue sea at sunrise, no text or watermark.` and fixed `square`, in-flight guard/abort, concise status and preview; do not add prompt/aspect inputs.
5. Call the shared adapter directly from the Settings-owned handler using current draft; never call workspace or checkpoint helpers.
6. Revoke the previous URL when a successful preview replaces it; revoke on unmount. Keep old preview on failed regeneration.
7. Follow existing restrained RetroOS settings styling and keyboard focus conventions.

UI probes:

- [ ] Copy then edit/save image config does not mutate chat Provider.
- [ ] Test works before save with a complete config draft, sends exact built-in prompt `A red sailboat on a calm blue sea at sunrise, no text or watermark.` and fixed `square`, and exposes no prompt/aspect input.
- [ ] Network call body has exactly model/prompt/size and the fixed endpoint.
- [ ] Workspace/checkpoint counts/content do not change after Settings test.
- [ ] Repeated tests and navigation/unmount leave no live old object URLs.
- [ ] Error UI never renders raw Provider response or key.

## Phase 7: Integration and Scope Audit

- [ ] Run an authorized Tool call in native mode and Text Tool Protocol mode.
- [ ] Run an unauthorized Agent and confirm schema/call rejection.
- [ ] Exercise formal-turn, `invokeAgent` and desktop Assistant bindings with an active save; only invokeAgent receives optional requiredSourceGuard from its request.
- [ ] Run the full guard authority matrix with spies: required+missing/wrong guard/wrong assetId zero Provider/zero write; required+exact success uses closure guard; absent+absent ordinary; absent+legal Tool guard guarded; formal direct unguarded succeeds.
- [ ] Verify no branch checks `agentId` or `purpose`, and remote malformed option cannot be silently normalized to absence.
- [ ] Verify Settings test and Tool share adapter behavior but differ at the persistence boundary.
- [ ] Verify the consistency-owned source-registration seam accepts the guarded handoff and emits exact-source metadata only; this platform task never exposes sourceGuard in transaction/storage metadata.
- [ ] Verify this task derives/binds guarded target identity and stages metadata but does not evaluate current-branch source validity itself.
- [ ] Verify direct formal-turn unguarded generation follows after-turn transaction commit, while unguarded `invokeAgent` performs ordinary workspace commit without old-checkpoint patch.
- [ ] Confirm only the optional generic `interaction.invokeAgent.generatedMediaSourceGuard` bridge field was added; no dedicated image RPC, prose, secret, bytes, or result authority entered bridge contracts.
- [ ] Confirm no edits were made to formal-turn full-snapshot commit, invokeAgent checkpoint options, checkpoint manifests, restore, consistency-owned source-registration/storage validators, GC, card files or character/inline illustration UI.
- [ ] Document the canonical identity/path/Tool-result/guarded-handoff contract for sibling and protocol implementation in those tasks' own process; do not implement their source registration, storage metadata, commit, or card algorithms here.
- [ ] Verify the card `{agentId,protocol}` capability propagates in its sibling tests without changing `PlatformConfig.imageGeneration`, `generate_image` schema/result, Provider adapter, or this runner; no brief validator enters platform storage/source registration.

## Phase 8: Validation Commands

Run from repository root:

```bash
npm run build --workspace @tsian/play-bridge
npm run build:contracts
npm run build:web

git diff --check
```

Planning/task gates and focused audits:

```bash
python ./.trellis/scripts/task.py list-context ./.trellis/tasks/07-21-platform-image-generation
python ./.trellis/scripts/task.py validate ./.trellis/tasks/07-21-platform-image-generation

rg -n "generate_image|imageGeneration|generatedMediaSourceGuard|requiredSourceGuard|sourceImagePaths|IMAGE_" packages/contracts/src packages/play-bridge/src apps/platform-web/src
rg -n "apiKey|b64_json|prompt|images/generations|images/edits|sourceImagePaths" apps/platform-web/src/agent-runtime apps/platform-web/src/platform-host
```

Interpret the searches manually: configuration/adapter request code may contain `apiKey`, `prompt`, `b64_json`, endpoint strings and multipart construction; Tool trace/result/schema and bridge code must not contain credential or image payload plumbing, and trace/memory must not store raw `sourceImagePaths`. Do not run `task.py start` as part of planning; implementation starts only after explicit approval.

## Risks and Rollback Points

- **Secret/prompt leak through generic tracing**: use dedicated allowlisted image trace and sanitized error class; never summarize image Tool arguments.
- **Source image bytes/path leak through edits mode**: `sourceImagePaths` stays as bounded model input only; host resolves it to verified Blobs before Provider, never echoes raw paths/bytes in result, trace or tool memory, and never forwards paths to Provider.
- **Provider returns HTML/JSON with image header**: validate byte signature and decode, not header alone.
- **Stable id/path traversal, authority spoofing, or guarded cross-target write**: canonical `assetId` validation, remote strict option normalization, invoke runner required guard closure, exact Tool/required field comparison, host-derived path, and pre-Provider fail-closed tests; never accept target path or authority from Agent input/result.
- **Required guard silently downgrades to ordinary write**: three-mode branch is explicit; required omission/mismatch has zero adapter/write counters and cannot enter ordinary transaction write.
- **Failed regeneration destroys old image**: stage only after complete response validation.
- **Tool silently becomes default/high-cost**: explicit regression check against `DEFAULT_AGENT_PLATFORM_TOOLS`.
- **Config lost by unrelated save**: update default/merge/clone and use full-config section merge.
- **Object URL leak**: central replace/revoke function plus unmount cleanup.
- **Out-of-scope concurrency fix**: validate invoke-required/Tool guard consistency and guarded identity before Provider, then pass `{ identityKey, assetPath, blob, sourceGuard }` losslessly to the consistency-owned source-registration seam and stop. Required path uses closure guard; option-absent self-guarded path uses normalized Tool guard; option-absent no-guard preserves ordinary host semantics. That sibling owns exact-source conversion, current-branch validation, storage metadata, commit/checkpoint/restore algorithms, and GC.

Rollback can remove the UI/config adapter and Tool runner independently without DB migration. Generated `save/assets/generated/*` files remain valid ordinary save-runtime media. No commit, push, task start or destructive reset is implied by this plan.
