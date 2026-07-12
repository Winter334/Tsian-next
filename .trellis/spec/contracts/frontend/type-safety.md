# Type Safety

Frontend/browser consumers should use shared contract types instead of redefining bridge payloads locally.

## Current Shared Shapes

- `ConversationMessageRecord` and `SessionHistoryEntry` describe frontend-readable session state (turn history rebuilt from workspace turn files).
- `WorkspaceFile`, `WorkspaceEntry`, `WorkspaceSearchResult`, `WorkspaceScope`, `WorkspaceOperationName`, `WorkspaceOperationRequest`, `WorkspaceDiffResult`, `WorkspacePatchResult`, `WorkspaceMoveResult`, `WorkspaceDeleteResult`, and `WorkspaceValidationResult` describe generic Runtime Workspace files, scoped operation requests, and operation results.
- `MessageInteractionRequest` is `{ content: string; injection?: InjectionMessage[] }`. `InvokeAgentRequest` is `{ agentId: string; input: string; invocationId?: string; purpose?: string; injection?: InjectionMessage[]; contextSlot?: string; persist?: boolean }`, and `InvokeAgentResult` is `{ invocationId: string; response: string }`. `AgentInvocationEvent` is the discriminated event union for `invokeAgent` streaming (`started` / `delta` / `round-end` / `tool` / `completed` / `failed`). `InjectionMessage` carries `role` (system/user/assistant), `content`, and optional `position` (before-input/after-input, per-message). Injection is per-turn only — not persisted to turn history or context.json snapshots; the platform inserts it by role+position without interpreting semantics. `contextSlot` isolates invokeAgent context into `context-<slot>.json` (omitted → default `context.json`); `persist` controls whether the context file is read/written (`true` = read+writeback, `false`/omitted = one-shot, no read/write). Both are optional and default to one-shot behavior. `invocationId` may be supplied by the frontend so it can filter events before the Promise resolves; SDK/platform generate one when omitted. `purpose` is a caller-defined label for filtering, logs, and UI state, not behavior routing.
- `DeepQueryRequest` / `DeepQueryResult<T>` wrap bridge query resources.
- `PlatformActionRequest` / `PlatformActionResult<T>` wrap platform actions.
- `RemotePlayBridge*` types describe the serializable `tsian.play-bridge.v1` postMessage protocol used by remote iframe frontends.
- `AiDebugRecord` and `CheckpointSummary` support debug/checkpoint views.
- `GameCardManifest`, `GameCardFrontendBinding`, `GameCardPackageManifest`, `GameCardPackageFileEntry`, and `GameCardContentFile` describe reusable game cards, package files, frontend bindings, and card-owned content files. `GameCardWorkspaceTemplateFile` is a compatibility alias for `GameCardContentFile`. `GameCardManifest.summary` is the single Game Card intro field; there is no parallel Game Card `description` field. `GameCardManifest.frontend` is optional; when present, frontend bindings are remote or packaged only. `GameCardManifest.runtime.entrypoints.playerTurn` is the optional manifest-owned Agent id used by `send` / `interaction.sendMessage` formal player turns; platform runtime must fail loud when a playable card/save lacks a non-empty player-turn entrypoint instead of silently falling back to a hardcoded Agent id.
- `AgentConfig`, `AgentSkillConfig`, `AgentPlatformToolConfig`, `AgentWorkspaceAccessConfig`, and `AgentPlatformToolName` describe the machine-readable `agents/<agent>/agent.json` Agent configuration used by Studio and Agent Runtime.
- `AgentRegistryEntry` describes lightweight `agents/<agent>/agent.json` index entries. `configPath` points to `agent.json`, `path` points to the required SOP `AGENT.md`, and entries include Skill enablement plus `platformTools` / `workspaceAccess` for runtime permission derivation. `defaultSkills` remains in the shared shape only as compatibility input.
- `AgentContextEntry` describes one assembled Agent context bundle for `agent-context`, including `agentFile`, optional `soulFile`, save runtime notes/session files, filtered Skill Index, declared context files, and missing context paths.
- `SkillRegistryEntry` describes lightweight shared or agent-local `SKILL.md` index entries. Use `name` / `description` for model-facing Skill identity and keep `id` / `summary` / `path` for compatibility and bridge/UI/debug consumers.
- `SkillDetailEntry` describes a loaded `SKILL.md` plus resource index for `skill-detail`.
- `SkillResourceEntry` describes a bundled skill resource file without its content.
- `RuntimeDiagnosticSummary`, `RuntimeDiagnosticFact`, `RuntimeDiagnosticHealth`, and `RuntimeDiagnosticsQueryParams` describe compact Agent-facing diagnostics returned by `runtime-diagnostics`.

