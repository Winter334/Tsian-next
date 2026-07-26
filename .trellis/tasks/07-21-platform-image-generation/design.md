# Design — 平台图像生成能力

## 1. Architecture and Ownership

```text
Settings ImageGenerationScreen (config draft only)
  ├─ save → PlatformConfig.imageGeneration → existing cache/meta file
  └─ test → generateImageBlob(draft, built-in short prompt, "square")
              → validated raster Blob
              → screen-local object URL only

explicitly enabled Agent
  → optional invokeAgent.generatedMediaSourceGuard (invokeAgent only)
      → play-bridge forward + remote strict normalize
      → host captures invocation-authoritative requiredSourceGuard
  → generate_image { prompt, aspect, assetId, sourceImagePaths?, sourceGuard? }
  → Agent Runtime built-in dispatch
  → host capability runGenerateImage(input, requiredSourceGuard?)
  → strict-normalize Tool sourceGuard with @tsian/play-bridge shared helper
  → resolve target before paid request:
      ├─ no required guard + no Tool guard: identityKey = assetId; ordinary path
      ├─ no required guard + valid Tool guard: derive/validate Tool guard; guarded path
      └─ required guard:
          require exact Tool guard + assetId derived from required guard;
          mismatch/omission → IMAGE_INVALID_ARGUMENTS, zero fetch/write;
          guarded authority remains required guard
  → if sourceImagePaths present: read current workspace image Blobs, validate/decode them
  → generateImageBlob(config, prompt, aspect, sourceImages?, signal)
  → if effective guarded source:
      guarded handoff { identityKey, assetPath, blob, sourceGuard }
        (required invoke path uses closure guard; Tool guard cannot override)
        → save-consistency platform-host source registration
        → storage transaction writeGeneratedMedia({ identityKey, assetPath, data: blob, source:{path,expectedRevision} })
    else:
      transaction.write({ path: generatedMediaAssetPath(identityKey), data: blob })
        → ordinary staged Blob write with host-native commit/checkpoint semantics
  → { path, mediaType }
  → Tool result never echoes guard; sibling consumes guarded handoff
```

The layers have intentionally different authority:

| Layer | Owns | Must not own |
|---|---|---|
| Settings | Config draft editing, chat-preset copy, fixed built-in paid test, future Provider mode selection, object URL lifecycle | Player-editable test prompt/aspect, Provider protocol duplication, workspace writes |
| Image config module | Normalize/validate/save/resolve `{ baseUrl, apiKey, model }` | Chat preset lifecycle, Agent selection |
| Image adapter | Current OpenAI-compatible mode: `/images/generations` JSON request, `/images/edits` no-mask multipart request, URL/body/auth, aspect mapping, response extraction, URL download, Blob verification, sanitized errors; internal seam for future Provider modes | Workspace/checkpoint semantics, mask/local-region editing UX, Agent-visible Provider-specific Tool names |
| Agent Runtime | Explicit Tool visibility, argument normalization, dispatch, short observation, metadata trace | API key, Provider request construction, arbitrary target path |
| Play bridge / remote RPC boundary | Optional generic `generatedMediaSourceGuard` option→request mapping and strict closed-shape normalization | Runtime identity/hash/path duplication, card/agent-specific routing |
| Platform host | Bind active transaction/current abort signal; for invokeAgent capture normalized option as `requiredSourceGuard`; use shared helper to derive/validate canonical target before paid fetch; resolve optional workspace reference images into verified Blobs for no-mask edits; stage ordinary unguarded Blob or emit guarded handoff whose authority is required option (or legal Tool self-guard when no option) | Trust Agent echo, branch on agentId/purpose, parse authoritative turn projection, define storage metadata, patch checkpoints, accept remote/data/base64 image inputs from Tool args |
| Save-consistency source-registration/storage seam | Read exact turn, generic projection lookup/raw fingerprint check, full turn revision, storage-facing generated-media write | Image Provider or card schema |

This follows the existing seams evidenced by `AgentRuntimeCapabilities` (`apps/platform-web/src/agent-runtime/turn-types.ts:171-224`), Tool execution context (`apps/platform-web/src/agent-runtime/workspace-tools-types.ts:486-521`), and transaction staging (`apps/platform-web/src/storage/workspace.ts:620-681`).

Naming boundary: `PlatformConfig.imageGeneration` is Provider-local `{baseUrl,apiKey,model}` for this MVP's single OpenAI-compatible mode. The Tool contract remains Provider-neutral: future ComfyUI or other modes should be selected in platform Settings and resolved by the host's internal adapter seam while preserving the same `generate_image` Tool name and semantic inputs. The separate card runtime entrypoint is optional `{agentId, protocol:"tsian.image-director.v1"}` capability propagated by contracts/manifest normalizers/host bridge in the protocol sibling. This platform Tool does not read that object and its shape does not change Tool authorization, request, adapter, or result. Likewise, this child never validates `IllustrationBriefV1`; it handles only generic raw projection identity/guard data, while storage/source-registration remains card-schema-agnostic.

