# Remote Iframe Frontend Bridge Implementation Plan

## Checklist

1. Add shared remote bridge protocol contract types:
   - request/response/event envelopes;
   - method name union;
   - bridge error shape.
2. Add platform-web remote iframe bridge adapter:
   - validates remote frontend URLs;
   - creates a per-mount session id;
   - listens for `message` events;
   - filters by iframe `contentWindow` and session id;
   - dispatches allowed methods to `playFrontendBridge`;
   - blocks `query.query` access to `ai-debug`;
   - emits `turn-completed` after `interaction.sendMessage`.
3. Update `PlayView`:
   - wait for platform host readiness;
   - resolve active game card frontend binding;
   - mount built-in `official-default` for built-in binding;
   - mount remote iframe for remote binding;
   - show loading/error states.
4. Update platform-host context if needed so `getPlatformContext()` reflects the active frontend binding better than the current hardcoded `official-default`.
5. Update docs/specs:
   - remote iframe uses postMessage RPC;
   - sandbox is compatibility-first and includes `allow-same-origin`;
   - remote bridge does not expose raw AI debug records;
   - workspace writes/deletes are immediate platform actions.
6. Validate:
   - `npm run build:contracts`;
   - `npm run build:runtime-core`;
   - `npm run build:web`;
   - `python3 ./.trellis/scripts/task.py validate 06-14-remote-iframe-frontend-bridge`;
   - `python3 ./.trellis/scripts/task.py validate 06-14-remote-game-frontend-foundation`;
   - `git diff --check`.

## Risky Files / Rollback Points

- `packages/contracts/src/bridge.ts` or a new bridge contract file: cross-package protocol type changes.
- `apps/platform-web/src/views/PlayView.vue`: current play route must preserve built-in fallback.
- `apps/platform-web/src/bridge/`: remote bridge adapter should reuse `playFrontendBridge` and avoid storage/runtime duplication.
- `apps/platform-web/src/platform-host/index.ts`: only adjust active frontend context if necessary.

Rollback should leave game-card storage intact and restore `PlayView` to always mounting `official-default`.