## Bridge Consumption

- Play frontends call `bridge.interaction.sendMessage({ content })` to submit player input.
- Play frontends read data through `bridge.query.query(...)`, in particular `session-history` for turn-by-turn dialogue history and turn number.
- Play frontends use `bridge.platform.runAction(...)` for allowed platform actions such as `restore-checkpoint`.
- `bridge.debug?.onTurnDebugReady(cb)` is a signal to refresh data, not the source of truth.
- Remote iframe frontends use `RemotePlayBridgeMessage` envelopes over `postMessage`; they must expect explicit `{ ok: true, result }` / `{ ok: false, error }` responses instead of thrown exceptions crossing the frame boundary.
- The default remote iframe bridge exposes `interaction.sendMessage`, `interaction.invokeAgent`, `query.query`, `platform.getPlatformContext`, and `platform.runAction`; it does not expose the `debug` namespace and must not expose `query.query({ resource: "ai-debug" })`.
- Use `AgentRegistryEntry` for `bridge.query.query({ resource: "agent-registry" })` results.
- Use `AgentContextEntry` for `bridge.query.query({ resource: "agent-context", params: { agentId } })` results.
- Use `SkillRegistryEntry` for `bridge.query.query({ resource: "skill-registry" })` results. Prefer `name` and `description` when presenting skills to an Agent; use `path` only for platform/debug queries such as `skill-detail`.
- Use `SkillDetailEntry` for `bridge.query.query({ resource: "skill-detail", params: { path } })` results.
- Use `RuntimeDiagnosticSummary` for `bridge.query.query({ resource: "runtime-diagnostics", params })` results. Diagnostics are facts-only summaries, not raw trace lines or repair instructions.

## Scenario: invokeAgent AgentInvocation Contract

### 1. Scope / Trigger

- Trigger: changing `InvokeAgentRequest`, `InvokeAgentResult`, `AgentInvocationEvent`, remote bridge event payloads, or frontend SDK handling for `invokeAgent` streaming.

### 2. Signatures

- `MessageInteractionRequest`: `{ content: string; injection?: InjectionMessage[] }` — player-turn entry.
- `InvokeAgentRequest`: `{ agentId: string; input: string; invocationId?: string; purpose?: string; injection?: InjectionMessage[]; contextSlot?: string; persist?: boolean }` — frontend/card-flow-selected Agent invocation.
- `InvokeAgentResult`: `{ invocationId: string; response: string }` — final text plus the id used by streamed events.
- `AgentInvocationEvent`: discriminated union with `type` = `started | delta | round-end | tool | completed | failed`.
- Remote bridge event name: `agent-invocation`; payload is `AgentInvocationEvent`.

### 3. Contracts

- Public SDK keeps both semantic entries: `send` for formal player turns; `invokeAgent` for explicitly targeting an Agent from frontend/card flow.
- `send` and `invokeAgent` may share internal runtime infrastructure, but consumers must not treat `invokeAgent` as a formal turn: it does not append player history or produce `turn-completed`.
- `invocationId` is optional in the request but required in the result and every `AgentInvocationEvent`; SDK should generate one before sending when omitted.
- `purpose` is a caller label for UI/log filtering only; platform behavior must not depend on parsing particular purpose strings.
- `agent_call` is not a SDK entry. It is an Agent-internal tool; delegated Agent events produced during an `invokeAgent` call use the same `invocationId` and their own `agentId`.

### 4. Validation & Error Matrix

- Missing/blank `agentId` -> bridge validation error before runtime invocation.
- Non-string `input` -> bridge validation error before runtime invocation.
- Missing `invocationId` -> SDK/platform generates one; this is not an error.
- Runtime failure -> `agent-invocation` emits `{ type: "failed", invocationId, agentId, error }` with JSON-compatible error payload, then the Promise rejects.
- Successful invocation -> emits `completed` and resolves `{ invocationId, response }`.

