# Directory Structure

The package is intentionally small and dependency-light.

## Source Files

- `src/index.ts` is the public export surface.
- `src/scheduler.ts` owns `executeWorkflow`, node executor protocol, workflow execution context, result shape, retry, abort propagation, input collection, result aggregation, and outputs hook timing.
- `src/validator.ts` owns load-time graph validation and returns topological order.
- `src/errors.ts` owns workflow error classes and validation codes.
- `src/types.ts` owns framework-neutral public interfaces such as `OutputsStoreWriter`.

## Boundary Rules

- Concrete node executors belong in `apps/platform-web/src/workflow-host/executors/`.
- Patch application belongs in `apps/platform-web/src/runtime-host/patch-applier.ts`.
- Vue output state belongs in `apps/platform-web/src/workflow-host/outputs-store.ts`; workflow-engine only sees the `OutputsStoreWriter` interface.
- Shared workflow shapes come from `@tsian/contracts`.

## Scheduler Flow

`executeWorkflow` should preserve this flow:

1. Call `validateWorkflowDefinition`.
2. Build node lookup, in-degree map, adjacency map, and incoming edge bindings.
3. Initialize output hooks for every node.
4. Schedule all ready nodes concurrently.
5. Run node executors with collected `inputs`, retry, and abort signal.
6. On failure, abort in-flight nodes and rethrow the loud error.
7. Aggregate `result` node outputs into `WorkflowResult.results`.

## Avoid

- Do not add platform-web imports.
- Do not add runtime node implementations.
- Do not add JSON schema, expression language, or type coercion to the engine unless a task explicitly expands validation scope.
