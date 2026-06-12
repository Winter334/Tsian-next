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
- Current active tables are `meta`, `saves`, `saveSnapshots`, `saveHistory`, `checkpoints`, and `stateRecords`.
- Checkpoints store snapshot, history, and generic state records only.

## Runtime State

- `LocalRuntimeEngine` owns the in-memory snapshot.
- `platform-host/index.ts` owns loading snapshots from storage, running Agent Runtime turns, persisting successful turns, checkpoint creation, and rollback on failure.
- `interaction.sendMessage` should not persist partial user/assistant messages when the Agent Runtime turn fails.

## Bridge State

- Bridge payloads must stay framework-neutral and serializable.
- `debug.onTurnDebugReady` is a notification to re-read debug/query resources, not a data transport.

## Avoid

- Do not add compatibility migrations unless explicitly requested.
- Do not store AI/runtime state only in component refs when it must survive navigation.
- Do not reintroduce events/archives as platform-owned required memory tables.
