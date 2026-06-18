# Agent Provider Model Selection Design

## Architecture And Boundaries

This task adds a per-Agent provider preset reference to the existing provider preset system. The preset store (localStorage, `config/ai.ts`) is unchanged. The change is additive: a new optional field on Agent config, a resolver that maps preset id -> runtime config, and a Studio UI control.

Primary files:

- `packages/contracts/src/runtime.ts`: add optional `providerPresetId` to `AgentConfig` and `AgentRegistryEntry`.
- `apps/platform-web/src/config/ai.ts`: add `resolveBrowserAiConfigForProvider(providerId)` that returns a `BrowserAiConfig` for a given preset id (or null), alongside the existing `getBrowserAiConfig()`.
- `apps/platform-web/src/agent-runtime/registry.ts`: normalize `providerPresetId` from `agent.json` into the registry entry.
- `apps/platform-web/src/platform-host/index.ts`: resolve per-Agent provider config before `callModel` in both `runAgentRuntimeTurn` wiring paths (AIRP play turn + Assistant chat turn). Add `updatePlatformStudioAgentProviderPreset` to persist the selection. Export available presets to the Studio snapshot.
- `apps/platform-web/src/views/StudioView.vue`: add a provider selection control in the Tools/权限 section (or a new compact section) showing a dropdown of saved preset names + clear button.
- `apps/platform-web/src/runtime-host/ai.ts`: no structural change needed; it already accepts an optional `config` override in `generateAssistantReply`.

No new Dexie table. No contract for preset shape (presets remain browser-local).

## Data Model

Contract change (`runtime.ts`):

```ts
export interface AgentConfig {
  // ... existing fields ...
  providerPresetId?: string  // references a saved BrowserAiProviderPreset.id
}

export interface AgentRegistryEntry {
  // ... existing fields ...
  providerPresetId?: string
}
```

The field is optional. `agent.json` example:

```json
{
  "id": "master",
  "title": "...",
  "providerPresetId": "provider-abc-123"
}
```

Provider presets remain in localStorage as before. The `providerPresetId` is a loose reference: if the preset is deleted or absent on another player's machine, resolution falls back.

## Resolution Flow

New helper in `config/ai.ts`:

```ts
export function resolveBrowserAiConfigForProviderId(providerId: string): BrowserAiConfig | null
```

It reads the stored draft, finds the preset by id, and returns a resolved `BrowserAiConfig` (or null if not found / incomplete).

Platform-host `callModel` wiring changes from:

```ts
callModel(messages, options) {
  return generateAssistantReply(messages, { debugLabel, signal })
}
```

to:

```ts
callModel(messages, options) {
  const agentConfig = resolveAgentProviderConfig(agentContext)  // Agent-selected or null
  return generateAssistantReply(messages, { debugLabel, signal, config: agentConfig })
}
```

Where `resolveAgentProviderConfig`:
1. Reads `agentContext.agent.providerPresetId`.
2. If set, calls `resolveBrowserAiConfigForProviderId(id)`.
3. If that returns a config, use it.
4. Otherwise return `null` (let `generateAssistantReply` fall back to `getBrowserAiConfig()` -> env defaults).

`generateAssistantReply` already handles `config: null` by falling back to `getBrowserAiConfig()`. No change needed there.

The agentContext is already available at both `callModel` wiring sites (it is loaded before `runAgentRuntimeTurn`). For `agent_call` (cross-agent delegation), the delegated agent's context is resolved inside the runtime; the `callModel` in platform-host is the single chokepoint and receives the active agent context. We resolve per-call from the agent that is currently making the model call. Since the runtime's `callAgentModelWithWorkspaceTools` passes `agentContext`, and the platform-host closure has access to the loaded registry, we resolve the provider from the agent being called.

Implementation note: the platform-host `callModel` closure needs the agent context. At the AIRP play turn site, the entry agent is known (`agentId: "master"` by current convention, but the unified entry pipeline means any agent can be entry). At the Assistant site, `agentId` is `LOCAL_ASSISTANT_AGENT_ID`. We load the agent registry/context once and capture the selected provider in the closure.

## Studio UI

In the Tools/权限 section (or a new row above it), add:

- A label "API 服务商" with a dropdown listing saved provider presets by name.
- The current selection is shown as the active option.
- A "清除" (clear) button to unset the selection (fall back to global).
- A hint line: "未选择时使用平台默认服务商。"
- Read available presets from the Studio snapshot (platform-host exports them).

The Studio snapshot (`PlatformStudioSnapshot`) gains a `providerPresets` array (id + name only, no keys) so the UI can render the dropdown without touching localStorage directly.

## Persistence

For card agents: `updatePlatformStudioAgentProviderPreset(input: { agentId, providerPresetId | null })` reads the current `agent.json`, sets/clears the field, and writes via `writeAgentConfigRecord`.

For the local assistant: the same function detects `.tsian/local/assistant/agent.json` and writes via `saveLocalAssistantFiles` instead of card-content.

The registry normalizes the field on read, so it appears immediately after save + refresh.

## Compatibility And Migration

Prototype period: no legacy shim needed. The field is optional; existing `agent.json` files without it simply have no provider selection and use the global provider.

A game card distributed with `providerPresetId` set will reference a preset id that likely does not exist on the recipient's machine. Resolution falls back to their global active provider. This is acceptable and expected — API credentials are per-player.

## Trade-Offs

- Storing only a preset id reference means the selection is machine-specific. This is intentional: credentials must not be distributed. The trade-off is that a card author's provider selection does not carry to recipients; recipients always get their own default. Acceptable for prototype.
- No per-Agent model parameter override means all agents using the same preset share its parameters. If a player needs different parameters per agent, they create separate presets. This keeps the model simple.

## Rollback

- If per-Agent resolution causes issues, the closure can pass `config: null` always, reverting to global-only behavior. The contract field and UI remain harmless.
- If the Studio UI control is confusing, it can be hidden behind a toggle without removing the backend resolution.

## Validation Commands

```bash
npm run build:contracts
npm run build:web
```
