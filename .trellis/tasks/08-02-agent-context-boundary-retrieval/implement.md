# Agent 上下文边界与桌面助手检索治理 — Implementation Plan

## Step 1 — Establish Contracts and Environment Composition

- [ ] Introduce the composite Agent runtime environment/policy types and move existing host-selected workspace, context, controlled-tool, event and audit inputs behind that boundary.
- [ ] Add Desktop Assistant and Game Runtime environment factories that reuse the same kernel services; make delegated environment derivation fail closed and remove desktop-only capabilities.
- [ ] Preserve existing model resolution, transactions, checkpoint semantics, streaming, abort and trace correlation while adapting the three current host entries.
- [ ] Add focused environment tests proving registry/workspace/capability/budget isolation and shared kernel execution.

Validation gate:

```powershell
npm test -- --run apps/platform-web/src/agent-runtime apps/platform-web/src/platform-host/assistant-chat.frontend-action-isolation.test.ts
```

## Step 2 — Split Raw, Agent, UI, and Audit Projections

- [ ] Add one projection stage after every raw tool execution; generate bounded AgentObservation, optional UI presentation and audit summary once.
- [ ] Replace aggregate-unbounded `compactLargeValueForModel` as the final authority with tool-specific projection plus a valid-JSON final character cap.
- [ ] Make read/search/agent_call/inspect/script projections preserve useful anchors, counts, truncation and continuation metadata.
- [ ] Generate task tool memories from AgentObservation rather than raw/UI output.
- [ ] Extend trace summaries with raw size, Agent/UI projected size, truncation and anchors without persisting generic raw result copies.
- [ ] Add pathological 50×50, huge single-line, nested-array and oversized-script-result tests.

Validation gate:

```powershell
npm test -- --run apps/platform-web/src/agent-runtime/tool-memory apps/platform-web/src/agent-runtime/workspace-tools
```

## Step 3 — Make UI Context Presentation-only

- [ ] Replace ordinary string `TurnToolOutput` with a closed `UiToolPresentation` contract and rename event/timeline `output` to `presentation`.
- [ ] Remove `ConversationMessageRecord.toolCalls`, `AgentContextToolCall`, `AgentRuntimeTurnContextUpdate.toolCalls`, raw collection and timeline-to-toolCalls reconstruction.
- [ ] Emit no presentation payload for ordinary tools; preserve the existing structured `agent_call` display payload.
- [ ] Thread the presentation contract through formal turn events, invokeAgent, remote bridge, play-bridge and Assistant UI mappers.
- [ ] Keep live/reloaded UI timeline order, displayName and status behavior unchanged; do not add data migration or generic result storage.

Validation gate:

```powershell
npm run build:contracts
npm run build --workspace @tsian/play-bridge
npm test -- --run apps/platform-web/src/views apps/platform-web/src/platform-host/turn-timeline-collector
```

## Step 4 — Separate Diagnostics from Workspace and Add Controlled Query

- [ ] Remove diagnostics virtual reads from Desktop Assistant Agent runtime and browser-script execution; keep the adapter only for Resource Manager/platform-owner UI operations.
- [ ] Add the desktop-only `query_diagnostics` controlled Platform Tool with list/search/read operations, closed inputs, summary-first behavior, snippet output, section paging and hard result limits.
- [ ] Gate schema exposure and execution on the Environment capability; prove runtime/delegated Agents cannot discover or call it.
- [ ] Update official diagnostics knowledge and Tool labels to use the explicit capability without development-side incident narration.
- [ ] Keep current diagnostic record authority, sanitization, retention, resource-manager read/copy/export and no eager snapshot behavior.

Validation gate:

```powershell
npm test -- --run apps/platform-web/src/platform-host/diagnostics-workspace-adapter.test.ts apps/platform-web/src/storage/diagnostic-records.test.ts apps/platform-web/src/agent-runtime/tool-schemas
```

## Step 5 — Scope Ordinary Retrieval

- [ ] Add optional `path` to the Agent-facing search schema and implement identical normalized root filtering for ordinary files and virtual adapters.
- [ ] Ensure path, scope, Environment WorkspaceView and actor access all apply; add traversal/ancestor/sibling tests.
- [ ] Add mutually exclusive `charOffset/charLimit` read input plus `totalChars/returnedChars/nextCharOffset` output, enforcing the 24 KiB Agent cap while leaving ordinary Resource Manager reads unchanged.
- [ ] Update search/read descriptions with concise action rules and no outside-context assumptions.

Validation gate:

```powershell
npm test -- --run apps/platform-web/src/agent-runtime/workspace-operations
```

## Step 6 — Repair Native Protocol and Final Request Budget

- [ ] Prevent role merging for tool messages and assistant messages carrying toolCalls; preserve one result per toolCallId.
- [ ] Add provider-shape tests for multiple parallel native calls across OpenAI Chat/Responses, Claude and Gemini adapters.
- [ ] Separate context capacity from request consumption budget in the Environment; apply the desktop default cap without changing Game policies.
- [ ] Run final preflight after merge/marker stripping/tool-schema assembly, include schemas/arguments in estimation, recompress and recheck before fetch.
- [ ] Return existing soft budget errors when no valid request can fit; emit preflight metrics and never create an oversized provider trace.

Validation gate:

```powershell
npm test -- --run apps/platform-web/src/agent-runtime/orchestration apps/platform-web/src/runtime-host/ai
```

## Step 7 — Desktop Retrieval Guidance and End-to-End Regression

- [ ] Update the Desktop Assistant SOP to prefer exact read, scoped search, list only for unknown directory shape, minimum sufficient evidence and explicit diagnostics query.
- [ ] Refresh framework-knowledge diagnostics instructions and tests while preserving progressive disclosure.
- [ ] Add an end-to-end regression mirroring the reported request: first-turn content question, several workspace files, many diagnostic records containing the same query text.
- [ ] Assert ordinary search never scans diagnostics, Agent observations stay within budget, final request remains bounded, UI records contain no raw observations, and the final answer path remains available.

Validation gate:

```powershell
npm test -- --run apps/platform-web/src/platform-host/assistant-chat apps/platform-web/src/storage/local-assistant-knowledge.test.ts
```

## Step 8 — Full Verification and Spec Update

- [ ] Run focused tests from all previous gates.
- [ ] Run contracts, play-bridge and platform-web builds/type-checks required by changed contracts.
- [ ] Search for stale raw UI/debug observation wording, diagnostics workspace instructions, `toolCalls` persistence and `TurnToolOutput` string consumers.
- [ ] Verify no unrelated Spatial working-tree changes are modified or included.
- [ ] Update platform-web frontend/storage and contracts specs with the proven final contracts.

Full gate:

```powershell
npm run build:contracts
npm run build --workspace @tsian/play-bridge
npm run build:web
git diff --check
```

## Rollback Points

- Steps 1–2: retain a temporary adapter from the old host arguments to the new Environment while keeping one runtime kernel.
- Step 3: UI may fall back to name/status-only presentation; raw observation persistence must remain removed.
- Step 4: disable `query_diagnostics` with an explicit unavailable error; do not remount diagnostics into Agent workspace.
- Steps 5–6: use conservative preview envelopes and lower request budgets; never remove the final total cap or toolCallId preservation.
