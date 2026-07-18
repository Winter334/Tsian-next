# Design: 通用 Agent 回复正则投影系统

## Scope

This child task adds a generic reply projection pipeline to platform-web and shared bridge/contracts. It also migrates the `tmp/沉浸阅读器` choices convention onto the new projection channel for validation. It does not update the outdated built-in default game-card template.

## Architecture Summary

```
raw assistant reply
  -> reply projector (config/reply-projection.json)
  -> projected assistant item
       content          clean LLM/context text
       displayContent?  frontend display text
       projections?     arbitrary JSON-compatible card/frontend data
  -> turn history + realtime turn result + player-turn context
```

The projector is platform-side and content-agnostic. It understands the projection rule schema but does not interpret projection keys such as `choices`.

## Source / Ownership Boundaries

### Rule file

- Card path: `config/reply-projection.json`.
- Source validation target path: `tmp/沉浸阅读器/workspace/config/reply-projection.json`.
- The file is game-card content, not frontend-package-only content.
- The file is visible through effective workspace composition, so platform host, setup scripts, assistant tools, and frontends can all read the same contract.

### Runtime implementation placement

Add a focused platform-host module, for example:

```text
apps/platform-web/src/platform-host/reply-projection.ts
```

Responsibilities:

- Read `config/reply-projection.json` from a supplied `WorkspaceFile[]` snapshot.
- Parse and normalize compact v1 rule config.
- Apply rules to a raw reply.
- Return projected text/data and diagnostic metadata.
- Never import Vue, bridge objects, Dexie tables, or card-specific frontend code.

Formal turns call this module from `apps/platform-web/src/platform-host/runtime-turn.ts` after `result.replyText` and before history/context/timeline persistence.

Opening turn 0 setup scripts reuse the same module through a narrow browser-script SDK operation (see “Opening turn 0 reuse”).

## Rule Config Shape

Example:

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

### Rule fields

- `id?: string` — diagnostic label only.
- `match: string` — regex literal string, e.g. `"/.../g"`.
- Replacement group:
  - `text?: string` — same replacement for both content and display lanes.
  - `content?: string` — replacement for content lane only.
  - `display?: string` — replacement for display lane only.
  - `text` is mutually exclusive with `content` and `display`.
  - `content` and `display` may be used together.
- Extraction group:
  - `project?: Record<string, string>`.
  - Keys ending in `[]` append values to an array.
  - Plain keys set/overwrite values.
  - Values are compact pipes such as `$1|lines|stripList`.

### Value pipe v1

Start token:

- `$&` or `$0` — full match.
- `$1`, `$2`, ... — numbered capture.
- `$<name>` — named capture.

Transforms:

- `trim` — trim string values; for arrays, trim each string.
- `lines` — split string by newline, trim, remove empty lines, output `string[]`.
- `stripList` — strip common Markdown list prefixes from string or each string item.

No nested object templates, JS expressions, conditionals, loops, deep merge, or arbitrary function calls in v1.

## Pipeline Semantics

Initial state:

```ts
contentLane = rawReply
displayLane = rawReply
projections = {}
```

Rules run in file order.

For each rule:

1. Compile/resolve the rule regex from `match`.
2. Extract `project` values from the rule's current content-lane matches before applying this rule's `text` / `content` replacement to the content lane.
3. Apply replacement group:
   - `text`: replace matches in both current content and display lanes with the same replacement string.
   - `content`: replace matches in current content lane only.
   - `display`: replace matches in current display lane only.
   - `content` + `display`: apply each to its corresponding lane.
4. If one rule fails, skip that rule and continue later rules.

Final result:

```ts
{
  content: contentLane,
  ...(displayLane !== contentLane ? { displayContent: displayLane } : {}),
  ...(Object.keys(projections).length > 0 ? { projections } : {})
}
```

Authoring guidance:

- Rules should normally match the LLM's original tag protocol and produce all final target outputs in one rule.
- Multi-step intermediate-tag chains are possible through ordered lanes but are discouraged.

## Failure / Diagnostics

Projection failure is fail-soft:

- Missing `config/reply-projection.json`: identity projection, no diagnostic needed.
- Invalid JSON / invalid schema / unsupported schema: identity projection, diagnostic emitted.
- Invalid regex / invalid replacement / invalid value pipe in one rule: skip that rule, continue later rules, diagnostic emitted.

Diagnostics should go to runtime trace/debug surfaces and optional console warnings. They must not be written into `TurnTimelineItem.projections`, `content`, `displayContent`, or any other player-facing timeline business data.

Suggested diagnostic events:

- `reply_projection_config_failed`
- `reply_projection_rule_failed`
- `reply_projection_completed` with metadata only (rule count, diagnostic count, output lengths, projection key count)

Trace records must not include reply text fragments.

## Contract Changes

### `packages/contracts/src/runtime.ts`

Extend assistant timeline item:

```ts
type AssistantTurnTimelineItem = {
  kind: "assistant"
  content: string
  displayContent?: string
  projections?: Record<string, JsonValue>
  stats?: TurnStats
}
```

Use the existing `JsonValue` type for projection values.

