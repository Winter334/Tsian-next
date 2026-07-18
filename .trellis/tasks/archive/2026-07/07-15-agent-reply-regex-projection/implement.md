# Implementation Plan: 通用 Agent 回复正则投影系统

## Pre-Implementation Context

Read these before editing code:

- `.trellis/spec/platform-web/frontend/index.md`
- `.trellis/spec/platform-web/frontend/directory-structure.md`
- `.trellis/spec/platform-web/frontend/state-management.md`
- `.trellis/spec/platform-web/frontend/quality-guidelines.md`
- `.trellis/spec/platform-web/storage/index.md`
- `.trellis/spec/contracts/backend/index.md`
- `.trellis/spec/contracts/frontend/index.md`
- `.trellis/spec/guides/cross-layer-thinking-guide.md`
- `.trellis/spec/guides/data-fileification-principle.md`
- `.trellis/spec/guides/ai-facing-content-changes.md`

Key code entry points:

- `packages/contracts/src/runtime.ts`
- `packages/contracts/src/bridge.ts`
- `packages/play-bridge/src/tsian-api.ts`
- `apps/platform-web/src/platform-host/runtime-turn.ts`
- `apps/platform-web/src/platform-host/history-turns.ts`
- `apps/platform-web/src/platform-host/platform-actions.ts`
- `apps/platform-web/src/platform-host/browser-skill-script-executor.ts`
- `apps/platform-web/src/bridge/remote-iframe-bridge.ts`
- `tmp/沉浸阅读器/frontend/src/composables/useTsian.ts`
- `tmp/沉浸阅读器/workspace/agents/storyteller/output-format.md`

## Ordered Steps

### 1. Update shared contract shapes

Files:

- `packages/contracts/src/runtime.ts`
- `packages/contracts/src/bridge.ts`

Changes:

- Add/export an assistant timeline item type or inline extension:
  - `content: string`
  - `displayContent?: string`
  - `projections?: Record<string, JsonValue>`
  - `stats?: TurnStats`
- Extend `MessageInteractionResult` to include `assistant`.
- Extend `turn-completed` event payload to include `assistant`.
- Keep bridge payloads framework-neutral and serializable.
- Remove/retire new-path reliance on `turn-options`; do not expose it as platform-owned options semantics.

Validation after this step can be deferred to final build, but keep imports clean.

### 2. Implement platform reply projector module

File:

- new `apps/platform-web/src/platform-host/reply-projection.ts`

Implement:

- `REPLY_PROJECTION_CONFIG_PATH = "config/reply-projection.json"`.
- `projectAssistantReply(input)` or similar:
  - inputs: raw reply string, workspace files, optional trace/diagnostic callback.
  - output: `{ content, displayContent?, projections?, diagnostics }`.
- Config read from supplied `WorkspaceFile[]` only; do not query Dexie directly.
- Missing config -> identity projection.
- Invalid file/schema -> identity projection + diagnostic.
- Per-rule failure -> skip failed rule, continue later rules + diagnostic.
- Regex literal parser for `match: "/.../flags"`.
- Replacement group validation:
  - `text` mutually exclusive with `content`/`display`.
  - `content` and `display` may coexist.
  - At least one of replacement group or `project` should exist; otherwise diagnostic/skip.
- Project value pipe evaluator:
  - capture start tokens `$&`, `$0`, `$1`, `$<name>`.
  - transforms `trim`, `lines`, `stripList`.
  - plain key set/overwrite; `key[]` append array.
- Use `JsonValue`-compatible values only.
- No raw reply fragments in diagnostics.

Suggested internal output:

```ts
interface ReplyProjectionResult {
  content: string
  displayContent?: string
  projections?: Record<string, JsonValue>
  diagnostics: ReplyProjectionDiagnostic[]
}
```

### 3. Apply projector in formal player turns

File:

- `apps/platform-web/src/platform-host/runtime-turn.ts`

Changes after `const replyText = result.replyText`:

- Call projector with `activeWorkspaceTransaction.workspaceFiles`.
- Emit trace diagnostics/metadata without content fragments.
- Build assistant timeline item from projected result + stats.
- Use projected clean `content` in:
  - `nextHistory` assistant message.
  - `stageAgentContextFile(... assistant: projected.content ...)`.
  - turn trace `replyLength` should refer to clean content length or record both raw/clean lengths as metadata-only numbers.
- Use assistant item in `turnTimeline`.
- Return `{ turn: nextTurn, assistant: assistantItem }`.

Do not persist raw reply in turn history.

### 4. Update realtime bridge and SDK turn completion

Files:

- `apps/platform-web/src/bridge/remote-iframe-bridge.ts`
- `packages/play-bridge/src/tsian-api.ts`
- possibly `docs/sdk/play-frontend-api.md`

Changes:

