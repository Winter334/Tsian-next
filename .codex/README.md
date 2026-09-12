# Codex Trellis integration

Codex uses [trellis.md](trellis.md), not the shared `.trellis/workflow.md` state machine.
This keeps major-change plans and decision history while removing compulsory phase
transitions, per-turn reminders, independent reviews and spec expansion.

## Entry points

- Root `AGENTS.md` points Codex to the local policy; project `config.toml` supplies the
  same bootstrap as developer instructions when the project is trusted.
- `hooks.json` is intentionally empty. The previous session/workflow/subagent Python
  hooks are removed; no hook trust bypass or user-level feature change is needed.
- Legacy `trellis-*` skills have Codex-specific `agents/openai.yaml` metadata with
  `allow_implicit_invocation: false`. Their bodies remain intact and explicitly
  callable, but are absent from the automatic model skill catalog. Two lightweight
  capabilities live in `.agents/skills/codex-task/` and `.agents/skills/codex-memory/`.
- The three agent profiles are optional. Implementers have a bounded write scope;
  reviewers/researchers are read-only and return findings to the main session.
- Task CLI, history, project specs, journals and `trellis mem` remain available.
  Task CLI resolves native `CODEX_THREAD_ID` without a workflow hook.

[spec-writing.md](spec-writing.md) is the current Codex authoring standard. Modernize
only knowledge encountered in normal work, not all historical specs in one campaign.
Shared runtime/spec contracts remain meaningful; only the old authoring ceremony is
replaced. Shared task scripts/config and `.claude/` / `.zcode/` were not changed.

## Reload and maintenance

Start a **new Codex session** after changing these assets. Existing conversations can
still contain old injected developer instructions and a previously discovered skill
catalog. Reloading files cannot erase those messages.

Project config requires a trusted project. The `AGENTS.md` pointer and per-skill
invocation metadata also provide the lightweight entry without relying on that config
layer. No trust settings are changed by this integration.

`trellis update` manages generated integration files and may conflict with or restore
legacy assets. Keep the Codex customization when resolving those changes; do not use a
force update to overwrite it. After an update, inspect the Codex diff and run:

```sh
python -B -m unittest discover -s tests -p test_codex_trellis.py
```

These checks validate configuration, entry points and isolation, not model behavior.
For a new session, check that a small edit starts directly, a larger request gets a
useful recorded plan, continuation consults past decisions, and finishing maintains
only touched knowledge without automatically spawning a reviewer.

## Configuration references

- https://developers.openai.com/codex/config-reference
- https://developers.openai.com/codex/config-file/config-advanced
- https://developers.openai.com/codex/build-skills

In this installation (Codex CLI 0.153.4), project-layer `skills.config` disable entries
were parsed but legacy skills remained in the rendered model input. Native per-skill
invocation metadata was verified to remove them. Keep that tested mechanism rather
than assuming a successfully parsed config necessarily changes model-visible context.
No global Codex settings, model selection or other platform workflow is changed.