Delivery boundary: the existing `exportGameCardPackage` text-size defect at `apps/platform-web/src/storage/game-card-packages.ts:685-689` is fixed by the inline-UI child's repack tooling scope, not by this Provider/Tool child. That sibling changes text inventory to actual UTF-8 ZIP entry bytes, adds ASCII/Chinese/emoji text and binary regressions, and runs `npm run build:web`; this child must not duplicate or pull that work into the image capability implementation.

## 2. Platform Configuration

### 2.1 Shape

Add one root section to `PlatformConfig`:

```ts
interface PlatformImageGenerationConfig {
  baseUrl: string
  apiKey: string
  model: string
}

interface PlatformConfig {
  // existing sections...
  imageGeneration: PlatformImageGenerationConfig
}
```

It is deliberately not nested under `provider`: image generation remains independent after the one-time copy action. It is also not a preset array or discriminated Provider registry.

Default:

```ts
imageGeneration: { baseUrl: "", apiKey: "", model: "" }
```

`platform-config.ts` must update all explicit schema sites together:

1. root interface and `PlatformConfigSectionKey` (`apps/platform-web/src/config/platform-config.ts:68-90`);
2. default (`apps/platform-web/src/config/platform-config.ts:94-123`);
3. defensive merge (`apps/platform-web/src/config/platform-config.ts:231-308`);
4. deep clone (`apps/platform-web/src/config/platform-config.ts:310-330`).

The persisted raw file stays `.tsian/local/platform-config.json`, backed by the existing single Dexie `meta` record (`apps/platform-web/src/storage/local-platform-config.ts:3-18`, `apps/platform-web/src/storage/local-platform-config.ts:58-73`). No DB schema/name change is needed.

### 2.2 Platform-meta configuration boundary

The current `loadLocalPlatformConfigFile()` returns the raw JSON content as a `WorkspaceFile` (`apps/platform-web/src/storage/local-platform-config.ts:32-50`), and `localPlatformConfigVolume.write()` overwrites that raw file from generic platform-meta writes (`apps/platform-web/src/platform-host/workspace-volumes.ts:298-330`). For `imageGeneration.apiKey`, this is the intended privileged configuration boundary: `.tsian/local/platform-config.json` remains the platform-meta management entry that advanced Agent/tools with that permission may read and edit. The boundary is not “no workspace projection ever contains the key”; it is “the key exists only in platform-local config and the explicit platform-meta config entry, never in card/save-runtime, Tool I/O, bridge payloads, trace, or generated-media artifacts”.

Keep one raw Dexie record and do not add a second secret store:

- **raw host config IO**: `readLocalPlatformConfigFileContent()` / `saveLocalPlatformConfigFile()` remain private-to-config/storage helpers and preserve all fields, including the key;
- **platform-meta enumeration/projection**: `loadLocalPlatformConfigFile()` may expose the raw `imageGeneration.apiKey` through `.tsian/local/platform-config.json` because platform-meta is the deliberate advanced configuration channel. Do not copy the key into any other workspace file, save-runtime path, card payload, Tool schema/arguments/result, bridge payload, trace or diagnostic summary;
- **generic platform-meta write/delete**: when `.tsian/local/platform-config.json` is mutated through the volume/workspace path, parse and normalize the full platform config, including `imageGeneration.apiKey`. Writes may set, clear or rotate the key; delete resets the platform config to defaults, including clearing the key, as an explicit platform-meta configuration operation;
- **Settings image helper**: the user-facing Settings screen is a convenience entry for editing the same section, not the only authority that may update `imageGeneration.apiKey`.

This keeps the requested single storage/cache flow while treating platform-meta as an intentional privileged management surface.

### 2.3 Normalization and resolution

Create a narrow image-config module, separate from the richer chat Provider types:

- `normalizeImageGenerationBaseUrl(input)`:
  - trim;
  - add `https://` only when no scheme is present;
  - remove trailing `/`;
  - strip one exact trailing `/images/generations` or `/images/edits` if the player pasted an endpoint;
  - reject credentials in URL, non-HTTP(S) schemes, query/hash, or an empty host.
- normalize stored fields to trimmed strings; keep `apiKey` only in local config memory/file.
- `resolveImageGenerationConfig()` returns `null` unless all three fields are non-empty and base URL validation succeeds.
- `saveImageGenerationConfig()` does read-modify-write via `{ ...getPlatformConfig(), imageGeneration }` so no unrelated section is lost.

