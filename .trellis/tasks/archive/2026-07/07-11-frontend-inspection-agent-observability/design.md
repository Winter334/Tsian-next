# 前端自检工具 Agent 可行动观测优化 - Design

## 1. Design Goal

`inspect_frontend` 的 Agent-facing 结果应从“原始页面/诊断转储”收敛为“可操作页面状态”。默认返回只保留助手在线编辑游戏前端所需的判断与行动信息：页面状态、可操作目标、动作命中结果、等待过程、真实诊断、最小构建/源码定位摘要。

本设计保持既有调试 session、rollback、same-origin packaged frontend 边界不变，只调整返回结构、过滤策略和 wait/action 语义。

## 2. Contract Shape

### 2.1 Wait mode

扩展 `InspectFrontendInput.wait`：

```ts
type InspectFrontendWaitMode = "runtime-settled" | "dom-stable"
```

- `runtime-settled`：继续表示“动作应触发 bridge-backed runtime/player turn；等待 bridge activity 触发并 quiet 2s”。
- `dom-stable`：用于纯前端 UI 状态切换；等待 microtask/短窗口内结构稳定，不要求 bridge activity。

`timeoutMs` 仍只约束 runtime settled 的长等待；`dom-stable` 使用内部短阈值，避免 Agent 把普通 UI 操作等成长任务。

### 2.2 Result additions

在 `InspectFrontendResult` 增加 model-facing 精简字段：

```ts
interface InspectFrontendWaitSummary {
  mode: "none" | "runtime-settled" | "dom-stable"
  status: "not-requested" | "triggered" | "settled" | "not-triggered" | "timeout" | "not-active"
  waitedMs: number
  activityBefore: number
  activityAfter: number
  triggerTimeoutMs?: number
  settleTimeoutMs?: number
  triggered?: boolean
  settled?: boolean
}

interface InspectFrontendInteractable {
  ref: string
  kind: "button" | "input" | "textarea" | "select" | "link" | "checkbox" | "radio" | "card" | "tab" | "option" | "dialog" | "status" | "generic"
  name?: string
  selector: string
  visible: boolean
  disabled?: boolean
  readonly?: boolean
  checked?: boolean
  selected?: boolean
  expanded?: boolean
}

interface InspectFrontendActionResult {
  step: number
  action: InspectDomAction
  ok: boolean
  matchedCount: number
  target?: {
    tag: string
    role: string
    name?: string
    selector: string
    visible: boolean
    disabled?: boolean
    readonly?: boolean
  }
  effect?: {
    domChanged: boolean
    bridgeTriggered: boolean
  }
  error?: { code: string; message: string; details?: unknown }
}

interface InspectFrontendDiagnosticsSummary {
  errors: number
  consoleErrors: number
  consoleWarnings: number
  resourceFailures: number
  resourceTimingAnomalies: number
  resourceTimingAnomaliesCollapsed?: boolean
}

interface InspectFrontendBuildSummary {
  status: "idle" | "building" | "ok" | "failed"
  lastBuiltAt: string | null
  error?: { message: string; file?: string; line?: number }
}

interface InspectFrontendSourceHint {
  kind: "runtime-error" | "build-error"
  path: string
  line?: number
  confidence: "high"
  message?: string
}
```

Result fields:

```ts
wait?: InspectFrontendWaitSummary
interactables?: InspectFrontendInteractable[]
actions?: InspectFrontendActionResult[]
diagnosticsSummary?: InspectFrontendDiagnosticsSummary
frontendBuild?: InspectFrontendBuildSummary
sourceHints?: InspectFrontendSourceHint[]
```

Compatibility:

- Keep existing `structure`, `diagnostics`, `activity`, `runtime`, `actionSnapshots`, `fileLineMap`, `diff`, `error` for now.
- Existing consumers that read old fields continue to work.
- New fields are additive; no Dexie migration.
- Where old fields are noisy (`diagnostics.resourceFailures`, `structure.computedStyles`), change default content filtering rather than removing the field shape.

## 3. Diagnostics Filtering

### 3.1 Resource failures

Split resource observations into two categories internally:

1. Real resource failures from element `error` events.
2. Resource Timing zero-byte anomalies.

Default Agent-facing behavior:

- `diagnostics.resourceFailures` contains only real resource failures.
- Timing anomalies are counted in `diagnosticsSummary.resourceTimingAnomalies` and optionally represented by a short folded metadata record, not by dozens of CDN URLs.
- If timing anomaly samples are retained, cap to very small N and group by host/reason.

This preserves the diagnostic signal while preventing esm.sh/CDN timing entries from dominating model context.

### 3.2 Console

Keep raw bounded console entries for now, but add `diagnosticsSummary` counts. If time permits, group duplicate warning messages in summary only; do not expand into a new logging subsystem in MVP.

### 3.3 Computed styles

Reduce default `computedStyles` to interaction-relevant selectors only. Root theme variables such as `--void` should not be emitted by default. If a future layout/hit-test failure needs style details, include target-specific display/visibility/pointer-events/opacity in action failure details instead of full style snapshots.

