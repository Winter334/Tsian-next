# Design — 平台图像生成与桌面环境变量

## 1. Boundaries

```text
.tsian/local/desktop.env
  -> desktop-env parser
     -> resolveImageEnvironment()
     -> resolveEmbeddingEnvironment()

explicit Agent permission
  -> generate_image {prompt,aspect,sourceImagePaths?}
  -> optional host binding from invokeAgent
  -> OpenAI Images adapter
  -> verified Blob
     -> bound commit callback (consistency child)
     -> or unbound RuntimeWorkspaceTransaction write
  -> {path,mediaType}
```

The chat Provider still drives the Agent. Image and embedding endpoints are service variables, not chat Provider presets.

## 2. Local File Storage

Add a second accepted local platform file beside `platform-config.json`, backed by the existing `meta` table and routed by path:

```text
.tsian/local/platform-config.json
.tsian/local/desktop.env
```

Storage helpers preserve the files independently. The volume selector routes both before the generic save-owned `.tsian` volume. Enumeration returns both to actors already allowed to read platform-meta.

The parser returns either a complete map or a structured parse error. It never mutates `globalThis.process.env` and never executes values.

## 3. Typed Resolvers

```ts
interface ImageEnvironment {
  baseUrl: string
  apiKey: string
  model: string
}

interface EmbeddingEnvironment {
  baseUrl: string
  apiKey: string
  model: string
  dimensions: number
}
```

Resolvers trim required fields, validate URL/positive dimensions, and return `null` when incomplete. Safe diagnostics name missing/invalid keys but never include values.

The old embedding object is removed from `BrowserPlatformConfigDraft`; all provider cloning and normalization becomes chat-only again. Semantic search Settings navigation is deleted rather than replaced.

## 4. Wire Target

`GeneratedMediaTurnProjectionTarget` belongs in contracts because it crosses iframe/RPC. Runtime normalization/path generation belongs in play-bridge or a narrow shared runtime module.

```ts
interface GeneratedMediaTurnProjectionTarget {
  kind: "turn-projection"
  turn: number
  projectionKey: string
  index: number
}
```

Allowed `projectionKey` matches a bounded ASCII identifier. Stable path encoding is total and requires no hash. Host authority is supplied later by the consistency child's source binding.

## 5. Adapter

```ts
interface GenerateImageBlobInput {
  environment: ImageEnvironment
  prompt: string
  aspect: ImageAspect
  sourceImages?: readonly VerifiedSourceImage[]
  signal?: AbortSignal
}
```

The adapter:

1. validates prompt/aspect/config;
2. chooses generations or edits;
3. issues one request;
4. extracts base64 or downloads URL;
5. verifies signature and decode;
6. returns canonical Blob metadata.

Reference paths are resolved before adapter entry. Adapter never knows workspace paths or generated-media target.

## 6. Tool Runner

The execution context exposes an image runner whose closure contains:

- active transaction/workspace reader;
- abort signal;
- optional generated-media binding/commit callback;
- per-bound-invocation `used` flag.

For bound calls, `used` changes before Provider fetch so model retries cannot create a second charge. A failed first request remains the only attempt; user retry starts a new invocation.

For unbound calls, Host creates a unique `save/assets/generated/unbound/<uuid>` path and stages the verified Blob. No Tool argument can choose a path.

## 7. Sanitized Errors

One error class carries a stable code plus safe metadata. Provider response text is inspected transiently only for allowlisted policy codes. Generic trace summarization must not see Tool arguments for `generate_image`; a dedicated trace branch records metadata only.

## 8. Sibling Seam

This task defines the optional binding shape consumed by the runner but does not implement source/checkpoint authority. The consistency child supplies:

- invocation-start target resolution;
- durable bound commit callback;
- stale-source error mapping.

Integration happens in platform-host after both children land. No temporary caller-supplied authority or ordinary-write fallback is introduced for a bound target.