### 5. Good/Base/Bad Cases

- Good: frontend creates `invocationId`, subscribes to `onAgentInvocation`, filters events by id, calls `invokeAgent`, renders deltas, then reconciles with final `response`.
- Base: frontend omits `invocationId`; SDK generates one and returns it in `InvokeAgentResult`.
- Bad: frontend listens to `turn-delta` for `invokeAgent` content, or assumes `invokeAgent` fires `turn-completed`.

### 6. Tests Required

- Run `npm run build:contracts` after contract changes.
- Run the consuming frontend build (`npm run build:web`) when platform-web/play-bridge consumes the changed types.
- Verify at least one `invokeAgent` path can receive `delta` and `completed` events with a matching `invocationId`, while `send` still uses turn events.

### 7. Wrong vs Correct

#### Wrong

```ts
const { response } = await tsian.invokeAgent("stage-manager", prompt)
// No way to associate streaming events before the Promise resolves.
```

#### Correct

```ts
const invocationId = crypto.randomUUID()
const off = tsian.onAgentInvocation((event) => {
  if (event.invocationId !== invocationId) return
  // render event.delta / event.tool / event.completed
})
try {
  const result = await tsian.invokeAgent("stage-manager", prompt, { invocationId })
  renderFinal(result.response)
} finally {
  off()
}
```


## Scenario: play-frontend Workspace Data Consumption

### 1. Scope / Trigger

- Trigger: a play frontend (`apps/play-frontend-dev/**` or any packaged/remote game card frontend) reading `save/playthrough/runtime.json`, `save/entities/<type>/<localId>.json`, or `save/scenes/<localId>.json` for UI rendering.

### 2. Signatures

- `tsian.workspace.read(path: string, scope?: WorkspaceScope): Promise<WorkspaceReadResult | null>` — the only sanctioned read exit. `WorkspaceReadResult.content` is a **string** and must be `JSON.parse`d by the consumer.
- `WorkspaceScope` for save-scoped runtime data is `"save-runtime"` (covers `save/**`). Pass it explicitly; do not rely on path-prefix inference.

### 3. Contracts

- Read result is `null` when the path does not exist (e.g. fresh save before any runtime write). This is **not** an error — treat it as `"not-found"` and let the UI decide whether to render empty or hide.
- `JSON.parse` may throw on corrupted/partial writes. Catch it locally and surface as `"load-failed"`, not as a thrown exception — play frontends must never crash the游玩面 because of a malformed workspace file.
- Bridge/RPC `read` rejections (platform/bridge errors) follow the same pattern: catch, set `error: "load-failed"`, do not re-throw.

### 4. Validation & Error Matrix

| Condition | Treatment | Surfaces as |
|---|---|---|
| `file === null` | UI hides the panel or shows empty state | `error: "not-found"` |
| `JSON.parse` throws | UI shows "状态暂不可用" or hides | `error: "load-failed"` |
| `workspace.read` rejects | same as parse failure | `error: "load-failed"` |
| Parsed object missing fixed fields | same as parse failure (do not silently coerce) | `error: "load-failed"` |

### 5. Good/Base/Bad Cases

- **Good**: `useRuntime()` catches all three failure modes, writes a typed `error` field on the returned `RuntimeData`, and the UI branch on `error` decides render-vs-hide.
- **Base**: a `useEntity(ref)` helper that returns `{ data, error, load }` with `load()` performing the read+parse+catch and never throwing.
- **Bad**: `const runtime = JSON.parse((await tsian.workspace.read(...)).content)` — no null check, no try/catch, crashes the component on missing/corrupt files.

### 6. Tests Required

- Assert `useRuntime()` returns `{ runtime: null, error: "not-found" }` when `workspace.read` resolves to `null` (no throw).
- Assert `useRuntime()` returns `{ runtime: null, error: "load-failed" }` when `content` is malformed JSON (no throw).
- Assert a successful read populates `runtime` and `displayItems` with `status: "ready"`.

### 7. Wrong vs Correct

#### Wrong

```ts
async function loadRuntime() {
  const file = await tsian.workspace.read("save/playthrough/runtime.json")
  return JSON.parse(file.content)  // crashes on null file or bad JSON
}
```

#### Correct

