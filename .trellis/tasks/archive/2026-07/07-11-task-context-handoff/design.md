# Design: Task 模式上下文管理优化

## 1. Problem Restatement

Task 模式 Agent（桌面助手与 delegated task agents）会产生大量工具调用。当前实现把历史工具调用作为 assistant turn 的附属字段持久化，并在下一轮 rebuild 成模型可见的 tool_call / tool_result 历史，导致长任务中上下文随工具过程快速膨胀。

本设计将 task 模式改为：**UI / debug 保存完整 raw 工具过程；模型上下文只接收受预算约束的工具记忆投影；对话正文与工具记忆分离管理。**

AIRP / narrative 模式保持现有「剧情摘要 + 最近对话 + 权威状态文件」机制，不引入 task 工具记忆状态机。

## 2. Confirmed Current Behavior

- 桌面助手以 task 模式运行：`runAssistantChat` 注入 `compressionMode: "task"`，见 `apps/platform-web/src/platform-host/assistant-chat.ts:461`、`apps/platform-web/src/platform-host/assistant-chat.ts:468`。
- 同一批 `turnToolCalls` 同时写入 UI 会话消息与 agent context：UI 写入见 `apps/platform-web/src/platform-host/assistant-chat.ts:751`，agent context 写入见 `apps/platform-web/src/platform-host/assistant-chat.ts:761`。
- 当前 `appendTurnToContext` 把工具调用挂在 assistant turn entry 上，见 `apps/platform-web/src/agent-runtime/context-lifecycle.ts:712`。
- 当前 `buildAgentContextMessages` 会把历史 assistant `toolCalls` rebuild 为模型可见工具历史，见 `apps/platform-web/src/agent-runtime/index.ts:284`、`apps/platform-web/src/agent-runtime/index.ts:300`、`apps/platform-web/src/agent-runtime/index.ts:309`、`apps/platform-web/src/agent-runtime/index.ts:311`。
- 当前跨 turn 压缩按 turn 粒度保留最近 K 轮，旧 turn 进入 summary，见 `apps/platform-web/src/agent-runtime/context-lifecycle.ts:475`、`apps/platform-web/src/agent-runtime/context-lifecycle.ts:482`、`apps/platform-web/src/agent-runtime/context-lifecycle.ts:529`。
- `agent-runtime` 不能导入 Dexie、storage、bridge、platform-host，见 `platform-web` type-safety spec 的 purity boundary：`.trellis/spec/platform-web/frontend/type-safety.md:242`。

## 3. Architecture Overview

### 3.1 Layer Split

```
Tool execution observation
  ├─ Raw/UI layer
  │   ├─ ConversationMessageRecord.toolCalls
  │   ├─ ConversationMessageRecord.timeline
  │   └─ trace/debug files
  │
  └─ Model context layer
      ├─ AgentContextSnapshot.summary
      ├─ AgentContextSnapshot.recentTurns        // text dialogue only
      └─ AgentContextSnapshot.toolMemories       // task-mode tool projections
```

The raw/UI layer remains complete and user-visible. The model context layer is compact, bounded, and task-facing.

### 3.2 Mode Boundary

- `compressionMode === "task"` enables tool memory projection and top-level `toolMemories`.
- `compressionMode === "narrative"` does not persist or rebuild task tool memories. Master AIRP behavior stays focused on narrative summary and recent dialogue.
- Shared contracts may carry optional `toolMemories`, but prompt rendering and writeback only use it for task-mode assistant/delegated paths.

## 4. Contracts

### 4.1 Raw Tool Call Type Stays UI-Facing

`AgentContextToolCall` remains the raw tool-call record used by `ConversationMessageRecord.toolCalls` for UI and debug reconstruction.

It should no longer be used as the model-facing cross-turn tool memory shape.

### 4.2 New Model-Facing Tool Memory Type

Add a new shared type in `packages/contracts/src/runtime.ts`:

