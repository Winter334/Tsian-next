# Agent Runtime MVP vertical slice implementation plan

## 0. Pre-Implementation Gate

- [ ] User reviews `prd.md`, `design.md`, and this `implement.md`.
- [ ] Task is activated with `task.py start` only after review approval.
- [ ] Load `trellis-before-dev` before editing code.
- [ ] Read relevant specs:
  - `.trellis/spec/guides/index.md`
  - `.trellis/spec/platform-web/frontend/index.md`
  - `.trellis/spec/contracts/backend/index.md`
  - `.trellis/spec/contracts/frontend/index.md`
  - `.trellis/spec/runtime-core/backend/index.md`
  - `.trellis/spec/runtime-core/frontend/index.md`

## 1. Workspace And Package Cleanup

- [ ] Remove `packages/workflow-engine` from npm workspaces and root scripts.
- [ ] Remove `packages/prompt-engine` from npm workspaces and root scripts.
- [ ] Delete or deactivate `packages/workflow-engine`.
- [ ] Delete or deactivate `packages/prompt-engine`.
- [ ] Remove `@dagrejs/dagre`, `@vue-flow/*`, and other workflow-editor-only dependencies if no active imports remain.
- [ ] Update package lock with the normal npm workflow after package/workspace changes.
- [ ] Remove old builtin mod/workflow content:
  - `builtin/mods/grey-salt-town`
  - `builtin/mods/default-airp-workflow.ts`
  - `builtin/mods/workflow-presets.ts`
  - old builtin mod index exports

## 2. Contract Reset

- [ ] Simplify `packages/contracts/src/runtime.ts`:
  - keep conversation, JSON, snapshot, state records, message interaction, query, platform action, and runtime write shapes that remain generic
  - remove event/archive-specific records and patch/write shapes
- [ ] Simplify `packages/contracts/src/bridge.ts`:
  - keep `getRuntimeSnapshot`, `sendMessage`, `query`, `platform.runAction`, and useful debug methods
  - remove archive marking, AIRP patch, direct append-message, and globals demo bridge methods
- [ ] Simplify `packages/contracts/src/debug.ts`:
  - keep AI debug
  - remove workflow debug and event/archive retrieval debug
  - add checkpoint/debug summary types if needed by the slim frontend
- [ ] Remove or stop exporting `preset.ts`, `workflow.ts`, and old mod content contracts from `packages/contracts/src/index.ts`.
- [ ] Build contracts before moving too far:
  - `npm run build:contracts`

## 3. Storage Reset

- [ ] Change Dexie database name to a new reset name.
- [ ] Reduce `apps/platform-web/src/storage/db.ts` to active tables:
  - `meta`
  - `saves` or `sessions`
  - `saveSnapshots`
  - `saveHistory`
  - `checkpoints`
  - `stateRecords`
- [ ] Remove old table interfaces and stores:
  - events
  - archives
  - embeddings if still event/archive-only
  - promptPresets
  - worldBooks
  - workflowPresets
- [ ] Rewrite save/session creation so it creates a contentless session without `modId`.
- [ ] Rewrite checkpoint creation/restore so checkpoints contain snapshot, history, and state records only.
- [ ] Keep generic state-record helpers if they compile cleanly after contract reset.
- [ ] Remove storage modules that only served old architecture:
  - resources
  - events
  - archives
  - airp-memory compatibility projection
  - event/archive runtime-write
  - event/archive embeddings

## 4. Platform Host Reset

- [ ] Remove workflow-host imports and workflow source resolution from `apps/platform-web/src/platform-host/index.ts`.
- [ ] Remove builtin mod imports and mod-static/builtin-mod query resources.
- [ ] Remove events/archives query resources and old runtime write actions.
- [ ] Remove workflow-debug and retrieval-debug resources.
- [ ] Keep or simplify resources:
  - `history`
  - `checkpoints`
  - `ai-debug`
  - snapshot access through `runtime.getRuntimeSnapshot`
