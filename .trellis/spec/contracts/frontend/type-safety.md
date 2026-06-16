# Type Safety

Frontend/browser consumers should use shared contract types instead of redefining bridge payloads locally.

## Current Shared Shapes

- `RuntimeSnapshotShell` and `ConversationMessageRecord` describe frontend-readable session state.
- `WorkspaceFile`, `WorkspaceEntry`, and `WorkspaceSearchResult` describe Runtime Workspace files and discovery results.
- `MessageInteractionRequest` is currently `{ content: string }`.
- `DeepQueryRequest` / `DeepQueryResult<T>` wrap bridge query resources.
- `PlatformActionRequest` / `PlatformActionResult<T>` wrap platform actions.
- `RemotePlayBridge*` types describe the serializable `tsian.play-bridge.v1` postMessage protocol used by remote iframe frontends.
- `AiDebugRecord` and `CheckpointSummary` support debug/checkpoint views.
- `GameCardManifest`, `GameCardFrontendBinding`, `GameCardPackageManifest`, `GameCardPackageFileEntry`, and `GameCardContentFile` describe reusable game cards, package files, frontend bindings, and card-owned content files. `GameCardWorkspaceTemplateFile` is a compatibility alias for `GameCardContentFile`. `GameCardManifest.frontend` is optional; when present, frontend bindings are remote or packaged only.
- `AgentRegistryEntry` describes lightweight `agents/<agent>/AGENT.md` index entries.
- `AgentContextEntry` describes one assembled Agent context bundle for `agent-context`.
- `SkillRegistryEntry` describes lightweight shared or agent-local `SKILL.md` index entries. Use `name` / `description` for model-facing Skill identity and keep `id` / `summary` / `path` for compatibility and bridge/UI/debug consumers.
- `SkillDetailEntry` describes a loaded `SKILL.md` plus resource index for `skill-detail`.
- `SkillResourceEntry` describes a bundled skill resource file without its content.
- `RuntimeDiagnosticSummary`, `RuntimeDiagnosticFact`, `RuntimeDiagnosticHealth`, and `RuntimeDiagnosticsQueryParams` describe compact Agent-facing diagnostics returned by `runtime-diagnostics`.

## Bridge Consumption

- Play frontends call `bridge.interaction.sendMessage({ content })` to submit player input.
- Play frontends read data through `bridge.runtime.getRuntimeSnapshot()` and `bridge.query.query(...)`.
- Play frontends use `bridge.platform.runAction(...)` for allowed platform actions such as `restore-checkpoint`.
- `bridge.debug?.onTurnDebugReady(cb)` is a signal to refresh data, not the source of truth.
- Remote iframe frontends use `RemotePlayBridgeMessage` envelopes over `postMessage`; they must expect explicit `{ ok: true, result }` / `{ ok: false, error }` responses instead of thrown exceptions crossing the frame boundary.
- The default remote iframe bridge exposes `runtime.getRuntimeSnapshot`, `interaction.sendMessage`, `query.query`, `platform.getPlatformContext`, and `platform.runAction`; it does not expose the `debug` namespace and must not expose `query.query({ resource: "ai-debug" })`.
- Use `AgentRegistryEntry` for `bridge.query.query({ resource: "agent-registry" })` results.
- Use `AgentContextEntry` for `bridge.query.query({ resource: "agent-context", params: { agentId } })` results.
- Use `SkillRegistryEntry` for `bridge.query.query({ resource: "skill-registry" })` results. Prefer `name` and `description` when presenting skills to an Agent; use `path` only for platform/debug queries such as `skill-detail`.
- Use `SkillDetailEntry` for `bridge.query.query({ resource: "skill-detail", params: { path } })` results.
- Use `RuntimeDiagnosticSummary` for `bridge.query.query({ resource: "runtime-diagnostics", params })` results. Diagnostics are facts-only summaries, not raw trace lines or repair instructions.

## Avoid

- Do not call platform-web storage, model config, or platform-host internals from a play frontend.
- Do not assume platform-owned events/archives/mod resources exist.
- Do not widen bridge payloads to `unknown` to bypass a compile error; update the shared contract or normalize at the boundary.
