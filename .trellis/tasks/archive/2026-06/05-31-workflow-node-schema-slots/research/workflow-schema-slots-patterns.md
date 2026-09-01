# Workflow Node Schema and Slot Patterns

## Question

How should Tsian add node input/output schema and semantic slots without breaking the existing edge-injected workflow model?

## Sources Checked

* Dify Output node docs: https://docs.dify.ai/en/use-dify/nodes/output
* Dify orchestration docs: https://docs.dify.ai/en/use-dify/build/orchestrate-node
* Node-RED editor node docs: https://nodered.org/docs/user-guide/editor/workspace/nodes
* Node-RED node property docs: https://nodered.org/docs/creating-nodes/properties
* Vue Flow handle docs: https://vue-flow.nodejs.cn/guide/handle.html
* n8n data structure docs: https://docs.n8n.io/data/data-flow-nodes/

## Observed Patterns

* Visual workflow tools usually separate the visual connection surface from the runtime value map. Node-RED exposes at most one input and many outputs, lets ports have labels, and marks invalid node configuration in the editor.
* Dynamic output count is a known pattern. Node-RED supports configurable output counts through node properties; Vue Flow supports multiple handles with stable unique ids.
* AI workflow tools tend to make variables visible and typed. Dify's Output node lets users assign output variable names from upstream outputs and supports scalar, object, file, and array variants. Its flow logic also restricts which node variables can be read across serial and parallel branches.
* n8n keeps a predictable runtime data structure across nodes and lets users inspect schema/table/JSON views, but expressions can still address previous node data by path. This suggests a useful split between editor assistance and execution semantics.

## Constraints From Tsian

* `WorkflowEdge` already maps `from.outputName` to `to.varName`; runtime input injection depends on this.
* Existing saved workflows may omit `outputs`, `position`, and any future schema fields, so migrations should be optional and tolerant.
* `NodeOutputDeclaration` already exists for extracted AI/compute outputs. Replacing it wholesale would cause unnecessary churn.
* The editor already renders dynamic source handles from `outputs` and switch config output names.
* The editor currently has a single target handle named `input`; adding input handles would be a visible UX and serialization change.
* Prior OpenSpec notes intentionally avoided node input schemas for the initial engine; this task should preserve that runtime contract unless explicitly choosing a stronger compatibility break.

## Feasible Approaches

### Approach A: Schema Metadata Only (recommended MVP)

Add optional `inputs` on `WorkflowNodeBase` and optional metadata fields on `NodeOutputDeclaration` such as `type`, `label`, `description`, and `semanticSlot`. Keep runtime injection unchanged: edges still write `inputs[varName]`, and executors keep their current parsing behavior.

Pros:
* Backward compatible with saved workflows.
* Enables editor labels, suggestions, and documentation immediately.
* Low risk for engine and executors.

Cons:
* Does not prevent all invalid connections at runtime.
* Requires follow-up work for stronger type compatibility.

### Approach B: Editor Validation + Schema Metadata

Do Approach A and add editor/workflow validation warnings for required inputs, unknown target slots, duplicate port names, and obvious type mismatches.

Pros:
* Users get practical guardrails before saving/running.
* Keeps runtime semantics stable.

Cons:
* More surface area: contracts, editor, validation translation, and tests.
* Needs careful severity design so existing workflows do not become unsavable.

### Approach C: Runtime-Enforced Schemas

Make schemas authoritative. Validate every edge against source/target declarations before execution and optionally coerce or reject values by declared type.

Pros:
* Strongest correctness model.
* Makes workflow presets more reliable as reusable public resources.

Cons:
* Highest migration and breakage risk.
* Requires a real type system for extracted AI text, JSON, arrays, and executor outputs.
* Conflicts most with the existing "edge-injected inputs" contract.

## Recommendation

Use Approach A as the MVP and reserve Approach B as a same-task stretch only if the user wants stronger editor guardrails now. Avoid Approach C until concrete schema failure cases justify runtime enforcement.

