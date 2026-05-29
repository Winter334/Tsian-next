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

---

## Forbidden Patterns

- Do not loosen platform prompt preset or world book resource payloads back to
  `unknown` just to bypass local type errors. Fix the caller's data shape or add
  explicit import-time normalization.
- Do not silently drop unknown prompt entry fields or `WorldBookEntry.other`
  during visual edits.
