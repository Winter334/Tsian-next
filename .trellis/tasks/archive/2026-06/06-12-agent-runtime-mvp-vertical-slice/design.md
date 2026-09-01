# Agent Runtime MVP vertical slice design

## 1. Scope Shape

This task is an integrated reset plus vertical slice.

It should not preserve the old workflow/prompt/content framework as a selectable compatibility path. The repository can temporarily become smaller and less feature-complete because the project is still a prototype and has no production users.

Do not split this task into child deliverables for implementation. The cleanup and the new contentless Agent Runtime path are tightly coupled: removing old contracts/storage/UI without the new path leaves the app unusable, while adding the new path without cleanup keeps the old architecture alive.

## 2. Target Runtime Model

The MVP runtime is contentless:

- no builtin content package
- no Grey Salt Town
- no mod library
- no prompt preset library
- no workflow editor
- no event/archive memory model

A save is still a platform-managed AIRP session container. For this MVP it contains:

- metadata: id, name, createdAt, updatedAt
- active runtime snapshot
- conversation history
- checkpoints
- generic state records

The platform does not understand gameplay memory semantics. It only stores generic session/runtime data and conversation state.

## 3. Package Boundaries

### Keep

- `packages/contracts` as the shared type boundary.
- `packages/runtime-core` as the tiny shared runtime interface package.
- `packages/memory-core` only if generic state/schema helpers still compile and remain useful. If it only serves the removed AIRP event/archive projection, remove it from active imports.
- `apps/platform-web` as the browser platform host and concrete runtime implementation.
- `builtin/play-frontends/official-default` as the official default play frontend package, but heavily slimmed.

### Remove From Active Architecture

- `packages/workflow-engine`
- `packages/prompt-engine`
- `apps/platform-web/src/workflow-host`
- `apps/platform-web/src/components/workflow`
- `apps/platform-web/src/components/resource-library`
- `apps/platform-web/src/views/ModListView.vue`
- `apps/platform-web/src/views/ModDetailView.vue`
- `apps/platform-web/src/views/ResourceLibraryView.vue`
- `builtin/mods/grey-salt-town`
- `builtin/mods/default-airp-workflow.ts`
- `builtin/mods/workflow-presets.ts`
- prompt preset / world book / workflow preset storage and seeding

If a file remains for future work, it must not be imported by the active app shell or exported as current architecture.

## 4. Contracts

Contracts should describe the new active platform surface, not old prototype compatibility.

Expected active shapes:

- `ConversationMessageRecord`
- `RuntimeSnapshotShell`
- `RuntimeStateShell`
- `StateRecord`
- `StateWriteOperation`
- `MessageInteractionRequest`
- `MessageInteractionResult`
- `DeepQueryRequest`
- `DeepQueryResult`
- `PlatformContextShell`
- `PlatformActionRequest`
- `PlatformActionResult`
- `AiDebugRecord`
- checkpoint summaries if currently shared with frontends
- `PlayFrontendBridge`
- `PlayFrontendManifest`

Remove or stop exporting current workflow/preset/mod-memory concepts:

- `WorkflowDefinition` and node contracts
- `PromptPreset` / `WorldBook`
- `EventRecord` / `ArchiveRecord`
- `MaintenancePatchDocument`
- event/archive runtime write inputs
- workflow debug snapshot types
- retrieval debug types that assume events/archives
- archive-specific bridge methods

`RuntimeBridge` should be reduced to frontend-safe runtime reads. Event/archive mutation and append-message methods should not be part of the frontend bridge.

## 5. Storage

Use a new local IndexedDB database name or equivalent reset mechanism. Do not migrate `tsian-local-v11`.

Target tables:

- `meta`
- `saves` or `sessions`
- `saveSnapshots`
- `saveHistory`
- `checkpoints`
- `stateRecords`

Remove active tables:

- `events`
- `archives`
- `embeddings` if still only keyed by event/archive
- `promptPresets`
- `worldBooks`
- `workflowPresets`

Checkpoint records should store:

- snapshot
- history
- generic state records

They should not store events/archives.

## 6. Platform Host Turn Flow

`interaction.sendMessage` remains the play frontend entrypoint.

Target flow:

1. Resolve active contentless save/session.
2. Load current snapshot and history.
3. Abort any previous in-flight turn.
4. Build a turn input containing:
   - player input
   - current turn number
   - recent history
   - current runtime snapshot
   - generic state records if useful
5. Call `runAgentRuntimeTurn`.
6. On success:
   - increment turn
   - append user message and assistant message
   - persist snapshot and history
   - create an `after-turn` checkpoint
   - emit turn-ready debug notification
   - return `RuntimeSnapshotShell`
7. On failure:
   - restore pre-turn in-memory snapshot
   - do not persist partial user/assistant messages
   - release turn controller when appropriate
   - rethrow the error

The flow must not call `executeWorkflow`, compile workflow state models, assemble prompt presets, or read builtin mods.

## 7. Agent Runtime

Create a browser-hosted Agent Runtime implementation under `apps/platform-web`, preferably `src/agent-runtime/`.

MVP API shape:

```ts
interface AgentRuntimeTurnInput {
  userInput: string
  recentHistory: ConversationMessageRecord[]
  snapshot: RuntimeSnapshotShell
  stateRecords: StateRecord[]
  signal?: AbortSignal
}

interface AgentRuntimeTurnResult {
  replyText: string
  masterPlan: string
}
```

Capabilities are injected by the platform host:

- model call using the existing browser AI client
- optional generic state read
- abort signal

MVP model calls:

1. `master-agent`
   - input: player message, recent history, minimal snapshot metadata
   - output: concise turn plan / writing brief as plain text
2. `narrative-agent`
   - input: player message, recent history, master plan
   - output: assistant-facing narrative text

Do not parse fragile JSON from the master agent in the MVP. A plain-text brief is enough to prove orchestration without adding structured-output recovery work.

## 8. Frontend

`PlayView` may continue hard-coding `loadOfficialDefaultFrontend`.

Slim `builtin/play-frontends/official-default` into:

- conversation display
- message composer
- simple session/runtime summary
- AI debug inspector
- checkpoint inspector with restore action
- snapshot inspector

Remove from the official frontend:

- mod overview
- event/archive stats and panels
- workflow panel
- retrieval panel if it only reflects the old event/archive retriever
- globals demo controls

Platform app shell:

- keep Lobby, Settings, Debug, Play
- remove nav links and routes for Mod and Resources
- Lobby should provide a way to create/enter a contentless session
- Settings should keep the model configuration needed by the MVP Agent Runtime and remove legacy retrieval/embedding controls if no active code uses them

## 9. Debug

Keep useful observability:

- AI debug records
- current snapshot
- history
- checkpoints

Remove current-runtime presentation of:

- workflow outputs
- retrieval debug tied to event/archive memory
- events/archives

AI debug should show separate calls labeled `master-agent` and `narrative-agent`.

## 10. Compatibility And Rollback

No old local data migration.

Rollback is git-based. Since this is a reset, the safest rollback point is before deleting old packages and routes. Implementation should keep commits/changes grouped enough that the user can inspect the cleanup before later feature work builds on it.

## 11. Tradeoffs

- Removing old content and memory structures reduces immediate demo richness but protects the new architecture from old assumptions.
- Keeping the Agent Runtime in `apps/platform-web` avoids premature package abstraction but means a future server/runtime package will need a later extraction step.
- Two model calls are slower than one but prove the master/specialist architecture immediately.
- Hard-coded smoke-test instructions avoid building a new configuration UI that would likely be replaced by runtime/content packages.

