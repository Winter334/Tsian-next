# Complete Runtime Foundation Before UI And Agent Design

## Goal

Move Tsian from a chain of successful runtime MVPs into a deliberate foundation-completion phase before investing in workspace UI, concrete AIRP Agent role design, or gameplay-specific Skill packages.

This task is the parent planning task for that phase. It should identify the MVP gaps in the current Agent Runtime / Runtime Workspace / executor substrate, decide the completion order, and split independently verifiable implementation slices into child tasks.

## User Value

- Future UI, Agent, and Skill design can rely on stable runtime contracts instead of inheriting half-finished MVP assumptions.
- Runtime side effects, traces, tool execution, workspace files, and Agent collaboration become inspectable and recoverable enough for real AIRP authoring.
- The platform stays gameplay-neutral: foundation work strengthens controlled execution and save/workspace semantics without hardcoding memory, world, relationship, or UI schemas.
- Implementation can proceed in small slices while preserving a coherent phase direction.

## Confirmed Facts

- The current active direction is Agent-Orchestrated AIRP Runtime, with Runtime Workspace as the save-scoped data container.
- Recent completed MVPs include workspace storage, Agent/Skill registry, `skill_load`, Skill action gating, `platform_action`, Runtime trace persistence, `agent_call`, raw AIRP history writeback, and strong-SDK `browser_script`.
- Active docs now say the foundation phase should not add independent `remote_http`, WASM, remote script loading, or hosted execution; remote API interaction should use existing `browser_script` + `fetch` unless a future concrete Skill proves that insufficient.
- Active docs recommend strengthening existing `browser_script` / Tsian SDK / controlled platform actions as concrete Skill needs appear, plus mature `agent_call`, trace/diagnostic experience, Runtime Workspace derived files, stateRecords migration, and workspace/Agent/Skill browsing/editing UI.
- The previous executor foundation task explicitly set the user-facing direction as completing lower runtime layers before UI, concrete AIRP Agents, or gameplay-specific Skill design.
- Current action executor support in code is `builtin`, `platform_action`, and `browser_script`; unsupported executor types fail structurally.
- Current controlled executor timeout is implemented for `platform_action` and `browser_script`, with a default of 10 seconds and maximum of 60 seconds.
- Current workspace mutations from `platform_action` and browser script SDK write/delete are applied immediately to storage and then synchronized to the in-memory workspace file list.
- Current turn failure handling rolls back the runtime snapshot and best-effort rolls back raw AIRP history writeback, but there is no general staged workspace mutation / turn-level rollback contract for all runtime workspace writes.
- Runtime trace currently records turn, Agent step, model calls, Skill loads, Agent calls, workspace read/list/search, action calls, script logs, and workspace mutations as JSONL files under `.tsian/traces/`.
- Runtime Workspace already seeds files such as `history/timeline.md`, `memory/summaries/current.md`, `memory/summaries/long-term.md`, and `agents/*/session.jsonl`, but current runtime does not maintain them automatically.
- `agent_call` is currently contacts-gated, bounded by a shared root-turn call count, and supports limited nested delegation under a code-level default collaboration policy.
- `stateRecords` still exists as transitional platform storage outside ordinary Runtime Workspace files.

## Foundation Completion Areas

### A. Controlled Execution Completeness

- Remote/WASM/hosted execution disposition: do not add independent `remote_http`, WASM, remote script loading, or hosted execution in the foundation phase; route remote API interaction through `browser_script` unless a future concrete Skill proves that insufficient.
- Executor trust and enable/disable policy, especially for high-power `browser_script`.
- Executor declaration normalization, result validation, error taxonomy, timeout/abort behavior, and trace summaries.
- Richer platform-controlled actions only when they are gameplay-neutral and belong at the platform boundary.

### B. Runtime Side-Effect Transactions

- Staged workspace mutations for runtime turns, or an equivalent rollback/checkpoint boundary.
- Consistent read-after-write semantics inside a turn.
- Failure behavior for platform actions, browser script SDK writes, any future new executor, trace writes, and raw history writeback.
- Clear contract for which files are ordinary user-editable workspace data and which are platform metadata.

### C. Agent-Facing Runtime Diagnostics

- Agent-facing diagnostic summaries over runtime trace facts.
- Query-time lookback/result/summary limits without destructive pruning.
- Script log/error facts without persisting large raw payloads.
- Failure trace guarantees and restore behavior.
- Diagnostic query APIs sufficient for future management Agent / Skill / UI use without designing the UI now.

### D. Runtime Workspace Completeness