- [ ] Preserve restore-checkpoint action.
- [ ] Add or preserve contentless session creation/selection helpers for Lobby and Play.
- [ ] Replace `interaction.sendMessage` implementation with the Agent Runtime turn flow.
- [ ] Preserve abort behavior with a per-turn `AbortController`.
- [ ] Preserve failure rollback so partial messages are not persisted.

## 5. Agent Runtime

- [ ] Add `apps/platform-web/src/agent-runtime/`.
- [ ] Define turn input/result types locally or in contracts only if needed across package boundaries.
- [ ] Add hard-coded smoke-test instructions for:
  - master agent
  - narrative agent
- [ ] Implement `runAgentRuntimeTurn`.
- [ ] Inject the model-call capability from platform-host using `generateAssistantReply`.
- [ ] Label calls as `master-agent` and `narrative-agent`.
- [ ] Use recent conversation history and current player input for both calls.
- [ ] Treat master-agent output as a plain-text writing brief.
- [ ] Return narrative-agent text as `replyText`.

## 6. App Shell And Views

- [ ] Remove `/mod`, `/mod/:id`, and `/resources` routes.
- [ ] Remove Mod and Resources links from `App.vue`.
- [ ] Update `LobbyView.vue`:
  - remove builtin mod counts and mod-library copy
  - add contentless session start/continue path
  - keep status focused on local storage, sessions, and model config
- [ ] Update `SettingsView.vue`:
  - keep chat model config used by Agent Runtime
  - remove legacy retrieval/embedding/retrieval-settings controls if unused
- [ ] Update `DebugView.vue`:
  - keep AI debug, history/snapshot/checkpoints
  - remove workflow, retrieval, events, archives

## 7. Official Default Frontend

- [ ] Slim `builtin/play-frontends/official-default/src/index.ts`.
- [ ] Keep:
  - conversation history
  - message composer
  - AI debug
  - checkpoints with restore
  - snapshot viewer
  - simple runtime/session summary
- [ ] Remove:
  - mod overview
  - event/archive stats and tabs
  - retrieval tab
  - workflow tab
  - globals demo controls
- [ ] Keep `PlayView.vue` loading `official-default`; do not add a frontend registry.

## 8. Documentation Cleanup

- [ ] Update stale docs that would mislead future development, especially:
  - `packages/runtime-core/README.md`
  - `docs/active/current-state-handoff.md`
  - root `README.md` if it names old active packages/routes
- [ ] Do not preserve old workflow/prompt docs as current reference material.

## 9. Validation

- [ ] `npm run build:contracts`
- [ ] `npm run build:runtime-core`
- [ ] `npm run build:web`
- [ ] `git diff --check`
- [ ] Search checks:
  - `rg "@tsian/(workflow-engine|prompt-engine)" .`
  - `rg "Grey Salt|grey-salt|workflow-debug|assemblePromptFromPreset|executeWorkflow" apps packages builtin`
  - `rg "EventRecord|ArchiveRecord|WorkflowDefinition|PromptPreset|WorldBook" packages/contracts apps/platform-web/src builtin/play-frontends`
- [ ] Start local dev server and verify with browser tooling:
  - app loads with no builtin content
  - contentless session can be created/entered
  - sending a message triggers two AI debug records
  - assistant reply appears
  - checkpoint is created
  - restore checkpoint works

## 10. Risk And Rollback Points

- Contract reset is the highest blast-radius step. If builds become noisy, stop and restore contracts to a smaller intermediate shape before continuing.
- Storage reset intentionally discards old local data; do not add migration code while debugging.
- UI cleanup can reveal hidden imports from deleted contracts. Remove the importing route/component instead of reintroducing old types.
- If two-step Agent Runtime fails due to model format or latency, keep the two calls but simplify prompts; do not collapse to workflow or prompt preset code.