Do not reuse `BrowserAiProviderPreset`: it carries models, fallback strategy and chat parameters outside MVP (`apps/platform-web/src/config/ai/providers.ts:61-88`, `apps/platform-web/src/config/ai/providers.ts:317-367`). The chat URL helper may inform behavior, but the image helper owns the fixed `/images/generations` and `/images/edits` suffixes (`apps/platform-web/src/config/ai/normalize.ts:71-99`).

## 3. Settings Experience

### 3.1 Navigation and draft

Add `image-generation` to the Settings screen union and hub entries, following `SettingsHub.vue:47-86` and `SettingsView.vue:157-169` / `269-337`. The new screen contains:

- `baseUrl` text field;
- password `apiKey` field;
- `model` text field;
- “从聊天提供商复制地址和密钥” action;
- save action;
- a clearly marked paid “测试生成” section with action, status, and preview; it has no prompt/aspect input.

Copy UX should let the user choose among complete chat presets when more than one exists. The action copies only `baseUrl` and `apiKey` into the local image draft; it does not save automatically and does not copy a chat model. This improves the existing first-complete-preset pattern at `SemanticSearchScreen.vue:211-239` without coupling the records.

### 3.2 Test lifecycle

The Settings screen passes an in-memory normalized config draft directly to the shared adapter, like the existing in-memory chat model test (`SettingsView.vue:601-644`). It does not require the draft to be saved first. The test call always supplies these platform-owned constants:

```ts
const IMAGE_GENERATION_TEST_PROMPT =
  "A red sailboat on a calm blue sea at sunrise, no text or watermark."
const IMAGE_GENERATION_TEST_ASPECT: ImageAspect = "square"
```

Neither value is player-editable, persisted, or exposed as a screen-local input. Keep the constants in the Settings-owned test module rather than platform config.

State:

```ts
const testPreviewUrl = ref<string | null>(null)
const testing = ref(false)
const testError = ref<string | null>(null)
```

On success:

1. create a new URL from the returned Blob;
2. swap it into `testPreviewUrl`;
3. revoke the previous URL after the swap.

On failure, retain the prior successful preview and show only the code-mapped message. On unmount, revoke the current URL. No adapter result is passed to workspace, checkpoint, bridge, toast details, or persistent form state. Existing project behavior demonstrates the required explicit revoke pattern (`apps/platform-web/src/views/WorkspaceMediaView.vue:89-114`).

The test button copy states that each test invokes the paid Provider and uses the platform's built-in square test image. Disable duplicate submission while one request is active; leaving/unmounting aborts the test request and revokes preview state.

## 4. Image Adapter

### 4.1 Public contract

The shared core returns only a verified Blob plus safe metadata:

```ts
type ImageAspect = "landscape" | "portrait" | "square"

interface GenerateImageBlobInput {
  config: PlatformImageGenerationConfig
  prompt: string
  aspect: ImageAspect
  sourceImages?: readonly VerifiedSourceImageBlob[]
  signal?: AbortSignal
}

interface VerifiedSourceImageBlob {
  blob: Blob
  mediaType: string
  path: string
  width: number
  height: number
}

interface GeneratedImageBlob {
  blob: Blob
  mediaType: string
  width: number
  height: number
  source: "base64" | "url"
  endpoint: "generations" | "edits"
  size: "1536x1024" | "1024x1536" | "1024x1024"
}
```

The exact size map is a total record with no default branch. It follows the official OpenAI Images API GPT Image standard sizes (`1024x1024`, `1536x1024`, `1024x1536`; `https://developers.openai.com/api/docs/api-reference/images/create`), rather than DALL-E 3-only `1792x1024` / `1024x1792` values:

```ts
const IMAGE_SIZE_BY_ASPECT = {
  landscape: "1536x1024",
  portrait: "1024x1536",
  square: "1024x1024",
} as const satisfies Record<ImageAspect, string>
```

Runtime validation still checks untyped Tool/UI boundaries before indexing it. Invalid aspect fails before fetch.

### 4.2 Requests

After validating all fields, prompt non-emptiness and the aspect-size map, the adapter chooses the endpoint from `sourceImages`:

**Text-to-image (`sourceImages` absent/empty):**

```http
POST {normalizedBaseUrl}/images/generations
Authorization: Bearer <apiKey>
Content-Type: application/json

{
  "model": "...",
  "prompt": "...",
  "size": "1536x1024"
}
```

**Image-to-image (`sourceImages.length >= 1`):**

```http
POST {normalizedBaseUrl}/images/edits
Authorization: Bearer <apiKey>
Content-Type: multipart/form-data

model=...
prompt=...
size=1536x1024
image[]=<host-read verified image Blob>
```

