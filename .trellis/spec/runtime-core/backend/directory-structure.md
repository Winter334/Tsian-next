# Directory Structure

`runtime-core` intentionally has only two source files:

- `src/engine.ts` defines the `RuntimeEngine` interface.
- `src/index.ts` re-exports `./engine`.

## Ownership

- Keep runtime implementation out of this package. `LocalRuntimeEngine` belongs in `apps/platform-web/src/runtime-host/engine.ts` because it depends on browser/platform behavior.
- Keep data shapes in `@tsian/contracts`. `RuntimeEngine` imports `RuntimeSnapshotShell`, `MessageInteractionRequest`, `DeepQueryRequest`, and related result types from contracts.
- Add methods here only when every runtime implementation should support them.

## Avoid

- Do not add storage, AI client, bridge, workflow, or platform-host logic here.
- Do not add package dependencies beyond `@tsian/contracts` unless there is a strong cross-runtime reason.
- Do not expose browser-only concepts such as Dexie, localStorage, Vue refs, or AbortController-specific implementation details in the interface unless the runtime contract truly requires them.
