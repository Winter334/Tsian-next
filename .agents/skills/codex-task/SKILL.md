---
name: codex-task
description: "Codex only: preserve planning and decisions for substantial changes, find or resume a recorded task, and archive completed work. Not needed for small direct edits."
---

# Task records for Codex

Use `.codex/trellis.md` as the workflow. Tasks are durable work records, not phase gates.

## Plan substantial work

Inspect relevant project guidance and code, then record the goal, scope and consequential
choices before implementing. Resolve important ambiguity with the user, not ceremonial
phase permissions. Reuse an existing matching task rather than create a duplicate.

```sh
python ./.trellis/scripts/task.py list
python ./.trellis/scripts/task.py create "Task title" --slug meaningful-name
```

Use the directory returned by `create`; it adds its own date prefix. Preserve useful
requirements in `prd.md`, design choices and alternatives in `design.md`, and execution,
validation and remaining work in `implement.md`. Do not generate empty sections solely
to complete a template. Record changes to decisions where they belong as work progresses.
Parent/child tasks are available when independently deliverable work benefits from them,
not simply because a request touches several files.

The seeded JSONL files are optional context aids. No curation gate is needed for Codex;
when delegating, supply the bounded assignment and relevant paths directly.

## Find or resume work

```sh
python ./.trellis/scripts/get_context.py
python ./.trellis/scripts/task.py current --source
python ./.trellis/scripts/task.py list-archive
```

Use task names, journal indexes and targeted text searches in `.trellis/tasks/` to find
the relevant record. Read its requirements, decisions, actual progress and evidence,
then check the affected code. Resolve outdated facts locally; do not re-audit the whole
repository. If the historical discussion is missing, use `codex-memory` or `trellis mem`.

`task.py start <task-dir>` can set the session pointer/status when useful for tracking;
it does not authorize execution. Native `CODEX_THREAD_ID` supplies session identity.
If identity is unavailable, work from the explicit task directory rather than inventing
an identity or borrowing another session's pointer. Do not load `--mode phase`.

## Close the record

At completion, update the actual result, deviations, verification and remaining issues
in existing task documents. Reflect on reusable knowledge under `.codex/spec-writing.md`.
Archive only when the task is really complete, not merely because a session is ending:

```sh
python ./.trellis/scripts/task.py archive <task-dir> --no-commit
```

Leave partial work discoverable with an accurate next action. `task.py finish` only clears
the current session pointer; it does not complete or archive a task. Recording and
archiving do not require a clean worktree or a preceding code commit. Leave unrelated
changes and other sessions' tasks alone.
