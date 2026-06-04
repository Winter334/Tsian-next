# Error Handling

Workflow-engine follows fail-loud behavior. Validation and execution errors must be visible to callers.

## Error Types

- `WorkflowValidationError` is thrown by load-time validation and includes a stable `code`.
- `WorkflowAbortError` is thrown when the workflow is aborted before or during execution.
- `WorkflowNodeError` is thrown when a node has no executor, returns invalid output, or exhausts retries. It includes `nodeId`, `attempts`, `cause`, and `code`.

## Validation Errors

`validateWorkflowDefinition` currently enforces:

- Duplicate node IDs -> `DUPLICATE_NODE_ID`
- Unknown node type -> `UNKNOWN_NODE_TYPE`
- Dangling edges -> `DANGLING_EDGE`
- Cycles -> `CYCLE_DETECTED`
- apply-patch missing required input binding -> `APPLY_PATCH_INPUT_INCOMPLETE`
- Missing result node -> `MISSING_RESULT_NODE`
- Duplicate result names -> `DUPLICATE_RESULT_NAME`
- Mod workflow with apply-patch -> `MOD_REGISTERED_APPLY_PATCH`

Keep validation at load time when the condition is knowable before execution.

## Execution Errors

- Missing executor is configuration error and should not retry. It throws `WorkflowNodeError` with code `UNKNOWN_NODE_TYPE`.
- Regular executor failures retry according to `node.retry?.maxRetries ?? 1`.
- Exhausted retry throws `WorkflowNodeError` with code `NODE_RETRY_EXHAUSTED`.
- Abort should pierce retry and throw `WorkflowAbortError`.
- On node failure, abort all other running nodes, wait for them to settle, then rethrow the original error.

## Outputs Hook Exception

`safeHook` catches outputs hook exceptions and logs a warning. This is the one explicit exception to fail-loud because debug/output hooks must not change scheduler correctness.

## Avoid

- Do not swallow validation errors and continue execution.
- Do not convert node failures to empty outputs.
- Do not make mod workflow `apply-patch` checks editor-only; engine validation is the runtime guard.