The Tool accepts `1..4` reference paths; the host resolves them from the current Runtime Workspace before the adapter call, rejects missing/non-image/non-decodable files, and passes verified image Blobs to the adapter. Reference images are Provider input only: they are not copied into Tool observation, result, trace, bridge payload, or generated-media metadata. `mask`, `maskPath`, transparent-region editing and local repaint controls are intentionally absent from the MVP because they are primarily human-directed editing affordances.

No extra response format, quality, count, style, negative prompt, custom params, mask, or retry fields are sent. An external abort remains `AbortError`.

### 4.3 Response normalization

Parse a successful response as unknown and inspect only `data[0]`:

1. if `b64_json` is a non-empty string, decode it with a strict base64 decoder;
2. else if `url` is a non-empty HTTP(S) URL, immediately `fetch` it with the same abort signal and no Authorization forwarding;
3. else throw `IMAGE_RESPONSE_INVALID`.

If both are present, prefer base64. Never return/store the remote URL. A URL download HTTP failure is classified as Provider/network failure using sanitized status only.

### 4.4 Blob verification

Headers and `Blob.type` are hints, not proof. Both branches use one verifier:

1. require `blob.size > 0` and enforce a bounded maximum before decoding (freeze a conservative constant, e.g. 32 MiB, in implementation);
2. inspect byte signatures for supported raster formats: PNG, JPEG, WebP, GIF and AVIF; derive the canonical MIME from bytes rather than accepting an arbitrary response header;
3. reject SVG, HTML, JSON, generic octet-stream with no recognized signature, and MIME/signature disagreement;
4. construct a Blob with canonical MIME;
5. decode with `createImageBitmap`, require positive width/height, then close the bitmap in `finally`; if `createImageBitmap` is unavailable in the runtime, return `IMAGE_RUNTIME_UNAVAILABLE` rather than accepting an unverified image;
6. return canonical Blob and dimensions.

This is stricter than checking `type.startsWith("image/")`. Once staged, existing workspace conversion preserves the Blob and exposes canonical image MIME (`apps/platform-web/src/storage/workspace.ts:117-149`; MIME resolution is at `apps/platform-web/src/lib/media-type.ts:220-255`).

## 5. Error Model and Secret Boundary

### 5.1 Stable errors

Use a dedicated error class whose public fields are already sanitized:

```ts
class ImageGenerationError extends Error {
  readonly code: ImageGenerationErrorCode
  readonly safeDetails?: {
    httpStatus?: number
    aspect?: ImageAspect
    size?: string
      source?: "base64" | "url"
      endpoint?: "generations" | "edits"
      mediaType?: string
    byteSize?: number
  }
}
```

Codes and concise user/model messages:

| Code | Message intent |
|---|---|
| `IMAGE_PROVIDER_NOT_CONFIGURED` | 请先配置图像生成服务。 |
| `IMAGE_INVALID_ARGUMENTS` | 图像生成参数无效。 |
| `IMAGE_POLICY_REJECTED` | 图像请求被服务商策略拒绝。 |
| `IMAGE_AUTH_FAILED` | 图像服务鉴权失败。 |
| `IMAGE_PROVIDER_ERROR` | 图像服务暂时无法完成请求。 |
| `IMAGE_NETWORK_ERROR` | 无法连接图像服务。 |
| `IMAGE_RESPONSE_INVALID` | 图像服务返回格式无效。 |
| `IMAGE_CONTENT_INVALID` | 返回内容不是有效图片。 |
| `IMAGE_RUNTIME_UNAVAILABLE` | 当前运行环境无法保存生成图片。 |

HTTP 401/403 maps to auth unless a parsed, allowlisted machine code identifies policy/content filtering. Policy detection may inspect known structured code fields, but no Provider message/body survives the adapter. Other non-2xx statuses retain only `httpStatus` in `safeDetails`. Fetch transport errors become network errors; external abort passes through unchanged.

### 5.2 Information-flow rules

| Value | Settings memory | Adapter local | Tool args | Workspace | Bridge/events | Trace |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| API key | password draft | yes | no | platform-local config / `.tsian/local/platform-config.json` platform-meta only | no other bridge payload | no |
| Prompt | built-in test constant / model-created | yes | yes | no new text file | existing Tool-call event identity only, no output echo | no |
| Source image paths | n/a | host resolves to verified Blobs | bounded path strings only | existing workspace image Blobs | no bytes; no path echo beyond generic argument keys | no raw paths or bytes |
| Provider error body | no | transient parse only | no | no | no | no |
| URL response | no | immediate download only | no | no | no | no |
| Base64 / Blob bytes | Blob preview only | yes | no | Blob only for Tool | no | no |
| `{ path, mediaType }` | n/a | n/a | result only | path+Blob | short Tool result | safe metadata |

