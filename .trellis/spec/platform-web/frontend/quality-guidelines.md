# Quality Guidelines

Quality for `platform-web` is mostly type safety, build success, and preserving cross-layer runtime contracts.

## Required Checks

- Run `npm run build:web` after any change under `apps/platform-web`.
- Run `npm run build:contracts` if a change imports or modifies contract shapes.
- **`build:web` passing does NOT mean the frontend-build runtime loop works.** The esbuild-wasm build engine (`src/frontend-build/`) has three runtime-only traps that `vue-tsc` + `vite build` cannot catch — they only surface when a real build runs in the browser:
  - **esbuild plugin objects may only carry `name` + `setup`.** Attaching extra fields (e.g. a `result` handle for post-build reads) throws `Invalid option on plugin "<name>": "<field>"` at runtime. A TS intersection type (`Plugin & { result }`) lies to tsc but esbuild rejects it. Return extra data as a sibling on a wrapper object (`{ plugin, result }`), not on the Plugin itself. See `cdn-external-plugin.ts`.
  - **`esbuild.initialize` is "call exactly once" per page lifetime.** esbuild-wasm guards it internally (`Cannot call "initialize" more than once`) and reuses one long-lived service for all `esbuild.build` calls. Cache the init promise on `globalThis` (NOT a module-level variable — vite HMR reloads the module and resets module state, diverging from esbuild-wasm's surviving module state). Wrap `initialize` to swallow the "more than once" error (it means a service is already alive = success), and clear the cache only on genuine failure. See `engine.ts` `ensureEsbuildInitialized`.
  - **esbuild `outputFiles[i].path` may carry a leading slash** (`/assets/stdin.js`). Concatenating a prefix (`frontend/dist/` + `/assets/...`) yields a double slash (`frontend/dist//assets/...`). The storage layer normalizes it on write, but any in-memory `Set` of "newly written paths" holds the un-normalized form — a later stale-file cleanup that compares against normalized stored paths won't match and will delete the freshly-written files. Strip the leading slash before concatenating. See `write-back.ts`.
  - **Keep import query/hash text in `OnResolveResult.suffix`, not `path`.** For VFS imports such as `logo.png?url`, return `{ path: "logo.png", suffix: "?url" }`; `onLoad` receives the pair as `args.path` + `args.suffix`. If the query is concatenated into `path`, esbuild's file loader may emit a stored filename containing `?url` while the browser/SW requests only the pathname, producing a packaged-iframe 404; extension/MIME inference can also degrade (for example SVG inline data becoming `text/plain`). Vue virtual style loaders must inspect `args.suffix` as well, or `?tsian-style=N` falls through and the raw SFC is compiled a second time. See `workspace-source-plugin.ts` and `sfc-plugin.ts`.
  - **JS asset URL imports need module-relative URL normalization for packaged iframes.** esbuild's file loader returns strings relative to the importing JS output (for example `./badge-HASH.svg`). If a Vue component puts that raw string in DOM (`<img :src>`), the browser resolves it relative to `frontend/dist/index.html`, not the JS module, and requests `frontend/dist/badge-HASH.svg` instead of `frontend/dist/assets/badge-HASH.svg`. This applies both to explicit `?url` imports and to ordinary JS static imports of file-loader assets (`import logo from "./logo.png"`); route ordinary static asset imports through the same `?url` wrapper at resolve time. Wrap URL imports as a JS module that imports the file through an internal file-loader query, strips any internal query/hash from the generated string, then exports `new URL(cleanAssetUrl, import.meta.url).href`. Apply the same rule inside Worker subbuilds; do not leak internal queries such as `?__tsian_url_asset` to DOM/runtime URLs.
- After touching `src/frontend-build/`, run `npm run build:web` and manually validate the affected browser matrix. A parent with several related children should perform one consolidated source-package browser pass through upload → IndexedDB → browser esbuild-wasm → dist write-back → SW → packaged iframe. Do not create per-capability fixture suites by default.

## Test Maintenance Policy

The repository deliberately keeps its permanent automated suite smoke-only. Tests
protect a few end-to-end product transactions; the specs below preserve the
exhaustive behavior contracts without requiring one automated assertion per row.

- The only permanent ordinary test files are `src/bridge/remote-iframe-bridge.test.ts`,
  `src/integration/assistant-runtime.smoke.test.ts`, and
  `apps/platform-server/internal/server/market_test.go`.
- A reviewed task may create focused temporary tests for one-off bug diagnosis or
  implementation verification. Run each temporary test explicitly by exact path,
  keep it out of smoke scripts, do not enable repository-wide discovery for it,
  record the command/result, and remove it before the final commit.
- Each smoke owns one success and at most one critical failure/rollback scenario.
  Unit, component, controller, validator, storage/host/bridge-seam, pure-algorithm,
  and UI/Spatial tests are not retained independently.
- Permanent smoke tests remain small project-operability gates. They should not
  absorb one-off bug-specific assertions by default; permanent admission still
  requires a stable retained contract and the explicit scope/risk decision below.
- `Validation & Error Matrix` and `Verification Required` sections are
  implementation-review checklists. A row not sampled by a retained smoke is
  verified manually when its owning behavior changes; it does not authorize a new
  test file by itself.
- UI, accessibility, text, focus, layout, rendering, and Spatial behavior are
  user-verified manually. `npm run build:web` proves type/build integrity only.
- The production-browser Frontend Action preflight is a separate mandatory gate.
  Node, happy-dom, fake IndexedDB, and scripted Worker fixtures cannot replace its
  production bundle, real Worker, or opaque-origin checks.
- A new permanent automated file requires an explicit scope/risk decision and an
  explicit `test:smoke` entry. Prefer changing an existing smoke scenario when the
  stable contract still belongs to one of the three main transactions.
- Before committing each task, apply a retention-value gate to touched tests and
  obvious duplicates only. Permanent coverage must protect a stable product,
  core, safety, or data-integrity contract; remove one-off diagnostic and temporary
  implementation-probing cases. No removal is a valid outcome, and necessary
  coverage must never be deleted merely to reduce count.
- When a touched test fails after an intentional behavior change, do not
  mechanically update or delete it. First decide whether it exposes a real
  contract regression or an obsolete expectation; fix the regression, or retire
  the obsolete expectation only after that decision.
- Never change production behavior merely to preserve a retired assertion.

```ts
// Wrong: a harmless renderer refactor breaks an historical draw total.
expect(drawCounts).toEqual([6, meshCount, meshCount, meshCount, 6])

// Correct: protect the semantic contract that must survive refactors.
expect(report.passes).toEqual(expectedPassOrder)
expect(transparentDraws).toHaveLength(opaqueDraws.length - 1)
```

## Scenario: Repository Smoke-Only Verification Gate

### 1. Scope / Trigger

- Trigger: changing root verification scripts, adding/removing a test, changing one
  of the three retained transactions, or deciding how a spec matrix is verified.

### 2. Signatures

```text
npm test                  -> npm run test:smoke
npm run test:smoke:web    -> two explicit Vitest files
npm run test:smoke:server -> TestMarketSmoke only
npm run build:all         -> every JS workspace plus Go server
npm run verify            -> build:all + smoke + production-browser preflight
```

### 3. Contracts

- Test discovery is explicit; naming a new file `*.test.ts` or `*_test.go` is not
  sufficient to enter the authoritative gate.
- The Web transaction smokes use real orchestration and persistence boundaries.
  Only external HTTP, unavailable browser globals, and the Node-side Worker
  primitive may be deterministic fakes.
- The server smoke uses the production router, auth middleware, SQLite repository,
  and filesystem blob store.
- Builds and smoke tests do not claim UI behavior coverage. UI/Spatial acceptance
  remains manual.

### 4. Validation & Error Matrix

| Change | Required verification |
|---|---|
| Platform/contract/storage/runtime code | Relevant build(s), retained owning smoke when sampled, manual matrix review |
| Frontend Action Worker/schema/preflight | `test:frontend-actions:production-browser` in addition to builds/smoke |
| UI/Spatial/controller/presentation | `build:web` plus manual user verification; no dedicated automated suite |
| Server market/auth transaction | `test:smoke:server` plus `build:server` |
| New proposed permanent test file | Explicit user approval and explicit smoke-script admission |
| Reviewed task-scoped temporary test | Run explicitly by exact path, record result, remove before final commit |
| Behavior not sampled by a smoke | Manual verification or accepted later-discovery risk |

### 5. Good/Base/Bad Cases

- Good: use an explicitly run task-scoped temporary test for a one-off bug branch,
  record the result, and remove it before the final commit.
- Good: extend the Assistant smoke when a stable retained regression contract
  belongs to the same host/runtime/transaction/persistence path.
- Base: update a behavior matrix and verify it manually because no retained smoke
  owns that low-level branch.
- Bad: restore a validator/component/unit suite merely because its old file existed
  or because a matrix contains many rows.

### 6. Verification Required

- Run `npm run verify` for repository-wide verification changes.
- After removing any task-scoped temporary tests, confirm the permanent test
  inventory remains exactly the three approved files.
- Record any manual UI/Spatial verification separately; do not describe a build as
  UI behavior evidence.
- If the real-browser gate passes assertions but Windows profile cleanup reports a
  transient `EBUSY`, rerun the unchanged gate; do not replace it with a fake Worker.

### 7. Wrong vs Correct

#### Wrong

```json
{ "test": "vitest run" }
```

This silently admits every new matching file and recreates test accumulation.

#### Correct

```json
{ "test": "npm run test:smoke" }
```

The explicit smoke scripts remain the admission boundary.

## Browser `import.meta.glob` VFS Contract

### 1. Scope / Trigger

Use this contract when changing the `import.meta.glob` transform, workspace source loading, Vue SFC script compilation, or esbuild output materialization under `src/frontend-build/`.

### 2. Signatures

```ts
interface GlobTransformInput {
  code: string
  importer: string
  loader: "js" | "jsx" | "ts" | "tsx"
  sources: Map<string, string | Uint8Array>
}

interface GlobTransformResult {
  code: string
  changed: boolean
}
```

### 3. Contracts

- Keep the parser/matcher behind a source-text gate plus memoized literal dynamic import; plain source must return unchanged without loading the transform chunk.
- Transform all three source boundaries: stdin entry, workspace JS/TS/JSX modules, and Vue `<script>` / `<script setup>` blocks before `compileScript`.
- Enumerate only canonical `sources` Map keys. Patterns are POSIX, case-sensitive, root-bound, and may start only with `./`, `../`, or `@/`.
- Generated import specifiers remain relative so existing workspace resolution stays authoritative.
- Lazy glob chunks also carry metafile `entryPoint`; HTML entry selection must match the exact root identity `frontend/src/${entryPath}`, never the first truthy entry point.

### 4. Validation & Error Matrix

| Condition | Required result |
|---|---|
| No glob macro | Return unchanged; do not request transform chunk |
| Dynamic/interpolated/array pattern | Build-time error with importer and location |
| Root escape, scheme, absolute, query/hash, encoded separator | Build-time error |
| Unknown/computed/spread/non-boolean option | Build-time error |
| Non-direct `import.meta.glob` access | Build-time error |
| Empty match | Successful `{}` result |
| Multiple metafile entry points | Select exact root; zero/multiple root matches fail loudly |

### 5. Good / Base / Bad Cases

- Good: `import.meta.glob("./pages/*.ts")` generates sorted dynamic imports from the Map and esbuild emits split chunks.
- Base: an ordinary TypeScript module bypasses parser/matcher loading.
- Bad: `import.meta.glob(pattern)`, `import.meta["glob"]`, or `../../outside/*.ts` fails during build rather than in the iframe.

### 6. Verification Required

- Run `npm run build:web`.
- Manually exercise the source-package browser build for the changed glob cases,
  including lazy chunks, Vue blocks, assets, and root-entry selection.
- Treat the error matrix above as review/manual verification inventory; do not add
  a dedicated transform test file by default.

### 7. Wrong vs Correct

```ts
// Wrong: dynamic chunks can be mistaken for the HTML root entry.
const entry = Object.entries(metafile.outputs).find(([, output]) => output.entryPoint)

// Correct: pass and match the exact stdin root identity.
const entryPoint = `frontend/src/${sourceEntryPath}`
const entry = Object.entries(metafile.outputs)
  .filter(([, output]) => output.entryPoint === entryPoint)
```

## Browser Worker Subbuild Contract

### 1. Scope / Trigger

Use this contract when changing `?worker` imports, Worker subbuild orchestration, frontend-build output materialization, packaged frontend dist replacement, or Worker-related diagnostics under `src/frontend-build/`.

### 2. Signatures

```ts
// Main source syntax: the only supported Worker entry form.
import WorkerCtor from "./path/to/worker?worker"

const worker = new WorkerCtor(options?: WorkerOptions)
```

```ts
interface FrontendBuildContext {
  sources: Map<string, string | Uint8Array>
  workerEntries: Map<string, QueuedWorkerEntry>
}

interface WorkerBuildResult {
  entryPath: string
  key: string
  entryOutputPath: string
  outputFiles: OutputFile[]
  metafile: Metafile
}

interface ReplaceLocalGameCardFrontendDistInput {
  files: PutLocalGameCardFrontendFileInput[]
  keepPaths: Set<string>
}
```

### 3. Contracts

- `?worker` imports are accepted only as ordinary static ESM default imports from relative or `@/` VFS paths. The query must be exactly `?worker`; no duplicate keys, values, `&url`, `&inline`, `?sharedworker`, re-export, type import, import attributes, dynamic import, or CommonJS `require`.
- Generated constructors may accept `WorkerOptions`, but must always force `{ type: "module" }`. Do not add classic Worker mode without a new task.
- Worker entry builds are queued during the main esbuild build and executed after the main build succeeds. Do not call nested `esbuild.build()` from plugin callbacks.
- Same canonical Worker entry dedupes to one subbuild; different entries build independently and do not share chunks in v1.
- Worker output paths live under `assets/workers/<stable-key>/` with `entry.js`, `chunks/[name]-[hash]`, and `assets/[name]-[hash]`. The constructor URL must resolve from the packaged iframe document/dist root, e.g. `new URL("./assets/workers/<key>/entry.js", window.location.href)`, not from a fragile current module path.
- Worker graph allowed inputs: JS/TS/JSX/TSX, JSON, `?raw`, `?url`, `?inline`, relative/`@/` VFS imports, dynamic import chunks, file-loader assets, and existing `import.meta.glob` transform. Worker `?url` follows the same module-relative URL normalization as main graph `?url`: export `new URL(cleanAssetUrl, import.meta.url).href`, not the raw file-loader string.
- Worker graph forbidden inputs: Vue SFC, CSS/Sass/Less, bare package imports, CDN/URL imports, nested `?worker` / `?sharedworker`, and direct `new Worker(...)` / `new SharedWorker(...)`.
- Direct Worker constructors are forbidden across executable source boundaries: stdin entry, workspace JS/TS/JSX/TSX modules, Vue `<script>` / `<script setup>`, and Worker child graph modules.
- Write-back must replace `frontend/dist/**` using a full successful output set: main outputs + Worker outputs + generated `index.html`. If any main or Worker build fails, do not call dist replacement; old dist remains mounted.
- `replaceLocalGameCardFrontendDist()` may only write `frontend/dist/**` paths and should preserve `createdAt`, write new records, delete stale dist records, and update card `updatedAt` in one transaction.

### 4. Validation & Error Matrix

| Condition | Required result |
|---|---|
| `import W from "./w?worker"` | Build succeeds; wrapper exports constructor; Worker entry is queued and subbuilt |
| Duplicate imports of same canonical entry | One Worker subbuild/output set is reused |
| `?worker=1`, duplicated `worker`, `?worker&url`, `?worker&inline`, `?sharedworker` | Build-time error |
| non-default import, re-export, type import, import attributes, dynamic import, CJS require | Build-time error |
| direct `new Worker(...)` / `new SharedWorker(...)` in entry/workspace/Vue/Worker code | Build-time error pointing to `?worker` constructor syntax |
| Worker imports Vue/CSS/Sass/Less | Build-time error |
| Worker imports bare package, `http(s):`, `data:`, or other URL/scheme | Build-time error explaining main import map does not apply to Worker |
| Worker imports unknown extension without explicit query | Build-time error; do not fall through to text loader |
| Worker imports unknown non-style extension with `?raw` / `?url` / `?inline` | Allowed through the explicit query loader |
| Worker subbuild emits CSS output | Invariant failure before write-back |
| Worker subbuild fails | Old `frontend/dist/**` remains; build status records failure |

### 5. Good / Base / Bad Cases

- Good: `import DemoWorker from "./workers/demo.worker.ts?worker"; new DemoWorker({ name: "demo" })` creates a module Worker whose entry/chunks/assets are served from `frontend/dist/assets/workers/**`.
- Base: a normal source build without `?worker` queues no Worker entries and does not run Worker subbuilds.
- Bad: `new Worker(new URL("./worker.ts", import.meta.url), { type: "module" })` must fail during build rather than becoming a packaged-iframe 404.
- Bad: `import textUrl from "./template.txt?url"` is valid inside a Worker, but `import text from "./template.txt"` must fail because unknown unqueried resources are not part of the Worker graph contract.

### 6. Verification Required

- `npm run build:web` for any `src/frontend-build/**` or packaged-dist storage helper change.
- `git diff --check`.
- Manually verify the supported/forbidden Worker matrix, dist replacement, and a
  packaged iframe Worker round-trip with Network evidence when this subsystem changes.
- Do not create a dedicated Worker unit/fixture suite; the production-browser
  Frontend Action preflight remains the repository's real-Worker automated gate.

### 7. Wrong vs Correct

```ts
// Wrong: bypasses VFS subbuild/materialization and may fail only in iframe runtime.
const worker = new Worker(new URL("./workers/demo.worker.ts", import.meta.url), { type: "module" })

// Correct: lets the platform build Worker outputs into frontend/dist/**.
import DemoWorker from "./workers/demo.worker.ts?worker"
const worker = new DemoWorker({ name: "demo" })
```

```ts
// Wrong: Worker module graph cannot use the page's HTML import map.
import { reactive } from "vue"

// Correct: Worker graph stays within VFS/source/resource imports supported by the platform builder.
import { compute } from "./compute"
import payload from "./payload.json"
```

## Browser Style Preprocessor Contract

### 1. Scope / Trigger

Use this contract when changing Sass, Less, or another browser-side style preprocessor under `src/frontend-build/`.

### 2. Signatures

```ts
type StylePreprocessorLanguage = "scss" | "sass" | "less"
interface StylePreprocessorInput {
  language: StylePreprocessorLanguage
  source: string
  filename: string
  sources: Map<string, string | Uint8Array>
}
interface StylePreprocessorResult {
  css: string
  dependencies: string[]
  sourceMap?: unknown
}
```

### 3. Contracts

- Use literal, memoized dynamic imports: `import("sass")` and pinned `import("less/lib/less/index.js")`.
- Dart Sass production builds require name preservation; keep Vite `esbuild.keepNames: true` unless a browser probe proves an equivalent replacement.
- Less uses its pinned core factory and Map FileManager. Do not use its package-root bootstrap or `window.less` / `window.LESS_PLUGINS`.
- Strictly bind imports to `frontend/src/`; reject root escape, schemes/authority, query/hash, backslashes, NUL, and encoded separator/control forms.
- Order: preprocessor → Vue scoped rewrite → esbuild `css`/`local-css`.
- `?raw`, `?url`, and `?inline` bypass preprocessing.

### 4. Validation & Error Matrix

| Condition | Required result |
|---|---|
| Missing/ambiguous import | Fail with language, entry, and requested import |
| Binary style source | Fail; never decode as text |
| Root escape/invalid URL | Fail even for Less `(optional)` |
| Less JavaScript/`@plugin` | Fail without execution |
| Plain CSS/Vue | Request neither compiler |
| Sass or Less | Request only its own compiler |

### 5. Good / Base / Bad Cases

- Good: SCSS `@use` resolves a Map-backed partial and reports its canonical dependency.
- Base: plain CSS bypasses the dispatcher.
- Bad: `../../secret`, `pkg:theme`, a binary partial, or a Less plugin fails loudly.

### 6. Verification Required

- Run `npm run build:web` and `git diff --check`.
- Manually run the real source-package browser loop for styles/modules/assets,
  diagnostics, lazy isolation, warm reuse, and old-dist preservation.
- On compiler upgrades, manually repeat Sass/Less factory, global, and DOM safety
  probes; do not add a dedicated preprocessor test file by default.

### 7. Wrong vs Correct

```ts
// Wrong: ambient browser bootstrap.
const less = await import("less")

// Correct: pinned core factory with explicit VFS environment.
const { default: createLess } = await import("less/lib/less/index.js")
```


## Project Rules

- Prefer fail loud over hidden fallback for writes and runtime mutations.
- Do not expand scope opportunistically.
- Do not add migrations or compatibility layers for local IndexedDB without explicit approval.
- Keep bridge APIs framework-neutral.

## Review Checklist

- If runtime turn flow or turn-number derivation changes, verify storage, bridge, DebugView, and remote/packaged frontend contracts still agree.
- If query resources change, verify platform-host and remote/packaged bridge consumers use the same resource names.
- If `interaction.sendMessage` changes, verify failure rollback does not persist partial messages.
- If Dexie tables change, use a new database name unless a task explicitly chooses migration.

## Avoid

- Do not add broad catch blocks around Agent Runtime turns just to keep UI quiet.
- Do not create duplicate storage helpers for the same table.
- Do not restore retired workflow/prompt/event/archive surfaces as incidental dependencies.

## Known Tech Debt

- **Workspace search helpers live only in `agent-runtime/workspace-operations.ts`.** An earlier storage-side copy (`searchWorkspaceFilesForSave` / `searchWorkspaceFilesFromFiles` plus duplicated `createPreview` / `normalizeLimit` / `fileName` in `storage/workspace.ts`) was dead code with zero callers — UI search routes through `searchPlatformWorkspace` → `executeWorkspaceOperation` (agent-runtime), not the storage copy. The dead storage copy was deleted; the shared helpers were NOT extracted into a separate module because agent-runtime is now the only live caller, so an abstraction layer would have no second consumer. If a second consumer appears, extract `createPreview` / `normalizeSearchLimit` / `fileName` into `apps/platform-web/src/lib/workspace-search.ts` (or similar) rather than copying them again.
- **Workspace path normalization lives in `lib/workspace-path.ts`.** Three byte-identical `normalizePathBase` copies once lived in `storage/workspace.ts`, `agent-runtime/workspace-operations.ts`, and `agent-runtime/workspace-tools.ts`; they differed only in which domain error type they threw (`WorkspaceStorageError` / `workspaceOperationError` / `toolError`). They were collapsed into `apps/platform-web/src/lib/workspace-path.ts`, which returns a discriminated `NormalizePathResult` (no throw) so each call site wraps failures in its own error type — the core stays free of those dependencies and free of import cycles. The core also accepts `.` and `..` relative segments (the runtime workspace is root-bound, so `..` clamps at the root and cannot escape); see [AI-Facing Content Changes](../../guides/ai-facing-content-changes.md) for why accepting `.` matches model training conventions. Two other path validators stay strict and are **not** routed through the shared core: `agent-runtime/context.ts` (authored-config paths, returns `null` for `.`/`..` because an authoring typo should surface, not silently clamp) and the `MEMORY_MAINTENANCE_SCRIPT_JS` embedded `normalizePath` (a skill-sandbox string literal with its own target allowlist). When adding a fourth path-normalizing call site, route it through `lib/workspace-path.ts` rather than copying the algorithm again.

## Agent Runtime Message Cache Contract

When changing Agent Runtime turn composition or AI debug records, preserve cache-friendly message layering:

- Keep stable system/Agent identity text first, then the cross-turn-stable history (already-occurred narrative turns, byte-stable), then workspace context, then dynamic turn data (`current turn`, user input, agent_call request, tool observations). Do not place workspace context before history, or its change shifts the cache breakpoint forward and makes all following history miss. Within workspace context, `buildAgentContextMessages_split` (task `06-30-workspace-context-cache-split`) splits it into a meta message (header/skillIndex/notes/missingPaths, semi-stable) plus one message per `contextFile`. Each file is its own cache boundary: a stable file (docs/README) that doesn't change across turns hits the prefix cache; a dynamic file (`runtime.json`/brief) misses only its own message and does not drag stable files down with it. No cross-turn state is needed — splitting itself is the full lever; the provider caches unchanged bytes automatically. Keep the `contextPaths` declaration order (do not reorder stable files ahead of dynamic ones) — real declarations already put docs first and state last, and provider prefix cache matches on tokens not message boundaries, so reordering has no extra benefit but breaks agent authors' context organization.
- Do not concatenate dynamic turn numbers with stable workspace context in the same message; a changing prefix inside one message prevents provider-side prefix cache reuse for the rest of that message.
- Native function-calling prompts should keep only short tool-use principles. Put concrete parameters in the `tools` schema, and avoid dynamic examples such as a concrete contact Agent id in the system prompt.
- Text Tool Protocol mode is a peer tool-call mode for ordinary chat-text APIs. Its prompt-visible manifest comes from the same `ToolSchema[]` source used by native mode, and every model-facing instruction requires an explicitly closed block using the one positive template `<tsian-tool-calls>[{"name":"TOOL_NAME","arguments":{}}]</tsian-tool-calls>`; message end is never presented as closure. The parser may silently accept a sole unclosed opening tag only when the full remaining response is a complete valid call array, and this fallback stays invisible to the model. After execution, inject one runtime-owned `user` report with `<tsian-executed-tools>` plus id-aligned `<tsian-tool-observations>` (and any image parts); never generate assistant `<tsian-tool-call-records>` history. Executed/observation/error tags, model-native `<tool_call>`, and legacy `<tsian-tool-call>` / call-records are non-executable: a fresh model echo enters the code-specific protocol correction path. Within one episode, each error code independently allows three correction calls after its first failure; switching codes neither consumes nor resets another code's allowance, a valid tool-call round clears all code counts, and provider context retains only the latest correction message.
- Raw Tool execution results are execution-local. Each Tool producer owns its bounded Agent delivery (page, summary, ID/path, or honest narrowing); the shared acceptance gate may only accept the strict-JSON result unchanged or return `TOOL_OBSERVATION_INVALID` / `TOOL_OBSERVATION_TOO_LARGE`. Never restore a generic preview/truncation projector, and never add an Environment-specific observation budget knob.
- Current-loop Tool result refs are equally execution-local: only an accepted successful `agent_call.response` may register a Provider-independent string ref in that loop's session state, and only `run_script.inputRefs` may resolve it into top-level action input before schema/policy/savepoint execution. Do not persist refs or registry values, expose them to browser scripts/UI, or generalize them into recursive paths or cross-turn artifacts.
- Native and Text Tool Protocol consume the same accepted observation; text mode must not compact it again. Text task compression treats each single-message execution report as one atomic round, aligns calls/results by runtime id, and preserves native-equivalent recent-round/unresolved-failure retention without relying on message role. Cross-turn `AgentContextSnapshot.toolMemories` may independently summarize accepted observations for retention. Conversation messages persist only prose, attachments, and presentation-only process timeline nodes; UI timelines must never receive ordinary raw output or become model-history sources.
- OpenAI Responses provider is still a **local stateless replay** provider in Tsian: build `input` from local messages plus replayed `function_call` / `function_call_output` items, default `store: false`, and do not use `previous_response_id` unless a future task designs the server-side response-id lifecycle, checkpoint rollback behavior, and debug visibility. The `NativeToolCall.id` for Responses is the provider `call_id` (not the output item `id`) because tool observations must be returned as `function_call_output.call_id`.
- Keep narrative/formal-player-turn and task/assistant compression thresholds separate. Narrative can trigger near the context budget, but task/assistant should trigger earlier because tool exploration is dynamic and cache-hostile.
- Unified diagnostic request messages preserve the provider-boundary request shape but are never fed back into a later provider call as extra metadata.
- `DiagnosticAiRequestRecord.response.usage` carries provider-reported cache usage (`cached` / `cacheCreation`) extracted per-provider by `extractUsageFromPayload` (OpenAI Chat Completions `prompt_tokens_details.cached_tokens`, OpenAI Responses `input_tokens_details.cached_tokens`, DeepSeek `prompt_cache_hit_tokens`, Claude `cache_read_input_tokens`/`cache_creation_input_tokens`, Gemini `usageMetadata.cachedContentTokenCount`). DebugView derives the real `cached/input` hit rate from unified summaries; do not reintroduce local char-based cache estimation.
- Claude top-level automatic-cache behavior is specified in [AI Provider Caching](./ai-provider-caching.md); keep its default-on normalization, shared request-builder boundary, compatibility switch, and provider-reported diagnostics aligned.

## AI Runtime Request Retry Contract

When changing `src/runtime-host/ai/*`, keep AI API retries in the runtime-host request layer, not in the Agent Runtime tool loop. The four shared entry points (`generateAssistantReply`, `generateAssistantReplyNative`, `streamAssistantReplyText`, `streamAssistantReplyNative`) are the coverage boundary for player turns, desktop assistant, `interaction.invokeAgent`, and delegated `agent_call` calls.

- Initial request is attempt 1, not a retry. Defaults are 3 retries after failure (4 total attempts) with increasing backoff around `800ms -> 1600ms -> 3200ms` plus small jitter.
- Retry only transient transport failures: browser fetch/network failure, request-layer timeout, and HTTP `408`, `429`, `500`, `502`, `503`, `504`. Do not retry user/parent aborts, HTTP `400`/`401`/`403`, or deterministic provider request/schema/tool errors.
- Streaming calls may retry only before any UI-visible content/reasoning delta is emitted. After the first delta, fail the stream rather than replaying and duplicating text or desynchronizing tool-loop context.
- Retry sleeps and every request attempt must respect the caller `AbortSignal`; delegated `agent_call` timeout elapsed time must include retry delay.
- Preserve one logical `DiagnosticAiRequestRecord` per model call. Keep every network retry in that record's `attempts[]`; do not create extra records or rely on console output for retry diagnostics.
