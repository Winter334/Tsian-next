# Agent Runtime MVP vertical slice

## Goal

Build the first runnable vertical slice of the new Agent-Orchestrated AIRP Runtime direction.

The MVP should first remove or retire the old prototype framework pieces that would keep pulling the project back toward workflow-as-system, then let a player send a message through the existing play frontend bridge, have the platform host run an Agent Runtime turn instead of the old fixed workflow main chain, append the generated narrative reply to the save's conversation, and keep the current save/checkpoint/debug basics usable.

## User Value

- Proves the new architecture with a playable path, not just documents.
- Moves the project away from workflow-as-system and SillyTavern prompt preset assembly as the default AIRP turn engine.
- Gives later work a concrete boundary for master agent orchestration, specialist agents, tools, memory, state updates, and frontend package rendering.
- Keeps the current UI usable while the runtime internals change.
- Reduces semantic-search and maintenance noise by removing obsolete prototype code instead of preserving it as a compatibility burden.

## Confirmed Facts

- The current direction document says Tsian is now an Agent-Orchestrated AIRP Runtime platform.
- `interaction.sendMessage` is the current player input boundary used by play frontends.
- `apps/platform-web/src/platform-host/index.ts` currently handles save loading, turn increment, workflow execution, assistant message append, compatibility memory sync, checkpoint creation, and debug notification in one large path.
- The current workflow path builds macros, resolves a workflow, compiles workflow state model links, executes workflow nodes, and expects `workflowResult.results.reply` to be a string.
- `RuntimeSnapshotShell.state.messages` is the existing frontend-readable conversation surface.
- The current browser AI client already supports OpenAI-compatible chat calls, abort signals, AI debug records, and usage capture.
- The old retrieval helper is built around events/archives AIRP memory and should not be reused as the MVP's current runtime retrieval tool.
- State records already exist through local save-scoped storage helpers and are closer to generic runtime data than events/archives.
- The old workflow editor, prompt engine, workflow engine, and state model code remain in the repository as prototype implementation, but they are no longer the long-term direction.
- There are no production users or compatibility promises yet; the project is still in prototype development, so destructive cleanup is acceptable when it supports the new architecture.
- Old workflow/prompt concepts are currently spread across `contracts`, builtin mods, platform host, resource-library UI, debug UI, the official default frontend inspector, and workspace scripts.
- Current save creation depends on `defaultModId` and `createBuiltinModInitialSavePayload`; deleting Grey Salt Town requires a platform change that supports contentless/empty saves.
- `runtime-core` currently has a strong Trellis spec constraint: it should stay a tiny shared interface package, while browser/platform runtime implementation belongs in `apps/platform-web`.
- `packages/runtime-core/README.md` still contains older guidance about putting AI chain / memory / state flows there; this is stale relative to `.trellis/spec/runtime-core`.
- Current app navigation exposes `/mod`, `/mod/:id`, and `/resources`.
- `ResourceLibraryView` is centered on prompt presets, world books, and workflow presets.
- `ModListView` and `ModDetailView` are centered on builtin mods, mod saves, manifest workflow preview, archives, and event catalogs.
- `DebugView` still includes workflow-output visualization; its AI, checkpoint, and snapshot sections remain useful for the new runtime.
- Current Dexie setup already uses a prototype reset pattern: `TsianLocalDb` is named `tsian-local-v11` with a comment saying the prototype directly switches DB names instead of migrating old structures.
- Current local storage includes old prototype tables for prompt presets, world books, and workflow presets.
- Legacy AIRP memory concepts are broadly coupled: `events`, `archives`, player archive IDs, patch application, runtime write actions, retrieval, checkpoints, DebugView, and the official default frontend inspector all expose them.
- `stateRecords` is closer to generic save-scoped storage than the legacy `events` / `archives` domain model.
- `PlayView` currently hard-codes `loadOfficialDefaultFrontend`; there is not yet a general frontend package registry in active use.
- The official default frontend currently renders mod overview, events, archives, workflow debug, retrieval debug, checkpoint data, snapshot data, and a globals demo. It is more old-prototype inspector than contentless runtime shell.

## Decisions

- Use a medium-high cleanup strategy for the prototype reset.
- Remove old workflow/prompt active surfaces instead of keeping a user-selectable legacy path.
- Preserve platform foundations and reusable capabilities that still fit the new boundary.
- Accept a large diff because the project has no production users or compatibility promises yet.
- Do not preserve Grey Salt Town as default content; it was designed to test the old workflow/memory system and should be removed during the reset.
- Do not add a replacement default content package in this task. The platform should temporarily support having no default content at all.
- Contentless sessions should still be able to enter the play surface and call the Agent Runtime as an infrastructure smoke path.
- Implement the first Agent Runtime inside the browser platform host area (`apps/platform-web`), not as a new shared workspace package.
- Remove current mod library, mod detail, and resource-library routes/UI from the app shell during this reset.
- Keep the debug surface only where it supports the new runtime: AI debug, checkpoints, and snapshots can stay; workflow and legacy retrieval debug should be removed.
- Do not migrate old IndexedDB saves/resources. Old local prototype data may be discarded by switching to a new local schema/database.
- Remove legacy AIRP memory structures from the active platform model: `events`, `archives`, AIRP compatibility projection, player archive IDs, and event/archive-specific bridge/query/debug surfaces.
- Slim down the existing official default play frontend rather than creating a new minimal frontend package.
- Use a two-step MVP Agent Runtime call chain: master-agent planning first, then narrative-agent generation.
- Do not add an agent instruction editor or temporary configuration UI in this task.

