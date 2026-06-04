# Type Safety

> Type safety patterns in this project.

---

## Overview

The contracts package owns shared TypeScript shapes that cross package
boundaries. Keep resource payload types explicit when the shape is part of the
platform contract, and keep only truly open extension points as `unknown` or
`Record<string, unknown>`.

---

## Type Organization

Prompt preset and world book resource payload types live in
`packages/contracts/src/preset.ts` and are re-exported from
`packages/contracts/src/index.ts`.

Platform resource wrappers live in `packages/contracts/src/workflow.ts`:

```typescript
export interface PromptPresetResource extends PlatformResourceBase<"prompt-preset"> {
  preset: PromptPreset
}

export interface WorldBookResource extends PlatformResourceBase<"world-book"> {
  worldBook: WorldBook
}
```

---

## Validation

Contracts describe the compile-time shape only. Runtime and semantic validation
for prompt preset and world book payloads still belongs to the prompt engine or
the consuming feature boundary. Do not treat the shared TypeScript type as an
import/compatibility validator.

---

## Common Patterns

### Scenario: Platform Resource Payload Contracts

#### 1. Scope / Trigger

- Trigger: prompt preset and world book resources are stored in platform-web,
  exposed through contracts, and consumed by workflow/mod code.
- These payloads are no longer arbitrary JSON in the contracts layer. Use shared
  `PromptPreset` and `WorldBook` types for the platform resource shape.

#### 2. Signatures

- `PromptPresetResource.preset: PromptPreset`
- `WorldBookResource.worldBook: WorldBook`
- `ModManifest.presets?: Record<string, PromptPreset>`
- `ModManifest.worldBooks?: Record<string, WorldBook>`
- `ModStaticContent.worldBooks?: Record<string, WorldBook>`

#### 3. Contracts

- `PromptPreset` contains `name`, ordered `prompts`, `utilityPrompts`,
  `regexScripts`, `other`, and optional deprecated `apiSetting`.
- `PromptPresetEntry` intentionally allows unknown entry fields via an index
  signature so visual editors can preserve imported compatibility fields.
- `WorldBook` contains `name` and ordered `entries`.
- `WorldBookEntry.other` is the compatibility bucket for advanced/imported
  fields that the MVP UI does not visualize.

#### 4. Validation & Error Matrix

- Missing required top-level fields -> reject or normalize at the import/storage
  boundary before saving.
- Extra prompt entry fields -> preserve through clone/update operations unless a
  feature intentionally rewrites the entry.
- Extra world book compatibility fields -> store under `other` when the current
  shape does not have a first-class field.
- Semantic invalid values, such as unsupported activation behavior -> validate
  in prompt-engine or the consuming workflow boundary, not by loosening
  contracts back to `unknown`.

#### 5. Good/Base/Bad Cases

- Good: UI receives `PromptPresetResource`, edits `preset.prompts`, and saves a
  full `PromptPreset` back to storage.
- Base: imported preset has advanced prompt fields; editor changes `content` and
  preserves the untouched fields on the same entry.
- Bad: resource APIs expose `preset: unknown` and every caller casts or parses
  ad hoc.

#### 6. Tests Required

- Contracts changes: run `npm run build:contracts`.
- UI/resource changes using these payloads: run `npm run build:web`.
- Prompt/world-book normalization or semantic behavior changes: run
  `npm run test:prompt-engine`.
- When adding import/normalization code, assert round-trip preservation of
  unknown/advanced fields.

#### 7. Wrong vs Correct

Wrong:

```typescript
interface PromptPresetResource {
  preset: unknown
}
```

Correct:

```typescript
interface PromptPresetResource {
  preset: PromptPreset
}
```

### Scenario: Workflow Preset Resource References

#### 1. Scope / Trigger

- Trigger: `LocalSaveRecord.workflowPresetId` and
  `ModManifest.workflowPresetId` cross platform resource storage, save storage,
  UI selection, and the runtime workflow host.
- Use this when adding or changing workflow preset selection, save metadata,
  mod manifest loading, or resource-library workflow persistence.

#### 2. Signatures