## 4. Interactables / Selector Map

Build interactables from the current iframe document alongside `collectInspectStructure`.

Default inclusion rules:

- Native controls: `button`, `input`, `textarea`, `select`, `option`, `a[href]`.
- ARIA controls: role `button`, `link`, `checkbox`, `radio`, `tab`, `option`, `menuitem`, `combobox`, `textbox`, `dialog`, `status`, `alert`.
- Semantically marked nodes: elements with meaningful `aria-label`, `data-testid`, `data-test`, `data-action`, `data-role`.
- Clickable generic/card nodes: element has click handler evidence, `tabindex`, button-like cursor, or class names such as `card`, `method-card`, `option-card`, while visible and carrying short text.

Filtering:

- Exclude hidden/aria-hidden/display-none/visibility-hidden nodes.
- Exclude pure layout wrappers without text, semantics, or interactivity.
- Cap result count with deterministic document order and include omitted count only if needed.

Selector generation priority:

1. `#id` when unique.
2. Stable data attribute selector when present.
3. ARIA/name-friendly selector only if currently supported by the internal action runner; otherwise return CSS selector.
4. Short CSS path using class/id/nth-of-type as fallback.

MVP actions continue accepting `selector`; `ref` is an output anchor only. Adding ref-based actions can be a future compatibility decision.

## 5. Action Execution Summary

Change `runInspectDomActions` from “optional snapshots only” to “always produce execution summaries”. Each step:

1. Query selector and count matches.
2. Capture target summary before action.
3. Run existing autoWait/action logic.
4. Capture per-step DOM signature before/after for `domChanged`.
5. Compare bridge `activitySequence` before/after for `bridgeTriggered`.
6. Return `InspectFrontendActionResult`.

Failure handling:

- If a step fails, include the failed step summary/error and stop subsequent actions.
- Preserve summaries in `buildFailureResult` when wait fails after actions have succeeded.
- Existing `actionSnapshots` can remain for `observeBetween`, but new `actions` field becomes the primary model-facing action evidence.

## 6. Wait Semantics

### 6.1 Runtime settled

Replace throwing `INSPECT_RUNTIME_NOT_TRIGGERED` as the only observable outcome with a wait summary:

- If actions ran and no bridge activity triggers within `RUNTIME_TRIGGER_TIMEOUT_MS`, return `wait.status = "not-triggered"`, `triggered = false`, `waitedMs ≈ 5000`, and keep action/DOM evidence.
- If DOM changed and bridge did not trigger, top-level `ok` should remain true unless there was an actual action/inspect failure. This state is expected for pure frontend UI operations.
- If no actions and no active chain, preserve an explicit failure or `wait.status = "not-active"`; this is a misuse of runtime wait with no ongoing runtime.
- If bridge triggers, wait for `waitForRuntimeSettled` as today and map result to `settled` / `settled-with-failures` / `timeout` while recording waited time and activity sequence deltas.

### 6.2 DOM stable

Implement a small `waitForDomStable` helper:

- Wait at least one microtick/paint-equivalent window.
- Poll a compact structure signature (`domSummary` + `renderedText` length/hash) until unchanged for a short stability window, or until a small timeout.
- Return `wait.status = "settled" | "timeout"` and `waitedMs`.
- Do not require bridge activity.

This mode serves Vue state switches, form fill effects, accordion/tab changes, and other non-runtime UI operations.

## 7. frontendBuild / sourceHints

### 7.1 frontendBuild

Use existing `getFrontendBuildStatus(cardId)` / `readFrontendBuildStatus(cardId)` data. Include a compact snapshot in every inspect/finish result when `cardId` is known.

No new persistence or build tracking is required.

### 7.2 sourceHints

MVP source hints are high-confidence only:

- Runtime error hints derived from existing `fileLineMap`.
- Build error hints derived from `frontendBuild.error.file` / `line`.

Do not implement visible-text/class source search in this task. That feature needs separate filtering and confidence rules to avoid replacing DOM noise with source-search noise.

## 8. AI-Facing Tool Schema / Docs

Update:

- `tool-schemas.ts` for `wait` enum and descriptions.
- `workspace-tools.ts` input normalization for `dom-stable` and timeout validation.
- `local-assistant-files.ts` embedded assistant workflow instructions.
- `docs/active/assistant-frontend-inspection-direction.md` with filtered-output, wait telemetry, interactables, and build/source hint behavior.

Apply the AI-facing content rule: descriptions should tell the Agent which mode to use, not expose internal timing mechanics beyond what helps decision-making.

## 9. Validation / Rollback

Validation:

- `npm run build:contracts` if shared types change.
- `npm run build:web` for platform-web changes.
- Manual/targeted inspection through type-level review if no automated tests exist.

Rollback:

- New result fields are additive; rollback can remove population logic while keeping old fields.
- Diagnostics filtering is the only behavior change that could hide information; keep timing anomaly counts to preserve observability without raw spam.
