# Implement: Task 模式上下文管理优化

## Pre-Implementation Context

Before coding, load:

- `.trellis/tasks/07-11-task-context-handoff/prd.md`
- `.trellis/tasks/07-11-task-context-handoff/design.md`
- `.trellis/tasks/07-11-task-context-handoff/research/current-implementation.md`
- specs listed in `implement.jsonl`

Because this task changes shared contract types and platform-web runtime behavior, run both contract and web builds.

## Implementation Plan

### Step 1: Contract model split

Files:

- `packages/contracts/src/runtime.ts`

Tasks:

- Add `AgentContextToolMemoryVisibility`, `AgentContextToolMemoryStatus`, and `AgentContextToolMemory`.
- Add optional `toolMemories?: AgentContextToolMemory[]` to `AgentContextSnapshot`.
- Remove model-context semantics from `AgentContextTurnEntry.toolCalls`; because no compatibility is required, new runtime parse/write should ignore old turn-level `toolCalls`.
- Keep `ConversationMessageRecord.toolCalls?: AgentContextToolCall[]` for UI/raw session messages.
- Keep `AgentContextToolCall` available as raw UI/debug shape.

Validation:

- `npm run build:contracts` after type changes.

### Step 2: Context lifecycle parse/serialize/estimate

Files:

- `apps/platform-web/src/agent-runtime/context-lifecycle.ts`

Tasks:

- Import/use `AgentContextToolMemory`.
- Parse `toolMemories` at the snapshot top level with runtime validation.
- Ignore/drop old `recentTurns[*].toolCalls` during parse.
- `createEmptyAgentContext` and `createInitialAgentContext` should initialize without tool memories or with empty optional list according to final style.
- Update `estimateContextTokens` to include `toolMemories` fields (`title`, `summaryText`, `argsSummary`, `anchors`) and stop counting turn-level raw tool calls.
- Update `buildCompressionPrompt` / task compression prompt path so tool memories associated with compressed turns can be included as "tool work already performed" facts.
- After `compressContext`, remove or placeholder-collapse tool memories for turns included in `lastCompressedTurn`, per design.
- Update `appendTurnToContext` signature to no longer accept raw `toolCalls`.

Validation:

- Type-check via `npm run build:web`.
- Inspect serialized sample context: recentTurns should have no `toolCalls`; top-level `toolMemories` should be present only when new memories exist.

### Step 3: Projection helper module

Files:

- New or existing module under `apps/platform-web/src/agent-runtime/`, e.g. `tool-memory.ts`.
- `apps/platform-web/src/config/platform-config.ts` for centralized tunables.

Tasks:

- Implement deterministic projection from `{ turn, round?, raw tool call, RuntimeWorkspaceToolObservation }` to `AgentContextToolMemory`.
- Add recursive large-field compaction helper that handles string result, top-level `content`, and nested/common large fields such as `response`, `output`, `stdout`, `stderr`, `html`, `diagnostics`, `logs`.
- Add tool-family projectors for:
  - workspace read
  - workspace search/list/glob
  - agent_call
  - inspect_frontend
  - run_script / user tools fallback
- Add retention/budget helper that applies:
  - per-tool model char budget (~8k)
  - total recent tool memory char budget (~32k)
  - keep recent tool turns (~3)
  - placeholder conversion rather than immediate disappearance
  - monotonic visibility changes (`summary -> placeholder -> dropped/aggregated`, never restore old placeholders)
  - stable sorting by `(turn, round, sourceToolCallId/id)`
- Source default budgets from platform config, not scattered constants. If adding config fields, update merge/clone defaults.

Validation:

- Add lightweight unit-like helper assertions if the project has an existing test seam; otherwise rely on build plus manual scenario inspection.
- Verify agent_call response and arbitrary `{ response: longString }` are compacted.

### Step 4: Runtime loop returns raw + model memories

Files:

- `apps/platform-web/src/agent-runtime/index.ts`
- `apps/platform-web/src/agent-runtime/turn-types.ts`

Tasks:

- Extend `AgentRuntimeTurnResult.contextUpdate` with `toolMemories?: AgentContextToolMemory[]`.
- Keep `toolCalls?: AgentContextToolCall[]` as raw UI/debug payload.
- In native and text tool loops, collect both:
  - raw `AgentContextToolCall[]` for session UI history
  - projected `AgentContextToolMemory[]` for agent context
