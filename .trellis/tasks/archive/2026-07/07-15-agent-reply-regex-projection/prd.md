# 通用 Agent 回复正则投影系统

## Goal

Introduce a platform-side, content-agnostic reply projection pipeline similar to Tavern regex replacement but adapted for Tsian's custom frontend model. Agent raw replies should be transformable into:

- `content`: clean text for LLM context, compression, semantic indexing, and fallback display.
- `displayContent`: optional display-oriented text for frontend-defined Markdown/HTML/DSL/component formats.
- `projections`: optional arbitrary JSON-compatible data keyed by card/frontend conventions.

The platform provides and persists the projection surfaces, but it must not understand gameplay concepts such as options, cards, HUDs, or HTML blocks.

## Background / Confirmed Facts

- Formal player turns currently persist the raw final assistant reply directly as both LLM-visible history/context and UI timeline content in `apps/platform-web/src/platform-host/runtime-turn.ts:250`.
- Formal turn history is stored as `save/history/turns/turn-NNNNNN.json` with `TurnTimelineItem[]`; LLM history reconstruction reads only user/assistant `content` in `apps/platform-web/src/platform-host/history-turns.ts:216`.
- `TurnTimelineItem` currently defines assistant items as `{ kind: "assistant"; content: string; stats?: TurnStats }` in `packages/contracts/src/runtime.ts:95`.
- Realtime play frontend turn completion currently receives `turn-completed` with only `{ turn }` from `apps/platform-web/src/bridge/remote-iframe-bridge.ts:700`; SDK `TurnEndResult` still exposes legacy `options?: string[]` in `packages/play-bridge/src/tsian-api.ts:77`.
- `interaction.sendMessage` currently returns only `{ turn }` through `MessageInteractionResult` in `packages/contracts/src/runtime.ts:865`.
- The old default/frontend choices convention parses `[[选项]]...[[/选项]]` in frontend code (`tmp/沉浸阅读器/frontend/src/lib/story-options.ts` and the mirrored `apps/play-frontend-dev/src/lib/story-options.ts`). This is frontend/card convention, not platform semantics.
- Opening turn 0 is written by setup script flow rather than `runtime-turn.ts`; the completed child task `07-15-opening-turn0-player-context` made Step4 write `turn-000000.json` and seed player-turn `context.json` directly.
- Effective workspace composition includes game-card content and card frontend files (`apps/platform-web/src/storage/workspace.ts:358`), so platform code and play frontends can read card-owned `config/reply-projection.json`.
- `tmp/沉浸阅读器` is the concrete validation target for this migration. Its card content lives under `tmp/沉浸阅读器/workspace/`; therefore the packaged card rule file path is `config/reply-projection.json`, and the source-tree file is `tmp/沉浸阅读器/workspace/config/reply-projection.json`.

## Product Decisions

- Options/choices are assistant output conventions, not a platform-owned structured field. Do not add a first-class platform `options` schema field.
- Frontends can be fully custom and may render Markdown, HTML, DSL, components, or any other card-defined format.
- Projection rules are provided by the game-card/frontend layer and stored as workspace-visible game-card content. They are not solely frontend-package files because the game card must prompt the LLM toward matchable text and the frontend must consume the resulting display/projection conventions.
- v1 rule file path: `config/reply-projection.json`.
- v1 author-facing configuration uses JSON short format, not a custom text file format. The format should stay compact enough for future UI editing without a dense form page.
- v1 rule language is declarative regex projection configuration, not arbitrary JS rules.
- v1 does not durably store the pre-projection raw model reply in turn history. AI debug records remain the raw-output source; automatic re-projection of old history after rule changes is out of scope.
- Projection config parse/schema errors, invalid regexes, or rule execution errors should not hard-fail the player turn. Projection fails soft with diagnostics; the turn still commits with best-effort/identity projection.
- Projection diagnostics belong in runtime trace/debug surfaces and optional console warnings, not in `TurnTimelineItem.projections` or other player-facing timeline business data.
- Security defenses for user/community-authored regex, HTML, DSL, XSS, sanitizer, import warning, or ReDoS are out of scope for this personal/non-commercial project.
- The existing built-in default game-card template is outdated and too tied to a specific gameplay card. Do not update that built-in template for this choices migration. Use `tmp/沉浸阅读器` as the validation/distribution target.

## Rule Format Requirements

A compact v1 rule file should look like this for the default choices convention:

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

Rule format constraints:

- `match` is a single regex-literal string such as `"/.../g"`, not separate `pattern` and `flags` fields.
- Rules execute in file order. Rule order is the card author's conflict-resolution mechanism.
- `text`, `content`, and `display` use familiar `String.replace` replacement-string semantics, including capture references such as `$&`, `$1`, and named captures.
- Each rule has two action groups:
  - Replacement group:
    - `text`: same replacement for both text lanes.
    - `content`: replacement only for the clean context lane.
    - `display`: replacement only for the display lane.
    - `text` must not be combined with `content` or `display`.
    - `content` and `display` may be combined to express different replacements for the same matched tag.
  - Extraction group:
    - `project` is optional and may be combined with any valid replacement group or used alone.
