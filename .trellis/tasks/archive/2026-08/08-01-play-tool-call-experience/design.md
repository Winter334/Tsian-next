# 游戏前端工具调用体验优化 — Technical Design

## 1. Scope and Boundaries

This task changes the player-visible process timeline for formal game turns and adds one additive presentation field to the tool-event pipeline.

Owned layers:

1. `packages/contracts`: optional tool display-name contract on live and persisted tool nodes.
2. `apps/platform-web`: resolve custom Tool titles, thread the optional field through runtime callbacks, timeline persistence, invocation events, and the remote iframe bridge.
3. `packages/play-bridge`: expose the optional field on `ToolEvent` without changing existing callbacks or status semantics.
4. `apps/play-frontend-dev`: flatten interim/tool rendering and add status/count animations.

The task does not change tool execution, arguments, outputs, permissions, ordering, or model-visible tool schemas.

## 2. Presentation Contract

### 2.1 Additive field

Use the field name:

```ts
displayName?: string
```

It is an opaque, player-facing label, not a sentence fragment and not a template. Add it to:

- the `kind: "tool"` branch of `TurnTimelineItem`;
- the `type: "tool"` branch of `AgentInvocationEvent` so the shared runtime callback is not lossy;
- the `turn-tool` remote event payload;
- play-bridge `ToolEvent`.

The field remains optional for backward compatibility with existing history files, old remote senders, and platform built-ins that do not currently own a user-facing title.

### 2.2 Resolution rule

At tool execution time:

```text
visible custom Tool registry entry title -> displayName
otherwise                              -> undefined
```

The runtime already has the visible `ToolRegistryEntry` in `RuntimeWorkspaceToolExecutionContext.agentContext.toolIndex`. Resolve it once per call by wire `name`; use its validated `title` for both the initial and terminal events. Platform built-ins do not gain a new hard-coded Chinese mapping in this task.

The frontend renders:

```text
displayName ?? name
```

It never prepends/appends tense, verbs, “了操作”, or failure text to the display name.

### 2.3 Status mapping

The transport status remains unchanged:

```ts
"loading" | "running" | "success" | "failed"
```

The player-facing mapping is deliberately smaller:

| Transport | Visible label | Visual state |
|---|---|---|
| `loading` | 运行中 | running |
| `running` | 运行中 | running |
| `success` | 成功 | success |
| `failed` | 失败 | failed |

The visible label and stable icon are always present. Color and animation are supplementary signals.

## 3. Data Flow

```text
ToolRegistryEntry.title
  -> workspace tool executor displayName
  -> Agent Runtime onTool(..., output?, displayName?)
  -> platform-host
       -> live streaming event -> remote iframe -> play-bridge ToolEvent
       -> timeline collector -> persisted TurnTimelineItem
       -> invokeAgent AgentInvocationEvent (parity path)
  -> useTsian StreamItem (live or history reload)
  -> ProcessNode tool row
```

Every positional callback in this pipeline receives the optional field at the end, after `output`, to avoid reordering existing parameters. Initial running events pass `undefined` for output and the resolved `displayName`; terminal events pass both output and the same display name.

When a later event has a display name and the existing in-memory/timeline node does not, the updater fills it. It never clears an existing display name because a later sender omitted the optional field.

## 4. Runtime and Persistence Changes

### 4.1 Tool executor

In `workspace-tools/tool-execution.ts`, resolve the visible custom Tool before emitting the initial event. Reuse the resolved entry in the custom-tool execution branch to avoid a second lookup.

Both loading and terminal calls carry the same display name. Unsupported tool calls have no display name and render their wire name.

### 4.2 Callback propagation

Extend the callback signatures in:

- `workspace-tools-types.ts`;
- `turn-types.ts`;
- both native and text tool-loop bindings in `agent-runtime/index.ts`;
- `platform-host/runtime-turn.ts`;
- `streaming-events.ts`;
- `platform-host/ai-invocation.ts`.

Update both collected `TurnTimelineItem` branches in Agent Runtime and `createTurnTimelineCollector()` so live UI, persisted formal-turn history, and agent session/invocation paths retain the same field.