- `ModManifest.workflowPresetId?: string`
- `ModManifest.workflow?: WorkflowDefinition` remains deprecated legacy input.
- `LocalSaveRecord.workflowPresetId?: string`
- `WorkflowPresetResource.workflow: WorkflowDefinition`
- `getWorkflowPresetResource(id: string): Promise<LocalWorkflowPresetResourceRecord | undefined>`
- `getWorkflowPresetIdForSave(saveId: string): Promise<string | undefined>`
- `setWorkflowPresetIdForSave(saveId: string, workflowPresetId: string | null): Promise<LocalSaveRecord | undefined>`
- `getPlatformWorkflowSource(saveId?: string): Promise<PlatformWorkflowSource | null>`
- `setPlatformSaveWorkflowPreset(workflowPresetId: string | null, saveId?: string): Promise<LocalSaveRecord>`

#### 3. Contracts

- Runtime workflow precedence is:
  1. save-level `LocalSaveRecord.workflowPresetId`
  2. `manifest.workflowPresetId`
  3. deprecated `manifest.workflow`
  4. platform `defaultWorkflow`
- Save-level workflow presets are user-selected runtime workflows. Execute them
  with `isModWorkflow: false` so traces and source-sensitive integration can
  distinguish player overrides.
- Mod-referenced workflow presets and deprecated legacy mod workflows are still
  mod-controlled input. Execute them with `isModWorkflow: true`, but do not use
  that metadata as a permission gate for `apply-patch`.
- Built-in/default, save-selected, and mod-referenced workflows may all contain
  explicit `apply-patch` compatibility write nodes when their patch input port
  is correctly declared and bound.
- UI should display the source kind so users can distinguish `save-override`,
  `mod-preset`, `legacy-mod-workflow`, and `platform-default`.

#### 4. Validation & Error Matrix

- Save-level `workflowPresetId` points to no resource -> throw a clear
  `save "<id>" references missing workflow preset "<preset>"` error at runtime
  resolution; the resource-library UI may show the error and allow clearing the
  save override, but runtime must not silently fall back.
- Mod-level `workflowPresetId` points to no resource -> throw a clear
  `mod "<id>" references missing workflow preset "<preset>"` error at runtime
  resolution.
- Referenced workflow contains `apply-patch` with a valid patch input binding ->
  allowed regardless of workflow source.
- Referenced workflow contains `apply-patch` without a valid patch input binding
  -> workflow-engine throws `APPLY_PATCH_INPUT_INCOMPLETE`.
- Clearing the save override (`workflowPresetId: null`) -> remove the optional
  field and return to the mod/default precedence chain.
- No `workflowPresetId` and no legacy `workflow` -> use `defaultWorkflow`.
- Legacy `workflow` present without `workflowPresetId` -> run the legacy
  definition with `isModWorkflow: true`.

#### 5. Good/Base/Bad Cases

- Good: A save sets `workflowPresetId`, the platform loads that resource before
  checking the mod manifest, and `executeWorkflow` receives
  `{ isModWorkflow: false }`.
- Good: A mod sets `workflowPresetId`, the platform loads that resource when the
  save has no override, and `executeWorkflow` receives
  `{ isModWorkflow: true }`.
- Base: Existing mods omit `workflowPresetId`; legacy `manifest.workflow` or
  `defaultWorkflow` behavior remains unchanged.
- Bad: A missing save-level or mod-level `workflowPresetId` silently falls back
  to `defaultWorkflow`.
- Bad: A mod-referenced workflow preset is rejected only because it contains an
  explicit `apply-patch` node.

#### 6. Tests Required

- Add or update a boundary test proving `platform-host` imports
  `getWorkflowPresetResource`, resolves save-level `workflowPresetId` before
  mod-level `workflowPresetId`, resolves mod-level `workflowPresetId` before
  legacy `manifest.workflow`, and passes `isModWorkflow` into `executeWorkflow`.
- Keep workflow-engine validation coverage proving mod workflows may explicitly
  contain `apply-patch` while `APPLY_PATCH_INPUT_INCOMPLETE` still fires for
  invalid patch input wiring.
- Run `npm run build:web`; run `npm run build:contracts` when contract shapes
  change.

#### 7. Wrong vs Correct

Wrong:

```typescript
const workflow = mod.manifest.workflow ?? defaultWorkflow
await executeWorkflow(workflow, context, { isModWorkflow: false })
```