- `remote-iframe-bridge.ts`: when `interaction.sendMessage` succeeds, post `turn-completed` with `{ turn: result.turn, assistant: result.assistant }`.
- SDK `TurnEndResult`: remove `options?: string[]`, add `assistant?: AssistantTurnTimelineItem`.
- Remove `pendingOptions` aggregation from `turn-options`.
- Keep `turn-stats` only if still needed for old event flow; new assistant item carries stats. If retaining `pendingStats`, avoid duplicating/overriding assistant stats inconsistently.
- Ensure `onTurnEnd` callbacks receive the assistant item from event payload.
- `tsian.send()` can continue returning `Promise<void>` unless a domain API return is intentionally added.

### 5. Add narrow browser-script projection SDK operation for turn 0

Files:

- `apps/platform-web/src/platform-host/browser-skill-script-executor.ts`
- `apps/platform-web/src/storage/workspace-templates/scripts/opening.ts`

Changes:

- Add script-side API, for example:
  ```js
  tsian.reply.project(text)
  ```
- Add worker RPC op such as `reply.project`.
- In `handleSdkRequest`, route `reply.project` to the same projector module using `options.workspaceTransaction.workspaceFiles`.
- Return only the projected data needed by script: `{ content, displayContent?, projections? }` plus optionally diagnostics metadata if useful; do not throw on projection diagnostics.
- Do not expose generic `platform.runAction` to browser scripts.
- Update `COMMIT_PLAY_SETUP_SCRIPT_JS`:
  - call projector for `openingReply` after validation and before building turn 0/context files.
  - write assistant timeline item with clean content/display/projections.
  - seed context with projected clean content.

### 6. Update `tmp/沉浸阅读器` validation card

Files likely involved:

- new `tmp/沉浸阅读器/workspace/config/reply-projection.json`
- `tmp/沉浸阅读器/frontend/src/composables/useTsian.ts`
- possibly remove unused `tmp/沉浸阅读器/frontend/src/lib/story-options.ts`
- `tmp/沉浸阅读器/workspace/agents/storyteller/output-format.md`

Changes:

- Add choices rule:
  ```json
  {
    "schema": "tsian.reply-projection.v1",
    "rules": [
      {
        "id": "choices",
        "match": "/\\[\\[选项\\]\\]([\\s\\S]*?)\\[\\[\\/选项\\]\\]/g",
        "text": "",
        "project": {
          "choices": "$1|lines|stripList"
        }
      }
    ]
  }
  ```
- Update realtime `onTurnEnd`:
  - use `result.assistant` instead of parsing `streamingText`.
  - push assistant stream item with `assistant.displayContent ?? assistant.content`.
  - set `turnOptions` from `assistant.projections?.choices` if it is a `string[]`.
- Update `reloadHistory()`:
  - use `item.displayContent ?? item.content` for assistant stream content.
  - restore latest choices from assistant `projections.choices`.
  - remove legacy `{ kind: "options" }` fallback for this alpha target.
- Remove `parseStoryOptions` imports/usages if no longer needed.
- Update storyteller docs to keep the `[[选项]]` output convention and mention the projection rule file owns cleanup/extraction.

### 7. Check generated/package artifacts only as needed

`tmp/沉浸阅读器/frontend/dist/**` exists. Decide during implementation whether to rebuild/update dist as part of the validation card package source. If dist is meant to be distributed immediately, rebuild or package according to the project's frontend packaging flow; otherwise document that source changed and dist rebuild is a follow-up packaging step.

Do not update `apps/platform-web/src/storage/workspace-templates/**` for the built-in default game-card choices rule except for the setup script projector reuse in Step 5.

### 8. Validation

Run:

```bash
npm run build:contracts
npm run build:web
```

Additional checks:

```bash
rg -n "TurnEndResult.*options|options\?: string\[\]|pendingOptions|turn-options" packages apps tmp/沉浸阅读器
rg -n "parseStoryOptions" tmp/沉浸阅读器/frontend/src
```

Manual behavior checks:

- Formal reply containing `[[选项]]...[[/选项]]` commits clean assistant `content` and `projections.choices`.
- Realtime `onTurnEnd` receives projected assistant item and shows choices without parsing raw content.
- `history.get()` reload path reconstructs choices from timeline assistant projections.
- Step4 opening turn 0 writes clean content and projections; context seed has no choices block.
- Broken `config/reply-projection.json` does not hard-fail a formal turn and emits diagnostics.

## Risk / Rollback Points

- Contracts changes cross `packages/contracts`, `packages/play-bridge`, `apps/platform-web`, and card frontend source. Keep `MessageInteractionResult`, `RemotePlayBridgeEventPayload`, and SDK `TurnEndResult` in sync.
- `turn-options` is legacy baggage; removing SDK exposure is intended. Avoid reintroducing `options` as a replacement field.
- Browser script SDK capability should stay narrow (`reply.project`) so setup scripts can project opening replies without gaining unrelated platform actions.
- Projection config parsing must not throw out of `sendMessage`; fail-soft is a product requirement.
- Trace/debug diagnostics must be metadata-only: no reply text previews.
- If `displayContent` exists, frontends may treat it as HTML/DSL. This task explicitly does not sanitize or police it.

## Completion Gate Before `task.py start`

- `prd.md`, `design.md`, and `implement.md` are present and aligned.
- `implement.jsonl` and `check.jsonl` contain real spec/research entries, not seed examples.
- User has reviewed/approved the plan.
