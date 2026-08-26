# Validation Scope And Evidence Guide

> **Core principle**: Every change needs an appropriate quality judgment, but not every quality judgment requires running a build or test command.

Validation exists to gather evidence against plausible failure modes. Choose the smallest set of checks that can meaningfully detect regressions caused by the actual diff, then expand only when the remaining risk justifies it.

## Decide Before Running Commands

1. Identify the changed artifacts and whether they are executable.
2. Name the realistic ways this change could be wrong.
3. Choose evidence that can detect those failures.
4. Prefer the narrowest check that covers the affected behavior.
5. Expand to package-wide, cross-package, or repository-wide checks only when the change surface or uncertainty is correspondingly broad.

Do not run a command merely because it exists, because a workflow reached its final phase, or because broader validation appears more thorough. A check that cannot detect the likely failure is ceremony, not evidence.

## Validation By Change Type

| Change type | Default validation | Do not run by default |
|---|---|---|
| Prose-only docs, comments, journals, or task notes | Re-read the diff; check structure, wording, links, paths, and factual references | Builds, type-checks, or code tests |
| README command or configuration examples | Confirm referenced files/scripts/options exist; use parsing, `--help`, or a safe dry-run only when it directly validates the changed example | Executing the full workflow described by the document |
| AI-facing prompts, skills, specs, or Agent instructions | Review trigger wording, scope, contradictions, mirrored entry points, and whether the instruction is self-contained | Product builds/tests unless prompt loading, generation, parsing, or runtime wiring changed |
| Structured config, manifests, schemas, or generated metadata | Parse/schema-check the changed files and verify affected references or generation boundaries | Unrelated package tests |
| Localized executable code | Relevant lint/type-check plus focused tests or manual checks for the changed behavior | Repository-wide verification when the impact is contained |
| Shared contracts, storage formats, build tooling, or cross-layer behavior | Affected package checks plus relevant consumer/integration checks | Unrelated product suites |
| Verification pipeline, release packaging, or broad refactor | Repository-wide verification when it is the actual contract being changed | Skipping broad checks merely because individual files look small |

Specific package specs may require stronger checks for known runtime traps. Apply those requirements only when their documented trigger is actually touched.

## Documentation And Prompt Changes

Text files can be operationally important without becoming code changes.

- If prose only describes behavior, validate the description against authoritative code or current docs.
- If a command name changes, verify the command definition or help output; running its entire downstream pipeline is usually unnecessary.
- If a prompt or spec changes future Agent behavior, search the intended project-owned mirrors and entry points, then inspect semantic consistency.
- If the text is consumed by a parser, generator, hook, packaging step, or runtime loader, treat that integration boundary as executable and run the narrow check for that boundary.
- A green build does not prove prose accuracy, prompt quality, UI behavior, or documentation usability.

## When Broader Validation Is Justified

Broaden checks when at least one of these is true:

- The change modifies shared contracts used by multiple packages.
- The affected behavior crosses storage, runtime, API, bridge, or UI boundaries.
- The change touches build, test, packaging, deployment, or generation infrastructure.
- A broad refactor makes the affected surface difficult to bound reliably.
- Targeted checks fail to provide confidence or reveal unexpected coupling.
- The user explicitly requests a release/full verification gate.

File count alone is not a sufficient reason to broaden or narrow validation.

## Reporting

Report the evidence that was actually relevant:

- What was checked and which failure mode it covers.
- What was intentionally not run because it could not validate the change.
- Any residual risk that still requires user or runtime verification.

For a prose-only change, “reviewed diff and verified links/references; no build or tests were relevant” is a complete verification result, not a missing quality gate.

## Common Mistakes

- Running the full build and smoke suite after a README-only edit.
- Treating `full-scope review` as synonymous with `run every available command`.
- Re-running unchanged package checks after a follow-up that only edits prose.
- Using a passing type-check as evidence that UI layout, prompt behavior, or documentation instructions are correct.
- Listing irrelevant skipped commands as failures or unresolved test gaps.

