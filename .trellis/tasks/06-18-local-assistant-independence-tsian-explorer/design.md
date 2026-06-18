# Design: Local Assistant Independence and Tsian Explorer

## Architecture Overview

Three coupled changes, each touching a different layer:

1. **Local assistant storage** — move the assistant agent identity from Game Card content (`agents/studio-assistant/*`) to platform-local `.tsian/local/assistant/*`.
2. **Assistant runtime assembly** — `runAssistantChat` builds the agent from local files instead of card content; remove the card-agent mode.
3. **Tsian Explorer** — reshape the Workspace Explorer from "all cards as roots" to "C drive (`.tsian/`) + loaded card (USB drive)".

## 1. Local Assistant Storage

### Location

`.tsian/local/assistant/` contains:
- `agent.json` — agent config (id, title, summary, contacts, skills, platformTools, workspaceAccess, contextPaths, knowledgeMount)
- `AGENT.md` — SOP/prompt prose
- `SOUL.md` — persona
- `notes.md` — self-improvement notes (already seeded here by the previous task)
- `skills/` — assistant-local skills directory (initially empty or with a self-improvement skill)

### Defaults

`agent.json` defaults:
- `id`: `"assistant"` (new local id; not `studio-assistant` to avoid confusion with the removed card agent)
- `platformTools.enabled`: all platform tools
- `workspaceAccess.level`: `4` (highest)
- `knowledgeMount`: `"docs/"` (unchanged — points at the loaded card's docs)
- `contextPaths`: local README/docs as needed
- `contacts`: `[]` (the assistant is a standalone chat agent, not part of an AIRP multi-agent chain)

### Seeding

A new seeding helper (in `platform-host/index.ts` or `storage/workspace.ts`) ensures `.tsian/local/assistant/` files exist. This replaces the current `ensureLocalAssistantFiles` which only injected `notes.md`. The seed must run:
- on assistant chat startup (so a fresh browser has the assistant)
- the files are platform-local (stored under save `workspaceFiles` at `.tsian/local/...` when a save is active, or in an in-memory/local fallback when no save is active)

**Storage boundary issue**: when no save is active, `.tsian/local/` has no persistent home (it was previously injected only into the in-memory workspace for the chat turn). The local assistant files need to persist even without a save. Options:

- **Option A (chosen)**: Store local assistant files in a dedicated Dexie `meta` key (e.g. `assistant-local-files`) as a JSON map of path→content, mirroring how assistant conversations are stored. `runAssistantChat` reads from this store, merges the files into the in-memory workspace, and writes back after the turn. This keeps local assistant data independent of both card content and save state.
- Option B (rejected): Store under save `workspaceFiles` — fails when no save is active, and couples local identity to a specific playthrough.

### Migration from existing data

Prototype phase, no compatibility required. The existing `agents/studio-assistant/` card content and `manifest.assistant` are simply removed. Players get a fresh local assistant seeded on first use. No migration of old card-content assistant edits.

## 2. Assistant Runtime Assembly

### Current flow

`runAssistantChat`:
1. Resolves `agentId` (`studio-assistant` or card manifest's assistant agentId).
2. Builds `workspaceFiles` from card content (+ save if active).
3. Calls `ensureLocalAssistantFiles` (only injects `notes.md`).
4. Calls `runAgentRuntimeTurn({ agentId, ... })`.
5. `runAgentRuntimeTurn` → `assembleAgentContext(files, { agentId })` → `buildAgentRegistry(files)` which scans **only `agents/<id>/agent.json`**.
6. Knowledge mount resolves via `agent.path` → `agents/studio-assistant/knowledge/` → `docs/`.

### New flow

`runAssistantChat`:
1. No mode switch. Always uses the local assistant.
2. Builds `workspaceFiles` from card content (+ save if active) — this provides the loaded card's `docs/` for knowledge.
3. Loads local assistant files from the Dexie `meta` store (Option A above) and **merges them into the workspace files** at `.tsian/local/assistant/*`.
4. Calls `runAgentRuntimeTurn({ agentId: "assistant", ... })`.
5. `buildAgentRegistry` must recognize `.tsian/local/assistant/agent.json` as a valid agent config. → **Registry pattern change** (see below).
6. Knowledge mount: `agent.path` is now `.tsian/local/assistant/AGENT.md`, so mount virtual dir is `.tsian/local/assistant/knowledge/` → resolves to `docs/`. This works unchanged because `resolveKnowledgeMountPath` only does string translation based on `agent.path` and `knowledgeMount`.

### Registry pattern change

`AGENT_CONFIG_FILE_PATH_PATTERN` in `registry.ts` is currently `/^agents\/([^/]+)\/agent\.json$/`. Two approaches:

- **Approach A (chosen)**: Generalize the pattern to also accept `.tsian/local/assistant/agent.json` as a recognized agent config path. Add a second pattern or broaden the regex. `agentPathInfo` derives `directoryPath` and `agentFilePath` from the matched path. This is a small, contained change.
- Approach B (rejected): Bypass the registry for the local assistant by constructing the `AgentRegistryEntry` directly in `runAssistantChat`. This splits agent resolution into two code paths and risks divergence.

With Approach A, `buildAgentRegistry` will find the local assistant alongside card agents. The local assistant's `agent.path` becomes `.tsian/local/assistant/AGENT.md`, and all downstream path derivation (context, soul, notes, knowledge mount) follows from that.

### Notes/session resolution

`assembleAgentContext` currently looks for notes at `save/<agentDirectory>/notes.md` and session at `save/<agentDirectory>/session.jsonl`. For the local assistant, `agentDirectory` is `.tsian/local/assistant`, so it would look at `save/.tsian/local/assistant/notes.md` — wrong.

Fix: `assembleAgentContext` should look for notes/session relative to the agent directory itself when the agent is under `.tsian/local/` (i.e. notes at `<agentDirectory>/notes.md`). For card agents under `agents/`, the existing `save/<agentDirectory>/notes.md` behavior stays. This is a small conditional in `context.ts`.

### Committing local assistant changes

`commitAssistantWorkspaceFiles` already filters `.tsian/` paths. It needs to route `.tsian/local/assistant/*` writes back to the Dexie `meta` store (Option A) instead of treating them as save-runtime or card-content. Card-content writes (knowledge mount → `docs/`) continue to persist to the card.

## 3. Remove Card-Agent Assistant Mode

### Contracts

- Remove `GameCardAssistant` interface and `assistant?: GameCardAssistant` from `GameCardManifest` in `packages/contracts/src/game-card.ts`.
- Rebuild contracts (`npm run build:contracts`).

### Consumers

- `platform-host/index.ts`: remove `assistant` block from `PlatformStudioSnapshot`, remove `assistantManifest` resolution in `getPlatformStudioSnapshot`, remove card-mode branch in `runAssistantChat`.
- `game-card-packages.ts`: remove `assistant` from package manifest export.
- `storage/workspace.ts` / `game-cards.ts`: remove `agents/studio-assistant/` seed content and `BUILTIN_BLANK_GAME_CARD_ASSISTANT_ID`, remove `assistant` from blank card manifest.
- `StudioView.vue`: remove `assistant?.agent?.id` default selection fallback (just default to first agent).
- `AssistantView.vue`: remove local/card mode switch UI and `mode` state.

## 4. Tsian Explorer (C Drive / USB Drive)

### Current model

`listPlatformWorkspaceRoots` returns **all installed Game Cards**. The explorer shows them all as selectable roots and browses any card's content.

### New model

Two roots:
- **C drive (`.tsian/`)**: platform-local data. Visible and editable. This is where `.tsian/local/assistant/` lives.
- **USB drive (loaded card workspace)**: the currently loaded Game Card's content. Switching the loaded card swaps this root's contents.

### Implementation

- `PlatformWorkspaceRootEntry` changes from per-card to a fixed two-root model: `{ kind: "local" | "card", ... }`.
- `listPlatformWorkspaceRoots` returns:
  - a `.tsian/` local root (with a file count from the local store)
  - a loaded-card root (the active card's name/summary/content count)
- The explorer's root list UI shows these two roots instead of all cards.
- `.tsian/` visibility: the explorer uses the Studio workspace operation path (which runs with `actorLevel: 1`). `.tsian/` is currently gated behind `readLevel` checks. For the explorer to show `.tsian/`, either:
  - the explorer's workspace operations for `.tsian/` run at a higher actor level (platform-level, since the player is the owner), or
  - `.tsian/local/` specifically gets a lower read level for player-facing browsing.
- The current "browse any card" capability is removed. To browse a different card, the player loads it first (via My Apps / game launcher).

### Scope note

This is the largest UI change. The explorer's file tree, breadcrumb, context menus, and editor integration all key off the root model. The change is mostly in the root-listing + file-source layer, not the tree/editor components themselves.

## Data Flow

```
Assistant chat turn:
  card content (docs/, agents/, ...) ──┐
  save runtime (save/, .tsian/traces) ─┤
  local assistant (.tsian/local/assistant/* from Dexie meta) ──┤── merged workspace files
                                                                  │
  runAgentRuntimeTurn(agentId: "assistant")                       │
    → buildAgentRegistry finds .tsian/local/assistant/agent.json ◄┘
    → assembleAgentContext: AGENT.md, SOUL.md, notes.md from .tsian/local/assistant/
    → knowledgeFiles from docs/ (knowledgeMount)
    → tool loop runs
    → workspace writes:
        .tsian/local/assistant/* → commit to Dexie meta store
        docs/* (via knowledge mount) → commit to card content
```

## Trade-offs

- **Dexie meta store for local assistant files** (Option A): adds a small storage helper but keeps local assistant data fully independent of card and save. The alternative (save workspaceFiles) breaks when no save is active.
- **Registry pattern broadening** (Approach A): `buildAgentRegistry` now recognizes a path outside `agents/`. This is intentional — the local assistant is a real agent, just stored locally. The pattern stays restrictive (only `.tsian/local/assistant/agent.json`, not arbitrary paths).
- **Removing "browse all cards"**: players lose the ability to browse non-loaded cards from the explorer. This is by design (USB drive model) and matches the loaded-card-centric mental model. Browsing another card requires loading it first.

## Risky Files / Rollback Points

- `packages/contracts/src/game-card.ts` — removing `GameCardAssistant`; all consumers must be checked.
- `apps/platform-web/src/agent-runtime/registry.ts` — pattern change; verify card agents still resolve correctly.
- `apps/platform-web/src/agent-runtime/context.ts` — notes/session path conditional; verify card agents unaffected.
- `apps/platform-web/src/platform-host/index.ts` — assistant assembly + commit routing; the largest single-file change.
- `apps/platform-web/src/views/WorkspaceExplorerView.vue` — root model change; verify tree/editor still work.
