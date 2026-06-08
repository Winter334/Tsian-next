# Quality Guidelines

Frontend integration should preserve engine invariants while presenting useful editor and debug feedback.

## Required Checks

- Run `npm run build:web` when changing platform-web workflow editor, executors, output store, or platform-host integration.
- Run `npm run build:workflow-engine` and `npm run test --workspace @tsian/workflow-engine` when engine API or validation behavior changes.
- Run `npm run build:contracts` when workflow contract shapes change.

## Review Checklist

- Editor validation uses `validateWorkflowDefinition` and translates messages without changing engine behavior.
- Workflow editor import/export preserves `inputs`, output metadata, `from.outputName`, and `to.inputName`.
- Platform-host passes the correct `isModWorkflow` value based on workflow source for trace/source metadata.
- Bridge patch APIs still share `applyMaintenancePatch`; the retired workflow
  `apply-patch` node must not be restored as an executor.
- Output store updates remain debug/observer state only.

## Avoid

- Do not implement editor-only validation that contradicts engine validation.
- Do not apply host-managed patches by scanning workflow outputs outside the DAG; runtime writes must be represented by explicit workflow nodes or bridge/API actions.
- Do not make port metadata required for old saved workflows.
