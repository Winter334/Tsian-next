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

Status: deferred
Source: `state-write` migration, 2026-06-06

Temporary state:
- Public workflow durable writes use `state-write`.
- Internal storage, checkpoint, and helper vocabulary still uses names such as
  `memoryRecords`, `applyMemoryWriteOperationsForSave`, and generic memory
  storage helpers.

Why deferred:
- Renaming this layer touches Dexie table shape, checkpoint slices, restore
  paths, save deletion, debug/query views, storage helpers, specs, and tests.
- It is a storage-contract migration, not just a public workflow node rename.

Revisit when:
- Public read/write node vocabulary has been unified around state terminology.
- Before schema resources or renderer adapters rely on generic state wording.

Suggested next task:
- `state-record-storage-rename`

Scope guard:
- Deliberately rename storage/checkpoint/helper vocabulary and decide whether
  prototype data is cleared or compatibility-read.
- Do not add schema resource UI, renderer adapters, or query DSL changes in the
  same task.

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

Status: deferred
Source: persistence node-carried schema decision, 2026-06-06

Temporary state:
- `state-write` can carry a `MemorySchemaDefinition` in node config.
- The editor does not yet provide a focused view of that durable state contract.

Why deferred:
- The first schema-boundary task needed to establish execution behavior and
  fail-loud validation before adding authoring UX.
- A rich schema editor would be larger than the current workflow-surface
  cleanup tasks.

Revisit when:
- Authors need to inspect why a `state-write` validates or rejects operations.
- Workflow preview needs to communicate the state model formed by a preset.

Suggested next task:
- `workflow-state-schema-visibility`

Scope guard:
- Add inspection/preview for existing node-carried schema.
- Do not build a full schema form editor or reusable schema resource system in
  the same task.

## DW-004 Extract Reusable State Schema Resources

Status: deferred
Source: workflow-as-system direction and state schema boundary discussion

Temporary state:
- Default AIRP schema is a runtime constant from `@tsian/memory-core`.
- The default workflow carries that schema through `state-write` node config.
- Platform resources currently cover prompt presets, world books, and workflow
  presets, but not state schema resources.

Why deferred:
- The selected MVP keeps schema close to the persistence node so workflow
  authoring remains coherent.
- Reusable schema resources need reference semantics, seed behavior, deletion
  checks, and authoring affordances.

Revisit when:
- Multiple workflows need to share the same state schema.
- Mods/packages need to ship keyword, map, relationship, or style-rule schemas
  as reusable assets.

Suggested next task:
- `state-schema-resources-mvp`

Scope guard:
- Introduce reusable schema resource storage and references.
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
- Renderer adapters depend on clearer state schema/resource boundaries.
- Building renderers before the state model boundary stabilizes would likely
  hard-code the current AIRP event/archive system again.

Revisit when:
- State schema resources or workflow-carried state contracts are stable enough
  for frontends to discover them.
- A concrete non-event/archive system, such as map graph state, needs a
  renderer.

Suggested next task:
- `state-renderer-adapters-exploration`

Scope guard:
- Start with one concrete renderer scenario and a minimal adapter contract.
- Do not attempt a complete UI framework or marketplace packaging model in the
  same task.
