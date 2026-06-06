# memory-core Authoring Specs

`packages/memory-core` owns runtime memory schema values and validation helpers. It depends on `@tsian/contracts` for shared shapes and must not own platform storage, Dexie tables, Vue state, workflow scheduling, or AIRP retrieval algorithms.

Use this layer when adding or changing default memory schemas, memory schema validation, or generic state write operation validation.

| Guide | Use When | Status |
|-------|----------|--------|
| [Memory Schema Contracts](./memory-schema.md) | Editing schema values, validators, or write operation behavior | Filled |

## Required Checks

- Run `npm run build:contracts` when memory-core depends on changed contract shapes.
- Run `npm run build:memory-core` for every memory-core change.
- Run `npm run test --workspace @tsian/memory-core` for schema or validator changes.
- Run `npm run build:web` when platform-web storage or workflow executors consume the changed behavior.

## Source References

- `packages/contracts/src/memory.ts`
- `packages/contracts/src/runtime.ts`
- `packages/memory-core/src/default-airp-schema.ts`
- `packages/memory-core/src/validation.ts`
- `apps/platform-web/src/storage/state-records.ts`