- Default directory/file contract review.
- Hidden vs visible workspace path rules beyond `.tsian/traces/`.
- Workspace indexing/cache conventions under `.tsian/indexes/` and `.tsian/cache/`.
- Import/export/migration implications for workspace files and platform metadata.
- Path/media type/versioning behavior that UI and Skills can rely on later.

### E. Agent Runtime Collaboration Completeness

- `agent_call` budget policy and limited recursion contract.
- Context/history policy for delegated Agents.
- Tool loop stability limits and failure reporting.
- Agent session/notes writeback contract as runtime data, without yet designing concrete role workflows.

### F. Transitional State Cleanup

- Decide whether `stateRecords` should migrate into Runtime Workspace files now, remain as a compatibility layer for one more phase, or be removed behind a workspace-backed adapter.
- Keep platform out of gameplay-specific schema interpretation.

## Requirements

- Treat this as a parent planning task unless the final agreed scope is small enough for one direct implementation slice.
- Produce a prioritized completion roadmap before starting code.
- Split implementation into child tasks when deliverables are independently verifiable.
- Start the foundation-completion phase with Runtime Side-Effect Transactions.
- Keep UI, concrete AIRP Agent behavior design, and gameplay-specific Skill packages out of the first foundation-completion children unless they are needed to validate a lower-layer contract.
- Prefer strengthening existing contracts over introducing parallel abstractions.
- Preserve the current direction that platform owns execution control, model calls, checkpoint, trace, storage lifecycle, and bridge boundaries, while workspace files and Skills own AIRP semantics.
- Keep compatibility for existing successful MVP behavior unless a child task explicitly designs a migration or removal.
- Update active docs/specs whenever a foundation contract becomes authoritative.

## Prioritized Roadmap

1. Runtime Side-Effect Transactions
   - Child task: `.trellis/tasks/06-13-runtime-side-effect-transactions`
   - Boundary: platform-host storage/checkpoint orchestration plus Agent Runtime executor capabilities.
   - Expected output: a staged workspace mutation or equivalent rollback contract for runtime turn writes.
   - Validation: probes must show successful turns commit writes, failed/aborted turns do not leave ordinary workspace writes behind, and same-turn read-after-write still works.
   - Why before UI/Agent/Skill design: future remote executors, Agent notes, timeline maintenance, and gameplay Skills all depend on predictable write semantics.

2. Runtime Workspace Maintenance Pipeline
   - Child task: `.trellis/tasks/06-14-runtime-workspace-maintenance-pipeline`
   - Boundary: post-turn platform-host orchestration, Runtime Workspace staged transaction, Agent session files, timeline/current/long-term summary files, and storage-free Agent Runtime maintenance helpers if needed.
   - Expected output: a generic maintenance pipeline for Agent session logs and derived AIRP files, without hardcoding gameplay-specific world or memory schemas in platform code.
   - Validation: probes must show successful turns append checkpoint-scoped session records, validated maintenance writes commit with the turn, failed/aborted turns leave no ordinary maintenance files behind, and invalid maintenance plans do not fail the player-facing turn.
   - Why before UI/Agent/Skill design: future UI, concrete Agent roles, and memory Skills need stable maintenance conventions for existing workspace files such as `agents/*/session.jsonl`, `history/timeline.md`, and `memory/summaries/current.md`.

3. Controlled Execution Policy And Result Contract
   - Child task: `.trellis/tasks/06-14-runtime-controlled-execution-completeness`
   - Boundary: Skill action executor declarations and platform-controlled executor adapters.
   - Expected output: lightweight executor-class policy and optional action `outputSchema` validation, so any future new executor can build on stable policy, result, timeout, trace, and rollback semantics.
   - Validation: executor policy and output-schema probes cover allow/deny behavior, structured observations, trace summaries, timeout/abort compatibility, and staged workspace rollback.
   - Why before any future new executor: new executor power should reuse the existing policy/result contract instead of inventing its own control surface.

4. Agent-Facing Runtime Diagnostics
   - Child task: `.trellis/tasks/06-14-agent-facing-runtime-diagnostics`
   - Boundary: runtime trace event contract, platform trace persistence, and on-demand diagnostic query view.
   - Expected output: compact facts-only diagnostic summaries over raw trace, suitable for future management Agent / Skill / UI use.
   - Validation: diagnostics remain bounded, facts-only, summary-sized, generated on demand, checkpoint-compatible, and useful for failed executor/Skill/Agent diagnosis without exposing raw payloads.
   - Why before UI/Agent/Skill design: future management UI and self-repair Agents should consume a stable diagnostic model rather than normalize MVP trace leftovers.