- `project` uses compact `key` / `key[]` plus value-pipe syntax:
  - Plain key: set/overwrite value.
  - Key ending in `[]`: append value to an array.
  - Value pipes start from `$&`, `$1`, `$<name>`, etc.
  - Minimal transforms: `trim`, `lines`, `stripList`.
- `lines` turns captured text into a non-empty `string[]`; `stripList` strips common Markdown list prefixes. This is a generic text transform, not a platform-owned choices parser.
- When a global rule has multiple matches, plain project keys set on each match and the last match wins. Authors use `key[]` to collect multiple values.
- Rules should normally match the LLM's original tag protocol and produce final target outputs in one rule. Multi-step rule chains are technically possible through ordered lanes but discouraged because they obscure intent, make rule order fragile, and are harder to debug.

## Pipeline Semantics

- Projection runs on the final complete assistant reply only, not on streaming deltas.
- `content` lane starts as raw model reply.
- `display` lane starts as raw model reply.
- `projections` starts as `{}`.
- Rules run in file order.
- `text` applies its replacement to both current text lanes.
- `content` applies its replacement to the current clean context lane.
- `display` applies its replacement to the current display lane.
- `project` extracts data from the rule's current content-lane matches before that rule's `text`/`content` replacement.
- If the whole config file cannot be parsed or validated, projection falls back to identity.
- If one rule fails during execution, that rule is skipped, later rules continue, and diagnostics are recorded.
- Final `displayContent` is persisted only when the display lane differs from final `content`.
- Frontend display uses `assistant.displayContent ?? assistant.content`; the platform only stores `displayContent` as an uninterpreted string and does not sanitize, render, or label it as Markdown/HTML/DSL.

## Requirements

- R1: Add a generic reply projection pipeline that transforms Agent raw replies before persistence.
- R2: Extend assistant `TurnTimelineItem` to persist clean `content` plus optional `displayContent` and `projections`.
- R3: `content` must be the only assistant reply text used for LLM-visible history, `context.json`, compression, and semantic indexing.
- R4: `displayContent` must preserve display-oriented inline replacement output when rules produce it, while remaining optional and uninterpreted by the platform.
- R5: `projections` must support arbitrary JSON-compatible card/frontend data under caller-defined keys. Platform stores values but does not interpret their semantics.
- R6: No first-class platform `options` field should be introduced.
- R7: Default `[[选项]]...[[/选项]]` migration should use this projection channel:
  - remove the option block from clean `content`;
  - expose `projections.choices` as `string[]`;
  - do not keep a legacy frontend parser fallback in the alpha-stage validation target.
- R8: The same projection semantics must apply to normal formal player turns and opening turn 0 `openingReply`.
- R9: Opening turn 0 must reuse the same platform projector through a platform action/API callable from setup scripts, rather than copying projection logic into card scripts.
- R10: Realtime turn completion must expose the projected assistant timeline item generically:
  - `interaction.sendMessage` result includes `{ turn, assistant }`;
  - `turn-completed` event payload includes the same `assistant` item;
  - SDK `TurnEndResult` exposes `assistant`, not legacy `options`.
- R11: `tmp/沉浸阅读器` should be updated as the concrete validation card/frontend, including its card content rule file and frontend consumption of `assistant.projections.choices`.

## Acceptance Criteria

- [ ] A raw assistant reply can be persisted as clean `content` plus optional `displayContent` and `projections` on the turn assistant timeline item.
- [ ] The same clean `content` is what gets appended to player-turn Agent context and reconstructed into future LLM history.
- [ ] A rule can remove UI-only markup from `content` while replacing it inline in `displayContent`.
- [ ] A rule can write JSON-compatible projection data under a caller-defined key, including `choices: string[]` through the generic `lines|stripList` transform.
- [ ] Default choices in `tmp/沉浸阅读器` are read from `assistant.projections.choices`, not from `TurnEndResult.options` or frontend parsing of assistant content.
- [ ] Opening turn 0 history stores clean `content` plus projection data, and the player-turn context seed uses clean `content`.
- [ ] Realtime `turn-completed` and `interaction.sendMessage` expose the same projected assistant item.
- [ ] The implementation does not add a platform-specific options schema field.
- [ ] Projection failures do not hard-fail the turn; diagnostics are available through trace/debug surfaces.
- [ ] Build/type validation passes for every package whose contracts or runtime shapes change.

## Out of Scope

- XSS, sanitizer, import warning, or ReDoS defenses.
- Making any gameplay-specific projection key mandatory.
- Implementing a specialized option system separate from generic projection rules.
- Durable raw reply storage and old-history re-projection.
- Old-save/backcompat migrations or legacy parser fallback for this alpha-stage migration.
- Updating the outdated built-in default game-card template for the choices rule.
- Streaming/incremental projection while deltas are still arriving.
