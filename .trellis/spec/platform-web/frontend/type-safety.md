# Type Safety

`platform-web` is strict TypeScript, but many runtime boundaries receive unknown JSON from imports, local storage, AI output, or browser APIs. Normalize at the boundary and keep shared shapes in `@tsian/contracts`.

## Shared Contracts

- Import runtime, mod, resource, debug, and workflow shapes from `@tsian/contracts`.
- Import the runtime engine interface from `@tsian/runtime-core`.
- Do not redefine cross-package contracts inside platform-web. If a shape crosses package boundaries, add it to `packages/contracts/src/*`.
- Vite and `tsconfig.app.json` map `@tsian/contracts` and `@tsian/runtime-core` to source files, so build failures surface contract drift immediately.

## Boundary Normalization

- Normalize imported workflow JSON before storing it in Vue Flow state. `useWorkflowEditor.ts` validates port value types, trims metadata, normalizes output extract rules, and falls back to safe defaults.
- Validate platform action inputs before writing runtime state. `platform-host/index.ts` uses helper functions such as `isPlainObject`, `isJsonValue`, and `normalizeStringList` around `write-runtime`.
- Convert old or external prompt/world-book data in prompt-engine or storage boundaries, not through ad hoc casts in components.

## Runtime JSON

- `RuntimeGlobalsMap` only permits `JsonValue`. When writing globals from UI or bridge code, reject values that cannot be represented as JSON.
- `ArchiveRecord` intentionally allows extension fields with `[key: string]: unknown`; callers must still preserve required base fields such as `type`, `name`, `aliases`, `background`, `situation`, `linkedNames`, and `presence`.
- `WorkflowNode.config` is `Record<string, unknown>` by contract. Concrete node config parsing belongs in platform-web forms and workflow executors.

## Controlled Escape Hatches

- `any` appears around Vue Flow node data and generic editor fields. Keep it local to the UI integration boundary and normalize before exporting a `WorkflowDefinition`.
- If a UI editor uses `JSON.parse(JSON.stringify(...))` cloning, ensure the edited shape is JSON-compatible. Resource editors currently edit prompt/world-book JSON-like resources.

## Avoid

- Do not loosen contract fields to `unknown` to bypass a platform-web error. Fix the caller or add normalization.
- Do not save editor-only handle IDs as private runtime schema. Workflow edges
  use contract port names: `to.inputName` and optional `from.outputName`.
- Do not silently swallow invalid platform action input. Return a structured `PlatformActionError` or throw at the correct boundary.