Generic trace helpers are forbidden for this Tool because `summarizeTraceValue()` emits string preview (`apps/platform-web/src/agent-runtime/trace.ts:100-117`). Generic error conversion is also safe only after conversion to `ImageGenerationError`; raw Provider errors must never cross the adapter boundary.

## 6. `generate_image` Tool Contract

### 6.1 Visibility and schema

Add `"generate_image"` to:

- shared `AgentPlatformToolName` (`packages/contracts/src/runtime.ts:429-446`);
- runtime name map (`permissions.ts:6-14`);
- registry accepted-name set (`registry.ts:63-71`);
- common Studio/Assistant capability controls (`tool-controls.ts:25-84`);
- wire-name map (`workspace-tools-types.ts:33-54`).

Do not add it to `DEFAULT_AGENT_PLATFORM_TOOLS` (`permissions.ts:24-28`). Visibility remains:

```text
platformTools.enabled explicitly contains generate_image
AND platformTools.disabled does not contain generate_image
```

`buildEnabledToolSchemas()` adds the schema only when this predicate holds, preserving one schema source for native and text protocols (`tool-schemas.ts:483-599`). Place it in a clearly labeled costly-media control group.

Schema:

```ts
{
  name: "generate_image",
  description: "Generate one image with the configured platform image service and save it as a runtime asset. This incurs provider cost.",
  parameters: {
    type: "object",
    required: ["prompt", "aspect", "assetId"],
    additionalProperties: false,
    properties: {
      prompt: { type: "string", minLength: 1 },
      aspect: { type: "string", enum: ["landscape", "portrait", "square"] },
      assetId: { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$" },
      sourceImagePaths: {
        type: "array",
        minItems: 1,
        maxItems: 4,
        items: { type: "string", minLength: 1, maxLength: 240 }
      },
      sourceGuard: {
        type: "object",
        required: ["kind", "turn", "projectionKey", "index", "fingerprint"],
        additionalProperties: false,
        properties: {
          kind: { type: "string", const: "turn-projection" },
          turn: { type: "integer", minimum: 0 },
          projectionKey: { type: "string", pattern: "^[A-Za-z][A-Za-z0-9._-]{0,63}$" },
          index: { type: "integer", minimum: 0 },
          fingerprint: { type: "string", pattern: "^sha256:[a-f0-9]{64}$" }
        }
      }
    }
  }
}
```

`sourceImagePaths` is optional. When omitted, the adapter calls `/images/generations`. When present, it must contain `1..4` ordinary workspace image paths; the host reads each file from the current Runtime Workspace, requires `binary` + `imageMimeType`, runs the same raster verifier, and passes the verified Blobs to `/images/edits`. The schema deliberately has no `mask`, `maskPath`, URL, data URL, base64, or inline binary field: mask/local repaint is a human-directed editing workflow and stays out of this AI-led MVP. Reference image bytes never enter Tool observation/result, bridge payloads, trace, or persisted text memory.

`sourceGuard` is optional so the platform Tool remains reusable beyond inline-story projection workflows. When supplied, it contains identifiers/digest only, never projection正文, prompt, workspace path or arbitrary JSON. The MVP defines no other guard kind. For the current card use case `projectionKey` is exactly `"illustrations"`. The frontend uses the shared play-bridge helper on the persisted raw projection body to create the guard and `assetId`; `image-director` validates and forwards both unchanged; this platform child strictly normalizes the guard and recomputes identity/path before any paid Provider request. The adapter ignores it, Tool output omits it, and trace records neither fingerprint nor source coordinates.

### 6.2 Shared runtime helper, invoke contract, host callback, and guarded handoff

The only runtime implementation lives in `packages/play-bridge/src/generated-media-identity.ts` and is exported from `@tsian/play-bridge` root. Add `@tsian/play-bridge` as a real `platform-web` workspace dependency and TypeScript path; the card/dev frontends consume the same package. Because `InvokeAgentRequest` is a contracts-owned RPC shape, contracts declares the bounded serializable `GeneratedMediaTurnProjectionGuard` shape (or an equivalent source shape that play-bridge aliases/re-exports), while play-bridge exclusively owns strict runtime normalization, hashing, canonical encoding and path derivation.

Extend the generic invoke surface without card-specific naming:

```ts
interface InvokeAgentRequest {
  // existing fields...
  generatedMediaSourceGuard?: GeneratedMediaTurnProjectionGuard
}

interface InvokeAgentOptions {
  // existing fields...
  generatedMediaSourceGuard?: GeneratedMediaTurnProjectionGuard
}
```

`createTsian().invokeAgent` forwards the option into RPC params. `normalizeInvokeAgentRequest` must run the shared strict normalizer and either return the canonical closed V1 object or reject the whole RPC request; it must not silently omit malformed/extra values. Existing callers that omit the option remain unchanged. No code selects this behavior by `agentId` or `purpose`.

