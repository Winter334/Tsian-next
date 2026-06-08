# Type Safety

Frontend consumers use workflow-engine through typed definitions from `@tsian/contracts` and executor maps supplied by platform-web.

## Consumer API

- `executeWorkflow(def, context, options)` runs a `WorkflowDefinition`.
- `validateWorkflowDefinition(def, options)` returns topological node order or throws.
- `WorkflowExecutionContext.executors` maps node type strings to `NodeExecutor`.
- `ExecuteWorkflowOptions.outputsHooks` accepts `OutputsStoreWriter`.

## Frontend Rules

- Build `WorkflowDefinition` with contracts types. The editor should normalize imported JSON before calling the validator.
- Register concrete executors in platform-web, not in workflow-engine.
- Pass `isModWorkflow: true` for mod-controlled workflow definitions as source metadata for traces and integration behavior; the validator must not use mod source to change the supported node type set.
- Preserve `WorkflowEdge.to.inputName`; it is the runtime input port key.
- Use `from.outputName ?? "raw"` when resolving upstream outputs.
- Treat edges as pure port connections. Conditional routing belongs in
  executable nodes such as `switch`, not in `WorkflowEdge`.

## Avoid

- Do not treat workflow port metadata as runtime type enforcement. Current metadata is editor/documentation-only.
- Do not pass Vue refs into workflow-engine context unless an executor explicitly owns that framework-specific dependency.
- Do not rely on result node config without validator coverage; `config.name` must be non-empty and unique.
