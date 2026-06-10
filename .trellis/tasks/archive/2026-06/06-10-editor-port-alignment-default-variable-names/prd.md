# 优化工作流编辑器端口对齐与示例变量命名

## Goal

Improve the workflow editor authoring experience by making node port labels line up with their connection squares, and make the default AIRP workflow easier to read as an example by replacing dotted/internal-looking port names with domain-oriented names where the runtime contract allows it.

## What I already know

* 用户反馈：节点输入/输出端口文本和卡片边缘的小方块没有对齐，连接时需要仔细辨认，容易连错。
* 用户反馈：默认工作流里存在较长的 `xxx.xxx` 风格变量名映射，不适合作为示例工作流的第一印象。
* `apps/platform-web/src/components/workflow/WorkflowNode.vue` currently renders port text in a grid, while Vue Flow `Handle` components are positioned separately with `handleTop(idx, total)` percentages across the whole node.
* `builtin/mods/default-airp-workflow.ts` uses dotted input names such as `events.records`, `archives.records`, `globals.records`, `retrieval.prompt`, `retrieval.directEntities`, and `archives.recent.json`.
* `ai-call` executor converts workflow inputs into prompt macros, so AI node input names can be renamed when the builtin preset references are updated together.
* `compute` nodes read `inputs[name]` inside their scripts, so compute input renames must be applied to node declarations, edges, and script constants together.

## Requirements

* Align each visible input/output port label row with the corresponding Vue Flow connection square.
* Preserve connection behavior for explicit input/output handles and the fallback "any input" handle.
* Simplify default AIRP workflow port/input names that look like dotted macro paths when they are only workflow-local wiring keys.
* Add clear display labels to default workflow ports where labels improve readability without hiding the executable port name from inspector/tooltips.
* Keep default AIRP workflow behavior equivalent after renaming by updating scripts, edges, and builtin preset macros consistently.

## Acceptance Criteria

* [x] In node cards, each rendered input/output row is vertically centered with its handle square.
* [x] Nodes with no explicit inputs but incoming-capable behavior still expose a fallback input handle aligned to the fallback row.
* [x] Default workflow no longer uses dotted workflow-local input names for AIRP retrieval/chat/maintenance wiring.
* [x] Builtin chat and maintenance presets reference the renamed workflow input macros.
* [x] Existing default workflow validation tests pass after updating expected edge names.

## Definition of Done

* Run relevant unit tests for default workflow behavior.
* Run the required platform-web build check for frontend changes.
* Review whether any spec update is needed after implementation.

## Technical Approach

* Move `Handle` components into the same DOM rows as their visible port labels, overriding their absolute offsets relative to the row so the connection square remains on the node edge while following the row center.
* Replace dotted default workflow input names with short domain names, for example `eventRecords`, `archiveRecords`, `globalRecords`, `memoryPrompt`, `entityNames`, and `recentArchives`.
* Update default workflow compute scripts, node input declarations, workflow edges, builtin chat/maintenance preset macro references, and tests in one pass.

## Decision (ADR-lite)

**Context**: The editor currently derives handle positions from percentages across the whole node, but labels live in a lower card section whose position changes when titles/config summaries change.

**Decision**: Anchor handles to the actual rendered port rows instead of calculating their vertical position independently.

**Consequences**: The visual model becomes more robust as node card content changes. The implementation is scoped to the node card rendering and avoids changing the workflow edge schema.

## Out of Scope

* Redesigning the workflow edge contract or adding edge-level mapping expressions.
* Changing AIRP retrieval logic, scoring, persistence schema, or prompt behavior beyond macro key renames required for equivalent behavior.
* Reworking inspector forms beyond any labels needed to keep the default workflow understandable.

## Technical Notes

* Relevant files:
  * `apps/platform-web/src/components/workflow/WorkflowNode.vue`
  * `builtin/mods/default-airp-workflow.ts`
  * `apps/platform-web/src/workflow-host/builtin-presets/chat.preset.json`
  * `apps/platform-web/src/workflow-host/builtin-presets/maintenance.preset.json`
  * `packages/workflow-engine/test/mixed-airp-default-workflow.test.ts`
  * `packages/workflow-engine/test/sc-crit.test.ts`
* Relevant specs:
  * `.trellis/spec/platform-web/frontend/index.md`
  * `.trellis/spec/guides/index.md`
* Verification:
  * `npm run build:workflow-engine`
  * `npm run test --workspace @tsian/workflow-engine`
  * `npm run build:web`
  * Browser preview at `http://127.0.0.1:5173/#/resources`; DOM measurement found 58 port rows with max handle-to-label center delta `0px`.
