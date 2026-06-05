# Memory Schema Contracts

## Scenario: Runtime Memory Schema Core

### 1. Scope / Trigger

- Trigger: changing `packages/contracts/src/memory.ts`, `packages/memory-core/src/default-airp-schema.ts`, `packages/memory-core/src/validation.ts`, or `apps/platform-web/src/storage/memory.ts`.
- Goal: keep memory schema shapes, default AIRP runtime schema, validators, and current custom memory write behavior aligned.

### 2. Signatures

- Type owner: `packages/contracts/src/memory.ts`
  - `MemorySchemaDefinition`
  - `MemoryCollectionDefinition`
  - `MemoryFieldDefinition`
  - `MemoryFieldRelation`
  - `MemoryIndexDefinition`
  - `MemoryValidationIssue`
- Operation owner: `packages/contracts/src/runtime.ts`
  - `MemoryWriteOperationType = "upsert" | "patch" | "delete" | "clear"`
  - `MemoryWriteOperation`
- Runtime value/validator owner: `packages/memory-core`
  - `defaultAirpMemorySchema`
  - `validateMemorySchema(schema)`
  - `assertValidMemorySchema(schema)`
  - `validateMemoryWriteOperation(schema, operation, defaults?)`
  - `normalizeMemoryWriteOperation(schema, operation, defaults?)`

### 3. Contracts

- `packages/contracts` remains type-only. Do not add schema constants, validators, error classes, or package dependencies there.
- `packages/memory-core` may export runtime constants and validators, but must stay storage-agnostic and framework-neutral.
- Default AIRP schema covers runtime memory only:
  - `events`
  - `archives`
  - `globals`
- Catalog events are author/static mod content and belong to a future author-content schema, not runtime memory schema.
- Field schema uses the project lightweight model, not JSON Schema. Additive extensions should be new optional fields or new field types.
- Relationships are field metadata, such as `entityArchiveIds -> archives.id`.
- Unknown fields are rejected by default; a collection may explicitly opt in with `additionalFields: { type: "json" }`.
- `patch` is shallow: it updates top-level record fields only. Nested objects are replaced as complete values.
- Platform custom memory storage must recognize every `MemoryWriteOperationType` exposed by contracts. It does not need to apply default AIRP event/archive storage migration.
- The `memory-write` workflow executor is the current schema validation boundary for workflow-provided operations. Dexie storage helpers stay storage-only and must not own schema semantics.
- MVP built-in schema policy: validate operations whose resolved target is `defaultAirpMemorySchema.defaultNamespace` plus a collection declared by `defaultAirpMemorySchema`; custom namespace/collection targets remain storage-only until memory schema resources exist.
- Schema-covered operations may be normalized with the schema default namespace before storage writes. Custom storage-only operations must not silently inherit the built-in AIRP namespace just because the schema has one.

### 4. Validation & Error Matrix

- Schema is not an object -> `INVALID_SCHEMA`.
- Missing schema id/version -> `INVALID_SCHEMA_ID` / `INVALID_SCHEMA_VERSION`.
- Unknown field type -> `INVALID_FIELD_TYPE`.
- Relation target collection missing -> `UNKNOWN_RELATION_COLLECTION`.
- Relation target field missing -> `UNKNOWN_RELATION_FIELD`.
- Index field missing -> `UNKNOWN_INDEX_FIELD`.
- Operation type unknown -> `INVALID_OPERATION_TYPE`.
- Namespace cannot be resolved from operation/default/schema -> `MISSING_NAMESPACE`.
- Collection cannot be resolved -> `MISSING_COLLECTION`.
- Collection not in schema -> `UNKNOWN_COLLECTION`.
- Upsert data missing required field -> `MISSING_REQUIRED_FIELD`.
- Unknown data field without `additionalFields` -> `UNKNOWN_FIELD`.
- Patch/delete without `id` -> `MISSING_OPERATION_ID`.
- Patch data is not a JSON object -> storage/validator error; do not silently coerce.
- Workflow `memory-write` built-in schema validation failure -> throw before storage write with a message beginning `memory-write schema validation failed` and include issue code/path/message details.
- Workflow `memory-write` custom collection outside built-in schema -> skip built-in schema validation and use existing storage-level errors such as missing namespace, missing id, invalid JSON, or unknown operation type.

### 5. Good/Base/Bad Cases

- Good: contracts declares `MemoryFieldDefinition`; memory-core exports `defaultAirpMemorySchema`; platform-web imports only the shared operation type and storage remains Dexie-owned.
- Good: an archive upsert with `customAffinity` passes because `archives.additionalFields` opts in.
- Base: an event patch with `{ status: "done" }` passes when `id` is present and does not require every event field.
- Base: workflow `memory-write` for `{ type: "upsert", collection: "events" }` with no namespace is normalized to the built-in `airp` namespace before storage writes.
- Base: workflow `memory-write` for `namespace: "mod.example", collection: "fragments"` remains storage-only until a schema resource exists for that namespace/collection.
- Bad: putting `defaultAirpMemorySchema` in contracts as an `export const`.
- Bad: adding `event-query` or `archive-query` node types instead of schema metadata.
- Bad: expanding `apply-patch` to become the generic memory operation model.
- Bad: making Dexie `storage/memory.ts` import `@tsian/memory-core` and decide schema policy.
- Bad: rejecting all unknown custom memory collections with `UNKNOWN_COLLECTION` before schema resources exist.

### 6. Tests Required

- `npm run build:contracts` when shared memory types change.
- `npm run build:memory-core`.
- `npm run test --workspace @tsian/memory-core`.
- `npm run build:web` when platform-web custom memory storage or executors consume changed operation behavior.
- `npm run test --workspace @tsian/workflow-engine` when a static proof protects platform-web workflow executor integration without importing platform-web into workflow-engine.
- Tests should assert:
  - default AIRP schema validates;
  - relation/index invalid targets fail;
  - required fields fail for upsert;
  - unknown fields fail unless `additionalFields` is enabled;
  - patch requires `id` and validates only provided shallow fields.
  - workflow `memory-write` invokes memory-core normalization before storage writes for built-in schema-covered targets;
  - custom memory collections remain storage-only in the current slice.

### 7. Wrong vs Correct

#### Wrong

```ts
// packages/contracts/src/memory.ts
export const defaultAirpMemorySchema = { /* runtime value */ }
```

#### Correct

```ts
// packages/contracts/src/memory.ts
export interface MemorySchemaDefinition {
  id: string
  version: string
  collections: Record<string, MemoryCollectionDefinition>
}

// packages/memory-core/src/default-airp-schema.ts
export const defaultAirpMemorySchema: MemorySchemaDefinition = { /* runtime value */ }
```
