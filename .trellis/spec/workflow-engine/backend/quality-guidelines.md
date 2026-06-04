# Quality Guidelines

Workflow-engine quality depends on preserving scheduler invariants and package purity.

## Required Checks

- Run `npm run build:workflow-engine`.
- Run `npm run test --workspace @tsian/workflow-engine`.
- Run `npm run build:web` when changing contracts or behavior used by platform-web executors or workflow editor validation.

## Review Checklist

- Validation remains deterministic and throws `WorkflowValidationError` with a precise code.
- Scheduler still validates before executing any node.
- Ready nodes can run concurrently; dependency order is enforced by in-degree.
- `edge.condition` remains simple string equality against upstream output.
- Incoming edges still bind upstream `outputs[outputName ?? "raw"]` into downstream `inputs[varName]`.
- Result aggregation still reads result node `outputs.value` into `results[config.name]`.
- Outputs hook timing matches `OutputsStoreWriter` docs.
- Package imports do not point into `apps/platform-web`.

## Test Patterns

- Use Vitest for dynamic scheduler and validation behavior.
- Use static proof tests when the invariant crosses package boundaries and importing platform-web would break layering. `p-i-1.test.ts` and `workflow-preset-resolution.test.ts` are the local examples.

## Avoid

- Do not weaken fail-loud validation for editor convenience.
- Do not add browser APIs or Vue types.
- Do not change retry or abort behavior without regression tests.
