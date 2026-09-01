# Research: Frontend Action Runtime

## Existing reusable surfaces

- `packages/contracts/src/bridge.ts` owns remote play bridge request/result/event types.
- `packages/play-bridge/src/tsian-api.ts`, `bridge.ts`, and `index.ts` expose the semantic frontend SDK and transport.
- `apps/platform-web/src/bridge/remote-iframe-bridge.ts` owns iframe RPC dispatch/session lifecycle.
- `apps/platform-web/src/platform-host/index.ts` composes host services.
- `apps/platform-web/src/platform-host/platform-actions.ts` owns the existing closed `platform.runAction` dispatcher.
- `apps/platform-web/src/platform-host/browser-skill-script-executor.ts` already executes browser-script Skill/Tool code in a Worker with timeout/abort and helper loading.
- `apps/platform-web/src/storage/workspace.ts` provides `createRuntimeWorkspaceTransaction`; current transaction deltas contain writes/deletes only.
- `apps/platform-web/src/storage/saves.ts` provides path-delta commit without CAS and optional-checkpoint whole-workspace signature commit. Neither matches Action requirements.
- `apps/platform-web/src/lib/workspace-events.ts` is authoring-oriented; play frontend currently also has a payload-less stale bus.

## Gaps

1. There is no Frontend Action registry or card namespace RPC.
2. Existing Skill Action schema validation in `agent-runtime/workspace-tools/action-executors.ts` is shallow: root/immediate required and types only.
3. Existing permissive Worker output normalization is not strict JSON validation.
4. Runtime transactions do not record reads.
5. Existing commits either have no optimistic protection or conflict on unrelated Workspace changes.
6. Remote generic `platform.runAction` workspace branches use local-assistant actor resolution, creating caller/permission confusion.
7. `platform-web` has no test script or fake IndexedDB harness.

## Validation decision

Use Ajv 8 Draft 2020-12 as a platform runtime dependency rather than extending the shallow Skill validator. Configure strict schema checking, allErrors, no coercion/default insertion/property removal, and synchronous local schemas only. Do not configure `loadSchema`; reject external/remote/async refs before compilation. Validate data separately as strict JSON/plain data.

Ajv compiles schemas to generated JavaScript. This is safe against schema code injection in current Ajv, but it depends on dynamic code generation. Implementation must verify the deployed CSP/build before accepting this design. If CSP forbids `unsafe-eval`, use a CSP-compatible schema interpreter or revise the platform CSP intentionally; merely moving Ajv to a Worker is not a solution, and validation must not be weakened. Standalone generation is not applicable to arbitrary card-authored runtime schemas unless validation modules are produced during trusted card packaging.

## Concurrency decision

Record actual save-runtime file/list/glob reads, blind-write baselines, delete ranges and exact Action resource rows from an atomic invocation-start snapshot; validate them together with active save/card/session binding inside one Dexie transaction. Execution reads only that snapshot plus staged read-your-writes overlay. Apply only the staged actual delta so unrelated concurrent edits survive. Read-only/no-op actions still validate dependencies. No retry: a related dependency change returns a deterministic conflict and writes nothing.

## Security decision

Frontend Actions are not routed through generic platform actions or Agent registries. Runtime game Agents must also be unable to read/list/search/glob or context-inject `frontend-actions/**`; desktop assistant authoring remains allowed. Actor level is fixed by the host, never accepted from iframe input. Remote generic platform actions use a closed allowlist plus host-enforced `play-frontend` caller identity, so future privileged actions fail closed and can never resolve local-assistant privilege. The first version reuses the current browser-script Worker threat model; it is transactional and permission-limited, not a proof of deterministic execution or a network sandbox.

## Testing decision

Add Vitest and fake-indexeddb to `platform-web`. Prefer pure unit boundaries for path/manifest/schema/JSON checks and focused integration tests for Worker, Dexie optimistic commit, remote session abort, mutation events, and privilege escalation. Keep existing package builds as release gates.