```ts
async function refresh() {
  try {
    const file = await tsian.workspace.read(RUNTIME_PATH, "save-runtime")
    if (file === null) { runtimeData.value = { runtime: null, error: "not-found", ... }; return }
    let parsed: unknown
    try { parsed = JSON.parse(file.content) }
    catch { runtimeData.value = { runtime: null, error: "load-failed", ... }; return }
    runtimeData.value = parseRuntime(parsed)   // parseRuntime also validates fixed fields
  } catch {
    runtimeData.value = { runtime: null, error: "load-failed", ... }
  }
}
```

## Scenario: Runtime Extension Parsing Contract

### 1. Scope / Trigger

- Trigger: any play frontend code that turns `runtime.extensions` / `entity.extensions` / `scene.extensions` into display items for status bar, character cards, container panels, or runtime injection UI.

### 2. Signatures

- `parseRuntime(raw: unknown): RuntimeData` — pure function; validates fixed fields, then parses `extensions`.
- `parseEntity(raw: unknown): { displayItems: DisplayItems; itemErrors: DisplayItemError[] }` / `parseScene(raw)` — pure functions; parse `extensions` only (fixed `fields`/`sections`/`status` stay on the raw entity for UI-specific rendering).
- Shared `parseExtensions(ext)` underlies all three — **do not** reimplement extension parsing per UI component (R7).

### 3. Contracts

- **render → category** is a fixed mapping (`lib/render-mapping.ts`): `progress/number → metric`, `tag/tags/text → tag`, `ref/cards/list → ref`, `section → section`. UI components select items by `category`, not by `render`.
- **Unknown render** (value present but not in the 9 presets) → `itemErrors` with `error: "unknown-render"`. Do not degrade unknown renders to text — fail loud so schema drift is visible.
- **Omitted `render`** → treat as `"text"` (schema OQ-2: `render` may be omitted for plain text display). This is **not** an unknown-render error.
- **Missing/typed-wrong fields** (e.g. `progress` without `value`) → degrade per render type and mark `fallback: true` on the `DisplayItem`. Do not push these into `itemErrors` — they are common Agent write slips and the UI can still show something useful.

### 4. Validation & Error Matrix

| Condition | Treatment | Surfaces as |
|---|---|---|
| `render` field omitted | effective render = `"text"`, normal item | `DisplayItem` in `tags` bucket |
| `render` value not in 9 presets | `itemErrors` entry, item dropped from buckets | `DisplayItemError { error: "unknown-render" }` |
| `render` valid but `value` missing | per-render fallback, item stays in bucket | `DisplayItem.fallback = true` |
| `extensions` is not an object | empty buckets, no errors | empty `DisplayItems` |

### 5. Good/Base/Bad Cases

- **Good**: UI status bar reads `displayItems.metrics` + `displayItems.tags` and renders them; separately reads `itemErrors` to show a dev-mode warning.
- **Base**: character card calls `parseEntity` on a `workspace.read` result and renders `displayItems` alongside the fixed `fields`/`sections`.
- **Bad**: a UI component re-implements `if (render === "progress") ...` switches on `extensions` directly — duplicates the shared parser and will diverge.

### 6. Tests Required

- Assert a runtime with `extensions: { "腐化值": { render: "progress", value: 37, max: 100 } }` produces one `DisplayItem` in `metrics` with no `fallback`.
- Assert `extensions: { "x": { render: "radar" } }` produces one `DisplayItemError` with `error: "unknown-render"` and empty buckets.
- Assert `extensions: { "x": { render: "progress" } }` (missing `value`) produces a `DisplayItem` with `fallback: true` and `value: 0`.
- Assert `extensions: { "x": { value: "hello" } }` (omitted `render`) produces a `text` item in `tags`.

### 7. Wrong vs Correct

#### Wrong

```ts
// Per-component re-implementation
for (const [key, item] of Object.entries(runtime.extensions)) {
  if (item.render === "progress") metrics.push({ label: key, value: item.value ?? 0 })
  else if (item.render === "tag") tags.push({ label: key, value: item.value })
  // ... and 7 more branches, no unknown-render handling, no fallback marker
}
```

#### Correct

