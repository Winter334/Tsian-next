# Agent Provider Model Selection Implementation Plan

## Checklist

1. Contract: add `providerPresetId?: string` to `AgentConfig` and `AgentRegistryEntry` in `packages/contracts/src/runtime.ts`. Run `npm run build:contracts`.

2. Config resolver: add `resolveBrowserAiConfigForProviderId(providerId: string): BrowserAiConfig | null` to `apps/platform-web/src/config/ai.ts`. It reads the stored draft, finds the preset by id, returns resolved config or null.

3. Registry: normalize `providerPresetId` from parsed `agent.json` in `apps/platform-web/src/agent-runtime/registry.ts` `buildAgentRegistryEntry`.

4. Platform-host:
   - Add `updatePlatformStudioAgentProviderPreset(input)` that sets/clears `providerPresetId` in agent.json (card-content for card agents, `saveLocalAssistantFiles` for the local assistant).
   - Export available preset names (id + name only) in `PlatformStudioSnapshot` as `providerPresets`.
   - In both `callModel` wiring sites (AIRP play turn + Assistant chat turn), resolve the active agent's provider config and pass it as `config` to `generateAssistantReply`.

5. Studio UI: add a provider preset selection dropdown + clear button in the Tools/权限 section of `apps/platform-web/src/views/StudioView.vue`. Read presets from snapshot; show name; clear falls back to global. Show a hint when no selection.

6. Verify:
   - `npm run build:contracts`
   - `npm run build:web`
   - Manual smoke: select a provider for an agent in Studio, run a turn, confirm it uses that provider. Clear selection, confirm fallback.

## Risky Files

- `apps/platform-web/src/platform-host/index.ts`: two `callModel` closure sites must correctly resolve the agent context. Getting the agent context at the right scope is the main risk.
- `packages/contracts/src/runtime.ts`: contract shape change; must rebuild contracts before web.
- `apps/platform-web/src/views/StudioView.vue`: adding a control without cluttering the Tools section.

## Rollback Points

- If per-Agent resolution breaks runtime calls, pass `config: null` in the closures to revert to global-only. The contract field and UI are harmless if unused.
- If the Studio UI control adds noise, hide it without removing backend support.

## Validation Commands

```bash
npm run build:contracts
npm run build:web
```
