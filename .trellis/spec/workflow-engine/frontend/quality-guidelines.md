# Quality Guidelines

Frontend integration should preserve engine invariants while presenting useful editor and debug feedback.

## Required Checks

- Run `npm run build:web` when changing platform-web workflow editor, executors, output store, or platform-host integration.
- Run `npm run build:workflow-engine` and `npm run test --workspace @tsian/workflow-engine` when engine API or validation behavior changes.
- Run `npm run build:contracts` when workflow contract shapes change.

## Review Checklist

- Editor validation uses `validateWorkflowDefinition` and translates messages without changing engine behavior.
- Workflow editor import/export preserves `inputs`, output metadata, `from.outputName`, and `to.varName`.
- Platform-host passes the correct `isModWorkflow` value based on workflow source.
- apply-patch executor and bridge patch APIs still share `applyMaintenancePatch`.
- Output store updates remain debug/observer state only.

## Avoid

- Do not implement editor-only validation that contradicts engine validation.
- Do not allow mod workflows to run platform-owned apply-patch nodes.
- Do not make port metadata required for old saved workflows.