The module owns the guard type and strict normalizer plus:

```ts
fingerprintProjectionRaw(rawProjection: string): Promise<`sha256:${string}`>
deriveTurnProjectionIdentityKey(guard: GeneratedMediaTurnProjectionGuard): Promise<string>
generatedMediaAssetPath(identityKey: string): string
```

`fingerprintProjectionRaw` hashes the exact persisted string emitted by reply projection `$1|trim` as UTF-8. It never parses JSON, reorders fields, normalizes Unicode/whitespace, or re-serializes. All host, source-registration, storage defense, and frontend consumers import these helpers instead of copying them.

Runtime runner shapes remain short:

```ts
interface RuntimeGenerateImageInput {
  prompt: string
  aspect: ImageAspect
  assetId: string
  sourceImagePaths?: string[]
  sourceGuard?: GeneratedMediaTurnProjectionGuard
}

interface RuntimeGenerateImageResult {
  path: string
  mediaType: string
}

type GuardedGeneratedMediaHandoff = {
  identityKey: string
  assetPath: string
  blob: Blob
  sourceGuard: GeneratedMediaTurnProjectionGuard
}

interface RuntimeGenerateImageRunnerContext {
  /** Present only for invokeAgent calls whose normalized request option supplied it. */
  requiredSourceGuard?: GeneratedMediaTurnProjectionGuard
}
```

The handoff is an internal platform-host dependency on `07-21-image-save-consistency`; it is not a bridge payload and not durable metadata. This task must not extend `RuntimeWorkspaceChanges`/`RuntimeWorkspaceTransaction` with `sourceGuard`, and must not define storage-facing `GeneratedMediaCommitMetadata`. The sibling owns the final authoritative storage shape:

```ts
// Authoritative final storage shape, defined and implemented by
// 07-21-image-save-consistency; shown here only as the downstream boundary.
type ConsistencyOwnedGeneratedMediaCommitMetadata = {
  identityKey: string
  assetPath: string
  source: { path: string; expectedRevision: string }
}
```

Argument normalization rejects unknown aspect, blank prompt, noncanonical asset id, malformed `sourceImagePaths` (not an array, empty array, more than 4 items, blank/too-long/non-string path), and—when Tool `sourceGuard` exists—non-integer coordinates, any V1 projection key other than `illustrations`, or fingerprint outside `sha256:<64 lowercase hex>` before the paid Provider call. Source image paths are resolved by the host after authority checks but before Provider fetch: each path must be an ordinary workspace/save-runtime image file with `binary` and `imageMimeType`, must not be `.tsian/local/**`, URL, data URL, base64, or inline bytes, and must pass the shared raster verifier. Missing/non-image/non-decodable references fail before Provider and produce no write/handoff. When the invoke runner has `requiredSourceGuard`, omission of Tool guard, any field mismatch, or mismatch between `assetId` and the identity derived from the required guard also returns `IMAGE_INVALID_ARGUMENTS` before config resolution/fetch. These failures perform no ordinary write, guarded handoff or checkpoint work and cannot downgrade to the unguarded branch.

Target identity is implemented only by the shared play-bridge module. It exposes the synchronous NUL-delimited UTF-8 preimage encoder, async SHA-256 derivation, raw projection fingerprint, and path helper. Host validation and sibling/card/frontend consumers import it rather than copying separators/encoding:

```text
preimage = UTF-8(
  "tsian-generated-media-turn-projection-v1" + NUL +
  decimal(turn) + NUL +
  projectionKey + NUL +
  decimal(index) + NUL +
  fingerprint
)
identityKey = "tp-v1-" + lowercaseHex(SHA-256(preimage))
path = "save/assets/generated/" + identityKey
```

Golden vector (all consumers must produce exactly this, including the raw projection fingerprint):

```text
rawProjection = {"title":"雨夜","description":"重逢","sceneRef":"scene:station","entityRefs":[]}
fingerprint = sha256:d5d01760ea67ebb81076c3d7e7a34d966e3766d4f3b51f5927441292c3ea54a4
guard = {
  kind: "turn-projection",
  turn: 12,
  projectionKey: "illustrations",
  index: 0,
  fingerprint
}
identityKey = "tp-v1-9ddcb65606a53538f1eb2cba492e8874519a29d0f3065f378ccafe4b5318f2b3"
assetPath = "save/assets/generated/tp-v1-9ddcb65606a53538f1eb2cba492e8874519a29d0f3065f378ccafe4b5318f2b3"
```

The raw string shown above has no trailing newline. Fingerprint input is the exact UTF-8 raw projection string, not parsed/normalized JSON.

