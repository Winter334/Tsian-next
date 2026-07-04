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


## Avoid

- Do not call platform-web storage, model config, or platform-host internals from a play frontend.
- Do not assume platform-owned events/archives/mod resources exist.
- Do not widen bridge payloads to `unknown` to bypass a compile error; update the shared contract or normalize at the boundary.
