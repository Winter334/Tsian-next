# Codex: project memory, lightweight execution

This is the workflow for Codex in this repository. Shared Trellis phase rules and
legacy workflow skills do not govern Codex. Other platforms are unchanged.

## Work according to the need

- Small, well-understood changes: do them directly. Do not ask whether to create a task.
- Larger changes: keep a Trellis task and plan before implementing. Judge size by
  behavioral impact, uncertainty and continuity needs, not line count alone.
- Keep requirements in `prd.md`, decisions and alternatives in `design.md`, and
  execution progress, validation and remaining work in `implement.md`. Use these
  documents to preserve useful understanding, not to satisfy an artifact checklist.
- Ask about consequential scope, product or risk decisions. A named phase transition
  is not a reason to ask for approval. If scope grows, update the plan and record.
- Task statuses and JSONL manifests organize records; they are not permission gates.
  Neither a status change nor a populated manifest is a prerequisite for editing.

## Recover project understanding

Use `.trellis/tasks/` for current and past decisions, `.trellis/spec/` for project
knowledge, and `.trellis/workspace/` for session summaries. On a new topic or after
context loss, inspect Git state and the relevant task/spec indexes; do not load the
shared phase index. Read the actual guidance needed for the affected area.

For continuation, recover the relevant task documents, then check the affected code
against their recorded state. Do not restart repository-wide discovery or re-prove
all historical decisions. Use `trellis mem` when a missing discussion would help.

## Implement and verify

Research, independent review and subagents are tools to choose when they materially
help, not mandatory stages. Work locally when it is the efficient choice. Delegate
bounded scopes with explicit context and ownership when useful; a task path is optional.

Use `.trellis/spec/guides/validation-strategy.md` to choose evidence for the actual
change. Review the task's cumulative changes and direct consumers; expand only along
concrete dependencies or risks. Optional `trellis-check` reports findings without editing.
The main session decides which findings belong to the task and fixes confirmed defects.

Preserve real trust-boundary and compatibility contracts. Do not add speculative
fallbacks, abstractions or future compatibility just to make code appear more defensive.
After a fix, revalidate the affected behavior; do not automatically restart a broad audit.
Finish when the requested behavior is delivered, confirmed defects are resolved and
relevant verification is satisfactory. State any remaining uncertainty honestly.

## Retrospect and maintain memory

At completion, reflect on decisions, user corrections and reusable lessons. Update the
existing task record with the actual outcome, deviations, evidence and unfinished work.
Persist useful knowledge; do not invent a new rule merely to produce a spec update.

While using specs, note useful corrections in existing task notes or working context.
At wrap-up, improve only the entries or sections actually used and understood: remove
confirmed redundancy, fill important gaps, correct mistakes and refresh stale guidance.
An unused section is not automatically useless; reading a large file does not commit
you to rewriting it. Defer maintenance that would require a separate investigation.

Read `.codex/spec-writing.md` when adding or revising knowledge. Its writing standard
replaces legacy spec-authoring templates for Codex, not established product contracts.
Keep detailed task history in task files. Session journals and task archives can be
written without Git commits (`--no-commit`). Commit or push only when the user requests it.

## Optional skills

- `codex-task`: plan, find, resume and archive substantial work using existing task tools.
- `codex-memory`: recall discussions, record a retrospective and maintain touched specs.

No skill invocation is required merely because another step finished. Legacy Trellis
skills are explicit-only; if requested, use their relevant capability under this policy,
not their old phase sequence.
