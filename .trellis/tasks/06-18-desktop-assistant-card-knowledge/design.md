# Design: Desktop Assistant App And Card Knowledge

## Architecture Overview

The Assistant app is a new RetroOS desktop application that provides a chat-first interface to a player-local assistant agent. It reuses the existing agent runtime turn loop (`runAgentRuntimeTurn`) as its execution engine, but introduces a new entry path that is independent from the AIRP play turn flow.

### Current State (what exists)

- Desktop apps are registered in `desktop-apps.ts` as `DesktopAppDefinition` entries, each with a route, icon, component, and window dimensions. No assistant app exists yet.
- `generateAssistantReply` in `runtime-host/ai.ts` is a thin OpenAI-compatible chat completion caller. It is currently only invoked as the `callModel` callback inside the AIRP play turn flow in `platform-host/index.ts`.
- `runAgentRuntimeTurn` in `agent-runtime/index.ts` is the core agent execution loop: it assembles agent context, calls the model, parses tool calls, executes workspace operations, and loops until a final text response or tool-round limit.
- Agent context assembly (`agent-runtime/context.ts`) builds `AgentContextEntry` from workspace files: AGENT.md, SOUL.md, notes.md, session.jsonl, and declared `contextPaths`.
- Workspace operations (`agent-runtime/workspace-operations.ts`) enforce scope-based access: `card-content`, `save-runtime`, `platform-meta`. The `.tsian/` prefix maps to `platform-meta` scope.
- Save checkpoint/restore uses `isSaveRuntimePersistencePath` (`workspace.ts:1215`) which accepts both `save/` and `.tsian/` paths. All `.tsian/` files are currently checkpointed.
- Game card content is forbidden from using `.tsian/` paths (`game-cards.ts:148`).
- The blank card's `studio-assistant` agent has `contextPaths` pointing at `docs/tsian-framework-knowledge.md`, `README.md`, `agents/README.md`, `skills/README.md`, etc.

### What Changes

The task introduces four coordinated changes:

1. **Assistant desktop app + chat entry path** — a new desktop app, route, view, and platform-host action that runs an assistant agent runtime turn without the AIRP play-turn machinery.
2. **`.tsian/local/` storage isolation** — a new local-only sub-directory for the player's assistant data, excluded from save checkpoint/restore.
3. **Knowledge mount** — a declarative mount in `agent.json` that lets the assistant read/write a card-content directory (`docs/`) as if it were the assistant's own `knowledge/` directory.
4. **Self-improvement Skill** — a Skill that automatically maintains `.tsian/local/assistant/notes.md` and writes distributable knowledge through the mount.

## Component Design

### 1. Assistant Desktop App

**Registration** (`desktop-apps.ts`):
- Add `"assistant"` to `DesktopAppId` union.
- Add a `DesktopAppDefinition` with `Bot` icon (already imported), route `/assistant`, component `AssistantView`.
- Default size ~900x640, min ~600x420.

**Route** (`router/index.ts`):
- Add `{ path: "/assistant", name: "assistant", component: () => import("../views/AssistantView.vue") }`.

**View** (`views/AssistantView.vue`):
- Chat-first layout modeled on web Codex: message list in the main area, input bar at the bottom.
- A lightweight mode switch in the header: default mode (player-local assistant + current card knowledge) vs. optional card-specific assistant mode (visible only when the loaded card declares `manifest.assistant`).
- Current card context indicator (card name, not a desktop-wide banner).
- Empty states: no loaded card, no active save, card without assistant metadata.

**Platform-host action** (`platform-host/index.ts`):
- New action `"assistant-chat"` (or a dedicated request type) that:
  1. Resolves the active assistant agent (local default or card-declared).
  2. Assembles agent context from the effective workspace.
  3. Calls `runAgentRuntimeTurn` with the player's chat message as `userInput`.
  4. Returns the assistant reply text.
- Unlike the AIRP play turn, this path does not increment the save turn counter, does not create checkpoints, and does not stage AIRP history files. It is a standalone agent runtime turn for Q&A and workspace assistance.
- Workspace mutations from the assistant turn are staged in a workspace transaction and committed if the turn succeeds, but do not trigger save snapshot/checkpoint.

### 2. `.tsian/local/` Storage Isolation

**Path classification** (`workspace-operations.ts`):
- `.tsian/local/` remains `platform-meta` scope (highest permission level).
- No new `WorkspaceScope` value is needed.

**Checkpoint exclusion** (`workspace.ts`):
- `isSaveRuntimePersistencePath` currently returns true for all `.tsian/` paths.
- Refine to exclude `.tsian/local/`: add a check `if (path.startsWith(".tsian/local/")) return false` before the existing `.tsian/` acceptance.
- This prevents assistant local data from being snapshot/checkpointed while preserving `.tsian/traces`, `.tsian/checkpoints`, `.tsian/indexes`, `.tsian/cache` checkpoint behavior.

**Local assistant file seeding**:
- The platform seeds `.tsian/local/assistant/notes.md` (empty or with a header) when the assistant app is first opened or when no local assistant data exists.
- `AGENT.md` and `SOUL.md` for the local assistant are also seeded under `.tsian/local/assistant/` if they don't exist, providing default identity/personality that the player can customize.

