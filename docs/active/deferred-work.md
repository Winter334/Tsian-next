# Deferred And Retired Work Register

## Purpose

This register records known directions that are deferred, retired, or no longer current after the Agent Runtime direction change.

Use this file to prevent old prototype ideas from re-entering planning as if they were still active roadmap items.

## Rules

- Keep entries short.
- Record why the item is not current.
- Point to the new boundary when possible.
- Do not preserve full old design text here; use Trellis task history or git history for archaeology.

## DW-001 Visual DAG Workflow As Core Runtime

Status: retired as long-term core direction

Implementation state:

- Active workspace code has removed the old workflow engine, workflow host, workflow editor, workflow preset resources, stateModel, and workflow debug surfaces.
- Historical details remain in Trellis archived tasks and git history.

Why retired:

- The fixed DAG model is too low-level for the desired AIRP runtime.
- It makes authoring difficult and tends to push behavior into compute scripts, macro prompts, and editor-specific configuration.
- The new direction is 主控 Agent + 专业 Agent + 通用工具, with runtime data consumed by frontend packages.

Revisit when:

- A future Agent Runtime needs an internal deterministic plan format for a narrow subsystem.

Scope guard:

- Do not rebuild the AIRP main loop around visual DAG workflow.
- Do not extend workflow editor as the default authoring experience.

## DW-002 SillyTavern Prompt Engine As Core AI Abstraction

Status: retired as long-term core direction

Implementation state:

- Active workspace code has removed `packages/prompt-engine`, builtin prompt presets, world book resources, regex/macro prompt assembly, and AI node prompt preset wiring.
- Historical details remain in Trellis archived tasks and git history.

Why retired:

- Macro prompt assembly hurts cache locality and hides data binding inside text.
- AI node configuration becomes difficult because changing runtime data often means editing prompt text.
- The Agent Runtime direction prefers structured context packages, tools, agent responsibilities, and platform-controlled model calls.

Revisit when:

- A future compatibility/import feature explicitly needs to read old SillyTavern materials.

Scope guard:

- Do not make SillyTavern prompt preset compatibility a prerequisite for the new runtime.
- Do not design new core Agent APIs around flattened string macros.

## DW-003 Platform-Level Generic Renderer Or UI DSL

Status: not current

Implementation state:

- No platform-level renderer adapter, RenderBlocks, widget DSL, or generic UI slot standard is planned.

Why not current:

- Runtime output and frontend package rendering can use private agreements.
- Platform should not understand gameplay UI semantics.
- Premature UI DSL design would harden unvalidated assumptions.

Revisit when:

- Multiple frontend packages independently need the same optional rendering contract and the duplication becomes painful.

Scope guard:

- Keep platform responsible for bridge and sandbox boundaries, not for deciding how data renders.

## DW-004 Standalone Schema Resource Mainline

Status: not current

Implementation state:

- Old workflow/stateModel work explored schema authoring for workflow state.

Why not current:

- In the Agent Runtime direction, runtime owns its internal data semantics and frontend package owns rendering interpretation.
- Platform should provide generic storage and validation capabilities, but not require a platform-wide schema resource mainline before gameplay can evolve.

Revisit when:

- A concrete runtime/package format needs reusable schema assets as part of content distribution.

Scope guard:

- Do not reopen standalone schema resources as a default prerequisite for Agent Runtime.
