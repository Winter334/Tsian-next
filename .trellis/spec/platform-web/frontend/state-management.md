# State Management

The app uses Vue local state, Dexie persistence, and explicit bridge/platform-host APIs. There is no Pinia, Vuex, or global store library.

## Vue State

- Use `ref`, `computed`, and `watch` for view-local state.
- Keep async status visible in local refs such as `feedback`, `settingsError`, or loading flags.
- Route views should refresh from platform/storage APIs after mutations instead of assuming local optimistic state is authoritative.

## Dexie State

- Table shapes live in `storage/db.ts`.
- Prototype schema changes use a new database name, not migrations.
- Multi-table writes should use `localDb.transaction`.
- Current active tables are `meta`, `gameCards`, `gameCardFrontendFiles`, `saves`, `saveSnapshots`, `saveHistory`, `checkpoints`, and `workspaceFiles`.
- Game cards own reusable content files (`contentFiles`) such as Agents, Skills, rules, schemas, docs, assistant metadata, and optional frontend bindings.
- Saves are playthrough slots linked to `gameCardId` / `gameCardVersion`; `workspaceFiles` stores only save runtime data mounted at `save/...` plus host-owned `.tsian/...` metadata.
- Packaged frontend files are reusable Game Card assets stored beside game cards, not copied into save runtime data.
- Built-in game cards may be refreshed by platform seed helpers when their source is `builtin` and their content/manifest is stale. This refresh updates reusable card content; existing saves see the updated card content through the effective workspace layer.
- Checkpoints store snapshot, history, and save runtime files. They do not snapshot card-owned content.

## Runtime State

- `LocalRuntimeEngine` owns the in-memory snapshot.
- `platform-host/index.ts` owns loading snapshots from storage, assembling the effective workspace from card content plus save runtime data, running Agent Runtime turns, persisting successful turns, checkpoint creation, and rollback on failure.
- `interaction.sendMessage` should not persist partial user/assistant messages when the Agent Runtime turn fails.

## Scenario: Current Game Card And Active Save State

### 1. Scope / Trigger

- Trigger: platform-web changes Game Card loading, desktop app context, Play frontend resolution, Workspace/Studio views, or active save selection.

### 2. Signatures

- `getActiveGameCardId(): Promise<string | null>`
- `setActiveGameCardId(cardId: string | null): Promise<void>`
- `getPlatformActiveGameCard(): Promise<LocalGameCardRecord | null>`
- `setPlatformActiveGameCard(cardId: string): Promise<LocalGameCardRecord>`
- `getPlatformActiveSaveId(): Promise<string | null>`
- `selectPlatformSave(saveId: string): Promise<void>`

### 3. Contracts

- The desktop has one currently loaded Game Card stored in `meta["active-game-card-id"]`.
- The active Save Instance is separate state stored in `meta["active-save-id"]`.
- Desktop apps such as Play, Studio, Assistant, and Game entrypoints use the current Game Card by default and must not add their own ordinary card picker.
- Save-scoped runtime work must use the active save's own `gameCardId` when composing an effective workspace.
- Selecting or creating a save updates the current Game Card to that save's card.
- Opening/loading a Game Card may update the current Game Card without requiring a save.
- If no current Game Card is stored, platform initialization may derive one from the active save, first save, or built-in blank card.

### 4. Validation & Error Matrix

- Stored current Game Card id does not exist -> initialize/fall back to an existing card.
- `setPlatformActiveGameCard` receives an unknown card id -> throw a clear error.
- Active save belongs to a different card than current Game Card -> Studio may show card-only content, but save-scoped runtime operations must still use the save's card.
- No active save -> Play/Runtime save-scoped queries may show empty or not-configured states; Studio registry views should still read current card content.

### 5. Good/Base/Bad Cases

- Good: opening a Game Card detail sets the current Game Card, then Studio opens without asking the user to choose a card again.
- Good: selecting a save sets both active save and current Game Card to that save's card.
- Good: Studio can list Agents/Skills from card content when no save exists.
- Base: built-in blank card is the fallback current Game Card for a fresh profile.
- Bad: effective workspace for active save is composed with an unrelated current Game Card.
- Bad: every desktop app implements a separate Game Card picker.

### 6. Tests Required

- Assert current Game Card id persists through refresh.
- Assert opening/loading a Game Card updates current Game Card without creating a save.
- Assert selecting a save updates current Game Card.
- Assert registry/Studio reads can use card content without an active save.
- Assert save-scoped runtime operations compose with the save's own card, not a mismatched current card.

### 7. Wrong vs Correct

#### Wrong

```typescript
const activeCard = await getPlatformActiveGameCard()
return listEffectiveWorkspaceFilesForSave(activeSaveId, activeCard)
```

#### Correct

```typescript
const activeSave = saves.find((save) => save.id === activeSaveId)
const sourceCard = activeSave?.gameCardId
  ? await getLocalGameCard(activeSave.gameCardId)
  : await getBuiltinBlankGameCard()
return sourceCard
  ? listEffectiveWorkspaceFilesForSave(activeSaveId, sourceCard)
  : []
```

## Bridge State

- Bridge payloads must stay framework-neutral and serializable.
- `debug.onTurnDebugReady` is a notification to re-read debug/query resources, not a data transport.
- Remote iframe frontend state is per-mount: the adapter owns the generated bridge session id, accepted iframe origin, and `message` listener cleanup. Do not persist bridge session ids in Dexie or workspace files.
- Remote iframe workspace writes/deletes call `platform.runAction` immediately against `save/...`. They are not part of the Agent Runtime staged transaction used inside `interaction.sendMessage`.

## Avoid

- Do not add compatibility migrations unless explicitly requested.
- Do not store AI/runtime state only in component refs when it must survive navigation.
- Do not reintroduce events/archives as platform-owned required memory tables.
