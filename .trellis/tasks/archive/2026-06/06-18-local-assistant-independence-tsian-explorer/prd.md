# Local Assistant Independence and Tsian Explorer

## Goal

Make the desktop Assistant a truly player-local, cross-Game-Card-stable agent by moving its identity/configuration out of Game Card content into a platform-local `.tsian/local/assistant/` directory, removing the optional card-agent assistant mode entirely, and reshaping the Workspace Explorer so players can see and edit `.tsian/` (the platform "C drive") alongside the currently-loaded Game Card workspace (the "USB drive" that swaps on card load).

## User Value

- Players keep one familiar, self-improving assistant across every Game Card. Editing its AGENT.md / SOUL.md / skills persists across card switches instead of being lost when the card changes.
- The assistant's knowledge still follows the loaded Game Card automatically via the existing `docs/` knowledge mount, so it understands the current card without the player reconfiguring anything.
- Players can browse and edit platform-local data (`.tsian/local/...`, including the assistant) in the same resource manager, under a clear "this is local, this is the loaded card" mental model.
- Fewer leftover concepts: no card-agent assistant mode, no legacy `manifest.assistant` field, no ambiguity about where assistant notes are written.

## Confirmed Facts

- The current LOCAL assistant path (`runAssistantChat` with `agentId: "studio-assistant"`) still reads the assistant agent from **Game Card content** at `agents/studio-assistant/*` (AGENT.md, SOUL.md, agent.json, skills/framework-knowledge). It is not actually independent of the loaded card. Only `.tsian/local/assistant/notes.md` is injected as a local file.
- `LOCAL_ASSISTANT_AGENT_ID = "studio-assistant"` in `platform-host/index.ts`. Card mode resolves `agentId` from `activeCard.manifest.assistant?.agentId`; local mode hardcodes `studio-assistant`.
- `GameCardManifest.assistant?: GameCardAssistant` (`{ agentId, summary? }`) is declared in `packages/contracts/src/game-card.ts`, consumed in `platform-host/index.ts` (assistant chat agent resolution + studio snapshot `assistant` block) and exported in `game-card-packages.ts`.
- The built-in blank card seeds `agents/studio-assistant/{agent.json, AGENT.md, SOUL.md, notes.md, session.jsonl, skills/framework-knowledge/SKILL.md}` as card content in `storage/workspace.ts`, and the blank card manifest sets `assistant.agentId = "studio-assistant"`.
- The assistant agent already declares `knowledgeMount: "docs/"` in its card-content `agent.json`; the workspace operation layer resolves mount reads/writes to the current card's `docs/` directory. This knowledge mechanism is independent of where the assistant *identity* lives and should keep working after the identity moves to `.tsian/local/`.
- `.tsian/` is currently platform-owned metadata **intentionally hidden** from ordinary Agent/Skill/frontend workspace read/list/search APIs (`isPlatformMetadataPath` in `workspace-operations.ts`, plus README content seeded in `workspace.ts` stating it is hidden). The resource manager (`WorkspaceExplorerView`) does not show `.tsian/`.
- `.tsian/local/` is already excluded from save checkpoint/restore while other `.tsian/` subdirs (traces, checkpoints, indexes, cache) remain checkpointed (completed in the previous task).
- The Workspace Explorer currently lists **all installed Game Cards** as roots (`listPlatformWorkspaceRoots` returns every local card) and lets the player browse any card's content regardless of which card is loaded. This contradicts the desired "USB drive = the one loaded card" model.
- The assistant's self-improvement `notes.md` should have exactly one write target (local). Keeping a card-agent mode would force an ambiguous choice (card content leaks personal preferences on distribute; local breaks the card-owned identity). The user confirmed removing the card-agent mode is acceptable and preferred.
- Prototype phase: destructive changes are allowed, no backward compatibility is required. The legacy `manifest.assistant` field and the card-agent assistant mode can be removed outright.
- The assistant's SOUL/AGENT/skills/config should be editable by the player. Today Studio can preview and manage agents, and `studio-assistant` appears in the Studio agent list because `buildAgentRegistry` scans all `agents/*/agent.json`; but editing it today edits the card-content copy, which is lost on card switch.

