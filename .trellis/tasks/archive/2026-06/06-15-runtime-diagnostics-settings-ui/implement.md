# Runtime Diagnostics And Settings UI Implementation Plan

## Checklist

1. Read platform-web frontend specs before editing.
2. Refresh `SettingsView.vue` into a Control Panel layout:
   - show effective config readiness
   - show per-field local override state
   - mask API key summaries
   - preserve save/reset behavior
3. Replace `DebugView.vue` with a new System Monitor layout:
   - remove the legacy stacked debug-card structure
   - introduce section navigation for overview, diagnostics, history, checkpoints, AI debug, and snapshot
   - fetch and display platform context
   - fetch and display `runtime-diagnostics`
   - convert history, snapshot, checkpoints, and AI debug into scannable summaries
   - keep raw details behind disclosure controls
   - confirm before checkpoint restore
4. Verify remote/packaged bridge still blocks `ai-debug`.
5. Run `npm run build:web`.
6. Smoke in browser:
   - open Control Panel and test save/reset feedback
   - open System Monitor and test refresh
   - verify diagnostics/checkpoint/history sections handle empty and populated states

## Validation Commands

```bash
npm run build:web
```

Optional browser smoke can use the existing dev server at `127.0.0.1:5173` when available.

## Risky Files

- `apps/platform-web/src/views/SettingsView.vue`
- `apps/platform-web/src/views/DebugView.vue`
- `apps/platform-web/src/bridge/remote-iframe-bridge.ts` only if verifying or tightening the debug boundary requires a change.

## Review Gate Before Start

- PRD, design, and implementation plan exist.
- Scope remains limited to platform settings and runtime diagnostics UI.
- No contract migration is planned.
