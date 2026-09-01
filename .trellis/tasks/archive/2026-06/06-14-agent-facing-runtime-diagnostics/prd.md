# Agent-Facing Runtime Diagnostics

## Goal

Turn the existing Runtime Trace Persistence MVP into a compact, Agent-facing runtime diagnostics contract that future management/self-repair Agents can consume on demand.

The primary value is not a developer log viewer. The primary value is that an Agent can inspect compact runtime facts about what went wrong and which workspace files or Skill definitions are relevant, without being flooded by raw trace events.

## User Value

- Players can later rely on a dedicated management Agent in the UI to explain runtime/Skill/Agent problems and help repair or improve the workspace.
- Agent self-modification becomes more practical because failures can point to actionable files such as `AGENT.md`, `SKILL.md`, schemas, scripts, notes, or workspace data.
- Runtime observability stays immersive: no mid-turn popups, no developer-console dependency, and no large trace dumps shown to players.
- Future UI can expose a stable diagnosis model instead of reinterpreting raw JSONL trace internals.

## Confirmed Facts

- Runtime trace currently persists JSONL files under `.tsian/traces/turns/`.
- Successful turns stage trace before the accepted checkpoint, so trace follows checkpoint/restore with the AIRP branch.
- Failed turns best-effort write a failed trace file and must not mask the original runtime error.
- Trace currently records turn, Agent step, model call summaries, Skill loads, Agent calls, workspace read/list/search, action executor policy checks, action calls, script logs, session transcript staging, and workspace mutations.
- Trace event data is normalized to JSON-compatible values.
- Existing contracts already require summaries instead of large raw payloads: no full prompts, no file contents for workspace reads, no script source, and no large raw action/script output.
- Existing runtime/tool/script failures already expose structured codes/messages/details such as `ACTION_OUTPUT_INVALID`, `ACTION_EXECUTOR_TIMEOUT`, `SKILL_NOT_FOUND`, `AGENT_CALL_LIMIT_EXCEEDED`, `BROWSER_SCRIPT_FAILED`, and `WORKSPACE_FILE_NOT_FOUND`.
- `.tsian/*` is platform-owned metadata space. Ordinary Agent/Skill workspace writes cannot modify it.
- Runtime and bridge workspace list/search hide `.tsian/traces/` by default, while exact trace read exists as an MVP debugging escape hatch.
- Active direction docs say ordinary workspace history should not become a pile of intermediate trace material.
- The user wants this work to serve Agent self-observation, self-repair, and future UI management, not traditional developer-only debugging.
- The user wants the diagnostic content structure to be concise and useful; more detail is not automatically better.
- The first access path should be a runtime/query diagnostic substrate that a future Skill or management Agent can wrap; this task should not immediately freeze a full official `runtime-diagnostics` Skill experience.
- The first diagnostic query should be reserved for explicit UI, management Agent, or self-repair entry points. It should not be exposed as a default live-turn tool to ordinary master/narrative/memory Agents.
- Diagnostic summaries should focus on failed/anomalous turns first, while allowing very compact successful-turn health summaries.
- Current code does not have a dedicated trace retention/pruning mechanism; trace currently follows save/checkpoint lifecycle and generic workspace deletion.
- The first implementation should use query-time limits/windowing instead of deleting or pruning old trace files.
- Diagnostic summaries should provide structured facts only. Platform-authored repair suggestions, probable-cause explanations, and `nextChecks` are out of scope; specialized management Agents or diagnostic Skills should interpret the facts through their own instructions.
- Diagnostic summaries may include lightweight normalized fact fields such as `source`, `eventType`, `code`, `agentId`, `skill`, `action`, `executor`, and directly related workspace paths, without adding cause inference or repair guidance.
- Diagnostic summaries should be generated on demand from raw trace files. This task should not persist derived diagnostic workspace files.

## Requirements

- Treat the Agent-facing diagnostic view as the main product contract for this child task.
- Preserve raw trace as platform-owned branch-local metadata and compatibility/debug substrate.
- Provide compact, structured diagnostic facts instead of exposing raw trace event streams as the normal Agent path.
- Include lightweight normalized fact fields so future management Agents/Skills do not need to re-parse raw trace event shapes for basic runtime area/entity identification.
- Diagnostics should help answer:
  - which turn/Agent/Skill/action/tool failed or behaved unexpectedly;
  - what failure category occurred, such as schema mismatch, executor policy denial, timeout, abort, script error, missing workspace file, invalid Skill action declaration, output validation failure, or Agent collaboration failure;
  - which workspace paths are directly related to the runtime event, such as Agent definitions, Skill definitions, schemas, scripts, or mutated/read files.
