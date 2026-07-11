# Research: Task 模式上下文管理现状与优化依据

## Current Implementation Findings

### Assistant task mode entry

- 桌面助手在 `runAssistantChat` 中注入 task 模式：`compressionMode: "task"`，见 `apps/platform-web/src/platform-host/assistant-chat.ts:461`、`apps/platform-web/src/platform-host/assistant-chat.ts:468`。
- 助手读取 `.tsian/local/assistant/sessions/<sessionId>/context.json` 作为跨 turn context，见 `apps/platform-web/src/platform-host/assistant-chat.ts:421`。

### Raw tool calls currently feed both UI and model context

- 同一批 `turnToolCalls` 从 `result.contextUpdate?.toolCalls` 取出，见 `apps/platform-web/src/platform-host/assistant-chat.ts:735`。
- UI 会话消息保存 raw `toolCalls`，见 `apps/platform-web/src/platform-host/assistant-chat.ts:751`。
- agent context 写回同一批 `toolCalls`，见 `apps/platform-web/src/platform-host/assistant-chat.ts:761`、`apps/platform-web/src/platform-host/assistant-chat.ts:768`。

### Tool calls are stored on assistant turn entries

- `appendTurnToContext` 把 tool calls 挂到 assistant `recentTurns` entry 上，见 `apps/platform-web/src/agent-runtime/context-lifecycle.ts:712`、`apps/platform-web/src/agent-runtime/context-lifecycle.ts:726`。
- `AgentContextTurnEntry.toolCalls` 类型位于 `packages/contracts/src/runtime.ts:142`、`packages/contracts/src/runtime.ts:146`。

### Historical tool calls are replayed to the model

- `buildAgentContextMessages` expands `AgentContextSnapshot` into model messages，见 `apps/platform-web/src/agent-runtime/index.ts:284`。
- assistant entry with historical `toolCalls` is rebuilt as native `assistant.toolCalls` + `role:"tool"` results in native mode，见 `apps/platform-web/src/agent-runtime/index.ts:300`、`apps/platform-web/src/agent-runtime/index.ts:309`、`apps/platform-web/src/agent-runtime/index.ts:311`。
- text mode rebuilds historical calls into text protocol blocks，见 `apps/platform-web/src/agent-runtime/index.ts:315`、`apps/platform-web/src/agent-runtime/index.ts:319`。

### Cross-turn compression is turn-granular

- `compressContext` keeps recent turns and compresses old turns into `summary`，见 `apps/platform-web/src/agent-runtime/context-lifecycle.ts:475`、`apps/platform-web/src/agent-runtime/context-lifecycle.ts:482`、`apps/platform-web/src/agent-runtime/context-lifecycle.ts:529`。
- This means recent assistant turns can keep all attached tool observations regardless of count/size.

### Current tool-result compacting is shallow

- Model observation formatting goes through `compactUnknownResultForModel`，见 `apps/platform-web/src/agent-runtime/workspace-tools.ts:2618`。
- The helper compacts large string results or object top-level `content` fields，见 `apps/platform-web/src/agent-runtime/workspace-tools.ts:2631`。
- Large nested fields such as `response`, `output`, `stdout`, `stderr`, `diagnostics`, or tool-specific payloads can bypass this shallow compacting.

### Workspace read behavior

- `workspace.read` has default/maximum line limits only when `offset` or `limit` is supplied，见 `apps/platform-web/src/agent-runtime/workspace-operations.ts:46`、`apps/platform-web/src/agent-runtime/workspace-operations.ts:69`。
- Without both offset and limit, it returns the whole file with metadata，见 `apps/platform-web/src/agent-runtime/workspace-operations.ts:622`、`apps/platform-web/src/agent-runtime/workspace-operations.ts:627`。
- Model formatting may preview the result, but raw observation can still be large before projection.

## External Reference Summary

User-provided article: https://news.qq.com/rain/a/20260608A07HSX00

Relevant principles extracted for this task:

- Context management should be a layered state-maintenance pipeline, not a single late summarization step.
- Prefer cheap deterministic reduction before LLM summarization.
- Treat complete tool output as recoverable log / disk, not permanent prompt memory.
- Preserve user intent and recent task focus more strongly than assistant/tool process details.
- Use handoff-style state for long tasks: completed work, constraints, decisions, remaining work, anchors.
- Avoid unstable sliding windows; compression/visibility decisions should be deterministic and persistable.

## Chosen Tsian-Specific Subset

This task intentionally does **not** import every mechanism from Claude Code / Codex / Cursor / OpenCode. The chosen subset is:

1. UI/debug raw tool log remains complete.
2. Task-mode model context receives bounded deterministic tool-memory projection.
3. Conversation text and tool memory are stored separately.
4. Delegated `agent_call` observations are bounded before feeding the parent model.
5. AIRP / narrative context remains simple and does not adopt task-mode tool memory state.

## Relevant Specs

- `platform-web` type-safety purity boundary: `agent-runtime` must not import Dexie/storage/platform-host, see `.trellis/spec/platform-web/frontend/type-safety.md:242`.
- Runtime tool-call scenario: `agent_call` structured observation and task-mode budget semantics, see `.trellis/spec/platform-web/frontend/type-safety.md:257`、`.trellis/spec/platform-web/frontend/type-safety.md:283`。
- Assistant context virtual file path and fileification principle: `.trellis/spec/platform-web/frontend/state-management.md:36` and `.trellis/spec/guides/data-fileification-principle.md:20`.
- Contract changes require `npm run build:contracts` and consuming build, see `.trellis/spec/contracts/backend/index.md:12`、`.trellis/spec/contracts/frontend/index.md:8`.