## Requirements

- Add a first-class Agent Runtime turn path for AIRP play turns.
- Keep the existing frontend-facing `interaction.sendMessage` contract working for the official default play frontend.
- Keep the platform responsible for save lifecycle, aborting stale turns, model-call capability, storage access, checkpoint creation, and bridge boundaries.
- Put AIRP turn composition behind an Agent Runtime boundary rather than inside workflow executor code.
- Remove old workflow/prompt framework surfaces before rebuilding the new play-turn path where keeping them would create compatibility drag.
- Remove Grey Salt Town and old builtin workflow test content rather than adapting them to the new runtime.
- Support a temporary no-default-content state instead of replacing Grey Salt Town with another builtin mod.
- Allow the platform to start and show useful empty states when no builtin content packages exist.
- Allow creating or entering a contentless play session that can send player input through the Agent Runtime.
- Keep `packages/runtime-core` as the shared runtime interface package; do not put browser-hosted Agent Runtime implementation there.
- Remove `/mod`, `/mod/:id`, and `/resources` as active routes for this MVP.
- Remove old workflow debug visualization from the active debug UI.
- Use a fresh local persistence shape for the reset; do not write migration code for old saves, workflow resources, prompt presets, world books, or Grey Salt Town data.
- Keep generic save/session storage such as conversation history, snapshots, checkpoints, and generic state/runtime records.
- Do not keep event/archive patching, runtime write, retrieval, or debug behavior as current platform semantics.
- Rework `builtin/play-frontends/official-default` into a contentless chat/runtime inspector surface.
- Do not introduce frontend package registry/default-selection changes in this task.
- The contentless runtime path should make one master-agent model call with recent history and player input, then one narrative-agent model call with the master output and recent history.
- Agent instructions for the MVP may be hard-coded browser-hosted smoke-test defaults. Future customization should come from runtime/content package configuration.
- Implement a minimal master-agent plus narrative-agent flow sufficient to produce a playable assistant reply.
- Use recent conversation history and generic runtime/session state as the MVP context source. Do not build a replacement retrieval system in this task.
- Avoid using the SillyTavern prompt preset engine for the MVP agent prompt assembly.
- Avoid requiring a visual workflow editor or fixed DAG for the new default play turn.
- Keep memory management and MVU/state-maintenance agents out of the hard MVP unless needed to preserve current basic playability.
- Preserve current local AI configuration behavior for model calls.
- Preserve rollback behavior on failed turn execution: do not leave a half-written user/assistant turn as the active runtime state.
- Do not keep a user-selectable old workflow path for the MVP.
- Keep or salvage only the parts of the prototype that still match the new boundary: package loading, save lifecycle, bridge API, AI config/client/debug, generic storage, and the official frontend shell.

## Acceptance Criteria

- [ ] Sending a message from the official default play frontend can complete through the Agent Runtime path and append an assistant narrative reply to the conversation.
- [ ] The generated narrative path does not call `executeWorkflow` or `assemblePromptFromPreset`.
- [ ] The default play path has no runtime switch back to the old workflow main chain.
- [ ] Removed old workflow/prompt packages, contracts, routes, UI, and builtin content do not remain as active architecture surfaces.
- [ ] Grey Salt Town is not retained as the default mod/content path after the reset.
- [ ] The platform can load with zero builtin content packages.
- [ ] Save/session creation no longer requires a default builtin mod.
- [ ] A contentless session can enter the play surface, send a player message, receive an Agent Runtime assistant reply, and persist a checkpoint.
- [ ] The first Agent Runtime implementation lives under `apps/platform-web` and receives platform capabilities by injection.
- [ ] The app shell no longer links to mod library, mod detail, or resource-library routes.
- [ ] Debug UI no longer presents workflow execution as a current runtime concept.
- [ ] The reset does not attempt to migrate old IndexedDB prototype data.
- [ ] Active contracts and platform storage no longer expose events/archives as required AIRP memory concepts.
- [ ] Checkpoints and debug views no longer require event/archive payloads.
- [ ] The official default play frontend no longer renders mod overview, event/archive panels, workflow debug, or globals demo controls.
- [ ] AI debug shows separate master-agent and narrative-agent model calls for a completed contentless turn.
- [ ] No new prompt/resource/agent configuration UI is introduced for MVP smoke-test instructions.
- [ ] The Agent Runtime turn path uses platform-host-provided tools/capabilities rather than directly reaching into frontend bridge objects.
- [ ] The runtime includes recent conversation history in the master-agent and narrative-agent calls.
- [ ] Existing AI debug records still show the model request made by the Agent Runtime path.
- [ ] Successful turns still create a save checkpoint and return a `RuntimeSnapshotShell`.
- [ ] Failed turns restore the pre-turn snapshot and do not leave partial user/assistant messages as active state.
- [ ] `npm run build:contracts`, `npm run build:runtime-core`, and `npm run build:web` pass.

## Out of Scope

- A visual Agent editor.
- User-facing custom agent/package authoring UI.
- Multi-agent concurrency beyond the minimal master-to-narrative call needed for the MVP.
- A complete memory Agent, state/MVU Agent, or context compression Agent.
- A new frontend package protocol or iframe/postMessage bridge migration.
- Platform-level renderer blocks, UI DSL, or generated frontend-code standard.
- Server-side provider/key management.
- A full replacement AIRP test module with rich story, memory, and status data.
- Any replacement builtin content package.

## Open Questions

1. None.
