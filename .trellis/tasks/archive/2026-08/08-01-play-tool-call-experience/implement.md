# 游戏前端工具调用体验优化 — Implementation Plan

## Step 0. Baseline and overlap check

- [ ] Record `git status --short` and preserve unrelated Trellis/Spatial task changes.
- [ ] Check whether parallel work touched any task-owned files before editing.
- [ ] Run baseline builds relevant to the current tree:

```powershell
npm run build:contracts
npm run build --workspace @tsian/play-bridge
npm run build:web
npm run build --workspace play-frontend-dev
```

- [ ] If a baseline failure exists, record it with command output and separate it from task regressions.

## Step 1. Add the optional display-name contract

- [ ] Add `displayName?: string` to the tool branches of `TurnTimelineItem`, `AgentInvocationEvent`, and `RemotePlayBridgeEventPayload`.
- [ ] Add `displayName?: string` to play-bridge `ToolEvent`; parse only non-empty strings and preserve absence.
- [ ] Update `docs/sdk/play-frontend-api.md` with opaque-label and fallback semantics.
- [ ] Add/extend a focused play-bridge event test for present and absent display names.
- [ ] Run:

```powershell
npm run build:contracts
npm run build --workspace @tsian/play-bridge
```

Rollback point: revert the additive field and SDK parser/doc changes before runtime work begins.

## Step 2. Thread display name through runtime, history, and bridge

- [ ] Resolve a visible custom Tool once in `workspace-tools/tool-execution.ts`; use `tool.title` as optional `displayName` and reuse the same entry for execution.
- [ ] Append `displayName?` to `onTool` callback signatures in workspace-tool execution context and Agent Runtime turn types.
- [ ] Thread it through native/text loop bindings and both Agent Runtime collected-timeline paths.
- [ ] Extend `createTurnTimelineCollector().onTool` to persist/update the field without clearing an existing value when a later event omits it.
- [ ] Thread it through formal player turns, streaming event listeners, remote iframe payloads, and `AgentInvocationEvent` emission.
- [ ] Add focused tests for collector upsert/persistence and remote bridge forwarding where the existing test harness permits.
- [ ] Run focused tests plus:

```powershell
npm run build:web
```

Rollback point: remove runtime propagation while keeping the optional contract harmlessly unused.

## Step 3. Preserve the field in frontend live/history state

- [ ] Extend default-frontend `StreamItem` tool nodes with optional `displayName`.
- [ ] On live `onTool`, fill/update the display name without clearing it on omission.
- [ ] On history reload, carry optional display name from `TurnTimelineItem`.
- [ ] Verify live and history nodes produce identical presentation input.

## Step 4. Flatten process rendering and add animations

- [ ] Remove `tool-group` from `ProcessNodeData` and delete `TOOL_LABEL` / generated-sentence logic.
- [ ] Update `StoryView.vue` to collect process nodes without contiguous-tool grouping.
- [ ] Render interim nodes as plain text with no inner fold, header, agent id, or “过渡” label.
- [ ] Keep thought nodes independently collapsible and remove agent id from the visible thought header.
- [ ] Render each tool as a direct row using `displayName ?? name` and the fixed status mapping.
- [ ] Add accessible state icons, visible labels, row-entry/status/count transitions, and reduced-motion overrides.
- [ ] Change `RoundProcess.vue` summary to tool count only and add stable-width keyed digit animation.
- [ ] Confirm no file under `cards/沉浸阅读器.tsian-card/frontend/**` or `game-card.json` changed.

## Step 5. Build and product verification

- [ ] Run:

```powershell
npm run build:contracts
npm run build --workspace @tsian/play-bridge
npm run build:web
npm run build --workspace play-frontend-dev
npx vitest run <focused-test-files>
git diff --check
```

- [ ] In the remote dev frontend, verify multi-tool live count, row insertion, running -> success/failed transitions, no generated tool sentences, direct interim text, and retained thought fold.
- [ ] Reload the same session and verify history parity.
- [ ] Verify `prefers-reduced-motion` behavior.
- [ ] Inspect Console and Network for runtime errors and missing packaged assets.

## Step 6. Review gate

- [ ] Dispatch `trellis-check` with the active task path and curated check context.
- [ ] Address findings and rerun affected checks.
- [ ] Run `trellis-update-spec` if the additive `displayName` tool-event convention is reusable project knowledge.
- [ ] Present the completed diff and verification evidence before commit.

## Risky Files / Coordination Points

- `packages/contracts/src/runtime.ts` and `packages/contracts/src/bridge.ts`: broad consumer impact; keep field optional.
- `apps/platform-web/src/agent-runtime/index.ts`: duplicate native/text collection paths must remain consistent.
- `apps/platform-web/src/platform-host/runtime-turn.ts` and `turn-timeline-collector.ts`: live/history parity boundary.
- `apps/platform-web/src/bridge/remote-iframe-bridge.ts` and `packages/play-bridge/src/tsian-api.ts`: remote payload boundary.
- `apps/play-frontend-dev`: this task's only frontend source target; card source/dist are explicitly out of scope.