## Requirements

- The local assistant's identity/configuration must live under `.tsian/local/assistant/` (AGENT.md, SOUL.md, agent.json, skills, notes.md) and persist across Game Card switches.
- `runAssistantChat` (local mode) must assemble the assistant agent from `.tsian/local/assistant/` instead of from the current Game Card's `agents/studio-assistant/`.
- The assistant must still receive the loaded Game Card's knowledge via the existing `docs/` knowledge mount, so it understands the current card. The knowledge mount source swaps automatically when the card changes.
- Remove the card-agent assistant mode: drop the local/card mode switch from the Assistant UI and remove the `mode === "card"` branch in `runAssistantChat`.
- Remove `GameCardAssistant` and `manifest.assistant` from contracts and all consumers (`platform-host`, `game-card-packages`, the blank card manifest, studio snapshot `assistant` block). Prototype phase, no compatibility shim.
- Remove the `agents/studio-assistant/` card-content seed from the built-in blank card, since the assistant no longer lives in card content.
- The Workspace Explorer must adopt a "C drive / USB drive" model:
  - `.tsian/` is visible as the platform-local root (the "C drive") and is editable through the resource manager.
  - The loaded Game Card workspace is shown as the current "USB drive"; switching the loaded card swaps this workspace.
  - The explorer no longer lists every installed Game Card as browsable roots; it shows the currently loaded card's workspace plus `.tsian/`.
- The local assistant files under `.tsian/local/assistant/` must be editable through the resource manager and/or Studio.
- `.tsian/local/` continues to be excluded from save checkpoint/restore and from Game Card package import/export.
- Sensitive platform configuration (AI provider/API keys) must not be exposed or packaged; this task does not migrate platform settings into `.tsian/local/settings/`.

## Acceptance Criteria

- [ ] The local assistant agent identity (AGENT.md, SOUL.md, agent.json) is stored under `.tsian/local/assistant/` and survives switching the loaded Game Card.
- [ ] `runAssistantChat` assembles the assistant from `.tsian/local/assistant/` and no longer reads `agents/studio-assistant/` from card content.
- [ ] The assistant still answers current-card questions using knowledge mounted from the loaded card's `docs/`.
- [ ] The Assistant UI no longer shows a local/card mode switch.
- [ ] `GameCardAssistant` and `manifest.assistant` are removed from `@tsian/contracts`; all consumers compile without them.
- [ ] The built-in blank card no longer seeds `agents/studio-assistant/` content or an `assistant` manifest field.
- [ ] The Workspace Explorer shows `.tsian/` as an editable platform-local root.
- [ ] The Workspace Explorer shows the currently loaded Game Card workspace (not all installed cards) and swaps it when the loaded card changes.
- [ ] The player can open and edit `.tsian/local/assistant/` files (AGENT.md, SOUL.md, notes.md) through the resource manager.
- [ ] `.tsian/local/` remains excluded from save checkpoint/restore and Game Card package import/export.
- [ ] `npm run build:contracts` passes.
- [ ] `npm run build:web` passes.

## Out Of Scope

- Migrating broader platform settings (AI provider config, etc.) into `.tsian/local/settings/`.
- Account sync or cloud-stored assistant identity.
- A general mount/soft-link manager beyond the single assistant knowledge mount.
- Redesigning the resource manager visual style (only the data/root model changes).

## Confirmed Decisions

- **Local assistant configuration management**: the local assistant's `agent.json` lives under `.tsian/local/assistant/` and is edited manually through the resource manager (like any other workspace file). No dedicated Studio GUI panel for the local assistant. Default to the highest permission level (4) and all platform tools enabled, so players normally never need to touch it. If a player wants changes, they either edit `agent.json` directly in the resource manager or ask the assistant to modify its own config in chat (it has `workspace_write`).
- **knowledgeMount stays `"docs/"`**: the mount target remains the loaded Game Card's `docs/` directory, unchanged from the current implementation. Only the assistant identity storage location moves.
- **No compatibility for `manifest.assistant`**: prototype phase, destructive removal is acceptable.
