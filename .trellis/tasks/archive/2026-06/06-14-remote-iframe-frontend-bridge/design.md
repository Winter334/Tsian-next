# Remote Iframe Frontend Bridge Design

## Architecture And Boundaries

This child turns the current in-process `PlayFrontendBridge` into a bridge that can also serve a remote iframe. The platform remains the owner of model keys, IndexedDB, save/checkpoint lifecycle, platform-host objects, and runtime execution. The remote game frontend only talks to the platform through typed `postMessage` RPC.

The first implementation should preserve the existing built-in `official-default` path. If the active game card frontend binding is `builtin`, `PlayView` mounts the current built-in frontend. If the binding is `remote`, `PlayView` mounts a sandboxed iframe and connects it to a remote bridge adapter.

Remote code must never run in the platform's JS realm. The iframe bridge adapts to the existing `playFrontendBridge`; it should not duplicate storage/runtime logic.

## Active Frontend Resolution

`PlayView` should ask platform-host for the active game card. The active card is already available through `getPlatformActiveGameCard()`.

Resolution rules:

- no active card -> built-in `official-default` fallback;
- `frontend.kind === "builtin"` -> mount built-in frontend by id when supported, otherwise show an error;
- `frontend.kind === "remote"` -> validate URL, create iframe, start remote bridge session;
- remote URL validation rejects obviously dangerous schemes such as `javascript:`, `data:`, and `vbscript:`;
- remote URL validation accepts common browser-loadable web URLs: `http:`, `https:`, and relative URLs that resolve to those schemes. Local dev URLs are covered by `http://localhost`, `http://127.0.0.1`, and similar browser-loadable HTTP(S) origins.

## Iframe Sandbox

The first sandbox is compatibility-first per user decision:

```text
allow-scripts allow-same-origin allow-forms
```

Do not add `allow-top-navigation` in the first slice. If future frontends need popups, downloads, presentation, or top navigation, add them as explicit bridge/UI/product decisions rather than silently expanding permissions.

`allow-same-origin` means the iframe keeps its real origin. The boundary therefore depends on:

- no same-realm execution;
- only `postMessage` bridge capabilities;
- source window filtering;
- per-mount session id filtering;
- remote bridge not exposing `debug` or platform internals.

## RPC Protocol

Add shared contract types for a minimal remote play bridge protocol.

Message envelope:

- `channel: "tsian.play-bridge.v1"`;
- `sessionId`;
- `id` for request/response correlation;
- `kind: "hello" | "ready" | "request" | "response" | "event"`;
- request `method` names mirror the safe parts of `PlayFrontendBridge`:
  - `runtime.getRuntimeSnapshot`;
  - `interaction.sendMessage`;
  - `query.query`;
  - `platform.getPlatformContext`;
  - `platform.runAction`;
- no `debug` namespace in the remote bridge.

Handshake:

1. Platform creates a unique bridge session id for this iframe mount.
2. Remote frontend sends `hello` with the expected channel/version.
3. Platform accepts the hello only when `event.source === iframe.contentWindow`.
4. Platform responds with `ready`, session id, and supported method names.
5. Subsequent requests must match both source window and session id.

Responses should be serializable and explicit:

- successful bridge calls return `{ ok: true, result }`;
- failed calls return `{ ok: false, error: { code, message, details? } }`;
- bridge-level failures should not throw across `postMessage`.

Events:

- after `interaction.sendMessage`, emit a compact `turn-completed` event with the resulting snapshot;
- when platform debug emits turn-ready, remote bridge may emit `turn-debug-ready` as a notification without exposing debug records.

## Allowed Methods

The remote adapter delegates to the existing `playFrontendBridge`, with one important restriction: `query.query` must reject or hide raw AI debug resource access. A remote frontend should not be able to call `query.query({ resource: "ai-debug" })` through the default remote bridge.

Workspace reads/lists/searches continue to use existing platform-host query behavior. Ordinary workspace methods already hide or reject `.tsian/*`.

Workspace writes/deletes continue to use existing immediate `platform.runAction({ action: "workspace-write" | "workspace-delete" })` behavior. They are intentionally outside Agent Runtime staged transactions.

Checkpoint restore continues to use existing `platform.runAction({ action: "restore-checkpoint" })`.

## UI States

`PlayView` should show compact full-viewport states:

- resolving active frontend;
- remote iframe loading;
- rejected/unsupported URL;
- unsupported built-in frontend id;
- iframe load failure.

These UI states must not mutate save data.

## Compatibility And Rollback

The built-in blank game card uses `official-default`, so current contentless play remains unchanged unless a remote card is selected/created manually.

Rollback can remove the remote iframe loader and make `PlayView` always mount `official-default` again. The game card storage model can remain; only remote binding execution is disabled.
