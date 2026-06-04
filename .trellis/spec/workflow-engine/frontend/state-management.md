# State Management

Workflow-engine does not own frontend state. It exposes hook points that platform-web adapts into reactive debug state.

## Outputs Hooks

`OutputsStoreWriter` methods are synchronous and framework-neutral:

- `initNode(nodeId)`
- `startNode(nodeId)`
- `succeedNode(nodeId, outputs)`
- `failNode(nodeId, error)`
- `abortNode(nodeId)`
- `setResult(name, value)`

The scheduler calls these during node lifecycle transitions. Hook failures are caught by `safeHook` and must not break execution.

## Platform-Web Integration

- `apps/platform-web/src/workflow-host/outputs-store.ts` implements the reactive output store.
- `platform-host` passes the writer through `executeWorkflow` options.
- Debug UI reads workflow output snapshots through bridge debug paths.

## Rules

- Keep hook implementations idempotent enough for UI/debug use.
- Treat outputs as observation state, not as the source of scheduler truth.
- Do not mutate scheduler `nodeOutputs` from hook implementations.
- Do not add Vue imports to `packages/workflow-engine/src/types.ts`.

## Avoid

- Do not use output hooks to recover from node failures.
- Do not make hook errors affect workflow success.
- Do not store long-lived UI state in workflow-engine.
