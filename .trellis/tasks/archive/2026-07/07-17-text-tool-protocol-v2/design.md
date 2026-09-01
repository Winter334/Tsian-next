# Design: Text Tool Protocol v2

## Scope

This design upgrades the existing `toolCallMode === "text"` path into Text Tool Protocol v2, a peer mode to native function calling. The change is concentrated in `apps/platform-web/src/agent-runtime/**`, `apps/platform-web/src/runtime-host/ai.ts`, and the small settings/config text surfaces that currently describe text mode as legacy fallback.

No new text-protocol probe and no runtime auto-switching are introduced. The selected model config continues to choose the tool loop.

## Current Architecture Summary

- `toolCallMode` is resolved by platform-host/local-assistant and passed through `AgentRuntimeCapabilities`.
- Native mode builds `ToolSchema[]` via `buildEnabledToolSchemas(...)`, sends those schemas through provider adapters, receives structured `NativeToolCall[]`, then appends assistant tool calls plus `role: "tool"` observations to the runtime message list.
- Text mode currently teaches a legacy `<tsian-tool-call>` block in the system prompt, parses those blocks from raw assistant text, strips them before replaying assistant context, and appends a `Workspace tool observations:` user message.
- Both modes already share `executeRuntimeWorkspaceToolCalls(...)`, permission derivation, tool memory collection, process timeline collection, and task/narrative compression entry points.

## Target Protocol

### Executable call block

The only executable text protocol block is:

```xml
<tsian-tool-calls>
[
  {"name":"read","arguments":{"path":"world/canon.md","offset":1,"limit":200}}
]
</tsian-tool-calls>
```

Contract:

- The block content must parse to a JSON array.
- Each item must be an object with a non-empty string `name` and optional object `arguments`.
- Single calls still use a one-element array.
- Legacy `<tsian-tool-call>` is not parsed or executed.
- A valid block may appear with prose before/after it. Runtime executes the calls and preserves surrounding prose as interim process text.
- Multiple executable blocks in one assistant response are a protocol error; this avoids ambiguous ordering and duplicated interim text boundaries.

### Non-executable replay records

After execution, text mode appends non-executable call records plus observations for the next model round.

```xml
<tsian-tool-call-records>[{"id":"text-r0-c0","name":"read","arguments":{"path":"world/canon.md"}}]</tsian-tool-call-records>
```

```xml
<tsian-tool-observations>[{"id":"text-r0-c0","name":"read","ok":true,"result":{...}}]</tsian-tool-observations>
```

Contract:

- `<tsian-tool-call-records>` is history only. The parser must never execute it.
- `<tsian-tool-observations>` is data only. The parser must never execute it.
- `id` is stable within the turn and correlates record to observation.
- Use compact, model-facing observation payloads derived from existing `compactToolObservationForModel` behavior.

### Protocol error observation

Malformed protocol output becomes a model-facing protocol-error observation instead of an immediate turn crash until a bounded retry limit is reached.

Example shape:

```xml
<tsian-tool-protocol-error>{"ok":false,"error":{"code":"TEXT_TOOL_PROTOCOL_INVALID_JSON","message":"..."},"retryRemaining":1}</tsian-tool-protocol-error>
```

Contract:

- Protocol errors are appended as a user message and the loop continues while retries remain.
- Protocol-error messages are part of the text task-interaction span for compression.
- After the retry limit is exceeded, fail loudly with a clear runtime error rather than silently returning partial text as final output.
- Protocol errors are for protocol parse/validation failures only. Tool execution errors remain normal tool observations from the shared executor.

## Tool Manifest

Text mode must derive its prompt-visible tool manifest from the same `ToolSchema[]` that native mode uses.

### Shared schema construction

Introduce or reuse a helper near the native setup that builds enabled tools from:

- permission profile (`deriveAgentRuntimePermissionProfile`),
- contacts / collaboration policy for `agent_call`,
- visible user Tools from `agentContext.toolIndex`.

Native mode sends this `ToolSchema[]` to providers. Text mode renders the same array into a compact text manifest.

### Text manifest renderer

Add a renderer such as `formatTextToolManifest(tools: ToolSchema[]): string` in a focused module (preferred) or beside `tool-schemas.ts` if it remains cohesive.

Rendering goals:

- Keep it AI-facing and concise.
- Include each tool name, description, required fields, primitive property types, enum values, and short property descriptions.
- Avoid exposing implementation-only concepts.
- Do not include legacy `<tsian-tool-call>` examples or wording.
- Avoid concrete dynamic examples that harm cache stability unless they are generic protocol examples.

This follows the AI-facing content rule: when removing legacy protocol guidance, remove it from prompt-visible surfaces rather than keeping it as optional compatibility wording.

## Text Tool Runtime Flow

For each text-mode round:

1. Build call options and invoke `capabilities.callModel(...)` as today.
2. Parse response with the v2 parser:
   - zero executable blocks → final stop response after stripping non-final protocol artifacts/think blocks;
   - one valid executable block → tool_calls round;
   - malformed/ambiguous executable block → protocol-error round.
