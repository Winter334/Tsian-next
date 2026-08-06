# Current Assistant and Spatial Boundaries

## 1. `ask_user` default mismatch

- `apps/platform-web/src/agent-runtime/tool-schemas.ts:79-102` declares `allowCustom` and documents “Defaults to true”.
- `apps/platform-web/src/agent-runtime/workspace-tools/tool-execution.ts:144-181` builds `{ question }` and only copies `allowCustom` when the model supplied it, so omission remains `undefined`.
- `apps/platform-web/src/views/assistant/AssistantAskPanel.vue:20-21` renders custom input only when `activeAsk.allowCustom` is truthy. The documented default therefore disappears before the UI.
- The durable `AskUserRequest` wire type is optional in `packages/contracts/src/runtime.ts`; retaining that optional field avoids migration pressure for bridge callers, while the Agent-facing normalizer can still produce an explicit boolean for new requests.

Conclusion: fix the default once in `normalizeAskUserArguments`; keep explicit `false`, and add a local defensive normalization when converting interaction events into active assistant state.

## 2. Current RetroOS process display

- `apps/platform-web/src/views/assistant/AssistantMessageList.vue:22,81-127` groups each adjacent Tool run into a separate collapsible.
- `AssistantMessageList.vue:261-341` maps tool names to generated sentence fragments and merges same-name calls into one summary.
- This hides original one-call identity at the summary level and conflicts with the current contract that identity and state stay separate.
- `apps/platform-web/src/composables/useAssistantTimeline.ts` keeps occurrence order and call-id upserts, but its local Tool node omits `displayName` even though `assistant-chat.ts` and runtime callbacks already supply it.
- `apps/platform-web/src/views/assistant-message-mappers.ts` also omits `displayName` while mapping stored/live Tool timeline nodes.

Conclusion: the runtime/storage contract already has the data needed. The UI layer needs to preserve `displayName`, remove generated tool sentences, and render one outer process fold with direct ordered rows.

## 3. Game frontend reference

- `apps/play-frontend-dev/src/components/story/RoundProcess.vue:6-40` owns one outer process fold and reports Tool count.
- `apps/play-frontend-dev/src/components/story/StoryView.vue:245-250` explicitly keeps original timeline order and avoids Tool merging or semantic sentence generation.
- `apps/play-frontend-dev/src/components/story/ProcessNode.vue:80-115,198-337` renders one Tool per row, separates identity from running/success/failure state, animates state changes, and disables motion under `prefers-reduced-motion`.

Conclusion: reuse this information architecture and behavior, not the game frontend’s ember visual theme.

## 4. Contract constraints

- `.trellis/spec/contracts/frontend/type-safety.md:69-95` requires `displayName ?? name`, separate status labels, stable call-id upserts, and no generated Tool sentences.
- `.trellis/spec/platform-web/frontend/type-safety.md:875-884` separates Agent observations from the closed UI presentation. Ordinary Tool arguments/results must never enter the timeline or session persistence; only declared `UiToolPresentation` variants may carry player-facing content.
- The active desktop `ask_user` surface must remain in the footer/composer and be the only input region. A read-only ask node enters the timeline only after answer/cancel.
- `.trellis/spec/platform-web/frontend/state-management.md:335-336` requires ordered timeline retention, pinned-scroll behavior, abort-safe partial output, and persistence from runtime-collected process records.

## 5. Spatial integration boundary

- `apps/platform-web/src/platform-apps.ts:117-131,192-204` registers RetroOS Studio/Assistant but has no Spatial components for either, so both remain `readiness: "pending"`.
- Completed Spatial apps live under `apps/platform-web/src/spatial/apps/`, import shared controllers, and use `spatial-apps.css` plus Spatial primitives instead of wrapping RetroOS views.
- Existing Assistant logic is partly separated into `useAssistantTimeline`, `useAssistantComposer`, `useAssistantScroll`, storage mappers, host APIs, and leaf components, but session/turn orchestration still lives in `AssistantView.vue`.
- Studio remains a RetroOS route view and needs a view-neutral controller seam before a separate Spatial presentation can use the same mutations and registry state.

Conclusion: first lock the RetroOS baseline with focused tests, then extract only view-neutral orchestration into controllers; implement independent Spatial presentations and register them only when parity checks pass.

## 6. Missing focused coverage

- No focused component/unit test currently locks the documented `allowCustom` default through Tool normalization to assistant state.
- No focused test locks the Desktop Assistant’s Tool order, `displayName` preservation, aggregate status, or one-fold behavior.

The implementation should add pure helper/composable tests and targeted component tests before broad build/browser verification.