Extend message result:

```ts
export interface MessageInteractionResult {
  turn: number
  assistant: AssistantTurnTimelineItem
}
```

### `packages/contracts/src/bridge.ts`

Extend `turn-completed` event payload to carry the same assistant item:

```ts
{ turn: number; assistant?: AssistantTurnTimelineItem }
```

Remove or retire `turn-options` from new SDK turn-end semantics. If the event name remains in low-level contracts briefly for cleanup sequencing, do not surface it through `TurnEndResult.options`.

### `packages/play-bridge/src/tsian-api.ts`

Update SDK `TurnEndResult`:

```ts
export interface TurnEndResult {
  turn?: number
  assistant?: AssistantTurnTimelineItem
}
```

Remove legacy `pendingOptions` aggregation and `options?: string[]` from the domain API.

`tsian.send()` may continue returning `Promise<void>` for domain API simplicity, but the underlying RPC result and `turn-completed` event must both include `{ turn, assistant }`.

## Formal Turn Flow

In `runtime-turn.ts`:

1. Run Agent Runtime and obtain raw `replyText`.
2. Project the reply using the current turn workspace snapshot.
3. Build `assistantItem`:
   ```ts
   const assistantItem = {
     kind: "assistant",
     content: projected.content,
     ...(projected.displayContent ? { displayContent: projected.displayContent } : {}),
     ...(projected.projections ? { projections: projected.projections } : {}),
     ...(turnStats ? { stats: turnStats } : {}),
   }
   ```
4. Use `projected.content` in `nextHistory` and `stageAgentContextFile`.
5. Use `assistantItem` in `turnTimeline`.
6. Return `{ turn: nextTurn, assistant: assistantItem }` from `sendMessage`.
7. `remote-iframe-bridge.ts` posts `turn-completed` with both `turn` and `assistant` after the RPC succeeds.

## Opening Turn 0 Reuse

Opening setup currently writes turn 0 and player-turn context inside `COMMIT_PLAY_SETUP_SCRIPT_JS`.

Do not copy projector logic into the setup script. Add a narrow platform-host/browser-script SDK operation that uses the same projector module against the script's current `workspaceTransaction.workspaceFiles` snapshot.

Suggested script-facing API:

```js
const projected = await tsian.reply.project(openingReply)
```

or an equivalent narrow operation such as `reply.project` in the worker RPC handler.

Avoid exposing a generic `platform.runAction` capability to runtime browser scripts, because it would surface unrelated host actions such as checkpoint restore. The setup script only needs reply projection.

The setup script then writes:

```js
const assistantItem = {
  kind: "assistant",
  content: projected.content,
  ...(projected.displayContent ? { displayContent: projected.displayContent } : {}),
  ...(projected.projections ? { projections: projected.projections } : {})
}

turn0Record.timeline = [assistantItem]
contextFile.recentTurns = [{ turn: 0, role: "assistant", content: projected.content }]
```

## Frontend Consumption

Generic frontend rule:

```ts
const visibleText = assistant.displayContent ?? assistant.content
```

The platform does not label or sanitize the display string.

### `tmp/沉浸阅读器`

Update this validation card, not the current built-in default template:

- Add `tmp/沉浸阅读器/workspace/config/reply-projection.json` with the default `choices` rule.
- Update `tmp/沉浸阅读器/frontend/src/composables/useTsian.ts`:
  - Remove realtime `parseStoryOptions` use from `onTurnEnd`.
  - On `TurnEndResult.assistant`, push settled assistant content using `displayContent ?? content`.
  - Set `turnOptions` from `assistant.projections?.choices` when it is a `string[]`.
  - In `reloadHistory()`, use assistant timeline items directly and restore latest choices from `item.projections?.choices`.
  - Remove legacy `options` timeline fallback for this alpha-stage migration.
- Remove or stop importing `tmp/沉浸阅读器/frontend/src/lib/story-options.ts` if it becomes unused.
- Update storyteller prompt/docs under `tmp/沉浸阅读器/workspace/agents/storyteller/` only as needed to document the card's output tag convention and projection rule file. Do not add platform-specialized options semantics.

## Compatibility / Migration

- No old-save migration.
- No legacy parser fallback in `tmp/沉浸阅读器`.
- Missing projection config keeps identity behavior for cards that have not opted in.
- Existing old turns that only contain raw `[[选项]]` blocks may surface visibly after the validation frontend removes its parser. This is accepted for alpha.

## Validation

Required commands after implementation:

```bash
npm run build:contracts
npm run build:web
```

Manual/product checks:

- Formal turn with choices block persists assistant `content` without the block and `projections.choices` as `string[]`.
- Realtime `onTurnEnd` receives `assistant.projections.choices` and displays choices without parsing raw text.
- `history.get()` returns the same assistant item shape for reload/restore.
- Opening turn 0 writes clean `content` and `projections.choices`; player-turn context seed uses clean `content`.
- Invalid projection config does not fail the turn; diagnostics appear in trace/debug metadata.
- No platform `options` schema field or SDK `TurnEndResult.options` remains in the new path.
