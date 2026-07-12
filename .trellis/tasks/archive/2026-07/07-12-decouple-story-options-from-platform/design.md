# Design: 解耦平台硬编码剧情选项

## Current Coupling

1. `apps/platform-web/src/agent-runtime/index.ts` 的 `ENTRY_AGENT_PLATFORM_GUARD` 教所有入口 Agent 输出 `[[选项]]`。
2. `apps/platform-web/src/platform-host/index.ts` 调用 `extractStoryOptions`，将模型输出拆为 `cleanReply + options[]`，并把 options 写入 turn timeline / bridge event。
3. `packages/contracts` 与 `packages/play-bridge` 公开了 options 兼容面。
4. 默认前端也在解析 `[[选项]]`，这是可保留的默认前端约定。

## Target Shape

- 平台 runtime/host 不解释玩法 marker。
- 新正式 turn 原样持久化 assistant 文本。
- 默认前端自行解析默认卡约定，渲染选项按钮。
- 旧 options timeline/event/type 保留为 legacy compatibility。

## Changes

### Runtime Guard

Remove the `[[选项]]` instruction from `ENTRY_AGENT_PLATFORM_GUARD`. Keep generic wording only.

### Platform Host

In `platform-host/index.ts`:

- remove `extractStoryOptions` import;
- use `result.replyText` directly as `replyText` / assistant content;
- do not append `{ kind: "options" }` for new turns;
- do not call `emitTurnOptions` for new turns.

Delete `platform-host/story-options.ts` if unused.

### Default Frontend Parser Ownership

Copy `parseStoryOptions` to `apps/play-frontend-dev/src/lib/story-options.ts` and update imports from `@tsian/play-bridge` to local path:

- `apps/play-frontend-dev/src/composables/useTsian.ts`
- `apps/play-frontend-dev/src/composables/useSetupState.ts`

Keep `packages/play-bridge/src/story-options.ts` as a legacy helper for external frontends.

### Default Card Prompt

In default三人写手 `AGENT.md`, add a default frontend convention:

- if action options are needed for the default frontend, append `[[选项]] ... [[/选项]]` at the end;
- this is a default frontend/card convention, not platform behavior.

### Legacy Comments / Docs

Mark options shapes/events as legacy/backcompat in code comments and SDK docs where directly stated.

## Compatibility

- Old turn files with `{ kind: "options" }` still parse and render.
- New turn files keep raw marker in assistant text; default frontend parses it at render/reload time.
- External frontends that depended solely on `TurnEndResult.options` stop receiving new options; they should parse their own convention or show raw text.

## Non-goals

- No render-rules/regex system.
- No removal of public options types/events in this task.
- No visual changes to `StoryOptions`.