```ts
export type AgentContextToolMemoryVisibility = "summary" | "placeholder"
export type AgentContextToolMemoryStatus = "success" | "failed"

export interface AgentContextToolMemory {
  /** Stable id for this model-facing memory part. */
  id: string
  /** Raw tool call id for UI/debug correlation; not rendered as a model-readable retrieval handle. */
  sourceToolCallId: string
  /** Assistant turn number that produced this memory. */
  turn: number
  /** Tool-loop round if known. */
  round?: number
  /** Tool name such as workspace_read / agent_call / inspect_frontend. */
  toolName: string
  status: AgentContextToolMemoryStatus
  /** summary = model may see bounded summaryText; placeholder = only action trace. */
  visibility: AgentContextToolMemoryVisibility
  /** Short model-facing title, e.g. "read apps/foo.ts". */
  title: string
  /** Bounded model-facing summary or placeholder line. */
  summaryText: string
  /** File/resource anchors extracted from args/result, e.g. apps/foo.ts:120-220. */
  anchors?: string[]
  /** Bounded argument summary; avoid full JSON for large args. */
  argsSummary?: string
  /** Coarse token/char estimate used for deterministic budget decisions. */
  tokenEstimate?: number
}
```

Notes:

- This is a generic structure + `summaryText`, not a per-tool union.
- Projection code can special-case tools internally, but the stored output stays uniform.
- `sourceToolCallId` is an internal correlation key. MVP does not add a model-facing raw-log read tool.

### 4.3 Agent Context Snapshot Shape

Extend `AgentContextSnapshot`:

```ts
export interface AgentContextSnapshot {
  schema: "tsian.agent.context.v1" | "tsian.assistant.context.v1"
  saveId: string
  agentId: string
  summary: string | null
  recentTurns: AgentContextTurnEntry[]
  toolMemories?: AgentContextToolMemory[]
  lastCompressedTurn: number | null
  updatedAt: string
}
```

Update `AgentContextTurnEntry` for new writes so it only represents dialogue text:

```ts
export interface AgentContextTurnEntry {
  turn: number
  role: "user" | "assistant"
  content: string
}
```

Because the project has not launched, no compatibility migration is required. Old turn-level `toolCalls` may be ignored/dropped by parse and will not be written again.

## 5. Data Flow

### 5.1 Current Turn Tool Execution

Current runtime loops already have the data needed at tool execution time:

- model tool call metadata (`id`, `name`, arguments)
- `RuntimeWorkspaceToolObservation`
- text/native observation formatter
- UI `onTool` output

New flow:

```
executeRuntimeWorkspaceToolCalls
  -> raw AgentContextToolCall[] for UI session messages
  -> AgentContextToolMemory[] for model context
```

`runAgentRuntimeTurn` returns both:

```ts
contextUpdate: {
  ...,
  toolCalls?: AgentContextToolCall[]       // raw/UI
  toolMemories?: AgentContextToolMemory[] // model-facing/task context
}
```

Host writeback then splits:

```
saveAssistantSessionMessages(... toolCalls: rawToolCalls, timeline ...)
stageAssistantContextFile(... toolMemories: modelToolMemories ...)
```

### 5.2 Agent Context Writeback

`stageAssistantContextFile` will:

1. Select base snapshot (`compressedContext` or `fallbackContext`).
2. Append user/assistant text via `appendTurnToContext` without tool calls.
3. Merge new `toolMemories` into top-level `snapshot.toolMemories`.
4. Apply deterministic task tool-memory retention/budget.
5. Serialize `.tsian/local/assistant/sessions/<sessionId>/context.json`.

### 5.3 Prompt Rebuild

Historical raw tool calls are no longer reconstructed as provider tool protocol messages. Prompt composition uses two separate pieces:

1. Dialogue history (`summary` + `recentTurns`) stays in the existing stable history position immediately after `system`.
2. Task tool memories render as a compact plain-text "recent tool work" user message **after** workspace agent context / context files and before the current turn metadata/input.

