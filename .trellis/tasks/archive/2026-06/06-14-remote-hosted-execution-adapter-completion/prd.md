# Remote / Hosted Execution Adapter Completion

## Goal

Resolve the remaining remote/WASM/hosted execution foundation gap before UI, concrete Agent role design, and Skill package design.

This is now a no-code decision/docs cleanup task. The confirmed outcome is not to add a new executor in this foundation phase. Instead, record that `remote_http`, WASM, remote script loading, and hosted execution do not provide enough near-term value over the existing `browser_script` executor and should be abandoned or deferred until a concrete Skill use case proves the need.

## Parent Direction

Parent task: `.trellis/tasks/06-13-runtime-foundation-completion`

Parent roadmap item: Remote / Hosted Execution Adapter Completion.

This child exists because remote/WASM/hosted execution was out of scope for the completed executor policy/result-contract child only. The parent task still needs a clear disposition for that gap.

## User Value

- Avoids adding a second remote-call surface that duplicates what Skill-local `browser_script` can already do with `fetch`.
- Keeps the executor model smaller before author-facing Skill and UI work.
- Preserves AIRP immersion by avoiding new trust prompts, remote package review flows, or complex install-time approval UX.
- Keeps future effort focused on strengthening the existing Skill action path rather than multiplying executor classes.
- Leaves room to add a new executor later only if a concrete Skill cannot be expressed through `browser_script`, `platform_action`, or a remote API called from script.

## Confirmed Facts

- Current action executor support in code is `builtin`, `platform_action`, and `browser_script`; unsupported executor types load structurally but calls return `ACTION_EXECUTOR_UNSUPPORTED`.
- `action_call` remains gated by `skill_load`; action declarations are parsed from `tsian-actions` fenced JSON inside loaded `SKILL.md` files.
- Existing action declarations support `inputSchema`, optional `outputSchema`, executor timeout normalization, executor policy, structured observations, trace, and diagnostics.
- Existing `browser_script` runs Skill-local Worker scripts and exposes Tsian SDK access to workspace read/list/search/write/delete, `fetch`, log/trace, and timeout/abort.
- `browser_script` does not expose raw DOM, `window`, platform internals, native files, terminal, localStorage, or API keys as supported APIs.
- Runtime workspace writes made during `interaction.sendMessage` use staged transactions: same-turn reads see staged writes, successful turns commit, and failed/aborted turns discard ordinary workspace mutations.
- Runtime trace and Agent-facing diagnostics already cover action calls, executor policy checks, script logs/fetch summaries, workspace mutations, and structured failures without large raw payloads.
- The original motivation for remote/hosted execution included possible self-updating or remotely packaged execution, but that creates package trust, versioning, caching, review, and debugging concerns before there is a proven Skill ecosystem need.
- `remote_http` can mostly be represented today as a `browser_script` action that calls an external API with `fetch`.
- Hosted execution can later be exposed as ordinary remote APIs consumed by `browser_script` instead of requiring a distinct platform executor.
- WASM is not currently required by a known AIRP Skill use case and would add a narrow, specialized runtime surface.

## Proposed Decision

Do not implement `remote_http`, WASM, remote script loading, or hosted execution as new executor classes in this foundation phase.

Instead:

- Treat `browser_script` as the supported extension point for remote API interaction.
- Treat remote services as APIs that Skills call from `browser_script` when needed.
- Strengthen existing executors later only when a concrete Skill need appears.
- Keep unsupported executor behavior unchanged for now: declarations may load structurally, but calls to unsupported types fail with `ACTION_EXECUTOR_UNSUPPORTED`.
- Update active docs/specs so future planning does not keep treating remote/WASM/hosted execution as an unhandled required foundation item.

## Resolved Questions

- User confirmed this child should become a no-code decision/docs cleanup task.
- Remote API interaction should use existing `browser_script` actions with `fetch` unless a future concrete Skill cannot reasonably use that path.
- WASM is not worth adding now because the application surface is narrow and no current AIRP Skill requires it.
- Hosted execution should be exposed later as ordinary remote APIs if needed, rather than as a distinct platform executor now.
- The original self-updating / remote package motivation is not valuable enough to justify package trust, versioning, caching, review, or debugging complexity in the current foundation phase.

## Requirements

- Record a clear parent-level disposition for remote/WASM/hosted execution.
- Avoid adding new executor code in this child unless planning reverses this decision.
- Keep current `builtin`, `platform_action`, and `browser_script` behavior unchanged.
- Keep non-local service interaction routed through Skill actions, preferably `browser_script` with `fetch`.
- Do not add runtime trust prompts, Settings toggles, per-Skill trust records, package review, remote package installation, content-hash approval, WASM runtime, hosted runtime, or secret forwarding.
- Do not expose API keys, platform-local provider config, internal bridge objects, raw trace files, `.tsian/*` paths, raw prompts, raw model outputs, native files, terminal access, DOM access, or platform internals to remote services.
- Update active direction docs and the parent PRD if the decision is confirmed.

## Acceptance Criteria

- [x] The task records whether remote/WASM/hosted execution is implemented, deferred, or abandoned for the foundation phase.
- [x] If abandoned/deferred, the reason is explicit: current `browser_script` covers remote API interaction sufficiently, while new executor classes add trust/versioning/debugging complexity.
- [x] Existing executor behavior remains unchanged by this planning decision.
- [x] Active docs no longer imply `remote_http`, WASM, or hosted execution are mandatory next foundation work.
- [x] Parent task acceptance can count this gap as handled by explicit decision rather than implementation.
- [x] Future revisit criteria are recorded: add a new executor only when a concrete Skill cannot be reasonably expressed through `browser_script`, `platform_action`, or remote APIs called from script.

## Out Of Scope

- Implementing `remote_http`.
- Implementing WASM execution.
- Implementing remote script loading.
- Implementing hosted execution.
- Designing remote package distribution, self-updating Skill packages, marketplace review, or trust UI.
- Adding new browser/host/native capabilities.

## Open Questions

- None.
