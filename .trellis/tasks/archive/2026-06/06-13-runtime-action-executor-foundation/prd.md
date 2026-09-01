# Complete action executor foundation

## Goal

Move the Agent Runtime action executor path from an MVP into a reliable controlled-execution foundation for future Skills.

The user-facing direction is: Tsian should now complete the lower runtime layers before investing in UI, concrete AIRP Agents, or gameplay-specific Skill design. This task focuses on the generic action execution substrate that lets loaded Skills safely call platform-controlled capabilities.

## User Value

- Skills can evolve from instructions into real reusable capabilities without bypassing Runtime safety boundaries.
- Future AIRP memory, world-state, rule, browser, and remote capabilities can share one execution model instead of each adding a bespoke tool.
- Runtime failures become inspectable and recoverable through structured errors, timeout behavior, and trace summaries.
- The platform remains gameplay-neutral: Skills and workspace files own AIRP semantics; the platform owns execution control.
- Third-party Skill authors can build powerful executable capabilities that approach native Skill scripts, while players consciously accept the risk of running third-party code.

## Confirmed Facts

- `action_call` already exists as a Runtime tool and requires a Skill loaded in the same Agent tool loop.
- `skill_load` parses `tsian-actions` fenced JSON declarations from `SKILL.md` and registers actions for the active Agent loop.
- Existing action input validation covers object input, required fields, and basic JSON schema field types.
- Current executor support is limited to side-effect-free built-ins (`validation`, `echo`) and injected `platform_action`.
- Current Agent Runtime platform actions are allow-listed to `workspace-write` and `workspace-delete`.
- `agent-runtime` is pure with respect to platform storage and host details; platform side effects flow through injected capabilities.
- Trace already records action calls and workspace mutations, and must summarize rather than persist large raw payloads.
- Direction docs identify browser script, remote HTTP, WASM, richer controlled platform actions, abort/timeout, result normalization, and trace coverage as later executor work.
- User decision: the first script executor should be more aggressive than a toy sandbox. Tsian official content should not depend on high-risk third-party scripts by default, but players who install/run third-party executable Skills can accept the associated risk in exchange for stronger capability.
- User decision: use a strong SDK capability profile for the first browser script executor. Scripts should get powerful Tsian-provided APIs such as workspace access, network fetch, logs/traces, timeout/abort, and JSON I/O, but should not receive raw DOM, `window`, internal bridge, Vue app state, or platform-host internals in this first slice.

## Requirements

- Keep `action_call` as the Skill-gated runtime primitive. Do not expose broad browser, HTTP, script, or state mutation tools directly to Agents.
- Preserve existing `skill_load` / `action_call` behavior for built-in executors and `platform_action` workspace writes/deletes.
- Make executor declaration parsing and execution extensible enough for additional controlled executor types without duplicating validation, timeout, error, and trace handling.
- Normalize executor success and failure into stable structured observations, including unsupported executor type, unknown executor, platform failure, timeout, abort, invalid declaration, and invalid input cases.
- Add executor-level timeout and abort behavior for asynchronous controlled execution. Long-running executors must not hang an AIRP turn indefinitely.
- Keep platform-controlled side effects behind explicit allow-lists and runtime-injected host capabilities.
- Treat high-power third-party script execution as an explicit trust boundary. The platform may allow broad script capabilities, but it must still make the executor type identifiable, traceable, disable-able, and bounded by browser/runtime limitations.
- Do not require Tsian official default content to ship or depend on high-power scripts.
- Expose high-power script capabilities through a Tsian SDK object rather than raw browser globals or platform internals in the first implementation slice.
- Ensure trace covers controlled executor execution without storing full prompts, large file bodies, or large raw outputs by default.
- Maintain workspace file synchronization after successful platform mutations.
- Keep gameplay-specific operations out of platform code. World, memory, relationship, rule, and narrative semantics belong in Skills plus Runtime Workspace data.
- Add or update focused validation coverage appropriate to the current project stance: build checks plus targeted runtime/browser probes are acceptable while the foundation is still stabilizing.

## First Implementation Slice

The first implementation slice should complete the shared executor foundation and integrate one real controlled executor path so the abstraction is exercised by more than `builtin` and workspace `platform_action`.

The selected candidate is now a high-power browser-side Skill script executor: a third-party/trusted executor that aims to approach native Skill script capability within the browser platform's hard limits.

The selected capability profile is strong SDK access, not raw browser/internal access.

## Acceptance Criteria

- [x] A loaded Skill can call existing built-in actions and existing `platform_action` workspace actions exactly as before.
- [x] Malformed or unsupported executor declarations fail with structured errors and do not register unsafe actions.
- [x] Asynchronous controlled execution has bounded timeout/abort behavior and returns structured observations on failure.
- [x] Successful and failed action executions are represented in trace with executor identity, status/error, and summarized input/output.
- [x] Platform-controlled side effects remain allow-listed and are unreachable without Skill loading plus action declaration plus input validation.
- [x] A high-power browser-side Skill script executor is implemented as the first non-trivial controlled executor path, unless implementation evidence shows it cannot be done responsibly in this slice.
- [x] The script executor exposes a strong Tsian SDK for workspace read/list/search/write/delete, network fetch where browser policy permits, structured log/trace, timeout/abort, and JSON-compatible input/output.
- [x] The first implementation does not expose raw DOM, `window`, internal bridge, Vue app state, or platform-host internals as supported script APIs.
- [x] The script executor has a documented trust/risk boundary and is not silently available as ordinary official default content behavior.
- [x] `npm run build:web` passes.
- [x] If shared contracts change, `npm run build:contracts` passes.
- [x] The task outcome updates the active direction/spec docs if executor contracts or boundaries change.

## Out Of Scope

- Workspace browsing/editing UI.
- Concrete AIRP memory Agent, state Agent, or gameplay Skill design.
- Platform-owned world, character, relationship, event, or memory schemas.
- Native host filesystem, terminal, OS process, or browser-extension powers that a normal web app cannot provide.
- General-purpose Bash-like tool exposure.
- Production remote executor authentication, billing, marketplace distribution, or multi-tenant trust policy.

## Open Questions

None currently blocking planning.
