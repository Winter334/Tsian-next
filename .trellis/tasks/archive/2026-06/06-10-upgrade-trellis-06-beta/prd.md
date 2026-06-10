# Upgrade Trellis to 0.6 beta

## Goal

Upgrade this WSL checkout from Trellis 0.5.19 to the 0.6 beta line so the project can use the newer channel-based multi-agent workflow consistently instead of mixing a 0.5 project with ad hoc 0.6 CLI calls.

## What I Already Know

- The user explicitly wants to upgrade directly to 0.6 beta to avoid partial-adoption drift.
- The project currently reports `.trellis/.version` as `0.5.19`.
- WSL has Linux Node/npm and Codex CLI available.
- A smoke test using `npx -y @mindfoldhq/trellis@beta channel run --provider codex` succeeded without modifying repository files.
- `trellis update --dry-run` from the beta CLI reports an upgrade from `0.5.19` to `0.6.0-beta.23`.

## Requirements

- Install or make available the WSL-native Trellis beta CLI, avoiding reliance on the old Windows-path `trellis` shim.
- Run the beta update for this project and apply required migrations.
- Preserve user data under `.trellis/tasks/`, `.trellis/workspace/`, and `.trellis/spec/`.
- Resolve update prompts for locally modified project config files conservatively.
- Verify Trellis session context still loads after upgrade.
- Verify channel-based Codex worker execution still works after upgrade.
- Verify the application build/tests still pass after generated file updates.

## Acceptance Criteria

- [ ] `trellis --version` or an equivalent WSL-native invocation reports `0.6.0-beta.x`.
- [ ] `.trellis/.version` reports the upgraded beta version.
- [ ] `python ./.trellis/scripts/get_context.py` succeeds and identifies developer `baisha`.
- [ ] `trellis channel run --provider codex` smoke test succeeds.
- [ ] Repository build/tests used for migration validation pass.
- [ ] Git diff is reviewed and contains only expected Trellis upgrade/task files.

## Out of Scope

- Redesigning the project workflow beyond the upstream beta update.
- Refactoring application code.
- Enabling a complex multi-worker workflow template unless the beta update itself requires it.
- Pushing to remote.

## Technical Notes

- Relevant Trellis architecture references were read through `trellis-meta`.
- Shared guides read before implementation:
  - `.trellis/spec/guides/index.md`
  - `.trellis/spec/guides/code-reuse-thinking-guide.md`
  - `.trellis/spec/guides/cross-layer-thinking-guide.md`
- Known dry-run changes include generated workflow/scripts/hooks/agents updates, new `.trellis/agents/*.md`, `trellis-session-insight`, and `trellis-spec-bootstarp` to `trellis-spec-bootstrap` migration.

## Verification Results

- WSL-native `trellis` now resolves to `/usr/local/bin/trellis` and reports `0.6.0-beta.23`.
- `.trellis/.version` reports `0.6.0-beta.23`.
- `python ./.trellis/scripts/get_context.py` succeeds and identifies developer `baisha`.
- `python ./.trellis/scripts/task.py validate .trellis/tasks/06-10-upgrade-trellis-06-beta` passes.
- `trellis mem projects --platform codex --limit 5` lists the current project.
- `trellis channel run --provider codex` post-upgrade smoke test returned `CHANNEL_OK_06`.
- `python -m compileall -q .trellis/scripts .codex/hooks` passes.
- `git diff --check` passes.
- `trellis update --dry-run` reports matching project/CLI beta versions and no pending generated template updates, aside from expected locally modified config files.
- TypeScript package builds and `platform-web` build pass.
- Vitest suites pass for `memory-core`, `workflow-engine`, and `prompt-engine`.

## Spec Update Decision

No `.trellis/spec/` update is needed for this task. The work upgraded Trellis-generated workflow/tooling files and captured the operational migration notes in this task artifact; it did not establish a new project coding convention or application runtime contract.

## Rollback Plan

- If the update fails before a useful diff is produced, restore generated file changes from git and keep this task as a failed migration record.
- If validation fails after update, inspect the generated diff first; only revert if the failure is caused by the Trellis migration and cannot be fixed locally.
