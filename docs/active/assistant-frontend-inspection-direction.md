# Tsian Assistant Frontend Inspection Direction

## 1. Purpose

`inspect_frontend` lets the desktop assistant inspect and operate the packaged
frontend that the player is currently seeing in `/play`. The inspected document,
bridge traffic, save, and runtime state are the real player scene.

The player prepares the scene by opening the intended save in Play. The tool does
not open Play, select a save, or cross the launcher on the player's behalf.

## 2. Core Model

The Play view owns the iframe. It registers a read-only mount handle containing:

- the current iframe and monotonic generation;
- packaged/remote kind, game card id, and entry;
- bridge readiness, in-flight request count, and last activity time;
- status and bridge activity subscriptions.

The inspector borrows this handle. It never removes or disposes the Play iframe,
never locates it through desktop DOM selectors, and never stores a bridge
session id.

Only a ready same-origin packaged frontend is supported. A remote frontend,
launcher state, closed Play window, active rebuild, or replacement frame fails
clearly and asks the assistant to retry after the real scene is ready.

## 3. Debug Session

The first `operation: "inspect"` starts one platform-wide frontend debug
session. It requires the active save, card, Play target, and bridge to agree and
be quiet.

The baseline is the exact canonical checkpoint at the save's current turn:

- turn greater than zero: newest `post-turn-maintenance`, otherwise newest
  `after-turn`;
- turn zero: newest `manual`, otherwise `initial`;
- no checkpoint at the current turn means inspection cannot start.

The persisted marker records the save id, card id, exact checkpoint id, baseline
turn, and start time. It survives page reloads, Play closure, and assistant
conversation changes. Ordinary pruning and same-turn checkpoint replacement
must preserve its exact checkpoint.

Every result exposes:

```ts
debugSession: {
  active: boolean
  saveId: string
  baselineCheckpointId: string
  baselineTurn: number
  startedAt: number
  rollbackScope: "save-runtime"
}
```

The rollback scope deliberately excludes card content, frontend source, and
built frontend artifacts.

## 4. Inspection And Actions

The tool returns an accessibility-oriented DOM summary, selected computed
styles, visible text, bridge state, runtime errors, console output, resource
failures, source hints, and a diff from the previous inspection of the same
iframe generation.

Actions operate the current iframe document:

- `click`
- `fill` and `type`
- `press`
- `scroll`
- `selectOption`
- `check`
- `hover`
- `focus`

Events and realm checks use the iframe's own window. `observeBetween` captures a
structural snapshot after each action. A source rebuild replaces the iframe;
the next inspection takes the new generation and resets diagnostics, activity,
and diff state.

Player turns must be triggered through the frontend's own controls. The
inspector does not call the play bridge interaction API directly.

## 5. Runtime Settling

`wait: "runtime-settled"` waits for the real UI-triggered run:

1. With actions, at least one new `interaction.sendMessage` request must be
   observed shortly after those actions.
2. From that request onward, every bridge RPC contributes to the same activity
   window.
3. The window settles only after in-flight requests reach zero and no new RPC
   appears for two continuous seconds.

Without actions, the wait continues an already observed active chain. If no
chain exists, the tool returns `INSPECT_RUNTIME_NOT_ACTIVE`. A timeout stops only
the inspector wait; it does not cancel the real bridge request.

Activity contains metadata only:

```ts
activity: Array<{
  sequence: number
  requestId: string
  method: RemotePlayBridgeMethod
  phase: "started" | "completed" | "failed"
  relativeMs: number
  error?: { code: string; message: string }
}>
```

Request parameters, results, story text, and workspace content never enter this
activity log.

## 6. Finish And Restore

The assistant must call `operation: "finish"` after verification.

Finish requires the original save and its ready packaged Play target. It refuses
to restore while bridge requests are in flight or the two-second quiet window
has not elapsed.

On success it:

1. restores the exact baseline checkpoint;
2. removes later turns, traces, and future checkpoints, including later
   checkpoints on the same turn;
3. clears the persisted debug marker;
4. asks Play to mount a fresh iframe;
5. waits up to ten seconds for the new generation and captures one final
   structure and diagnostics snapshot.

Frontend source and build output remain because they are card-owned rather than
save-runtime data. If remounting does not become ready, the result reports
`restored: true` and `reloadReady: false`; the marker remains cleared because
the runtime restore already succeeded.

## 7. Tool Shape

```ts
inspect_frontend({
  operation?: "inspect" | "finish"
  actions?: InspectDomAction[]
  observeBetween?: boolean
  autoWait?: boolean
  wait?: "runtime-settled"
  timeoutMs?: number
})
```

Examples:

```json
{
  "actions": [
    { "type": "fill", "selector": "#message", "text": "测试输入" },
    { "type": "click", "selector": "#send" }
  ],
  "observeBetween": true,
  "wait": "runtime-settled"
}
```

```json
{ "operation": "finish" }
```

## 8. Assistant Workflow

1. Ask the player to open the intended packaged frontend and save in Play.
2. Call `inspect_frontend` once to establish the baseline and read the scene.
3. Reproduce through DOM actions and the frontend's real controls.
4. Read structure, diagnostics, activity, runtime state, and source hints.
5. Edit `frontend/src/**`, then wait for the platform rebuild and Play remount.
6. Inspect the new generation and verify the diff and diagnostics.
7. Call `operation: "finish"` to restore save-runtime.

## 9. Boundaries

- Cross-origin remote frontend inspection is unsupported.
- The tool does not drive the launcher or select saves.
- Rollback does not cover browser storage, network side effects, or external
  services owned by the frontend.
- Canvas-only content has limited structural visibility.
- The debug flow assumes the assistant has exclusive control of Play while
  reproducing and verifying.

## 10. Review Checklist

1. Is the target the iframe currently owned by Play?
2. Are all player turns triggered through real frontend controls?
3. Does activity contain metadata only?
4. Does generation replacement dispose old listeners and reset accumulated
   state?
5. Is the exact baseline protected until finish?
6. Does finish restore save-runtime while preserving frontend source?
7. Do schema, prompts, permissions, and docs teach only this model?
