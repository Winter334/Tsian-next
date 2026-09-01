# Deferred Work Register

## Goal

Create a small active documentation register for work that is intentionally
deferred during scoped implementation tasks. The register should preserve why a
known gap was left for later, what should revisit it, and what must stay out of
scope when it becomes a real task.

This prevents "not now" decisions from turning into ambiguous legacy problems
after conversation context is lost.

## What I Already Know

* The direction document positions Tsian as a workflow-as-system platform.
* Recent work renamed the public durable write workflow node from
  `memory-write` to `state-write`.
* Internal storage/checkpoint vocabulary such as `memoryRecords` was
  intentionally left in place to keep that task bounded.
* The user explicitly wants a document that records these intentionally
  deferred items so they are not forgotten or mistaken for accidental leftovers.
* `docs/active/README.md` currently says the active docs set should remain
  small and currently lists only:
  * `README.md`
  * `current-state-handoff.md`
  * `airp-workflow-platform-direction.md`
* `current-state-handoff.md` already records current implementation state and
  next-step candidates, but it is not structured as a deferred-work register.

## Assumptions (Temporary)

* A new `docs/active/deferred-work.md` document is justified despite the active
  docs minimization rule because it has a distinct maintenance role.
* The document should be terse and index-like, not a new long-form roadmap.
* The active docs README should be updated so future maintainers know this
  document is part of the maintained active set.
* This task should only create the register and seed known items. It should not
  implement any deferred item.

## Requirements

* Add an active deferred-work register document.
* Document the purpose and maintenance rules for the register.
* Use stable deferred-work IDs such as `DW-001`.
* Each entry should record:
  * status;
  * source/context;
  * temporary state;
  * why it was deferred;
  * revisit trigger;
  * suggested next task;
  * scope guard.
* Seed the register with currently known deferred items from recent
  workflow-as-system discussions:
  * internal `memoryRecords` / storage helper / checkpoint vocabulary should
    eventually move to generic state vocabulary;
  * public `memory-query` should likely migrate to `state-query`;
  * workflow/editor visibility for node-carried durable state schema;
  * schema resource extraction from node-carried schema;
  * renderer adapters for schema/state model rendering.
* Update `docs/active/README.md` so the active docs reading order and
  maintenance rules mention the new register.
* Optionally update `current-state-handoff.md` to point readers at the register
  for known deferred work, without duplicating every deferred item.

## Acceptance Criteria

* [x] `docs/active/deferred-work.md` exists.
* [x] The register explains what belongs there and what does not.
* [x] The register contains seeded entries for the known deferred items above.
* [x] Each seeded entry records why the item is deferred and what should trigger
  revisiting it.
* [x] `docs/active/README.md` includes the register in the maintained active
  docs set.
* [x] `current-state-handoff.md` links to the register or otherwise makes it
  discoverable from the current-state entry point.
* [x] No implementation or storage/node migrations are performed in this task.

## Definition Of Done

* PRD is confirmed by the user.
* Documentation changes are committed.
* Task is archived and session is recorded.

## Out Of Scope

* Implementing `state-query`.
* Renaming `memoryRecords`, Dexie tables, checkpoint fields, or storage helpers.
* Creating schema resource UI.
* Creating renderer adapters.
* Adding Trellis automation around deferred-work IDs.
* Reopening archived docs as active guidance.

## Technical Approach

Use `docs/active/deferred-work.md` as a focused register:

```md
## DW-001 Short Title

Status:
Source:
Temporary state:
Why deferred:
Revisit when:
Suggested next task:
Scope guard:
```

Keep entries short enough to scan. Link back to direction/current-state docs
only when needed. Do not duplicate broad architecture rationale that belongs in
`airp-workflow-platform-direction.md`.

## Decision (ADR-lite)

**Context**: Scoped implementation tasks keep leaving intentionally deferred
work, but chat context and old task PRDs are not reliable long-term reminders.
The active docs set is intentionally small, so any new active document needs a
distinct job.

**Decision**: Add a maintained active deferred-work register. It records known
deferred items as structured, actionable entries with revisit triggers and
scope guards.

**Consequences**: Future tasks can see why a gap exists before treating it as a
bug or accidental legacy. The cost is one more active document, controlled by
strict entry format and README maintenance rules.

## Implementation Plan

1. Create `docs/active/deferred-work.md` with purpose, rules, and seeded entries.
2. Update `docs/active/README.md` reading order and maintenance rules.
3. Update `docs/active/current-state-handoff.md` with a short pointer to the
   register.
4. Review for duplicated roadmap content and keep the register concise.

## Open Questions

* None currently. The proposed shape follows the user's request and existing
  active-docs constraints.

## Technical Notes

* Active docs README: `docs/active/README.md`.
* Direction doc: `docs/active/airp-workflow-platform-direction.md`.
* Current handoff: `docs/active/current-state-handoff.md`.
* Seed source: 2026-06-06 discussion after `state-write` migration.
