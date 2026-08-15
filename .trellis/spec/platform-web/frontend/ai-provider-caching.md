# AI Provider Caching

## Scenario: Claude Top-Level Automatic Prompt Cache

### 1. Scope / Trigger

- Trigger: changing Claude model parameters, persisted provider normalization, Claude request construction, either model-settings surface, or cache-usage diagnostics.

### 2. Signatures

```ts
interface BrowserClaudeModelParameters {
  promptCachingEnabled: boolean
  // other Claude parameters omitted
}

type ClaudeAutomaticCacheControl = {
  type: "ephemeral"
}
```

Enabled requests carry `cache_control: ClaudeAutomaticCacheControl` at the Messages API body top level.

### 3. Contracts

- New Claude model parameters default `promptCachingEnabled` to `true`. Persisted parameters missing the field normalize to `true`; only explicit boolean `false` disables platform injection.
- `buildClaudeRequestBody` is the single injection boundary for text, native, streaming, and non-streaming calls. Do not copy cache logic into individual adapter methods.
- Enabled requests add `cache_control: { type: "ephemeral" }` before the existing custom-parameter merge, so the typed model setting owns that field when enabled. Disabled requests add nothing; an advanced custom JSON value may still provide its own `cache_control` under the existing merge contract.
- An incompatible Claude-style endpoint fails normally. Do not retry automatically without caching: a hidden second request can add cost, latency, and Tool side effects. The model-level switch is the recovery path.
- Keep explicit tools/system/message-block cache breakpoints, TTL selection, model capability tables, and endpoint probing out of this automatic switch until provider-reported usage demonstrates a need.
- Cache observability remains provider-reported: Claude `cache_read_input_tokens` maps to `cached` and `cache_creation_input_tokens` maps to `cacheCreation`; never infer either from local message size.

### 4. Validation & Error Matrix

| Configuration / provider result | Required behavior |
|---|---|
| New config or persisted field missing | Normalize enabled; send top-level ephemeral cache control |
| Explicit `promptCachingEnabled: true` | Send top-level ephemeral cache control on every Claude call style |
| Explicit `false`, no custom cache field | Omit platform-generated `cache_control` |
| Explicit `false`, custom JSON supplies cache field | Preserve the advanced custom field under normal custom merge behavior |
| Endpoint rejects cache control | Surface the provider error; user may disable; no cache-disabled retry |
| Provider omits cache usage | Keep usage cache fields undefined and display no cache data |
| Non-Claude provider | No request or configuration behavior change |

### 5. Good / Base / Bad Cases

- Good: a modern Claude model reuses a growing stable conversation prefix, with the first eligible call reporting cache creation and later calls reporting cache reads.
- Base: a Claude-compatible proxy does not support the top-level field; disabling the model switch restores the previous platform-generated body shape.
- Bad: add cache markers independently in text/native/stream builders, infer a hit from unchanged local text, or silently replay a rejected Tool call without caching.

### 6. Verification Required

- Run `npm run build:web` and `npm run test:smoke:web`.
- Verify default/missing/explicit-false normalization and inspect final text, native, and stream request bodies at the provider boundary.
- Verify both desktop and Spatial settings read and update the same model parameter.
- When a live endpoint and a prompt above its minimum cache threshold are available, confirm cache creation followed by cache read in unified diagnostics.
- Follow the repository smoke-only policy: use manual or temporary boundary probes for this matrix; do not retain a provider unit-test file unless it is explicitly admitted to `test:smoke`.

### 7. Wrong vs Correct

#### Wrong

```ts
// Per-call duplication drifts and can miss text or streaming paths.
if (config.kind === "claude") body.cache_control = { type: "ephemeral" }
```

#### Correct

```ts
// The shared Claude builder covers every Claude request style.
if (provider.promptCachingEnabled) {
  body.cache_control = { type: "ephemeral" }
}
```