- Diagnostics must not include platform-authored repair suggestions, probable-cause narratives, or hardcoded next-check instructions. If facts need interpretation, that interpretation belongs in a future management Agent or diagnostic Skill definition.
- Failed/anomalous diagnostics are the primary output. Successful-turn health summaries may exist, but must stay minimal: turn, status, participating Agents, used Skill/action names, workspace mutation paths/counts, and warning/anomaly counts rather than detailed event streams.
- Diagnostics must avoid dumping full prompts, full model outputs, full tool observations, large action payloads, script source, provider internals, bridge internals, Dexie/storage internals, API keys, or `.tsian/*` implementation details.
- Diagnostics must be available on demand and must not create a fixed every-turn workflow step.
- Diagnostics should be stable enough for a future official `runtime-diagnostics` Skill or management Agent UI to consume.
- The first implementation should focus on a platform/runtime query contract rather than a default Skill package.
- The first implementation must not add the diagnostic query to the ordinary live AIRP Agent tool instructions by default.
- Keep the scope gameplay-neutral. The platform can describe runtime/tool/Skill/workspace failure facts, but must not interpret world, relationship, event, memory, or narrative semantics.
- Keep compatibility with existing trace persistence, checkpoint/restore behavior, and trace hiding rules unless this task explicitly designs a migration.
- Do not implement destructive trace retention/pruning in this task. Diagnostic queries should use bounded lookback, result limits, and summary size limits instead.
- Do not persist derived diagnostic files in this task. The first diagnostic surface is a bounded query view over existing trace files.

## Candidate Deliverables

- A diagnostic summary contract for recent or failed runtime turns.
- A small runtime/platform query path that can return Agent-facing diagnostics without exposing raw trace by default.
- Failure/category normalization for the trace events that matter to repair.
- Lightweight source/entity normalization without cause inference.
- Minimal successful-turn health summaries when explicitly requested by the query.
- Query-time lookback/result/summary limits without destructive pruning.
- On-demand generation from raw trace files, without persisted derived diagnostic files.
- Size and content limits for diagnostic summaries.
- A facts-only contract that avoids platform-authored repair suggestions or hardcoded `nextChecks`.
- Tests or probes proving that diagnostics are concise, facts-only, and do not contain large raw payloads.
- Direction/spec updates that reframe trace/debug work as Agent-facing runtime diagnostics.

## Acceptance Criteria

- [x] The task defines an Agent-facing diagnostic summary shape that is smaller and more stable than raw trace JSONL.
- [x] The diagnostic summary includes lightweight normalized source/entity fields while preserving raw code/message facts.
- [x] The diagnostic summary includes enough context for an Agent to identify the failing Agent/Skill/action/tool and likely workspace files to inspect.
- [x] The diagnostic summary excludes full prompts, full model outputs, file contents, script source, large raw payloads, provider internals, bridge internals, storage internals, API keys, and raw `.tsian/*` implementation details.
- [x] Diagnostics are available on demand and do not run as a mandatory every-turn maintenance step.
- [x] Raw trace remains platform-owned, checkpoint-scoped, hidden from normal list/search, and summary-only.
- [x] Existing trace persistence behavior remains compatible for successful and failed turns.
- [x] Validation covers at least one successful turn, one failed/runtime error case, one action/schema/executor error case, and one script/log summary case where applicable.
- [x] Active direction docs and platform frontend spec are updated to describe Agent-facing diagnostics.

## Out Of Scope

- Building the management Agent UI.
- Designing concrete management Agent personality, role workflow, or repair policy.
- Automatically applying repairs without explicit future design.
- Platform-authored repair suggestions, probable-cause explanations, or hardcoded next-check instructions.
- Exposing diagnostics to all default live-turn Agents.
- Full developer log viewer UI.
- Append-only security audit logging.
- Destructive trace retention/pruning.
- Persisted derived diagnostic workspace files.
- Per-turn mandatory diagnostic Agent execution.
- Remote HTTP, WASM, or hosted executor implementation.
- Exposing `.tsian/*` as ordinary Agent-editable workspace content.

## Resolved Questions

- First access path: build the runtime/query diagnostic substrate first. A future official `runtime-diagnostics` Skill may wrap it later, but this task should not make the Skill the primary deliverable.
- Visibility: first diagnostic query access should be scoped to explicit UI, management Agent, or self-repair entry points, not exposed to all ordinary live AIRP Agents by default.
- Coverage: diagnostics should primarily serve failures and anomalies, with only very compact successful-turn health summaries for future optimization/management use.
- Retention: first implementation should add query-time limits/windowing only. Actual trace deletion/pruning is deferred to later Runtime Workspace completeness/lifecycle work.
- Repair guidance: platform diagnostics should expose structured facts only. Cause interpretation and repair strategy belong in future management Agent or diagnostic Skill instructions, not platform code.
- Normalization: diagnostic summaries may add lightweight `source`/entity fields for runtime area identification, while preserving raw event type and error code/message and avoiding cause inference.
- Persistence: diagnostic summaries are an on-demand query view over raw trace files. Do not persist derived diagnostic workspace files in this task.

## Open Questions

- None.