### 4.3 Bridge

`remote-iframe-bridge.ts` forwards `displayName` only when defined. `packages/play-bridge/src/tsian-api.ts` accepts a non-empty string and exposes it on `ToolEvent`; missing/invalid values are omitted rather than coerced.

Update `docs/sdk/play-frontend-api.md` to document the optional label and its fallback semantics. The SDK does not localize or inflect it.

## 5. Frontend Rendering

### 5.1 Outer process fold

`RoundProcess.vue` remains the only fold that governs the whole process area. Its summary counts only direct `kind: "tool"` nodes.

Header shape:

```text
[chevron] 推演过程  [animated N] 次工具调用
```

If `N === 0`, omit the count phrase. Use tabular numerals and an overlapping keyed Vue transition so old/new digits share one grid cell and do not move adjacent text.

### 5.2 Node variants

`ProcessNode.vue` renders three explicit variants rather than one universal collapsible shell:

1. `interim`: plain text block, always visible once the outer fold is open. No inner trigger, border-card header, `agentId`, or “过渡” label.
2. `thought`: retain the current inner collapsible pattern with the single label “思考”. Do not show `agentId`.
3. `tool`: one non-collapsible list row with display name on the left and state icon + visible status text on the right.

Remove the `tool-group` type, `TOOL_LABEL`, `groupSummary`, and contiguous-tool grouping branch from `StoryView.vue`. Consecutive tools remain consecutive direct nodes in original timeline order.

No raw args/output are added to the player UI. Existing output transport remains untouched for other consumers.

### 5.3 Motion

Use local CSS/Vue transitions; do not add a dependency.

- New tool row: 180–220 ms opacity + small upward translation.
- Running icon: low-amplitude continuous ring/spinner; status text remains stable.
- Running -> success: icon crossfade/draw and one brief accent glow, then static.
- Running -> failed: icon crossfade and one short horizontal nudge, then static.
- Count change: 160–220 ms vertical/fade swap in a stable-width grid.
- Outer/thought fold animation: preserve existing measured-height animation and precise selectors.

Under `prefers-reduced-motion: reduce`, disable translations, spins, nudges, and glow animations; keep near-immediate opacity/state changes and all visible labels/icons.

## 6. Compatibility

- Existing turn files without `displayName` render `name` and require no migration.
- Existing remote frontends ignore the additive payload field.
- Existing remote senders without the field continue to parse.
- `loading` and `running` remain distinct on the wire even though the default player UI maps both to “运行中”.
- Existing `output` remains available in SDK/contracts but is intentionally not consumed by this player UI.
- Tool-call order and callId upsert behavior do not change.

## 7. Delivery Boundary

Implement and verify only `apps/play-frontend-dev`. Do not modify `cards/沉浸阅读器.tsian-card/frontend/src`, card `frontend/dist`, `game-card.json`, or packaged artifacts. The user will run the existing development-frontend packaging/upload workflow later, outside this task.

## 8. Verification

Automated checks:

- contract and consumer builds;
- a focused timeline-collector test proving display name survives loading -> success and missing later metadata does not erase it;
- a play-bridge event test proving the optional display name is exposed and absence remains compatible;
- pure frontend presentation tests for name fallback and status mapping if logic is extracted to a helper;
- `git diff --check`.

Browser/product checks:

1. Start a turn that emits several custom Tool calls.
2. Observe count increments without header layout shift.
3. Confirm new rows enter once and update in place to success/failed.
4. Confirm custom titles are labels only and statuses remain generic.
5. Confirm interim text has no nested fold or `storyteller · 过渡` label.
6. Confirm thought still folds independently.
7. Reload history and compare order/name/status/layout with the live result.
8. Repeat with reduced motion enabled.

## 9. Rollback

The change is additive at the protocol layer. Rollback can first revert the UI to `name` + existing layout while leaving `displayName` ignored, then remove the optional field propagation in a later compatible cleanup. No stored data migration or database rollback is required.
