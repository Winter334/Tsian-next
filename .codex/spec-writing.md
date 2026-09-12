# Writing useful project knowledge

This is Codex's current spec-authoring standard. Apply it to new or revised passages;
untouched historical content does not have to be migrated in the same task. It replaces
fixed seven-section templates and automatic code-spec expansion for Codex.

## What belongs where

- **Project understanding — spec:** responsibilities, authoritative data, important
  entry points, capability ownership, stable project habits and non-obvious contracts.
  Preserve knowledge that lets a future session start from a short user request.
- **Reusable judgment — guides:** the kind of decision, the factors that matter, the
  project's preferred tradeoff and the conditions that change that recommendation.
- **This task — task documents:** chosen design, rejected alternatives and why, detailed
  implementation history, experimental evidence, deviations and unfinished work.
- **Session navigation — workspace:** a compact outcome and pointers to tasks/commits.

Signatures or concrete examples are useful when necessary to explain a contract. Do not
copy inventories of types, branches or tests that are easier to obtain from source.

## Write the reasoning that changes future decisions

Ask: what would let the next session ask fewer questions, search less code, or avoid
choosing the wrong approach in a different task?

State the applicable situation, useful judgment and its limits in the shortest clear
form. These are writing goals, not mandatory headings. Keep a brief example if it helps;
link to a task or source for lengthy evidence. Label a project preference as such rather
than claiming it is universal. A one-off correction is not automatically a lasting rule.

For example, do not promote “the popup fix used a transparent overlay” into a universal
UI prescription. Preserve the judgment: first consider whether layout, data ownership
or an existing native mechanism can guarantee the desired behavior structurally before
adding interception and fallback paths. Use it only when that structure meets the real
interaction requirements; keep the popup details in the task.

Similarly, reuse depends on shared meaning and expected co-evolution, not resemblance
alone. Share a rule that must change consistently; tolerate local duplication when
sharing would introduce unrelated options, branches or dependencies.

## Maintain touched knowledge, rather than append indefinitely

During normal work, note the relevant spec passage and any demonstrated problem using
existing notes. At completion, revise that passage under this standard:

- Delete confirmed obsolete restrictions, redundant common knowledge or duplicated text.
- Add missing project context, decision criteria and genuinely reusable experience.
- Correct inaccurate explanations and narrow conclusions overgeneralized from one case.
- Update superseded responsibilities, paths and decisions; replace stale text rather
  than appending an incompatible rule below it.

Use the current agreed design and observed implementation as evidence. If code and spec
disagree, determine whether the code is wrong or the documented contract changed; do not
rewrite the contract merely to excuse an implementation defect. Preserve safety and data
integrity constraints that still apply.

Stay within the used sections and knowledge already gained by the task. Leave unrelated
history alone. No new finding means no obligatory spec edit, and partial modernization
of a large document is a valid result. Review prose, links and references as appropriate;
a spec edit does not itself require product builds or a new independent review cycle.