Decimal coordinates use their canonical base-10 form with no sign or leading zeros; schema-normalized `projectionKey` and `sha256:<64-lowercase-hex>` fingerprint enter unchanged. NUL is safe as an unambiguous delimiter because no string field permits it. For a call with no invoke-required guard and no Tool guard, `identityKey = assetId` and the same path mapping applies. For no invoke-required guard plus a legal Tool guard, derive from that Tool guard and enter guarded registration. When `requiredSourceGuard` exists, the host compares every Tool guard field to the required object and derives identity only from the required object; Tool omission/mismatch or wrong `assetId` returns `IMAGE_INVALID_ARGUMENTS` before config resolution/fetch. The Tool object never replaces the closure authority. This preserves generic caller-selected ids while preventing required guarded invocations from targeting another asset or silently becoming ordinary writes.

A path without extension is intentional: identity is stable across Provider output formats, while meaningful `Blob.type` wins over path inference (`apps/platform-web/src/lib/media-type.ts:220-246`). The existing transaction validates it is an ordinary `save/` path (`apps/platform-web/src/storage/workspace-paths.ts:66-81`).

The host runner:

1. assert active save and transaction;
2. validate/normalize the optional Tool source guard with the shared helper; receive optional already-normalized `requiredSourceGuard` from the host binding;
3. resolve effective authority before paid fetch:
   - no required guard + no Tool guard → `identityKey = assetId`, ordinary path;
   - no required guard + valid Tool guard → derive identity from Tool guard, require exact assetId, guarded path;
   - required guard → require Tool guard exists and every field equals required; derive identity from required guard and require exact assetId; any omission/mismatch is `IMAGE_INVALID_ARGUMENTS` with zero Provider/write;
4. derive asset path, resolve cached image config;
5. if `sourceImagePaths` exist, read each current workspace image Blob and verify it with the shared raster verifier; any invalid reference fails before Provider and does not reach write/handoff;
6. call adapter with config/prompt/aspect plus verified source images when present (edits), or without source images (generations), and the host abort signal;
7. after complete generated-image validation, call ordinary `transaction.write({ path: assetPath, data: blob })` only for the no-option/no-Tool-guard case; otherwise submit `{ identityKey, assetPath, blob, sourceGuard }` to the consistency-owned source-registration seam, using the required closure guard when present and the legal Tool guard only when no required guard exists;
8. return `{ path: assetPath, mediaType }`.

The platform runner does not parse the authoritative turn projection and does not create sourceGuard-bearing transaction metadata. Agent input/final-result echoes are not consulted for host authority. Guarded metadata can therefore arise only from the required-and-validated host option path or, when that option is absent, from a valid self-supplied Tool guard. The guarded source-registration seam validates the exact turn source and performs the final storage staging defined by `07-21-image-save-consistency`. Provider/Blob validation failure reaches neither ordinary write nor guarded handoff, so the pre-existing file remains unchanged.

### 6.3 Execution order

Dispatch `generate_image` as a built-in before user Tool fallback (`tool-execution.ts:500-525`). Keep it out of `PARALLEL_TOOL_NAMES`: it is costly and stages a write, so calls in one model round execute serially with other stateful operations (`tool-execution.ts:575-653`). Independent host invocations can still run concurrently; sibling consistency work owns their eventual merge/checkpoint semantics.

## 7. Host Wiring

Bind one factory-created runner to every Agent Runtime entry path:

- formal turn capability object around `runtime-turn.ts:211-245`, with no invocation-required guard (Tool guard remains optional);
- side-channel `invokeAgent` capability object around `ai-invocation.ts:383-422`, closing over the strict-normalized `input.generatedMediaSourceGuard` as `requiredSourceGuard` when present;
- desktop Assistant capability object around `assistant-chat.ts:581-739`, with no invocation-required guard.

Each binding closes over its current `RuntimeWorkspaceTransaction`, current abort signal and active-save presence. `agent_call` receives the same `capabilities` recursively, so no separate delegated implementation is required. No binding tests agentId or purpose to decide guard behavior.

The Tool must not depend on `workspaceMutations` or `workspace_write` permission; it writes through its own host runner after its own platform Tool permission gate.

## 8. Trace and Model Observation

Add a dedicated image trace branch in `workspace-tools/tracing.ts`:

Success fields:

- `tool: "generate_image"`;
- `endpoint: "generations" | "edits"`;
- `aspect` and mapped `size`;
- stable output `path`;
- canonical `mediaType`;
- `byteSize`;
- `durationMs`.

Failure fields:

- `tool`;
- sanitized `code`;
- optional `httpStatus`;
- `durationMs`.

