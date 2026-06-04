# Type Safety

Frontend code should treat `RuntimeEngine` as a narrow protocol, not as the platform host.

## RuntimeEngine Contract

`RuntimeEngine` currently exposes:

- `getSnapshot(): Promise<RuntimeSnapshotShell>`
- `sendMessage(input: MessageInteractionRequest): Promise<MessageInteractionResult>`
- `query<T = unknown>(request: DeepQueryRequest): Promise<DeepQueryResult<T>>`
- `getPlatformContext(): Promise<PlatformContextShell>`

The concrete browser implementation is `LocalRuntimeEngine` in `apps/platform-web/src/runtime-host/engine.ts`.

## Consumer Rules

- Import the interface from `@tsian/runtime-core`, not from platform-web.
- Keep bridge implementations typed against `RuntimeEngine` when they only need core runtime methods. `createPlayFrontendBridge` is the reference.
- Use `@tsian/contracts` for payload shapes. Do not create parallel frontend-only versions of snapshots or query results.
- Treat deprecated or platform-host-owned paths as implementation details. In the current browser runtime, `sendMessage` throws because `platform-host` runs workflow execution directly.

## Avoid

- Do not assume `RuntimeEngine` implies Dexie persistence, local AI config, or workflow execution.
- Do not downcast `RuntimeEngine` to `LocalRuntimeEngine` in shared bridge code.
- Do not leak Vue state into this interface.