**Workspace API visibility**:
- `.tsian/local/` files are readable/writable through workspace operations at `platform-meta` scope (level 4), consistent with existing `.tsian/` handling.
- They are hidden from ordinary workspace read/list/search APIs (same as all `.tsian/` paths), but accessible to the assistant agent through its runtime tool loop with appropriate permissions.

### 3. Knowledge Mount

**Declaration** (`agent.json`):
- New optional field `knowledgeMount?: string` on `AgentConfig`.
- Value is a card-content relative directory path, e.g. `"docs/"`.
- The assistant agent sees this as a virtual `knowledge/` directory under its own agent directory.

**Context assembly** (`agent-runtime/context.ts`):
- When assembling assistant agent context, if `knowledgeMount` is declared, enumerate files under the declared card-content directory (e.g. `docs/`) and include them as knowledge context files.
- The context builder labels these as "Knowledge base" in the assembled context, distinct from `contextPaths`.

**Workspace operation path resolution** (`agent-runtime/workspace-operations.ts`):
- When the assistant agent performs a workspace operation targeting a path under its own `knowledge/` directory (e.g. `agents/studio-assistant/knowledge/some-doc.md`), the operation layer resolves it to the real card-content path (e.g. `docs/some-doc.md`).
- Resolution is bidirectional: reads pull from the real path, writes sync to the real path.
- The mount is per-agent and declared in `agent.json`, so it is static for a given agent config. Changing the loaded card changes the card-content files, so the mount content swaps automatically.

**Contract changes** (`packages/contracts/src/runtime.ts`):
- Add `knowledgeMount?: string` to `AgentConfig`.

### 4. Self-Improvement Skill

**Skill definition**:
- A new Skill (e.g. `assistant-self-improvement`) that the assistant agent loads and uses after meaningful interactions.
- The Skill's action writes to two targets:
  - `.tsian/local/assistant/notes.md` — personal preferences, recurring corrections, working habits (local, not distributable).
  - Knowledge mount (`docs/` via `agents/studio-assistant/knowledge/`) — organized card knowledge documents (distributable).
- The Skill is automatic and invisible: the assistant agent decides when to invoke it based on conversation signals, without asking the player for confirmation.

**Scope**:
- First version: the Skill maintains `notes.md` only (per the confirmed decision — no `MEMORY.md`).
- `AGENT.md` and `SOUL.md` are not auto-written; they remain player-editable identity/policy files.

## Data Flow

```
Player sends chat message in Assistant app
  → AssistantView.vue sends request to platform-host
  → platform-host resolves assistant agent (local default or card-declared)
  → platform-host assembles agent context:
      - AGENT.md, SOUL.md from .tsian/local/assistant/ (local) or agents/<id>/ (card)
      - notes.md from .tsian/local/assistant/notes.md (local)
      - knowledge files from docs/ (via knowledge mount)
      - contextPaths from agent.json
      - skill index from registry
  → runAgentRuntimeTurn:
      - model call → tool calls (workspace_read, workspace_write, skill_load, etc.)
      - workspace ops resolve mount paths to real card-content paths
      - self-improvement skill may write notes.md and/or knowledge docs
  → assistant reply returned to AssistantView
  → workspace transaction committed (no checkpoint, no turn increment)
```

## Mode Switch Design

- **Default mode**: Uses the player-local assistant agent (`.tsian/local/assistant/`). Card knowledge is still mounted as context. This persists across card changes.
- **Card-specific mode** (optional): Uses the card-declared assistant agent (`manifest.assistant.agentId` → `agents/<id>/`). Available only when the loaded card declares an assistant. Switching is manual via the mode switch in the header.
- The default mode is always selected when a new card is loaded, unless the player explicitly chose card-specific mode for the current session.

## Compatibility And Migration

- **Destructive changes allowed** (prototype phase, per user direction).
- `AgentConfig` gains `knowledgeMount` — existing agents without this field are unaffected (optional field).
- `.tsian/local/` checkpoint exclusion is a tightening of existing behavior; no existing data needs migration because `.tsian/local/` is new.
- The blank card's `studio-assistant` agent.json should be updated to declare `knowledgeMount: "docs/"`.
- The existing `generateAssistantReply` function is reused unchanged; the new assistant chat path wraps it in the same `callModel` callback pattern used by the play turn flow.

## Trade-offs

- **No separate confirmation UI for writes**: the existing runtime tool loop handles workspace writes directly. Destructive operations (delete card content, delete save) remain a product-policy boundary for a future task, but are technically possible through the tool loop today.
- **No soft-link manager**: the knowledge mount is a single hardcoded mount per agent, not a general mount system. This keeps the first slice focused.
- **No MEMORY.md**: a single `notes.md` avoids redundant mental models. If structured long-term memory is needed later, it can become `.tsian/local/assistant/memory/` as a directory, not a competing file.
- **Assistant turn does not checkpoint**: this means assistant-driven workspace writes to `save/` content are committed but not individually restorable. This is acceptable for Q&A/assistance; if the assistant writes to card content via the knowledge mount, those are card content files (not save files) and don't have checkpoint semantics anyway.

## Operational Considerations

- The assistant app should gracefully handle missing AI config (no provider configured) with a clear empty state pointing to Control Panel.
- The assistant app should handle abort/cancel gracefully (player closes window mid-response).
- The mode switch state is session-local (not persisted across app restarts in the first version).
