# Text Tool Protocol v2

## Goal

Create Text Tool Protocol v2 as a first-class runtime tool-calling mode alongside native function calling. The mode should let Tsian run Agent Runtime tool loops over plain chat-text APIs, including provider-compatible relay / proxy APIs whose native tool-calling support is unavailable or unreliable, without presenting the mode as a fallback or making mode-selection decisions for the player.

## Confirmed Code Facts

- Current tool-call mode is model-level config with two modes, `native` and `text`; the existing comments still describe `text` as legacy fallback: `apps/platform-web/src/config/ai.ts:12`.
- Native runtime builds provider tool schemas from `buildEnabledToolSchemas(...)`, including gated platform tools and filtered user Tools: `apps/platform-web/src/agent-runtime/tool-schemas.ts:494`.
- Current text runtime uses hand-written prompt instructions and the legacy `<tsian-tool-call>` single-call block: `apps/platform-web/src/agent-runtime/index.ts:580`.
- Current text parser only reads `<tsian-tool-call>` blocks and strips them by regex: `apps/platform-web/src/agent-runtime/workspace-tools.ts:105`, `apps/platform-web/src/agent-runtime/workspace-tools.ts:419`.
- Both native and text paths already share `executeRuntimeWorkspaceToolCalls(...)` for actual tool execution and ordering/concurrency policy: `apps/platform-web/src/agent-runtime/workspace-tools.ts:2536`.
- Native mode threads assistant `toolCalls` plus `role: "tool"` observations back into model context: `apps/platform-web/src/agent-runtime/index.ts:1773`.
- Current text mode strips the executable tool-call block from assistant context and appends observations as a user message: `apps/platform-web/src/agent-runtime/index.ts:2156`, `apps/platform-web/src/agent-runtime/workspace-tools.ts:2611`.
- Current task compression identifies text tool interaction by legacy `<tsian-tool-call>` and `<tsian-tool-observation>` markers, which will need updating for v2 records/observations: `apps/platform-web/src/agent-runtime/index.ts:375`.
- Current original/native tool probe exists and returns messages that include recommendation wording for text mode on some failures: `apps/platform-web/src/runtime-host/ai.ts:2079`.

## Product Requirements

- R1. Text Protocol must be treated as a first-class tool-calling mode, not documented or presented as a fallback-only path.
- R2. The UI/config surface must expose the modes neutrally as peer capabilities: native tool calling and text protocol tool calling.
- R3. The existing native tool-calling probe must remain a native-only capability test. Its returned user-facing message must report facts only and must not recommend switching modes.
- R4. No separate text-protocol probe should be added.
- R5. Runtime must not automatically switch between native and text protocol. The selected model mode controls the execution path.
- R6. Text Protocol v2 executable calls must use only the new batch tag `<tsian-tool-calls>`.
- R7. `<tsian-tool-calls>` content must be a JSON array of calls, even for a single call.
- R8. Legacy `<tsian-tool-call>` must not be supported as an executable compatibility format. Once prompt guidance is removed, old tags should not be parsed/executed.
- R9. Text Protocol v2 tool availability and parameter documentation must be derived from the same `ToolSchema` source used by native mode, so platform tools, gated permissions, contacts, `ask_user`, and user Tools do not drift between modes.
- R10. Text Protocol v2 must assign stable runtime call ids, e.g. round/index-derived ids such as `text-r${round}-c${index}`, because text APIs do not provide provider tool-call ids.
- R11. Text Protocol v2 must preserve a non-executable tool-call record in model context after a tool round, including id, name, and arguments, so later rounds and task compression can understand what was executed.
- R12. Text Protocol v2 observations must be associated with the stable call id and must not be executable tool-call blocks.
- R13. Text task-context compression must recognize v2 call records and observations as tool-interaction messages.
- R14. Protocol parse/validation failures should be reported back to the model as protocol-error observations with bounded retries, rather than immediately crashing the turn on the first malformed tool-call attempt.
- R15. Final assistant output must not contain executable tool-call tags, tool observations, protocol records, or implementation/tool details unless the agent's own user-facing task asks for them.
- R16. If a valid `<tsian-tool-calls>` block appears with prose before or after it, runtime should execute the valid block and preserve the surrounding prose as interim process text instead of treating the round as a protocol error.

## Out of Scope

- A dedicated text-protocol probe.
- Runtime auto-fallback or automatic mode switching.
- Legacy `<tsian-tool-call>` execution compatibility.
- Provider-native tool-call behavior changes beyond neutralizing probe wording where needed.
- Broad UI redesign unrelated to tool-call mode labels/messages.

## Acceptance Criteria

- [ ] AC1. Text mode prompt/instructions describe Text Protocol v2 as a first-class text protocol and no longer call it a legacy fallback in user-facing configuration text.
- [ ] AC2. Text mode executable parser recognizes `<tsian-tool-calls>` JSON arrays and does not execute legacy `<tsian-tool-call>` blocks.
- [ ] AC3. Text mode tool manifest is generated from the same enabled `ToolSchema[]` used by native mode, including user Tools and gated platform tools.
- [ ] AC4. A text tool round with one or more valid calls executes through the shared runtime tool executor and assigns stable text call ids.
- [ ] AC5. The next model round receives non-executable call records plus observations correlated by id, not legacy executable call blocks.
- [ ] AC6. Text task compression can locate and compress v2 tool interaction records/observations.
- [ ] AC7. Malformed v2 tool-call output produces a model-facing protocol error observation and stops after a bounded retry limit.
- [ ] AC8. Native tool-call probe messages report pass/fail facts without recommending a mode switch.
- [ ] AC9. No text-protocol probe UI/API is added.
- [ ] AC10. Existing native-mode tool loop behavior remains intact.
- [ ] AC11. Extra prose around a valid `<tsian-tool-calls>` block is captured as interim process text while the valid tool block still executes.

## Open Questions

- None.
