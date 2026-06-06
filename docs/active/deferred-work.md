# Deferred Work Register

## Purpose

This register records work that Tsian intentionally defers during scoped tasks.
It is not a roadmap, backlog replacement, or design essay. Its job is to keep
"not now" decisions visible after chat context, task PRDs, or review notes fade
from memory.

Use this document when a task leaves a known gap on purpose because doing it
now would widen scope, touch a riskier contract, or require a separate design
decision.

## Maintenance Rules

- Add an entry only when the team explicitly knows the gap exists and chooses
  to defer it.
- Keep each entry short, actionable, and tied to a revisit trigger.
- Record why the work was deferred, not just that it exists.
- Include a scope guard so the future task does not accidentally absorb
  unrelated platform work.
- Remove or mark an entry as resolved when the follow-up task lands.
- Do not duplicate long-term architecture rationale from
  `airp-workflow-platform-direction.md`.

## Entry Format

```md
## DW-000 Short Title

Status: deferred
Source: where the deferral came from

Temporary state:
- What is intentionally left as-is today.

Why deferred:
- Why it was not included in the current task.

Revisit when:
- Concrete trigger for picking it back up.

Suggested next task:
- Short task title or slug.

Scope guard:
- What the future task should not expand into.
```

## DW-001 Rename Internal Memory Storage Vocabulary

Status: resolved
Source: `state-write` migration, 2026-06-06

Temporary state:
- Public workflow durable reads/writes use `state-query` / `state-write`.
- Internal generic durable state storage now uses names such as `stateRecords`,
  `listStateRecordsForSave`, and `applyStateWriteOperationsForSave`.

Resolution:
- Resolved by `state-record-storage-rename`, 2026-06-06.
- Prototype IndexedDB data was intentionally not migrated; the Dexie database
  name was bumped and local prototype saves should be recreated.

Why deferred:
- Renaming this layer touches Dexie table shape, checkpoint slices, restore
  paths, save deletion, debug/query views, storage helpers, specs, and tests.
- It is a storage-contract migration, not just a public workflow node rename.

Revisit when:
- N/A for the storage vocabulary rename itself. Future schema resources or
  renderer adapters should be tracked as separate tasks.

Suggested next task:
- N/A

Scope guard:
- Historical guard: this task did not add schema resource UI, renderer
  adapters, query DSL changes, or old `memoryRecords` compatibility reads.

## DW-002 Rename Public Memory Query Node To State Query

Status: resolved
Source: post `state-write` planning, 2026-06-06

Temporary state:
- Public workflow reads now use `state-query`.
- Old `memory-query` workflow nodes fail loudly as unknown node types.

Resolution:
- Resolved by `workflow-state-boundary-cleanup`, 2026-06-06.

Why deferred:
- The write-side migration was kept small to avoid mixing public node-surface
  cleanup with read-side defaults, editor copy, tests, and docs.
- At the time, `memory-query` behavior was already collection-only, so the
  semantic issue was naming and workflow vocabulary rather than hidden AIRP
  retrieval behavior.

Revisit when:
- N/A for the rename itself. Future richer state query behavior should be
  tracked as a separate task.

Suggested next task:
- N/A

Scope guard:
- Historical guard: this rename did not rename internal storage vocabulary or
  add a richer query language.

## DW-003 Show Node-Carried Durable State Schema In Workflow Authoring

Status: completed in `06-06-workflow-carried-state-contract-authoring`
Source: persistence node-carried schema decision, 2026-06-06

Result:
- The workflow editor bottom drawer now derives a state-contract summary from
  `state-query` and `state-write` nodes.
- `state-write.config.schema` can be inspected and edited through a focused MVP
  form for schema metadata, collections, fields, relations, and indexes.
- `record-filter`, `record-merge`, and `record-format` have focused forms so the
  default AIRP workflow can be understood without raw JSON for those nodes.

Remaining limits:
- State contracts are still carried by workflow nodes rather than extracted into
  reusable workflow blocks or system packages.
- The editor performs schema self-consistency checks only; runtime `state-write`
  validation remains the final write boundary.

Follow-up direction:
- Continue toward workflow block / subworkflow / system package boundaries
  instead of introducing standalone schema resources as the next default step.

Suggested next task:
- N/A; superseded by future system-package work.

Scope guard:
- Add inspection/preview for existing node-carried schema.
- Do not build a full schema form editor or reusable schema resource system in
  the same task.

## DW-004 Revisit Schema Resources As System-Package Artifacts

Status: deferred
Source: workflow-as-system direction and workflow-carried state contract discussion

Temporary state:
- Default AIRP schema is a runtime constant from `@tsian/memory-core`.
- The default workflow carries that schema through `state-write` node config.
- Platform resources currently cover prompt presets, world books, and workflow
  presets, but not state schema resources.

Why deferred:
- In the current direction, a schema by itself only reuses a data shape. It does
  not reuse the configured query, filtering, prompt composition, maintenance,
  writeback, debug, or renderer-facing behavior that makes a system runnable.
- The preferred reuse unit is a future workflow block / subworkflow / system
  package that carries its state contract along with nodes, ports, and required
  resources.
- Standalone schema resources would need reference semantics, seed behavior,
  deletion checks, extraction rules, and authoring affordances, and could pull
  the product back toward schema-first authoring before workflow-carried state
  contracts are visible.

Revisit when:
- Workflow-carried state contracts are visible in the editor.
- A block/subworkflow/system package MVP exists or is being designed.
- Multiple packaged systems need to expose or share a stable state contract for
  renderer adapters, package dependencies, or compatibility checks.

Suggested next task:
- `workflow-block-state-contract-mvp`

Scope guard:
- Do not introduce schema resources as an isolated authoring prerequisite.
- If schema resources are introduced later, treat them as extracted/shared
  artifacts of workflow-carried contracts or system packages, not as the main
  reusable system unit.
- Do not build renderer adapters or a full visual schema editor in the same
  task.

## DW-005 Add Renderer Adapters For Schema/State Models

Status: deferred
Source: workflow-as-system direction document

Temporary state:
- Frontends can read platform state and resources through existing bridge/query
  paths.
- There is no generic adapter layer that maps a state schema to a renderer such
  as a map, relationship graph, keyword panel, or state inspector.

Why deferred:
- Renderer adapters depend on clearer workflow-carried state contract and
  system-package boundaries.
- Building renderers before the state model boundary stabilizes would likely
  hard-code the current AIRP event/archive system again.

Revisit when:
- Workflow-carried state contracts or system packages are stable enough for
  frontends to discover them.
- A concrete non-event/archive system, such as map graph state, needs a
  renderer.

Suggested next task:
- `state-renderer-adapters-exploration`

Scope guard:
- Start with one concrete renderer scenario and a minimal adapter contract.
- Do not attempt a complete UI framework or marketplace packaging model in the
  same task.
