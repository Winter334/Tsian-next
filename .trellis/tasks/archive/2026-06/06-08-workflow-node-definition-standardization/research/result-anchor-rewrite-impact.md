# Result Anchor Rewrite Impact

## Question

If workflow results are changed from executable `result` nodes into resource anchors, how much existing code depends on the current model and how hard is a full rewrite?

## Current Model

Current `result` is a normal executable workflow node:

* `WorkflowNodeType` includes `"result"`.
* `ResultNodeConfig` has `name`.
* `resultExecutor` returns `{ outputs: { value: inputs.value } }`.
* The scheduler has result-specific logic:
  * when a result node succeeds, it calls `outputsHooks.setResult(name, outputs.value)`;
  * after all nodes finish, it returns `WorkflowResult.results[name] = outputs.value`.
* The validator requires at least one result node and checks `config.name` uniqueness.
* Platform host expects `workflowResult.results.reply` to be a string and appends it as the assistant message.

## Dependencies

### Contracts

* `packages/contracts/src/workflow.ts`
  * `WorkflowNodeType` includes `"result"`.
  * `ResultNodeConfig` documents writing into workflow results.
* `packages/contracts/src/debug.ts`
  * debug snapshot `results` is described as result-node `config.name -> outputs.value`.

### Workflow Engine

* `packages/workflow-engine/src/validator.ts`
  * requires at least one result node.
  * checks unique result names.
* `packages/workflow-engine/src/scheduler.ts`
  * result-specific `setResult` hook calls.
  * result-specific final `WorkflowResult.results` collection.
* `packages/workflow-engine/src/types.ts`
  * `OutputsStoreWriter.setResult`.
* Tests rely on result nodes as normal DAG nodes:
  * `packages/workflow-engine/test/outputs-hooks.test.ts`
  * `packages/workflow-engine/test/sc-crit.test.ts`

### Platform Web

* `apps/platform-web/src/workflow-host/executors/result.ts`
  * current runtime executor.
* `apps/platform-web/src/workflow-host/index.ts`
  * executor registration.
* `apps/platform-web/src/platform-host/index.ts`
  * reads `workflowResult.results.reply`.
* `apps/platform-web/src/workflow-host/outputs-store.ts`
  * stores `results` through `setResult`.
* Workflow editor pieces:
  * node registry entry;
  * input slot resolution;
  * result inspector form;
  * validation message mapping;
  * default node config.

### Builtin Workflow

* `builtin/mods/default-airp-workflow.ts`
  * uses a `result` node for final reply.

## What A Complete Rewrite Would Mean

A true resource-anchor rewrite would not simply hide result nodes in UI. It would require:

1. Add a workflow output resource model, likely parallel to `WorkflowStateModel`:
   * output anchors;
   * output ports/fields;
   * links from executable node outputs to output fields.
2. Change `WorkflowDefinition` to carry output resources/links outside executable nodes.
3. Change validation:
   * require output field bindings instead of result nodes;
   * validate output field uniqueness;
   * validate links reference existing node outputs and output resource ports.
4. Change scheduler or add a compile step:
   * either scheduler natively collects output links after producer nodes finish;
   * or a compiler converts output links to hidden/internal result nodes.
5. Change debug outputs:
   * preserve `results` snapshots without relying on result node success hooks;
   * decide whether output anchors appear in node trace.
6. Change platform host:
   * continue reading `results.reply`, but the source becomes output resource fields.
7. Change editor:
   * add resource anchor rendering/editing for workflow outputs;
   * add edge/link rules for output anchors;
   * remove or hide regular `result` node creation.
8. Update builtin workflow and tests.

## Difficulty Assessment

Dependency level: medium-high.

The code surface is broad, but conceptually contained:

* hard parts are not algorithmic;
* most changes are schema/editor/runtime-contract alignment;
* the biggest risk is ending with both visible result nodes and output anchors active, which would create exactly the kind of half-special model this task is trying to avoid.

A complete rewrite is feasible, but it is large enough to be its own focused task or a clearly separated phase inside this task.

## Recommendation

Do not partially convert `result` into an output resource anchor.

Choose one:

1. Keep `result` as a standard executable node for this task.
   * Treat it as a terminal/output function node in the standard node definition.
   * Do not introduce workflow output resource anchors yet.
   * This avoids half-migration and keeps this task focused on node definition standardization.
2. Make output resources a first-class part of this task.
   * Remove or replace visible result nodes.
   * Add workflow output resource anchors and links properly.
   * Update validator, scheduler/compile step, debug store, editor, builtin workflow, and tests.

Given the current task already includes node definition standardization, edge simplification, semantic slot removal, and resource anchor standardization for state database, option 1 is lower risk. Option 2 is cleaner in product terms but substantially expands scope.
