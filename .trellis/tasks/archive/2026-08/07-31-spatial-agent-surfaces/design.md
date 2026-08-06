# Spatial Agent 工作界面 — Technical Design

## 1. Delivery stages and boundaries

The task is delivered in two gated stages:

1. **RetroOS baseline correction**: fix `ask_user` default semantics and replace fragmented Tool groups with one ordered process fold. Run focused tests and obtain browser acceptance before changing Spatial readiness.
2. **Shared orchestration + Spatial presentation**: extract view-neutral Studio/Assistant controllers, build independent Spatial Studio and Assistant views, then register them as ready.

The first stage changes shared behavior intentionally; the second stage must reuse it. Neither stage enables the production Spatial release gate.

## 2. `ask_user` request contract

### 2.1 Normalization

Keep `AskUserRequest.allowCustom?: boolean` optional at the public contracts/bridge boundary for compatibility with existing callers. At the Agent Tool producer boundary, `normalizeAskUserArguments` returns an explicit value:

```ts
const request: AskUserRequest = {
  question,
  allowCustom: input.allowCustom === undefined ? true : validatedAllowCustom,
}
```

Explicit `false` remains authoritative. Options stay optional and may coexist with custom input.

When `subscribeInteractionRequest` creates `ActiveAskState`, normalize defensively with `allowCustom: allowCustom !== false`. This protects the in-process assistant against older/non-Agent emitters while preserving the shared producer as the primary source of truth. Make the local active-state field required so `AssistantAskPanel` always receives an explicit boolean.

### 2.2 Lifecycle

The active ask surface remains in the composer/footer. It replaces the ordinary composer, focuses the custom input when available, rejects blank custom answers, and resolves answer/cancel through the existing interaction request table. Only after resolution does the timeline receive a read-only ask record.

No interactive ask card is added to the scrollable timeline.

## 3. Ordered Assistant process presentation

### 3.1 Data preservation

Extend the local `AssistantTimelineNode` Tool variant with optional `displayName`. Update `useAssistantTimeline.onTool` to accept the existing callback argument order `(presentation?, displayName?)` and obey stable upsert rules:

- loading and terminal updates share one call id;
- a later defined display name may fill an earlier omission;
- a later omission must not erase an existing display name;
- presentation follows the same non-erasing update rule.

Update assistant message mappers in both directions so persisted Tool nodes retain `displayName`. Old history without the field renders with `name` and requires no migration.

### 3.2 Pure summary helper

Add a small view-neutral helper under the assistant feature that derives from one message timeline:

- `toolCount`;
- aggregate status: running when any call is loading/running, failed when any terminal call failed and none are running, success when all calls succeeded, idle when there are no Tool calls;
- visible Tool label: `displayName ?? name`;
- stable Chinese status label: `运行中 | 成功 | 失败`.

The helper must not generate action sentences or inspect Tool arguments/results.

### 3.3 RetroOS renderer

Replace adjacent Tool grouping in `AssistantMessageList.vue` with one `Collapsible` per assistant message when it has process nodes:

- default closed;
- header label “执行过程”, Tool count, aggregate status, and chevron;
- body iterates the original timeline without reordering or merging;
- interim text stays readable inside the process body;
- thought remains a nested collapsible;
- each Tool is one row with identity and state in separate columns;
- read-only ask records remain recognizable Q&A blocks;
- `agent_call` retains its bounded target/response/error detail beneath its Tool row.

Outer fold state is ephemeral UI state on `ChatMessage` and defaults closed on live creation and history load. Existing per-node `collapsed` fields remain for nested thought/ask compatibility and persisted history; they are not repurposed as the outer fold state.

Use height/opacity fold animation, short enter/status transitions, fixed status geometry, and an explicit `prefers-reduced-motion` override. Status text and `aria-live` carry meaning without relying on color or motion.

## 4. Shared Studio and Assistant orchestration

### 4.1 Assistant controller

After RetroOS acceptance, move view-neutral orchestration from `AssistantView.vue` into a controller/composable owned under `controllers/assistant/`:

- session list/create/select/rename/delete;
- active and background turn registry;
- provider/model selection and context usage;
- conversation loading/persistence mapping;
- streaming callbacks, stop/abort, error states;
- attachment add/remove/cleanup;
- ask request routing by session and answer/cancel actions;
- shared process summary/state contracts.

DOM refs, scroll positioning, focus, drag/drop hit areas, and visual drawer state remain in each presentation. Existing focused composables (`useAssistantTimeline`, `useAssistantComposer`, `useAssistantScroll`) remain separate and are composed by the controller/view according to their current responsibility.

### 4.2 Studio controller

Extract a view-neutral Studio controller under `controllers/studio/` for:

- Agent registry and selection;
- Agent/Skill/config file load, validation and mutation;
- provider/model and platform Tool controls;
- file preview and workspace navigation commands;
- refresh subscriptions and mutation feedback.

RetroOS `StudioView.vue` must remain behaviorally unchanged while consuming this controller. Spatial Studio consumes the same controller and must not duplicate registry/storage mutations.

## 5. Spatial presentations

Create independent views under:

- `spatial/apps/studio/SpatialStudioView.vue`;
- `spatial/apps/assistant/SpatialAssistantView.vue`;
- focused Spatial leaf components under the same feature directories where useful.

Both import shared controllers and domain helpers, `spatial-apps.css`, and existing Spatial primitives. They must not mount or wrap `StudioView.vue`, `AssistantView.vue`, or RetroOS-styled leaf components.

### Spatial Studio

- Agent list/selection and current-card identity;
- Agent instruction/config/Skill file previews and edits;
- provider/model and platform Tool controls;
- workspace navigation and mutation feedback;
- keyboard access and responsive container layout.

### Spatial Assistant

- session navigation and management;
- provider/model header and context status;
- ordered message stream using the same one-fold process model;
- streaming, stop, attachments, copy/edit-resend, jump-to-bottom;
- composer deformation for `ask_user` with options/custom/cancel;
- config surface and persisted scroll per session.

Spatial source capture must continue to see stable mounted DOM while windows are focused, side-positioned, occluded, or minimized. Minimize/focus must not abort turns or interaction requests; only close/unmount may perform controller cleanup.

## 6. Registry and readiness

Add lazy imports and pass Spatial components to the existing `presentation(...)` registrations for `studio` and `assistant` only after each view passes its parity checks. Until then both remain `pending`; no temporary RetroOS embedding or fallback is allowed inside Spatial windows.

## 7. Compatibility and persistence

- No migration scan or backfill. Old Tool history without `displayName` falls back to `name`; old ask records remain readable.
- Conversation persistence remains prose, attachments, and presentation-only timeline nodes. Raw Tool arguments/results never enter storage.
- Existing Agent observation work stays independent; this task consumes only the closed UI event/presentation contract.
- Game frontend rendering is not changed. Shared `ask_user` default normalization intentionally makes omitted `allowCustom` mean `true` for all new Agent Tool requests, matching the existing schema.

## 8. Verification and rollback

Verification layers:

1. focused Tool normalization, timeline/helper, mapper, and controller tests;
2. RetroOS component/browser checks for ask and process behavior;
3. Spatial component/controller tests and projected-input browser checks;
4. contracts, full platform-web tests/build, RetroOS regression, and Spatial long-running behavior.

Rollback points:

- Ask normalization is isolated and can revert without touching presentation.
- Retro process renderer can revert while retaining `displayName` data preservation.
- Controller extraction must land behavior-preserving before Spatial registry readiness changes.
- Removing the Spatial components from the two registry entries restores `pending` without affecting RetroOS.
