# Type Safety

Frontend/browser consumers should use shared contract types instead of redefining bridge payloads locally.

## Current Shared Shapes

- `RuntimeSnapshotShell` and `ConversationMessageRecord` describe frontend-readable session state.
- `StateRecord` describes generic runtime data exposed through `state-records`.
- `MessageInteractionRequest` is currently `{ content: string }`.
- `DeepQueryRequest` / `DeepQueryResult<T>` wrap bridge query resources.
- `PlatformActionRequest` / `PlatformActionResult<T>` wrap platform actions.
- `AiDebugRecord` and `CheckpointSummary` support debug/checkpoint views.
- `AgentRegistryEntry` describes lightweight `agents/<agent>/AGENT.md` index entries.
- `SkillRegistryEntry` describes lightweight shared or agent-local `SKILL.md` index entries.
- `SkillDetailEntry` describes a loaded `SKILL.md` plus resource index for `skill-detail`.
- `SkillResourceEntry` describes a bundled skill resource file without its content.

## Bridge Consumption

- Play frontends call `bridge.interaction.sendMessage({ content })` to submit player input.
- Play frontends read data through `bridge.runtime.getRuntimeSnapshot()` and `bridge.query.query(...)`.
- Play frontends use `bridge.platform.runAction(...)` for allowed platform actions such as `restore-checkpoint`.
- `bridge.debug?.onTurnDebugReady(cb)` is a signal to refresh data, not the source of truth.
- Use `AgentRegistryEntry` for `bridge.query.query({ resource: "agent-registry" })` results.
- Use `SkillRegistryEntry` for `bridge.query.query({ resource: "skill-registry" })` results.
- Use `SkillDetailEntry` for `bridge.query.query({ resource: "skill-detail", params: { path } })` results.

## Avoid

- Do not call platform-web storage, model config, or platform-host internals from a play frontend.
- Do not assume platform-owned events/archives/mod resources exist.
- Do not widen bridge payloads to `unknown` to bypass a compile error; update the shared contract or normalize at the boundary.
