# Design — 正文内嵌插图生成

## 1. End-to-End Flow

```text
storyteller response
  -> Reply Projection
     content: clean prose
     displayContent: prose + inline markers
     projections.illustrations[]: raw JSON strings
  -> persisted assistant item {turn, content, displayContent, projections}
  -> frontend ordered segment parser
  -> player activates illustration card
  -> invokeAgent(image-director, {brief, prose}, {
       generatedMediaTarget:{kind:"turn-projection",turn,projectionKey:"illustrations",index}
     })
  -> Host resolves persisted source + branch epoch + stable path
  -> image-director reads current scene/entity media
  -> generate_image {prompt, aspect, sourceImagePaths?}
  -> image adapter reads desktop.env and calls generations/edits
  -> generated-media CAS writes Blob + patches eligible checkpoints
  -> invokeAgent completed
  -> frontend probes stable path and renders Object URL
```

## 2. Authority and Ownership

| Concern | Authority | Explicit non-authority |
|---|---|---|
| Narrative placement | persisted `displayContent` + ordered projection index | DOM order or title |
| Brief validity | card/frontend single runtime validator | projector and storage |
| Tool permission | Agent `platformTools` | env completeness |
| External service variables | `.tsian/local/desktop.env` | card, save, Tool arguments |
| Generated target | Host-resolved persisted turn projection | frontend prose, Agent result, Tool args |
| Stale detection | source revision + restore branch epoch | asset path alone |
| Durable media | workspace Blob + checkpoint manifests | Object URL and UI registry |
| Art direction | card `image-director` context | platform adapter |

## 3. Shared Contracts

### 3.1 Illustration brief

```ts
interface IllustrationBriefV1 {
  title: string
  description: string
  sceneRef: string
  entityRefs: string[]
}
```

The marker contains exactly one JSON object. Projection stores the raw trimmed capture so the Host can verify the same source without knowing card schema. The runtime validator lives in one card-consumable module; Prompt copies are self-contained prose contracts, not executable validators.

### 3.2 Generated media target

```ts
interface GeneratedMediaTurnProjectionTarget {
  kind: "turn-projection"
  turn: number
  projectionKey: string
  index: number
}
```

The target is serializable request metadata, not Tool input. RPC normalization rejects unknown keys. A shared path helper derives:

```text
save/assets/generated/turn-projection/<turn>/<projectionKey>/<index>
```

`projectionKey` is restricted to a path-safe identifier. Stable path does not prove authority; storage CAS does.

### 3.3 Image Tool

```ts
interface GenerateImageInput {
  prompt: string
  aspect: "landscape" | "portrait" | "square"
  sourceImagePaths?: string[]
}

interface GenerateImageResult {
  path: string
  mediaType: string
}
```

Bound invocation uses the Host target path. Unbound generic invocation gets a Host-generated unique path. No caller controls a workspace path.

## 4. Desktop Environment

`.tsian/local/desktop.env` uses a strict dotenv subset. One parser returns a flat immutable map; capability resolvers read only named keys.

```env
TSIAN_IMAGE_BASE_URL=
TSIAN_IMAGE_API_KEY=
TSIAN_IMAGE_MODEL=
TSIAN_EMBEDDING_BASE_URL=
TSIAN_EMBEDDING_API_KEY=
TSIAN_EMBEDDING_MODEL=
TSIAN_EMBEDDING_DIMENSIONS=
```

The file reuses platform-meta storage and access rules. It is never injected wholesale into runtime contexts. Structured tunables remain in `platform-config.json`.

## 5. Invocation Binding

At `invokeAgent` start, platform-host:

1. strict-normalizes the target;
2. resolves the active save and exact turn file;
3. locates the assistant projection array and exact string at `index`;
4. captures `{sourcePath, sourceRevision, branchEpoch, assetPath}`;
5. closes this binding over the invocation's `generate_image` runner;
6. allows at most one paid call for a bound invocation.

The Agent receives only brief/prose. No caller-computed durable identity is duplicated through Agent or Tool messages.

## 6. Image Adapter

The MVP adapter is OpenAI Images compatible internally while the Tool remains neutral.

- text-to-image: JSON request to normalized `/images/generations`;
- image-to-image: multipart request to normalized `/images/edits`, 1..4 verified source files, no mask;
- semantic aspect mapping is adapter-owned;
- accept supported base64 or HTTP(S) URL result, immediately download URL results;
- inspect signature and decode raster before returning a canonical Blob;
- map errors to sanitized stable codes; Abort remains Abort.

No interactive configuration test call exists. Adapter tests use mocked fetch and fixture Blobs.

## 7. Persistence

### 7.1 Formal turns

`RuntimeWorkspaceTransaction.finalWorkspaceChanges()` becomes the formal commit input. Storage merges written/deleted paths into the latest workspace and builds the new auto checkpoint from the merged result. It never deletes every workspace row.

### 7.2 Generated media

The Provider call runs outside Dexie transaction. Commit then rechecks source revision and branch epoch. On success, one transaction:

1. writes/replaces the workspace media path;
2. replaces/adds that path in every retained checkpoint with `historyFileCount >= sourceTurn + 1`;
3. leaves earlier checkpoints unchanged;
4. updates the save timestamp.

`historyFileCount` is stored on new/overwritten checkpoint records: initial state is 0, published opening is 1, and formal turn N yields N+1. This avoids treating the pre-opening turn-0 checkpoint as if it contained the opening source. Blob hashing may happen before the transaction; CAS failure cleans an unreferenced prewritten Blob. After replacement/prune/restore, full reference-scan GC removes orphan hashes.

### 7.3 Restore epoch

Each save carries an internal restore/branch epoch. Restore increments it in the same operation that restores workspace and deletes future turns/checkpoints. Normal forward turn commits do not increment it. Therefore a long image request survives ordinary story progress but becomes stale after any restore/branch rewrite.

## 8. Card Protocol and Opening

`storyteller` owns marker placement for both formal turns and opening. Current opening integration updates the staged `开局建模` final storyteller delegation and `publish_opening`; no second publication path is added.

`image-director` reads current scene/entity data, chooses existing image references, composes fixed-style prompt and calls `generate_image` exactly once. It never writes workspace itself.

## 9. Frontend Model

The assistant timeline keeps source fields instead of collapsing early to display text. Ordered parsing happens only for settled assistant items. Each interactive segment is keyed by `{turn, projectionKey, index}`.

The registry stores logical attempt state only. Components own Object URLs. After a durable completed event, the component reads the stable path from workspace. Reload recreates state by probing; in-flight requests are intentionally not resumed.

Restore removes targets no longer present and invalidates mounted URLs. Regeneration leaves the old Blob visible until the replacement commit completes.

## 10. Delivery and Compatibility

- Old cards without entrypoint/projection render normal prose.
- Old saves require no migration.
- Old embedding configuration is intentionally discarded.
- Existing package/repack commands are the only card distribution authority.
- Built-in blank card templates do not gain immersive-reader-specific Agent/protocol files.
