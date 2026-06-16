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

## Bridge State

- Bridge payloads must stay framework-neutral and serializable.
- `debug.onTurnDebugReady` is a notification to re-read debug/query resources, not a data transport.
- Remote iframe frontend state is per-mount: the adapter owns the generated bridge session id, accepted iframe origin, and `message` listener cleanup. Do not persist bridge session ids in Dexie or workspace files.
- Remote iframe workspace writes/deletes call `platform.runAction` immediately against `save/...`. They are not part of the Agent Runtime staged transaction used inside `interaction.sendMessage`.

## Avoid

- Do not add compatibility migrations unless explicitly requested.
- Do not store AI/runtime state only in component refs when it must survive navigation.
- Do not reintroduce events/archives as platform-owned required memory tables.