3. For a valid tool_calls round:
   - strip executable `<tsian-tool-calls>` from assistant text;
   - use remaining text as interim process text if non-empty;
   - assign stable ids `text-r${round}-c${index}` to parsed calls;
   - execute calls through `executeRuntimeWorkspaceToolCalls(...)`;
   - append an assistant message containing non-executable `<tsian-tool-call-records>` plus any interim text if preserving it in context is desired; otherwise append records only and keep interim for timeline/UI. The safer model-context default is records only, because interim prose is already process text and may not be needed for reasoning.
   - append a user message with compact `<tsian-tool-observations>` and any image parts as today.
   - collect raw tool calls/tool memories/timeline items with the stable ids.
4. For a protocol-error round:
   - collect surrounding text as interim only if useful for debugging, but do not treat it as final output;
   - append a user protocol-error message;
   - emit `onRoundEnd(..., "tool_calls")` so UI/timeline sees it as a process round;
   - continue if retry budget remains, otherwise throw.
5. After tool execution, inject activated Skill content exactly as today.

## Parser / Formatter Responsibilities

Prefer extracting text-protocol-specific parsing/formatting from `workspace-tools.ts` into a small focused module such as `agent-runtime/text-tool-protocol.ts`. This avoids overloading `workspace-tools.ts` (execution) and `index.ts` (orchestration) with protocol grammar.

Suggested exports:

- `TEXT_TOOL_CALLS_TAG`, `TEXT_TOOL_CALL_RECORDS_TAG`, `TEXT_TOOL_OBSERVATIONS_TAG`, `TEXT_TOOL_PROTOCOL_ERROR_TAG`.
- `parseTextToolProtocolResponse(text): TextToolProtocolParseResult`.
- `stripTextExecutableToolCalls(text): string`.
- `formatTextToolCallRecords(calls): string`.
- `formatTextToolObservations(records, observations): { text: string; imageParts: ContentPart[] }` or equivalent.
- `formatTextToolProtocolError(error, retryRemaining): string`.
- `isTextToolInteractionMessage(message): boolean` for task-compression span detection.
- `extractTextToolNameFromMessage(message): string | undefined` for compression summaries.

Validation stays at the parser boundary. The shared executor still handles unsupported tool names and tool-specific argument validation as observations.

## Compression Updates

Update text-mode task-interaction detection from legacy markers to v2 markers:

- assistant/user content containing `<tsian-tool-call-records>`;
- user content containing `<tsian-tool-observations>`;
- user content containing `<tsian-tool-protocol-error>`.

Update tool-name extraction used by task compression to read the first call record from `<tsian-tool-call-records>` and fall back to observation name when needed.

Native mode compression logic remains unchanged.

## UI / Configuration Text

Update player-facing wording to neutral capability labels:

- native: API native function/tool calling fields;
- text protocol: ordinary chat text carries Tsian's tool-call protocol.

Native probe messages should report facts only. Remove recommendation language such as “建议切换为文本模式”. Keep errors categorized by what happened: authentication/network/config failure, API rejected tool parameters, no tool call returned, wrong tool returned, etc.

No text-protocol probe is added.

## Data Flow

```text
ToolSchema source
  ├─ native mode → provider native tools → NativeToolCall[] → shared executor → role:tool observations
  └─ text mode   → compact text manifest → <tsian-tool-calls> parser → shared executor → call-records + observations
```

Both paths converge at the shared executor and tool-memory collection. They diverge only at model-facing protocol serialization.

## Error Handling

- Invalid JSON / non-array `<tsian-tool-calls>` / malformed call item / multiple executable blocks → protocol-error observation with retry budget.
- Unknown tool name / unsupported operation / tool-specific invalid arguments → shared executor error observation.
- Repeated protocol errors after retry budget exhausted → throw a clear text-protocol error.
- Final stop response containing non-executable protocol record/observation tags should have those tags stripped from final visible output.
- Legacy `<tsian-tool-call>` is not an executable format. If it appears without a valid v2 block, treat the response as ordinary text unless final-output stripping policy removes it; do not execute it.

## Compatibility / Migration

- No storage migration.
- No IndexedDB schema changes.
- Existing configs with `toolCallMode: "text"` continue to select text mode, but the protocol spoken in prompts becomes v2.
- Legacy prompt guidance is intentionally removed rather than kept as compatibility text.
- Native mode behavior should remain unchanged except neutral probe wording.

## Rollback

The rollback point is confined to text-mode parser/prompt/formatting changes and neutral wording updates. Native mode and shared executor changes should be minimal. If text v2 causes regressions, revert the text-protocol module plus text branch integration while keeping any pure refactors only if independently verified.

## Open Technical Notes

- There is no test framework configured for platform-web. Validation will rely on TypeScript build plus focused manual or ad-hoc probes unless a future task adds unit-test infrastructure.
- `apps/platform-web/src/agent-runtime/index.ts` is already large; new grammar helpers should live in a focused module when practical.