```ts
import { parseRuntime } from "../lib/parse-runtime"
const { displayItems, itemErrors } = parseRuntime(raw)
// UI renders displayItems.metrics / .tags / .refs / .sections by category
// itemErrors rendered separately (dev-mode warning or hidden)
```

## Scenario: Runtime Refresh Trigger Bus

### 1. Scope / Trigger

- Trigger: wiring a play-frontend composable that needs to re-read `runtime.json` after turn completion, post-turn sync, checkpoint restore, or player-initiated workspace mutations.

### 2. Signatures

- `emitRuntimeStale(): void` — module-level payload-less signal that runtime data may be out of date.
- `onRuntimeStale(cb: () => void): () => void` — subscribe; returns unsubscribe. Callbacks are isolated (one throwing callback does not block others).
- `setOnSynced(cb: () => void)` (from `useSyncAfterTurn`) — single-consumer hook for post-turn-sync completion. Currently last-writer-wins; if a second consumer appears, upgrade it to multi-callback before registering.

### 3. Contracts

- The bus is **payload-less**: subscribers respond by re-reading their own data. Do not attach event details (they cause "detail doesn't match my context" false-negatives).
- `useRuntime()` auto-subscribes to `ready`, `onTurnEnd`, `setOnSynced`, and `onRuntimeStale`. UI components calling `useRuntime()` do **not** need to wire these themselves.
- Checkpoint `restore()` has no event broadcast — callers must explicitly invoke `useRuntime().refresh()` after restore succeeds.
- Player-initiated actions that mutate workspace (future UI: use item, move inventory) should call `emitRuntimeStale()` on success. Do **not** globally wrap `runAction`/`invokeAgent` to auto-emit — most calls do not touch runtime and would cause noise refreshes.

### 4. Validation & Error Matrix

| Trigger source | Mechanism | Who wires it |
|---|---|---|
| bridge ready | `watch(ready, immediate)` | `useRuntime` (internal) |
| turn completed | `tsian.onTurnEnd` | `useRuntime` (internal) |
| post-turn sync done | `setOnSynced` | `useRuntime` (internal) |
| checkpoint restore | explicit `refresh()` call | caller (e.g. StoryView) |
| player action mutates workspace | `emitRuntimeStale()` | future UI component |

### 5. Good/Base/Bad Cases

- **Good**: a future inventory panel calls `emitRuntimeStale()` after a successful `tsian.runAction("use-item", ...)`; `useRuntime` re-reads automatically; the panel does not know who subscribes.
- **Base**: StoryView calls `await restore(id)` then `void refreshRuntime()` — restore has no event, so the explicit call is the contract.
- **Bad**: wrapping `tsian.runAction` globally to `emitRuntimeStale()` on every call — read-history / query calls would trigger pointless runtime re-reads.

### 6. Tests Required

- Assert `emitRuntimeStale()` invokes all subscribers even when one throws (isolation).
- Assert `onRuntimeStale` returned unsubscribe removes the callback from subsequent emits.

### 7. Wrong vs Correct

#### Wrong

```ts
// Globally wrap runAction to auto-refresh
const origRunAction = tsian.runAction
tsian.runAction = async (action, params) => {
  const r = await origRunAction(action, params)
  emitRuntimeStale()   // fires even for read-only queries — noise
  return r
}
```

#### Correct

```ts
// The UI that knows it mutated workspace emits explicitly
async function onUseItem() {
  await tsian.runAction("use-item", { itemId })
  emitRuntimeStale()   // this action actually changed runtime
}
```

## Avoid

- Do not call platform-web storage, model config, or platform-host internals from a play frontend.
- Do not assume platform-owned events/archives/mod resources exist.
- Do not widen bridge payloads to `unknown` to bypass a compile error; update the shared contract or normalize at the boundary.
- Do not reimplement `extensions` parsing per UI component — use the shared `parseExtensions`/`parseRuntime`/`parseEntity` so render→category, unknown-render, and fallback rules stay consistent (R7).
- Do not degrade unknown `render` values to text — push them to `itemErrors` so schema drift is visible. (Omitted `render` is a separate case and maps to `text`.)
- Do not throw out of workspace-read composables — surface `error: "not-found" | "load-failed"` and let the UI decide.
- Do not globally wrap `runAction`/`invokeAgent` to auto-emit `runtimeStale`; only the component that knows it mutated workspace should emit.