Recommended message order for task assistant turns:

```
system
summary + recentTurns dialogue
workspace agent context / contextFiles
recent tool work log (toolMemories)
turn number
current input
```

This order intentionally keeps high-frequency tool-memory changes behind the larger stable workspace context so prompt-prefix cache misses do not cascade through context files.

Historical tool memories are plain context, not native `role:"tool"` messages. This avoids teaching the provider that old tool calls are active tool-call protocol state.

Narrative/master path sees no tool memory section unless explicitly task-mode assistant.

## 6. Deterministic Projection

### 6.1 Goals

Projection must be:

- deterministic and testable
- bounded by per-tool and total budgets
- generic enough for user tools
- specific enough for known large-result tools
- safe for prompt use (no huge JSON blobs, no base64 image data)

### 6.2 Initial Budgets

Use character budgets first; no tokenizer dependency in MVP.

Recommended defaults:

- `perToolModelCharLimit`: ~8,000 chars
- `totalRecentToolModelCharLimit`: ~32,000 chars
- `keepRecentToolTurns`: ~3 assistant turns

Expose these under platform config in the existing `contextCompression` or a new adjacent assistant/task context section. Exact naming can be chosen during implementation, but settings should be centralized in `apps/platform-web/src/config/platform-config.ts` rather than hardcoded across modules.

### 6.3 Projection Rules By Tool Family

#### workspace read

Model-facing memory should include:

- path
- offset / returnedLines / totalLines / truncated when available
- bounded content preview or extracted first/last relevant lines
- anchors such as `path:offset-end`
- instruction-neutral wording: if exact content is needed, use workspace tools again

Do not persist full read content in task context.

#### workspace search / glob / list

Include:

- query/pattern/path summary
- count and top bounded matches
- matched paths as anchors
- truncation facts if present

Avoid storing all match lines when the result is large.

#### agent_call

For the parent agent's model observation and cross-turn memory, include:

- target agent id/title
- request summary from args
- completion/failure status
- bounded response summary/preview
- important anchors if present in the response text

Do not feed the full child-agent response to the parent by default.

#### inspect_frontend

Include:

- inspected target / mode
- success/failure status
- bounded console/network/DOM diagnostic summary
- error messages and counts

Avoid storing full DOM trees, screenshots, or large diagnostic payloads in model context.

#### run_script / user tools

Include:

- skill/action or tool name
- status
- bounded stdout/stderr/output summary
- structured error code/message if failed

Large object fields named `content`, `response`, `output`, `stdout`, `stderr`, `html`, `diagnostics`, `logs`, or similar must be recursively compacted before model use.

### 6.4 Placeholder Policy

When a projected memory exceeds budget or falls outside `keepRecentToolTurns`, convert it to `visibility: "placeholder"` instead of dropping it immediately.

Example model rendering:

```text
- workspace_read apps/foo.ts offset=1 returnedLines=2000: details omitted from model context; rerun/read source if exact content is needed.
- agent_call researcher: completed; detailed response omitted from model context.
```

The placeholder should preserve action trace and status, but not include raw payload or a model-readable raw-log retrieval handle.

### 6.5 Retention And Compression Interaction

`toolMemories` has its own deterministic retention pass:

1. New tool memories enter as `summary` visibility after projection.
2. Entries outside the recent turn window or over the total budget become `placeholder`.
3. Visibility changes are monotonic: `summary -> placeholder -> dropped/aggregated`. A later wider budget must not restore an old placeholder back to summary, because that rewrites the prompt prefix.
4. Sort order is stable by `(turn, round, sourceToolCallId/id)`. Do not sort by size, score, or other values that may change between turns.
5. Entries from turns already covered by `lastCompressedTurn` may be dropped after `compressContext` has had a chance to include their summary/placeholder text in the compression prompt.
6. Optional safety cap: if placeholder count itself grows too large before LLM compression triggers, collapse oldest placeholders into one aggregate placeholder line.

