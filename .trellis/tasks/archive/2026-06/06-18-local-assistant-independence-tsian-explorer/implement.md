# Implementation Plan: Local Assistant Independence and Tsian Explorer

## Phase 1: Contracts — Remove `GameCardAssistant`

1. Remove `GameCardAssistant` interface and `assistant?: GameCardAssistant` from `GameCardManifest` in `packages/contracts/src/game-card.ts`.
2. `npm run build:contracts` and fix any compile errors in consumers.

## Phase 2: Remove Card-Agent Assistant Consumers

3. `platform-host/index.ts`:
   - Remove `assistant` block from `PlatformStudioSnapshot`.
   - Remove `assistantManifest` / `assistantAgent` resolution in `getPlatformStudioSnapshot`.
   - Remove the card-mode branch in `runAssistantChat` (no `mode === "card"`).
4. `storage/game-card-packages.ts`: remove `assistant` from package manifest export.
5. `storage/workspace.ts` + `storage/game-cards.ts`: remove `agents/studio-assistant/` seed content, `BUILTIN_BLANK_GAME_CARD_ASSISTANT_ID`, and `assistant` from the blank card manifest.
6. `StudioView.vue`: remove `assistant?.agent?.id` default selection fallback; default to `next.agents[0]?.id`.
7. `AssistantView.vue`: remove local/card mode switch UI, `mode` ref, and `AssistantMode` usage in chat calls.

## Phase 3: Local Assistant Storage

8. Create a storage helper (e.g. `storage/local-assistant-files.ts`) backed by a Dexie `meta` key (`assistant-local-files`) storing a JSON map of `.tsian/local/assistant/*` path→{content, mediaType}. Functions: `loadLocalAssistantFiles()`, `saveLocalAssistantFiles(files)`, `ensureLocalAssistantFilesSeeded()` (seeds defaults if missing).
9. Define default local assistant content: `agent.json` (id `assistant`, level 4, all tools, knowledgeMount `docs/`), `AGENT.md`, `SOUL.md`, `notes.md`. Base AGENT.md/SOUL.md on the current `agents/studio-assistant/` seed content, adapted for the local identity.

## Phase 4: Registry + Context — Support `.tsian/local/assistant/`

10. `agent-runtime/registry.ts`: broaden `AGENT_CONFIG_FILE_PATH_PATTERN` to also match `.tsian/local/assistant/agent.json`. Update `agentPathInfo` to derive `directoryPath` and `agentFilePath` from the matched path for the local assistant case.
11. `agent-runtime/context.ts`: when the agent directory is under `.tsian/local/`, resolve notes/session relative to the agent directory itself (`<agentDir>/notes.md`) instead of `save/<agentDir>/notes.md`. Card agents keep existing behavior.

## Phase 5: Assistant Runtime Assembly

12. `platform-host/index.ts` — rewrite `runAssistantChat`:
   - Remove mode param / card-mode branch.
   - Load local assistant files from the Dexie meta store and merge into `workspaceFiles` at `.tsian/local/assistant/*`.
   - Replace `ensureLocalAssistantFiles` with the new store-backed merge.
   - Call `runAgentRuntimeTurn({ agentId: "assistant", ... })`.
13. `platform-host/index.ts` — update `commitAssistantWorkspaceFiles`:
   - Route `.tsian/local/assistant/*` writes back to the Dexie meta store.
   - Card-content writes (docs/ via knowledge mount) continue to persist to the card.
   - Save-runtime writes unchanged.
14. Remove the old `ensureLocalAssistantFiles` helper and `LOCAL_ASSISTANT_AGENT_ID`.

## Phase 6: Tsian Explorer

15. `platform-host/index.ts` — reshape `PlatformWorkspaceRootEntry` and `listPlatformWorkspaceRoots`:
   - Return a `.tsian/` local root + a loaded-card root (not all cards).
   - Add a way to list `.tsian/` contents for the explorer (platform-level actor).
16. `WorkspaceExplorerView.vue`:
   - Root list shows the two roots (C drive + USB drive).
   - Selecting the card root browses the loaded card workspace.
   - Selecting `.tsian/` browses platform-local files including `.tsian/local/assistant/`.
   - Remove multi-card root selection.
17. Ensure `.tsian/local/assistant/` files are editable through the explorer's editor integration.

## Phase 7: Verification

18. `npm run build:contracts` passes.
19. `npm run build:web` passes.
20. Manual verification:
   - Assistant chat works with no card loaded (local assistant seeded).
   - Assistant chat answers current-card questions (knowledge from docs/).
   - Switching loaded card keeps the same assistant identity.
   - Editing `.tsian/local/assistant/AGENT.md` in the explorer changes assistant behavior on next chat.
   - Explorer shows `.tsian/` and the loaded card; does not show all cards.
   - Assistant notes self-improvement writes land in `.tsian/local/assistant/notes.md`.

## Validation Commands

```bash
npm run build:contracts
npm run build:web
```

## Risky Files / Rollback Points

- `packages/contracts/src/game-card.ts` — contract removal; check all consumers.
- `apps/platform-web/src/agent-runtime/registry.ts` — pattern broadening; verify card agents resolve.
- `apps/platform-web/src/agent-runtime/context.ts` — notes path conditional; verify card agents unaffected.
- `apps/platform-web/src/platform-host/index.ts` — assistant assembly + commit routing; largest change.
- `apps/platform-web/src/views/WorkspaceExplorerView.vue` — root model change; verify tree/editor.

## Follow-Up Checks Before `task.py start`

- [ ] PRD reviewed by user.
- [ ] design.md reviewed by user.
- [ ] implement.md reviewed by user.
