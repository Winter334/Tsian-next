# Card-Owned Content And Save Runtime Data Model Design

## Current State

The current local model is save-scoped:

- `gameCards.workspaceTemplateFiles` stores the reusable template.
- `createLocalSaveFromGameCard()` copies template files into `workspaceFiles` for the new save.
- Runtime, workspace tools, Agent registry, Skill registry, Skill detail, bridge queries, checkpointing, and debug surfaces read save-scoped `workspaceFiles`.
- Checkpoints include snapshot, history, and workspace files.

This makes every save a copied game definition. That no longer matches the desired product model.

## Target Model

The target model has two layers:

1. Game Card content layer
   - Owned by the Game Card.
   - Contains Agents, Skills, schemas, rules, author docs, canonical setup, frontend-facing definitions, manifest metadata, cover, assistant metadata, and frontend binding.
   - Edits affect existing and future saves for that Game Card.

2. Save runtime data layer
   - Owned by one Save Instance / save slot.
   - Contains dialogue/history, generated entities, maps, relationships, memory, current scene, frontend view state, and other playthrough state.
   - Checkpointed and restored with the save.

Runtime code should consume an effective workspace:

```text
effective workspace = selected Game Card content + selected Save Instance runtime data
```

The platform still should not understand gameplay semantics such as NPCs, maps, or relationships. Those remain files described by card content, schemas, README files, Agents, Skills, and frontends.

## Storage Direction

The exact table names can be settled during implementation, but the conceptual split should be:

- Game Card content files live beside `LocalGameCardRecord`, replacing or redefining the current `workspaceTemplateFiles` semantics.
- Save runtime files are keyed by `saveId`.
- Save records keep `gameCardId` and may keep `gameCardVersion` for diagnostics/version prompts, but card edits are live by default.
- Packaged frontend files remain card assets, not save data.
- Platform `.tsian/*` metadata remains platform-owned and hidden from ordinary workspace APIs.

Prototype local database reset is acceptable if the table shape changes.

## Save Directory UX

User-facing UI should present saves as a larger save directory under the selected card. Each child directory or file is one playthrough/save slot and contains that playthrough's runtime data:

```text
saves/
  save-a/
    history/
    state/
    memory/
    frontend/
  save-b/
    history/
    state/
    memory/
    frontend/
```

Runtime-facing APIs should avoid encouraging Agents to inspect or mutate other save slots by accident. The selected save's runtime data is exposed through a stable `save/` mount in the effective workspace:

```text
save/
  history/
  state/
  world/
  memory/
  frontend/
```

Workspace Studio and card detail UI may show the broader `saves/<save-id>/...` management view, but ordinary runtime reads/writes, Skill SDK workspace APIs, and frontend bridge workspace APIs should operate against the selected slot through `save/...`.

## Effective Workspace Reads

Consumers that currently read save-scoped workspace files should move to an effective workspace helper:

- Agent Runtime prompt composition;
- `agent-registry`;
- `agent-context`;
- `skill-registry`;
- `skill-detail`;
- workspace read/list/search bridge queries;
- frontend bridge queries;
- diagnostics that summarize runtime-visible content.

Effective workspace composition should be deterministic:

- card content files are available at their card paths;
- active save runtime files are available under `save/`;
- `save/` is a reserved effective-workspace root for selected save runtime data, so Game Card content must not define card-owned files below `save/`;
- conflicts between card content and reserved runtime/platform roots should be rejected during normalization/import/editing rather than silently layered;
- `.tsian/*` remains hidden from ordinary read/list/search.

## Writes

Writes need an explicit target:

- Runtime Agent/Skill writes during play should write save runtime data by default.
- Frontend bridge save-state writes should write save runtime data by default.
- Card authoring UI writes should write Game Card content.
- Runtime writes to `save/...` map to selected save runtime data. Card authoring writes cannot target `save/...` as card-owned content.
- `.tsian/*` writes stay platform-only.

Do not silently route a card-content edit into save data or a save-runtime mutation into card content.

## Checkpoints

Checkpoints should snapshot and restore save runtime data plus runtime snapshot/history. They should not duplicate or roll back card-owned content by default.

This means a restored old checkpoint still runs against the current Game Card content, unless a later version-pinning feature is added.

## Package Import And Export

Game Card package export should include:

- `game-card.json`;
- card-owned content files;
- optional packaged frontend files;
- cover assets when supported.

It should exclude:

- save slots/runtime data;
- checkpoints;
- runtime traces;
- player-mutated state;
- AI debug records.

Importing a Game Card package should create or update card-owned content only. It should not create save slots.

## Compatibility And Migration

This is a prototype. If implementation changes IndexedDB schema shape, use a new local database name rather than compatibility migrations unless the user explicitly asks for migration.

Active docs and Trellis specs must be updated because they currently state that Runtime Workspace is save-scoped and that saves are full card-derived workspace copies.

## Risks

- Existing saves may break when card content changes. Mitigation: later add duplicate card, version pinning, or save-upgrade UI.
- Runtime tools may accidentally write card content during play. Mitigation: default runtime writes target save data and require explicit authoring APIs for card content.
- Effective workspace path collisions may confuse Agents. Mitigation: choose a stable save-data mount and document reserved paths.
- UI may expose save-data structure as gameplay semantics. Mitigation: keep platform file-based and let card schemas/docs explain meaning.