Correct:

```typescript
const { def, isModWorkflow } = await resolveWorkflowForSave(saveId)
await executeWorkflow(def, context, { isModWorkflow })
```

### Scenario: Workflow Node Port Metadata

#### 1. Scope / Trigger

- Trigger: workflow node input/output slot metadata crosses contracts,
  resource-library persistence, the workflow editor, and workflow-engine
  consumers.
- Use this when adding or changing workflow node port declarations, editor
  handle labels, workflow JSON import/export, or default slot metadata for
  built-in node types.

#### 2. Signatures

- `WorkflowPortValueType = "string" | "number" | "boolean" | "object" | "array" | "unknown"`
- `NodePortMetadata.label?: string`
- `NodePortMetadata.description?: string`
- `NodePortMetadata.valueType?: WorkflowPortValueType`
- `NodePortMetadata.semanticSlot?: string`
- `NodeInputDeclaration.name: string`
- `NodeInputDeclaration.required?: boolean`
- `NodeOutputDeclaration extends NodePortMetadata`
- `WorkflowNodeBase.inputs?: NodeInputDeclaration[]`
- `WorkflowNodeBase.outputs?: NodeOutputDeclaration[]`
- `WorkflowEdge.to.varName` remains the runtime input key.
- `WorkflowEdge.from.outputName` remains the runtime output selector.

#### 3. Contracts

- Port metadata is editor/documentation metadata only. Runtime execution still
  injects upstream values into downstream `inputs[varName]`.
- `inputs` is optional so older workflows without input declarations remain
  valid and loadable.
- Output metadata extends the existing output declaration shape and must not
  change `extract` behavior.
- `semanticSlot` is an open string for UI semantics; do not treat it as a
  permission, validator, or executable capability.
- Editors may derive default display slots for built-in node types, but saved
  workflow JSON must preserve explicit `inputs` and output metadata when
  present.

#### 4. Validation & Error Matrix

- Missing `inputs` -> load as a legacy workflow and show derived/default UI
  handles where possible.
- Missing output metadata -> load the output using its `name` and `extract`
  fields.
- Unknown or empty metadata fields -> normalize at the editor boundary for
  display/persistence hygiene; do not reject the workflow at the contracts
  layer.
- Type mismatch between connected ports -> no runtime error in the metadata-only
  model. Add editor warnings in a later change only after the UX severity is
  explicitly designed.
- Required input metadata without an incoming edge -> no runtime or save-blocking
  error in the metadata-only model.

#### 5. Good/Base/Bad Cases

- Good: a result node declares/display-derives an input slot named `value`, and
  an edge still serializes as `to.varName: "value"`.
- Good: an AI node output has `label: "Patch"` and
  `semanticSlot: "state.patch"` while execution still reads the value through
  the existing output extraction path.
- Base: an old workflow omits `inputs` and output metadata; the editor loads,
  renders, exports, and executes it without migration.
- Bad: `validateWorkflowDefinition` rejects a workflow because a metadata
  `valueType` differs from a connected source.
- Bad: the editor rewrites `WorkflowEdge.to.varName` into a separate target
  handle schema and breaks existing executors.

#### 6. Tests Required

- Contracts changes: run `npm run build:contracts`.
- UI/editor changes using port metadata: run `npm run build:web`.
- When adding runtime validation in a future change, add workflow-engine
  validator coverage and keep legacy workflows without `inputs` passing.
- When changing editor serialization, verify workflow JSON round-trips explicit
  `inputs`, output metadata, and existing `from.outputName -> to.varName`
  edges.

#### 7. Wrong vs Correct

Wrong:

```typescript
if (source.valueType !== target.valueType) {
  throw new Error("workflow port type mismatch")
}
```

Correct:

```typescript
const targetHandle = declaredInputs.some((input) => input.name === edge.to.varName)
  ? edge.to.varName
  : "input"
```

---

## Forbidden Patterns

- Do not loosen platform prompt preset or world book resource payloads back to
  `unknown` just to bypass local type errors. Fix the caller's data shape or add
  explicit import-time normalization.
- Do not silently drop unknown prompt entry fields or `WorldBookEntry.other`
  during visual edits.
