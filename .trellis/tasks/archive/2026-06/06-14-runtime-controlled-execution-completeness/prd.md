# Runtime Controlled Execution Completeness

## Goal

Plan and implement the third runtime-foundation child after side-effect transactions and workspace maintenance: complete the controlled execution substrate enough that future Skill, Agent, and UI work can rely on stable executor boundaries.

This slice should decide and implement the next generic executor/trust layer without turning Tsian into a broad platform tool surface or hardcoding gameplay-specific Skill semantics.

## Parent Direction

Parent task: `.trellis/tasks/06-13-runtime-foundation-completion`

Roadmap item 3 says Controlled Execution Completeness should cover Skill action executor declarations and platform-controlled executor adapters. Remote/WASM/hosted execution decisions should build on the completed staged Runtime Workspace transaction boundary instead of inventing their own failure semantics.

## User Value

- Future distributed Skills can declare executable behavior against a stable, inspectable execution contract, including optional output shape expectations.
- High-power execution surfaces such as `browser_script`, future remote HTTP, WASM, or hosted execution become controllable before Skill/UI authoring exposes them widely.
- Agent Runtime remains flexible: Skills load and call actions on demand, while platform code owns execution control, timeout/abort, result normalization, trace, and rollback boundaries.
- The platform stays AIRP-generic and avoids adding one-off gameplay-specific tools.

## Confirmed Facts

- Current Agent Runtime tools are `skill_load`, `action_call`, `agent_call`, `workspace_read`, `workspace_list`, and `workspace_search`.
- Current Skill action executors are `builtin`, `platform_action`, and `browser_script`.
- Built-in executors are side-effect-free: `validation` and `echo`.
- `platform_action` executors route through injected `runPlatformAction`; Agent Runtime itself does not import storage or platform-host.
- Runtime `platform_action` is allow-listed in platform-host and currently allows `workspace-write` and `workspace-delete`, not `restore-checkpoint`.
- `browser_script` executors route through injected `runBrowserScript`; script paths resolve relative to the declaring Skill directory and must stay under that directory.
- `browser_script` currently uses a strong Tsian SDK in a browser Worker. It exposes workspace read/list/search/write/delete, fetch, log/trace, timeout/abort, and JSON-compatible input/output.
- `browser_script` intentionally does not expose raw DOM, `window`, internal bridge objects, Vue state, platform-host internals, native files, or terminal capability.
- Controlled async executors already share timeout/abort handling with default 10 seconds and maximum 60 seconds.
- Runtime Workspace side effects from platform actions and browser scripts now run against a staged transaction inside `interaction.sendMessage`; successful turns commit atomically, while failed/aborted turns discard ordinary workspace mutations.
- Runtime trace records action calls, browser script start/log/fetch summaries, workspace mutations, and structured executor failures without large raw payloads.
- Active docs still list remote executor, WASM/hosted execution, richer platform actions, and browser script trust/enable policy as future work.
- Current browser AI config reads the API key from environment variables or the browser-local platform config stored in localStorage.
- Current browser scripts run in a Worker where `localStorage`, `window`, DOM, internal bridge objects, Vue state, platform-host internals, native files, and terminal access are not exposed as supported APIs.
- Parent PRD has two open questions relevant to this child:
  - whether `stateRecords` migration belongs before UI;
  - whether executor trust/enable policy should come before `remote_http`, or whether `remote_http` should drive that policy design.
- Current code treats unsupported executor types structurally: declarations load but calls return `ACTION_EXECUTOR_UNSUPPORTED`.
- Current action declarations support `inputSchema`, but do not yet support an `outputSchema`; successful executor output is returned as arbitrary JSON-compatible `output`.
- User decision: this slice should include a policy layer, but it must stay intentionally lightweight. Tsian is not a real-filesystem agent framework; the main sensitive material is API/provider configuration, and current executors do not expose it directly. Complex security machinery would likely hurt AIRP player experience more than it helps.
- User decision: the first policy slice should be executor-class level only. Existing `browser_script` should remain usable by default under the current Worker + strong-SDK containment model; this task should not add per-Skill/per-script trust state, runtime trust prompts, content-hash approval, or a full security review flow.
- User decision: do not add Settings UI, localStorage persistence, or player-facing toggles for this first policy slice. The policy should be code-level/default-only, with an injectable override surface for tests or future platform-host experiments.
- User decision: because the lightweight policy shrank the task, add a small `outputSchema` / result validation contract to the same `action_call` boundary. This should complete the controlled execution result contract without adding remote/WASM/hosted execution.

## Requirements

