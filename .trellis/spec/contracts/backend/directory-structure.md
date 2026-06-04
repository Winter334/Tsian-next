# Directory Structure

`packages/contracts/src/index.ts` re-exports every public module. Add contract files only when a shape has a clear cross-package owner.

## File Ownership

- `runtime.ts` owns runtime snapshots, messages, archives, events, maintenance patches, platform action shapes, deep query shapes, and write-runtime payloads.
- `bridge.ts` owns `PlayFrontendBridge` and bridge namespace interfaces.
- `debug.ts` owns debug records exposed to play frontends through `bridge.debug` and legacy query paths.
- `mod.ts` owns mod manifests, static content, catalog events, entity field definitions, and mod initial save payloads.
- `frontend-package.ts` owns play frontend manifest metadata.
- `preset.ts` owns prompt preset and world book resource shapes imported from prompt-engine concepts.
- `workflow.ts` owns workflow DAG definitions, node config shapes, edges, port metadata, and platform resource wrappers.
- `memory.ts` owns memory schema type contracts, relation/index/render metadata shapes, validation issue payload shape, and normalized operation type aliases. Runtime schema values and validators live in `packages/memory-core`, not here.

## Export Rules

- Every public type must be exported through `src/index.ts`.
- Keep the package type-only. Do not add runtime helpers, validators, storage code, or browser-specific APIs here.
- Prefer a single source of truth. If `platform-web` and `workflow-engine` both need a shape, define it in contracts and import it.

## Contract Granularity

- Use explicit interfaces for stable payloads such as `RuntimeWriteRequest`, `ApplyPatchOutput`, `WorkflowDefinition`, and `ModManifest`.
- Use open extension points only where the product intentionally allows external fields, such as `ArchiveRecord` extra fields, `PromptPresetEntry` compatibility fields, and `semanticSlot` strings.
- Keep node `config` as `Record<string, unknown>` in `WorkflowNodeBase`; concrete parsing belongs to node executors and editor forms.

## Avoid

- Do not add implementation functions to this package.
- Do not put UI-only labels or local storage metadata here unless they are intentionally shared across packages.
- Do not make a field optional to hide a caller bug. Optionality must reflect real backward compatibility or feature semantics.