Never pass the whole call, `call.arguments`, raw error, prompt, source image paths, URL, response body, base64 or Blob to trace. The existing model-call completion summary stores only Tool name and argument keys (`agent-runtime/index.ts:1260-1276`) and should remain unchanged.

The normal observation and Tool event contain only `{ path, mediaType }` on success or `{ code, message }` plus allowlisted safe details on failure. They do not contain adapter diagnostics beyond that allowlist.

## 9. Checkpoint/Concurrency Handoff

Current formal turn commits a full final snapshot (`runtime-turn.ts:366-370`), while `invokeAgent` commits touched changes (`ai-invocation.ts:471-495`). This task does not reconcile that mismatch. It preserves three explicit modes:

- **no required option + no Tool guard**: stage one ordinary Blob write. A direct formal-turn Tool call is included by that turn's existing after-turn transaction. An unguarded `invokeAgent` follows its existing workspace commit only and does not patch an older checkpoint;
- **no required option + valid Tool self-guard**: after Provider/Blob validation, submit the guarded handoff using the normalized Tool guard;
- **invokeAgent required option**: before Provider, require exact Tool guard and derived assetId; after validation, submit guarded handoff using the option closure guard. Omission/mismatch is zero Provider/zero write and cannot enter ordinary mode.

No `sourceGuard` is added to `RuntimeWorkspaceTransaction` or storage metadata by this task. Agent request/result guard echoes do not choose one of these modes.

The guarded handoff contract to `07-21-image-save-consistency` is:

```ts
{
  identityKey: "tp-v1-<sha256>",
  assetPath: "save/assets/generated/<identityKey>",
  blob: Blob,
  sourceGuard: {
    kind: "turn-projection",
    turn: number,
    projectionKey: "illustrations",
    index: number,
    fingerprint: `sha256:${string}`
  }
}
```

The sibling's card-agnostic platform-host source-registration seam reads the exact authoritative turn file, generically resolves `assistant.projections[projectionKey][index]`, verifies the raw projection with the same play-bridge helper, computes the complete turn-file revision, then calls its storage transaction seam with:

```ts
writeGeneratedMedia({
  identityKey,
  assetPath,
  data: blob,
  source: { path, expectedRevision }
})
```

That exact-source metadata contains no `sourceGuard`; storage does not parse turn projections. The consistency child owns touched-path/CAS merge, checkpoint path patch, restore linearization, stale late-result rejection, replacement, and Blob GC. This child owns Provider/Tool schema, invoke request/options propagation, remote strict normalization, invocation-authoritative required guard closure, the sole shared helper, pre-paid Tool guard/`assetId` binding, and lossless guarded handoff. Tool success remains exactly `{ path, mediaType }`.

## 11. Future Provider Modes

MVP ships one OpenAI-compatible mode and one semantic Tool, `generate_image`. Future ComfyUI or other image endpoints should extend the platform configuration/control panel with a Provider mode selector and internal adapter registry; Agent/card protocols should continue to call `generate_image` rather than Provider-specific Tools.

Future mode switching contract:

- Settings owns selecting the active Provider mode and mode-specific local config.
- The host runner resolves the active mode and dispatches to the corresponding adapter automatically.
- Tool input remains semantic (`prompt`, `aspect`, `assetId`, optional `sourceImagePaths`, optional `sourceGuard`) rather than workflow/node/endpoint-specific.
- Tool schema/description may be generated from the active mode's **semantic capabilities** (for example whether reference images are supported), but must not expose Provider secrets or low-level workflow wiring. If a mode lacks a semantic capability, either omit that optional field from the schema/description or fail clearly before Provider fetch; do not ask Agents to choose OpenAI vs ComfyUI.
- Provider-specific UI such as workflow selection, node mapping, queue polling, progress/cancel or mask/local repaint belongs to future tasks.

This preserves stable card/Agent behavior while allowing the control panel to switch the underlying image backend later.

## 12. Compatibility and Rollback

- Existing platform config files lack `imageGeneration`; merge supplies the empty default. No migration is needed.
- Existing Agent configs omit `generate_image`; because the Tool is not default, behavior remains unchanged.
- Existing native/text Tool consumers and invokeAgent callers gain no behavior change when `generatedMediaSourceGuard` is omitted; Tool schema remains invisible until explicitly authorized.
- `InvokeAgentRequest`/play-bridge options gain an additive optional bounded guard field; remote callers supplying it malformed fail loud instead of silently becoming unguarded.
- No DB table/name or card package shape changes. The only bridge payload change is the optional generic generated-media guard on existing `interaction.invokeAgent`; it contains no prose, secret or bytes.
- Rollback removes the config section/UI, adapter, Tool name/schema/runner and host bindings. Generated files already stored under `save/assets/generated/` remain ordinary inert workspace Blobs; removing capability does not corrupt saves.
