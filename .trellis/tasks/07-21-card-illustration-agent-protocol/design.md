# Design — 卡内插图 Agent 与输出协议

## 1. Flow

```text
storyteller opening/formal response
  -> [[插图]] raw JSON blocks, 1..3 (normally 1)
  -> Reply Projection
     content: clean prose
     displayContent: prose + markers at original positions
     projections.illustrations[]: raw trimmed JSON strings
  -> persisted assistant turn
  -> frontend validates and activates one projection target
  -> invokeAgent(imageGeneration.agentId, {brief, prose}, {generatedMediaTarget})
  -> image-director reads latest scene/entities
  -> generate_image({prompt, aspect, sourceImagePaths?}) once
  -> Host commits bound image
  -> Agent returns closed asset result
```

The marker is card semantics. Projection remains generic, and Host persistence treats the selected raw projection as opaque source text.

## 2. Brief Shape

```ts
interface IllustrationBriefV1 {
  title: string
  description: string
  sceneRef: string
  entityRefs: string[]
}
```

Validation is closed and non-coercing. Strings are trimmed only after type checking. `entityRefs` are normalized by first-occurrence deduplication after each ref passes the grammar. The runtime validator returns either a normalized brief or a structured invalid result suitable for fail-soft rendering; it never repairs arbitrary JSON.

The canonical executable validator lives in one card-consumable runtime module and is exported for the frontend. `storyteller`, the opening delegation and `image-director` each repeat the relevant contract in self-contained prose because Agent prompts cannot depend on hidden TypeScript behavior.

## 3. Projection Rule

The card config adds a non-greedy complete-marker matcher with one capture group for the body. Its transforms are conceptually:

```json
{
  "content": "",
  "projections": {
    "illustrations": { "append": "$1", "trim": true }
  }
}
```

Exact config syntax follows the existing Reply Projection schema. No display transform is present. Every complete marker consumes one projection index, including an invalid body, which preserves a deterministic mapping between inline placement and `projections.illustrations[index]`.

An incomplete marker is outside the generic projector's complete-match contract. The UI removes it from settled/streaming display without changing persisted content.

## 4. Storyteller Prompt Contract

Formal output instructions and the opening delegation use the same schema and explain:

- at least one and at most three blocks are required;
- one block is the normal choice;
- two or three are reserved for distinct important visual beats;
- the block follows the paragraph it illustrates;
- refs name existing workspace records and do not embed their contents;
- brief fields describe subject, action, composition, environment and mood, not Provider syntax.

Prompt compliance is a generation goal, not a commit invariant. `publish_opening` and formal turn persistence remain fail-soft.

## 5. Image Director

### 5.1 Registration

`agent.json` registers a card Agent with explicit `workspace_read` and `generate_image`. `AGENT.md` defines its SOP. A separate fixed-style context file is injected through the established context path mechanism so art direction stays card-owned and versioned with the workspace.

### 5.2 Request and result

```ts
interface ImageDirectorRequestV1 {
  brief: IllustrationBriefV1
  prose: string
}

interface ImageDirectorResultV1 {
  schema: "tsian.image-director.result.v1"
  asset: {
    path: string
    mediaType: string
  }
}
```

The request deliberately excludes persistence identity. Host binds the invocation from `InvokeAgentOptions.generatedMediaTarget`; Agent code cannot downgrade, redirect or reproduce that authority.

### 5.3 SOP

1. Validate the closed request and refuse malformed input before Tool use.
2. Read the latest referenced scene and entities from save runtime.
3. Extract only trusted image paths from successfully read records; deduplicate and cap at four.
4. Compose one Provider-neutral prompt from clean prose, brief, current records and fixed style.
5. Choose one semantic aspect.
6. Call `generate_image` exactly once, with `sourceImagePaths` only when references exist.
7. Return the closed result from the Tool observation.

The Agent never writes workspace files. Missing refs are soft inputs; fabricated records, URLs, inline image data, mask and target arguments are forbidden.

## 6. Entrypoint

`imageGeneration` is an optional protocol-versioned capability rather than a Provider or UI-specific setting:

```json
{
  "imageGeneration": {
    "agentId": "image-director",
    "protocol": "tsian.image-director.v1"
  }
}
```

All manifest normalizers treat it as a closed object. The frontend caches it at initialization and only activates cards for exact v1. This supports future card-owned directors without a one-tool-one-setting registry.

## 7. Opening Integration

The current `开局建模` skill remains the orchestrator. Its final storyteller delegation asks for opening prose, inline illustration blocks and choices. `publish_opening` receives the complete reply and runs the same configured projection used by formal turns. No opening-specific parser or publication code is introduced.

## 8. Packaging

Protocol implementation changes only workspace source, shared entrypoint/validator contracts and the actual card manifest. Existing packaging commands rebuild inventory and later merge UI dist. Exporter behavior and harness construction are already delivered and remain untouched.

## 9. Failure Model

- Prompt violation: publish story; affected or missing illustration is unavailable.
- Invalid brief: hide marker and render bounded fallback when possible.
- Missing entrypoint: all briefs are noninteractive.
- Missing scene/entity: continue with safe remaining context or fail this image.
- Tool/Provider failure: return current invocation failure; story and other cards remain unaffected.
- Host target stale: Host rejects commit; Agent cannot redirect it.
