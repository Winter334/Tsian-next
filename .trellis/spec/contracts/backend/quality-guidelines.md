# Quality Guidelines

Contract changes are high impact because they compile through multiple workspace packages.

## Required Checks

- Always run `npm run build:contracts`.
- Run `npm run build:web` when platform-web imports the changed type.
- Run `npm run build:workflow-engine` and workflow-engine tests when workflow contracts or validation expectations change.
- Run `npm run test:prompt-engine` when prompt preset or world book shapes affect prompt-engine conversion or assembly.

## Review Checklist

- Confirm `src/index.ts` exports new public types.
- Confirm each optional field is intentionally optional for backward compatibility or missing data semantics.
- Confirm open extension points use `unknown`, `Record<string, unknown>`, or index signatures only where callers preserve external fields.
- Confirm runtime validation did not move into contracts.
- Confirm deprecated fields include enough comments for consumers to choose the new field.

## Local Examples

- `ModManifest.workflowPresetId` is preferred while `workflow` remains deprecated legacy input.
- `WorkflowNodeBase.inputs` is optional so old workflows without input declarations still load.
- `ApplyPatchOutput` is shared by bridge/runtime patch APIs; workflow nodes no longer expose the patch compatibility path.

## Avoid

- Do not loosen concrete resource payloads back to `unknown`.
- Do not add package dependencies here.
- Do not change a contract without checking the consuming package builds.
