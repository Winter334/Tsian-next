# Implementation Plan: 完善人类与桌面助手可读项目文档

## Preconditions

- Task status remains `planning` until the user reviews this PRD/design/implement plan.
- Before editing code in Phase 2, load `trellis-before-dev` for the relevant package/layer.
- Phase 2 implementation should keep changes scoped to the PRD decisions; do not expand into default Game Card template docs or all historical docs.

## Phase 2 Checklist

### 1. Human documentation updates

- [ ] Add `docs/active/documentation-map.md` with:
  - documentation layers: human repo docs, platform assistant knowledge, game-card `docs/`;
  - recommended reader paths for newcomers, maintainers, and assistant-knowledge authors;
  - authority/maintenance rules;
  - note that current default card template docs are intentionally not maintained in this task.
- [ ] Update `docs/README.md`:
  - include `active/documentation-map.md` in recommended active docs;
  - align the active docs list with `docs/active/README.md`;
  - keep it as a short navigation/maintenance guide, not a duplicated manual.
- [ ] Update `docs/active/README.md`:
  - add the documentation map to the reading order and active set;
  - document that assistant runtime knowledge lives in `.tsian/local/assistant/skills/framework-knowledge/` and card-specific docs live in each Game Card `docs/`.
- [ ] Update root `README.md` docs section:
  - point to `docs/active/documentation-map.md` and current active docs;
  - describe desktop assistant built-in knowledge as platform generic, not card-specific.
- [ ] Clean top-level `CLAUDE.md`:
  - read it before deletion;
  - if it is the stale old AI entry already identified, delete it;
  - do not replace it with another long AI guide.

### 2. Active docs conflict cleanup

- [ ] Search active docs for stale concepts discovered in PRD:
  - `studio-assistant`, `manifest.assistant`, `assistant.agentId`;
  - `director` default roster claim;
  - `activeSceneIds`;
  - old `master-agent` / `narrative-agent` if present.
- [ ] Update only current active docs where these facts would mislead readers or assistant maintainers:
  - document the current platform-local assistant model `.tsian/local/assistant`;
  - avoid claiming `director` exists in the default template unless code confirms it;
  - prefer `activeSceneRefs` where current direction needs a field name;
  - if a concept is future/deferred rather than implemented, state that explicitly or move it to deferred notes.

### 3. Platform assistant knowledge content

- [ ] In `apps/platform-web/src/storage/local-assistant-files.ts`, replace existing `framework-knowledge` defaults with:

```text
.tsian/local/assistant/skills/framework-knowledge/
  SKILL.md
  references/platform-concepts.md
  references/documentation-boundaries.md
  references/workspace-and-authoring.md
  references/frontend-and-bridge.md
```

- [ ] Keep content Chinese-first, retaining English technical terms and exact paths/API names.
- [ ] Keep `SKILL.md` focused on when to use the knowledge and which reference to read.
- [ ] Keep references conceptual and boundary-focused; do not add troubleshooting SOPs yet.
- [ ] Remove or stop seeding old official reference files:
  - `references/platform-architecture.md`
  - `references/frontend-development.md`
  - `references/memory-system.md`
- [ ] Ensure local assistant default `agent.json` still enables `.tsian/local/assistant/skills/framework-knowledge/SKILL.md` and does not require changes to `AGENT.md` / `SOUL.md`.

### 4. Knowledge refresh API

- [ ] Add a storage helper in `local-assistant-files.ts`, such as:
  - `LOCAL_ASSISTANT_FRAMEWORK_KNOWLEDGE_DIR`
  - `refreshLocalAssistantFrameworkKnowledgeFiles()`
  - result shape with `updatedPaths` and `removedPaths`.
- [ ] Refresh helper behavior:
  - overwrites official `framework-knowledge` files;
  - removes known obsolete official reference files;
  - preserves all non-official paths, including `AGENT.md`, `SOUL.md`, `notes.md`, `agent.json`, custom Tool/Skill files, model/permission config, session/trace files, and current Game Card `docs/`.
- [ ] Add a thin platform-host wrapper in `apps/platform-web/src/platform-host/local-assistant.ts`:
  - `refreshLocalAssistantKnowledge()`.
- [ ] Re-export the wrapper from `apps/platform-web/src/platform-host/index.ts`.

### 5. Assistant config UI

- [ ] Update `apps/platform-web/src/components/assistant/AssistantConfigPanel.vue`:
  - import the new platform-host API and existing `confirm` dialog helper;
  - add `updatingKnowledge` local ref;
  - add an “助手知识库” section after “权限边界” and before “Skills”.
- [ ] UI copy must say:
  - this refreshes platform built-in `framework-knowledge` only;
  - it will not modify assistant identity, style, notes, model config, permissions, custom Tool/Skill, or current Game Card docs.
- [ ] Disable the refresh button while applying/updating or when unsaved config changes exist.
- [ ] On click:
  - show confirmation dialog with explicit overwrite scope;
  - call `refreshLocalAssistantKnowledge()` on confirm;
  - `reload()` after success;
  - emit `change` and show success toast;
  - show error toast on failure.

### 6. AI-facing stale concept checks

- [ ] Run focused grep on assistant-visible knowledge source after edits:

```bash
rg -n "studio-assistant|manifest\.assistant|assistant\.agentId|activeSceneIds|save/world|save/state|event[- ]card|memory-system|master-agent|narrative-agent" apps/platform-web/src/storage/local-assistant-files.ts
```

- [ ] Any remaining hit in platform built-in assistant knowledge must be either removed or justified as not model-facing / not in the refreshed knowledge strings.
- [ ] Run broader docs grep for known conflicts and decide whether each remaining hit is acceptable human-facing historical/deferred context or should be edited:

```bash
rg -n "studio-assistant|manifest\.assistant|assistant\.agentId|activeSceneIds|master-agent|narrative-agent" README.md docs AGENTS.md
```

### 7. Validation

- [ ] Run `git diff --check`.
- [ ] Run `npm run build:web`.
- [ ] If contracts are not changed, skip `npm run build:contracts` and report it as skipped.
- [ ] Manually inspect diff for:
  - no default Game Card template `docs/` maintenance beyond accidental search/edit avoidance;
  - root `CLAUDE.md` removed only after confirming it is stale;
  - no UI wording that implies resetting the whole assistant.

## Rollback points

- If UI/API changes fail build, revert AssistantConfigPanel + platform-host/storage helper changes while keeping pure docs changes if they are correct.
- If assistant knowledge content proves too broad, revert only the string constants/reference file map and keep refresh API/UI if behavior is sound.
- If deletion of `CLAUDE.md` causes unexpected tooling issue, restore a minimal stub that points to `AGENTS.md` and active docs, but do not restore old architecture content.