- Ensure projection has access to current turn number and round.
- Do not rebuild old tool memories as native provider `tool` role messages; render them later as plain context.

Validation:

- `npm run build:web`.
- Manual trace/log inspection: result.contextUpdate should contain raw toolCalls and model toolMemories separately.

### Step 5: Assistant host writeback split

Files:

- `apps/platform-web/src/platform-host/assistant-chat.ts`

Tasks:

- `saveAssistantSessionMessages` continues to write raw `toolCalls` and `timeline` to UI session messages.
- `stageAssistantContextFile` accepts `toolMemories?: AgentContextToolMemory[]`, not raw `toolCalls`.
- When staging context:
  - append user/assistant text only
  - merge top-level tool memories
  - apply retention/budget helper to the full top-level list
- Keep `.tsian/local/assistant/sessions/<sessionId>/context.json` as the virtual-file storage location.

Validation:

- Manual context snapshot inspection after a tool-heavy assistant turn:
  - UI messages still have raw `toolCalls`
  - context.json has top-level `toolMemories`
  - recentTurns entries do not have toolCalls

### Step 6: Prompt rendering and compression behavior

Files:

- `apps/platform-web/src/agent-runtime/index.ts`
- `apps/platform-web/src/agent-runtime/context-lifecycle.ts`

Tasks:

- Update `buildAgentContextMessages` so task assistant context renders `toolMemories` as a compact "recent tool work" user message.
- Historical tool memories must not be rendered as native tool-call protocol messages.
- Ensure narrative/master path does not receive task tool work sections unless explicitly task assistant.
- Update `locateHistorySpan` assumptions if the new tool-memory section affects history boundaries.

Validation:

- Inspect message order: system → summary/recent dialogue → workspace context/contextFiles → tool work log → turn number → current input.
- Ensure `locateHistorySpan` still finds the dialogue history span for compression and does not accidentally include the tool work log or workspace context.

### Step 7: Parent model observation compacting for delegated `agent_call`

Files:

- `apps/platform-web/src/agent-runtime/workspace-tools.ts`

Tasks:

- Replace or extend `compactUnknownResultForModel` with recursive compacting for known large fields.
- Ensure `formatNativeToolObservationContent` and `formatRuntimeWorkspaceToolObservationMessage` both use the same compacted result.
- Keep `buildToolOutput` for UI/timeline full output unchanged unless type constraints require local adaptation.

Validation:

- Manual or helper check: an `agent_call` result with long `response` is compacted for model observation but UI output remains complete.

### Step 8: Storage normalization and UI mapping sanity

Files:

- `apps/platform-web/src/storage/assistant-conversations.ts`
- `apps/platform-web/src/views/assistant-message-mappers.ts` if impacted

Tasks:

- Ensure UI raw `ConversationMessageRecord.toolCalls` remains normalized and persisted.
- Remove comments that say UI `toolCalls` are agent-layer context if that becomes stale AI-facing/developer-facing noise.
- No UI behavior regression: historical tool timeline still rebuilds from raw UI/session data.

Validation:

- Reopen an assistant session with historical tool calls; UI timeline still renders.

## Validation Commands

Required:

```bash
npm run build:contracts
npm run build:web
```

Recommended focused checks:

- Search for stale agent-context raw tool replay semantics:
  ```bash
  rg -n "entry\.toolCalls|recentTurns.*toolCalls|observation.*context|工具调用跨 turn|role: \"tool\"" apps/platform-web/src packages/contracts/src
  ```
- Inspect generated/updated prompt rendering around `buildAgentContextMessages`.
- Run one manual desktop assistant turn with a large read or delegated `agent_call` and inspect:
  - assistant session messages retain raw toolCalls
  - context.json stores top-level toolMemories
  - model-facing observation for `agent_call.response` is compacted

## Rollback Points

- After Step 1/2, if contract shape causes broad compile failure, revert contract/context parse changes first.
- After Step 4/5, if UI loses tool timeline, check raw `ConversationMessageRecord.toolCalls` path before touching model context.
- If projection is too aggressive, increase platform-config budgets before changing data flow.

## Completion Criteria

- Contracts and web builds pass.
- No new turn-level `toolCalls` are written into agent context snapshots.
- Task-mode context snapshots use top-level `toolMemories` for model-facing tool history.
- UI/debug raw tool history remains intact.
- AIRP/narrative behavior remains unchanged except for shared type additions.