5. Runtime Workspace Completeness
   - Child task: `.trellis/tasks/06-14-runtime-workspace-completeness`
   - Boundary: save-scoped virtual filesystem, platform metadata paths, indexes/cache, import/export/migration rules.
   - Expected output: workspace path visibility, media type, version, and metadata rules that future UI and Skills can rely on.
   - Validation: workspace list/search/read/import/export/checkpoint probes cover visible and platform-owned paths.
   - Why before UI/Agent/Skill design: UI and Skills will encode workspace assumptions unless the filesystem contract is settled.

6. Remote / Hosted Execution Disposition
   - Child task: `.trellis/tasks/06-14-remote-hosted-execution-adapter-completion`
   - Boundary: action executor adapter roadmap beyond local `builtin`, `platform_action`, and Skill-local `browser_script`.
   - Expected output: no-code decision and documentation cleanup confirming `remote_http`, WASM, remote script loading, and hosted execution are not foundation-phase implementation targets because existing `browser_script` + `fetch` covers remote API interaction sufficiently for current needs.
   - Validation: active docs and parent roadmap no longer present remote/WASM/hosted execution as mandatory next foundation work; future revisit criteria require a concrete Skill that cannot be reasonably expressed through `browser_script`, `platform_action`, or remote APIs called from script.
   - Why before UI/Agent/Skill design: author-facing Skill design should know that `browser_script` is the supported extension point for remote service interaction, instead of designing against unimplemented executor classes.

7. Agent Runtime Collaboration Completeness
   - Child task: `.trellis/tasks/06-14-agent-runtime-collaboration-completeness`
   - Boundary: `agent_call`, context/history policy, tool loop limits, Agent session/notes writeback contract.
   - Expected output: mature delegation limits and persistence hooks without designing concrete AIRP role behavior.
   - Validation: delegated Agent probes cover budgets, default limited recursion, and trace/failure behavior.
   - Why before UI/Agent/Skill design: concrete Agent teams need a stable collaboration substrate.

8. Transitional State Cleanup
   - Boundary: current `stateRecords` compatibility storage versus workspace-backed state files.
   - Expected output: decision and migration/adapter plan that keeps platform gameplay-neutral.
   - Validation: existing frontend/debug behavior remains compatible or has an explicit migration.
   - Why before UI/Agent/Skill design: future UI should not accidentally make transitional platform state look like the long-term model.

## Acceptance Criteria

- [x] The task records a prioritized foundation-completion roadmap with clear rationale.
- [x] Each roadmap item names its platform/runtime boundary, expected output, validation method, and reason it must happen before UI/Agent/Skill design.
- [x] The roadmap distinguishes parent-level phase direction from child implementation slices.
- [x] The first child implementation slice is selected: Runtime Side-Effect Transactions.
- [x] The first child implementation slice is scoped tightly enough for planning.
- [x] The second child implementation slice is selected: Runtime Workspace Maintenance Pipeline.
- [x] The third child implementation slice is selected: Runtime Controlled Execution Completeness.
- [x] The fourth child implementation slice is selected: Agent-Facing Runtime Diagnostics.
- [x] The fifth child implementation slice is selected: Runtime Workspace Completeness.
- [x] The remote/WASM/hosted execution gap is handled as its own remaining roadmap item or child, not hidden under the completed policy/result-contract child.
- [x] The next child implementation slice is selected: Agent Runtime Collaboration Completeness.
- [ ] Known MVP gaps from recent runtime tasks are either assigned to a roadmap item or explicitly deferred with a reason.
- [ ] Out-of-scope UI, concrete Agent role behavior, and gameplay Skill design remain out of the foundation phase unless later re-approved.
- [ ] Active direction docs are updated if the roadmap changes the project direction.

## Out Of Scope For This Parent Task

- Implementing all foundation-completion work in one task.
- Designing the final workspace browser/editor UI.
- Designing concrete memory/state/rules/narrative Skills.
- Hardcoding platform-level world, character, relationship, event, memory, or frontend schemas.
- Reintroducing the retired visual DAG workflow or SillyTavern prompt-engine mainline.

## Open Questions

- Should `stateRecords` migration be part of foundation completion before UI, or deferred until workspace UI makes the migration observable?

## Resolved Questions

- Executor trust/enable policy comes before `remote_http` inside the completed third child: that child implements a lightweight code-level executor-class policy plus optional action `outputSchema`, while `remote_http`, WASM, hosted execution, per-Skill trust state, and trust UI are out of scope for that child only.
- Remote/WASM/hosted execution remained a parent-level Controlled Execution gap after the policy/result-contract child, but the user later confirmed the gap should be handled by no-code disposition rather than implementation: do not add `remote_http`, WASM, remote script loading, or hosted execution in the foundation phase; route remote API interaction through `browser_script` unless a future concrete Skill proves that insufficient.