This preserves prompt stability better than a sliding raw observation window and prevents unbounded placeholder growth.

## 7. Context Compression Changes

### 7.1 Token Estimation

`estimateContextTokens` must include top-level `toolMemories`:

- `title`
- `summaryText`
- `argsSummary`
- `anchors`

It should no longer count turn-level `toolCalls` for new snapshots.

### 7.2 Compression Prompt

For task-mode assistant context compression, `buildCompressionPrompt` should include tool memories associated with compressed turns as "tool work already performed" facts.

For narrative/master context compression, behavior should remain unchanged unless `toolMemories` is explicitly present.

### 7.3 Result Snapshot

When `compressContext` compresses turns up to `maxCompressedTurn`, drop or compact `toolMemories` whose `turn <= maxCompressedTurn` after they have been represented in the compression prompt.

This keeps old tool work from persisting forever as separate prompt lines.

## 8. Parent/Child `agent_call` Observation Path

The MVP also covers delegated `agent_call` return size. This is separate from cross-turn persistence:

- `buildToolOutput` can continue giving UI/timeline the full structured child response.
- Model observation formatters (`formatNativeToolObservationContent`, `formatRuntimeWorkspaceToolObservationMessage`, or the shared compact helper they call) must compact nested large fields such as `response`, not only top-level `content`.
- The parent model should receive a bounded child-agent result, with enough status and summary to continue.

This closes the leak where `agent_call.response` bypasses the current shallow `content`-only compact path.

## 9. Storage And Fileification

Assistant context remains a virtual file at `.tsian/local/assistant/sessions/<sessionId>/context.json` as required by the Data Fileification Principle. No new hidden Dexie key/table should be introduced for task context state.

Raw UI/debug history remains in existing assistant session message storage and trace files. The MVP does not add a raw-log retrieval tool.

## 10. AI-Facing Prompt Surface

Keep new prompt text minimal:

- Add a compact "recent tool work" section only for task-mode assistant context.
- Do not explain raw log internals or a retrieval mechanism the model cannot use.
- Prefer positive guidance: "rerun/read source if exact content is needed" rather than detailed prohibitions.
- Avoid leaving old tool-call protocol traces in historical context; old tools are rendered as work log facts, not tool protocol messages.

## 11. Compatibility

No migration or backwards-compatible read of old turn-level `toolCalls` is required because the project has not launched.

Parse behavior:

- Ignore old `AgentContextTurnEntry.toolCalls` if present.
- Parse `toolMemories` only when it is an array of valid records.
- Malformed tool memory entries are dropped at parse boundary.

Write behavior:

- New snapshots never write turn-level `toolCalls`.
- Raw UI session messages may continue to write `ConversationMessageRecord.toolCalls`.

## 12. Rollout / Rollback

Rollout can be done in one task but staged internally:

1. Add contracts and parse/serialize support.
2. Add projection and budget helpers.
3. Split runtime return values into raw tool calls + tool memories.
4. Update assistant host writeback.
5. Update prompt rendering and compression.
6. Validate with build and targeted runtime checks.

Rollback shape:

- Because context snapshots are local and project is not launched, rollback can drop `toolMemories` and return to raw turn-level toolCalls if needed.
- UI raw history remains intact throughout.

## 13. Open Technical Risks

- Over-aggressive projection may cause repeated reads/searches. Initial budgets are intentionally slightly wide and configurable.
- If placeholder aggregation is too lossy, the agent may repeat actions. Keep action traces with tool name + key args + status.
- Prompt rendering must not accidentally reintroduce provider tool protocol messages for old history.
- Prompt cache could degrade if tool memories are placed before large stable context or rewritten/reordered every turn. Mitigation: render tool memories after stable workspace context, use stable ordering, and make visibility changes monotonic.
- Contracts changes require `npm run build:contracts` and downstream `npm run build:web`.
