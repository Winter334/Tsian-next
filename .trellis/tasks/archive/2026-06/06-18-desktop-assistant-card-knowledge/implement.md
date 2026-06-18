# Implementation Plan: Desktop Assistant App And Card Knowledge

## Ordered Checklist

### Phase 1: Contracts & Storage Foundation

1. **Add `knowledgeMount` to `AgentConfig`**
   - File: `packages/contracts/src/runtime.ts`
   - Add optional `knowledgeMount?: string` field to `AgentConfig`.
   - Run contract build to verify no breakage.

2. **Exclude `.tsian/local/` from save checkpoint/restore**
   - File: `apps/platform-web/src/storage/workspace.ts`
   - In `isSaveRuntimePersistencePath`, add early return `false` for paths starting with `.tsian/local/` before the existing `.tsian/` check.
   - Verify: existing `.tsian/traces`, `.tsian/checkpoints`, `.tsian/indexes`, `.tsian/cache` still pass the filter.

3. **Seed local assistant files**
   - File: `apps/platform-web/src/storage/workspace.ts` (or a new helper)
   - Add seeding logic for `.tsian/local/assistant/notes.md`, `.tsian/local/assistant/AGENT.md`, `.tsian/local/assistant/SOUL.md` when the assistant app is first opened and no local assistant data exists.
   - These are default templates; the player can customize them.

4. **Update blank card's `studio-assistant` agent.json**
   - File: `apps/platform-web/src/storage/workspace.ts`
   - Add `knowledgeMount: "docs/"` to the studio-assistant agent config.

### Phase 2: Knowledge Mount Resolution

5. **Implement mount path resolution in workspace operations**
   - File: `apps/platform-web/src/agent-runtime/workspace-operations.ts`
   - When the assistant agent targets a path under `agents/<agentId>/knowledge/`, resolve it to the `knowledgeMount` target (e.g. `docs/`).
   - Resolution applies to read, list, search, patch, write, and delete operations.
   - The mount source is read from the agent's `knowledgeMount` field in `agent.json`.

6. **Extend context assembly for knowledge mount**
   - File: `apps/platform-web/src/agent-runtime/context.ts`
   - When `knowledgeMount` is declared, enumerate files under the target directory and include them as knowledge context in the assembled `AgentContextEntry`.

7. **Update agent registry to parse `knowledgeMount`**
   - File: `apps/platform-web/src/agent-runtime/registry.ts`
   - Parse `knowledgeMount` from `agent.json` and include it in `AgentRegistryEntry`.

### Phase 3: Assistant Chat Entry Path

8. **Add assistant-chat platform-host action**
   - File: `apps/platform-web/src/platform-host/index.ts`
   - New request handler for assistant chat that:
     - Resolves the active assistant agent (local default or card-declared based on mode).
     - Assembles agent context from the effective workspace.
     - Calls `runAgentRuntimeTurn` with the chat message.
     - Commits workspace transaction on success (no checkpoint, no turn increment).
     - Returns the reply text.

9. **Wire up workspace mutations for assistant turns**
   - The assistant chat path needs its own workspace mutation handlers, similar to the play turn but without save snapshot/checkpoint staging.
   - `card-content` scope writes (via knowledge mount) should be allowed for the assistant agent when it has `workspace_write` permission.

### Phase 4: Desktop App UI

10. **Register assistant desktop app**
    - File: `apps/platform-web/src/desktop-apps.ts`
    - Add `"assistant"` to `DesktopAppId`.
    - Add `DesktopAppDefinition` with `Bot` icon, route `/assistant`, component `AssistantView`.

11. **Add assistant route**
    - File: `apps/platform-web/src/router/index.ts`
    - Add `{ path: "/assistant", name: "assistant", component: () => import("../views/AssistantView.vue") }`.

12. **Create AssistantView.vue**
    - File: `apps/platform-web/src/views/AssistantView.vue`
    - Chat-first layout: message list, input bar, mode switch in header.
    - Card context indicator (card name).
    - Empty states for no card, no save, no assistant metadata.
    - Calls the platform-host assistant-chat action.

### Phase 5: Self-Improvement Skill

13. **Create assistant self-improvement Skill**
    - Files: Skill definition in the workspace template (`apps/platform-web/src/storage/workspace.ts`).
    - The Skill action writes to `.tsian/local/assistant/notes.md` and through the knowledge mount to `docs/`.
    - Automatic invocation: the assistant agent's AGENT.md instructs it to use this Skill when it detects durable preferences or corrections.

14. **Enable the Skill for the assistant agent**
    - Update the local assistant's `agent.json` to include the self-improvement Skill in `skills.enabled`.

### Phase 6: Verification

15. **Build verification**
    - `npm run build:web` passes.
    - `npm run build:contracts` passes if contract shapes changed.

16. **Manual verification checklist**
    - Assistant app opens from desktop shell.
    - Chat works with a loaded card (can ask about card content).
    - Mode switch appears when card declares an assistant.
    - `.tsian/local/assistant/notes.md` is seeded and editable.
    - Knowledge mount: writing through `agents/<id>/knowledge/` appears in `docs/`.
    - Checkpoint/restore does not include `.tsian/local/` files.
    - Empty states work (no card, no save, no AI config).

## Validation Commands

```bash
npm run build:contracts
npm run build:web
```

## Risky Files / Rollback Points

- `packages/contracts/src/runtime.ts` — contract change; all consumers must be checked.
- `apps/platform-web/src/storage/workspace.ts` — checkpoint filter change; verify with existing save tests.
- `apps/platform-web/src/agent-runtime/workspace-operations.ts` — mount resolution; verify existing agents without `knowledgeMount` are unaffected.
- `apps/platform-web/src/platform-host/index.ts` — new action handler; verify it doesn't interfere with existing play turn flow.

## Follow-Up Checks Before `task.py start`

- [ ] PRD reviewed by user.
- [ ] design.md reviewed by user.
- [ ] implement.md reviewed by user.
- [ ] No remaining open questions in PRD.