- Keep `action_call` Skill-loaded gating intact. New execution power must remain available only through declared Skill actions, not as always-visible runtime tools.
- Do not add broad platform runtime tools merely because the Web environment lacks Bash.
- Preserve Agent Runtime purity: executor execution remains injected via capabilities; storage, bridge, Worker, network, and platform-host details stay outside `agent-runtime`.
- Preserve staged turn semantics: any ordinary workspace mutation performed by controlled executors during `interaction.sendMessage` must be visible to same-turn tools and commit only with successful turns.
- Keep frontend bridge `platform.runAction` behavior compatible and separate from Agent Runtime turn transactions.
- Extend execution only where the platform must own generic execution control, result normalization, timeout/abort, trace, rollback, or allow/deny policy.
- Define lightweight executor-class enable/policy semantics for high-power executors before exposing them to ordinary author-facing UI.
- Keep this first policy code-level and default-only: no persisted setting, no SettingsView controls, and no AIRP-turn prompt.
- Do not design a heavy per-turn trust prompt or complex security model. Runtime AIRP turns must not be interrupted by executor trust UI.
- Treat the policy as an execution-control and diagnostics layer: centralize allow/deny decisions, return structured errors when blocked, and trace policy decisions.
- Add optional action `outputSchema` declaration support. If absent, existing action output behavior remains unchanged.
- Validate executor output after successful execution and before returning the `action_call` success observation when `outputSchema` is declared.
- Keep output validation lightweight: support the same JSON-compatible type vocabulary as `inputSchema`; support object `required` and `properties` checks; ignore unsupported JSON Schema keywords for now rather than pretending to implement full JSON Schema.
- Return structured output validation errors as normal failed tool observations and trace summaries, without persisting large raw output payloads.
- Keep result payloads JSON-compatible and avoid large raw trace persistence.
- Update docs/specs for whichever executor/trust contract becomes authoritative.

## Recommended Initial Scope

This child should first settle a lightweight executor enable/policy layer, then leave `remote_http` for a later child unless planning discovers a very small adapter is needed.

Recommended bias:

1. Add an explicit controlled-executor policy layer for `browser_script` and future high-power executors.
2. Keep currently seeded official/default Skills runnable without extra UI friction.
3. Avoid content-hash approval, install-time review, runtime prompts, or per-Skill trust UX in this slice unless implementation evidence proves the simpler policy is insufficient.
4. Add structured trace and observation errors for disabled executor classes or unsupported policy decisions.
5. Keep `browser_script` compatible by default under the existing Worker + strong-SDK containment model.
6. Keep policy configuration out of Settings UI/localStorage for this slice; expose only a code-level default plus an injectable override for tests/future host policy.
7. Add optional `outputSchema` support as the second small deliverable in this task: parse declarations, report malformed schemas during `skill_load`, validate output after executor success, and expose only `hasOutputSchema` in loaded action summaries.
8. Defer `remote_http`, full WASM, hosted execution, and full trust UI unless the simple policy cannot be validated without them.

## Acceptance Criteria

- [x] This child implements lightweight executor-class policy plus optional `outputSchema` result validation; `remote_http`, WASM, hosted execution, and broad trust UI remain deferred.
- [x] Any new execution capability remains reachable only through `skill_load` -> `action_call`.
- [x] High-power executor availability is controlled by a platform-owned lightweight policy rather than by arbitrary Skill text alone.
- [x] The first policy has no Settings UI, localStorage persistence, or runtime prompt; default behavior remains code-defined.
- [x] The policy can be overridden through runtime/platform injection for tests or future host-owned configuration.
- [x] Official default Skills remain usable under the chosen policy.
- [x] Disabled executors return structured observations and trace summaries without failing unrelated turns or interrupting AIRP immersion.
- [x] Existing `builtin`, `platform_action`, and `browser_script` behavior remains compatible where allowed.
- [x] Action declarations may include an optional `outputSchema`; malformed schema declarations are reported through `skill_load` action declaration errors without loading that action.
- [x] Actions without `outputSchema` keep existing output behavior.
- [x] Actions with `outputSchema` validate successful executor output before returning a success observation.
- [x] Output validation failures return structured failed observations, recommended code `ACTION_OUTPUT_INVALID`, with metadata and summaries rather than raw large payloads.
- [x] Loaded Skill action summaries expose whether an action has `outputSchema` without exposing extra resource content.
- [x] Timeout/abort semantics remain bounded and consistent.
- [x] Ordinary workspace writes from controlled executors continue to use the staged turn transaction.
- [x] Trace records executor policy decisions and failures without large raw payloads.
- [x] Active docs/specs are updated for the selected controlled execution contract.

## Out Of Scope

- Designing Skill marketplace/package distribution.
- Designing final UI for trust prompts, Skill install review, or executor audit.
- Adding per-Skill/per-script trust state, content-hash approval, or runtime trust prompts.
- Adding raw DOM, terminal, host filesystem, or unrestricted browser capabilities.
- Hardcoding gameplay-specific executor actions.
- Replacing `skill_load` / `action_call` with a broad Bash-like tool surface.
- Implementing full JSON Schema validation beyond the lightweight type/required/properties subset needed for current action contracts.
- WASM or hosted execution if the first policy slice can safely defer them.

## Open Questions

- None. Planning is ready once `design.md` and `implement.md` reflect both the lightweight code-level policy boundary and optional `outputSchema` result validation.
