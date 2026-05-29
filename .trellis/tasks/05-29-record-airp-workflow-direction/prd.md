# Record AIRP Workflow Platform Direction

## Goal

Persist the product and architecture decisions from the 2026-05-29 AIRP workflow discussion so future sessions can resume from the same direction without reconstructing the reasoning from chat history.

## What I Already Know

* The product direction is to build Tsian as an AIRP workflow editing and runtime platform.
* AIRP is treated as a presettable, composable, debuggable AI text-processing workflow.
* The default event/archive memory system should be polished first and treated as a reference implementation, not as an immutable final core.
* The current near-term priority is workflow infrastructure, especially save-level workflow preset selection.
* The user explicitly wants this direction recorded before the next implementation task.

## Requirements

* Add a persistent active doc for the AIRP workflow platform direction.
* Update the active docs index so future sessions read the direction before implementation details.
* Update the current implementation plan so the recommended next step is save-level workflow preset override.
* Create a separate next implementation task for save-level workflow preset override.
* Keep the recording task documentation-only; do not start code implementation in this task.

## Acceptance Criteria

* [ ] `docs/active/airp-workflow-platform-direction.md` records the product thesis, workflow abstraction, memory direction, platform safety boundary, and near-term roadmap.
* [ ] `docs/active/README.md` includes the new direction doc in the recommended reading order.
* [ ] `docs/active/implementation-plan.md` points the next implementation step at save-level workflow preset override.
* [ ] `.trellis/tasks/05-29-save-workflow-preset-override/prd.md` exists and can be used as the next task handoff.
* [ ] Existing unrelated dirty files are not touched.

## Definition of Done

* Documentation changes are committed.
* The record task is ready to archive after commit.
* The next implementation task remains active in planning state, ready to start separately.

## Out of Scope

* Implementing save-level workflow preset override.
* Adding new workflow node types.
* Refactoring the memory system into nodes.
* Designing a full MemoryStore plugin architecture.
* Changing contracts or runtime code.

## Notes

This task intentionally preserves product direction, not executable code contracts. The executable contract work should happen in the follow-up implementation task.

