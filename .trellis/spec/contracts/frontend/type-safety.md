# Type Safety

Frontend/browser consumers should use shared contract types instead of redefining bridge payloads locally.

## Current Shared Shapes

- `ConversationMessageRecord` and `SessionHistoryEntry` describe frontend-readable session state (turn history rebuilt from workspace turn files).
- `WorkspaceFile`, `WorkspaceEntry`, `WorkspaceSearchResult`, `WorkspaceScope`, `WorkspaceOperationName`, `WorkspaceOperationRequest`, `WorkspaceDiffResult`, `WorkspacePatchResult`, `WorkspaceMoveResult`, `WorkspaceDeleteResult`, and `WorkspaceValidationResult` describe generic Runtime Workspace files, scoped operation requests, and operation results.
- `MessageInteractionRequest` is `{ content: string; injection?: InjectionMessage[] }`. `InvokeAgentRequest` is `{ agentId: string; input: string; invocationId?: string; purpose?: string; checkpoint?: InvokeAgentCheckpointOption; commitMode?: AgentInvocationCommitMode; checkpointReason?: string; injection?: InjectionMessage[]; contextSlot?: string; persist?: boolean }`, and `InvokeAgentResult` is `{ invocationId: string; response: string }`. `checkpoint` is the preferred side-channel checkpoint request: omitted/`false` = no checkpoint, `true`/`{ mode: "create" }` = create after workspace commit, `{ mode: "overwrite", checkpointId }` = overwrite an existing checkpoint, `{ mode: "current-turn-auto" }` = overwrite/create the current turn's automatic checkpoint. Legacy `commitMode: "workspace-with-checkpoint"` maps to current-turn-auto only when no explicit `checkpoint` is provided; `checkpointReason` is compatibility data. `AgentInvocationEvent` is the discriminated event union for `invokeAgent` streaming (`started` / `delta` / `round-end` / `tool` / `completed` / `failed`). `InjectionMessage` carries `role` (system/user/assistant), `content`, and optional `position` (before-input/after-input, per-message). Injection is per-turn only — not persisted to turn history or context.json snapshots; the platform inserts it by role+position without interpreting semantics. `contextSlot` isolates invokeAgent context into `context-<slot>.json` (omitted → default `context.json`); `persist` controls whether the context file is read/written (`true` = read+writeback, `false`/omitted = one-shot, no read/write). Both are optional and default to one-shot behavior. `invocationId` may be supplied by the frontend so it can filter events before the Promise resolves; SDK/platform generate one when omitted. `purpose` is a caller-defined label for filtering, logs, and UI state, not behavior routing.
- `DeepQueryRequest` / `DeepQueryResult<T>` wrap bridge query resources.
- `PlatformActionRequest` / `PlatformActionResult<T>` wrap host-owned platform actions. They are not the Frontend Action contract.
- `CardRunActionRequest`, `CardAbortActionRequest`, `CardRunActionResult`, `FrontendActionPublicError`, `FrontendActionRuntimeErrorCode`, and `RuntimeWorkspaceMutationEvent` describe card-owned Frontend Action RPC, typed errors, cancellation, and path-only durable-commit notifications. `JsonValue` is the only Action input/output/details value type; do not widen it to `unknown`.
- `RemotePlayBridge*` types describe the serializable `tsian.play-bridge.v1` postMessage protocol used by remote iframe frontends.
- `DiagnosticRecord`, `DiagnosticRecordSummary`, `DiagnosticTraceOverview`, and `DiagnosticStoreHealth` support the in-process unified diagnostics view. `CheckpointSummary` supports checkpoint recovery and exposes behavior fields (`retention: "auto" | "pinned"`, optional `source`, `tags`, `visible`, `metadata`) plus compatibility `reason?: string`; consumers must use `retention` for pruning/protection semantics, not closed `reason` values.
- `GameCardManifest`, `GameCardFrontendBinding`, `GameCardPackageManifest`, `GameCardPackageFileEntry`, and `GameCardContentFile` describe reusable game cards, package files, frontend bindings, and card-owned content files. `GameCardWorkspaceTemplateFile` is a compatibility alias for `GameCardContentFile`. `GameCardManifest.summary` is the single Game Card intro field; there is no parallel Game Card `description` field. `GameCardManifest.frontend` is optional; when present, frontend bindings are remote or packaged only. `GameCardManifest.runtime.entrypoints.playerTurn` is the optional manifest-owned Agent id used by `send` / `interaction.sendMessage` formal player turns; platform runtime must fail loud when a playable card/save lacks a non-empty player-turn entrypoint instead of silently falling back to a hardcoded Agent id.
- `AgentConfig`, `AgentSkillConfig`, `AgentPlatformToolConfig`, `AgentWorkspaceAccessConfig`, and `AgentPlatformToolName` describe the machine-readable `agents/<agent>/agent.json` Agent configuration used by Studio and Agent Runtime.
- `AgentRegistryEntry` describes lightweight `agents/<agent>/agent.json` index entries. `configPath` points to `agent.json`, `path` points to the required SOP `AGENT.md`, and entries include Skill enablement plus `platformTools` / `workspaceAccess` for runtime permission derivation. `defaultSkills` remains in the shared shape only as compatibility input.
- `AgentContextEntry` describes one assembled Agent context bundle for `agent-context`, including `agentFile`, optional `soulFile`, save runtime notes/session files, filtered Skill Index, declared context files, and missing context paths.
- `SkillRegistryEntry` describes lightweight shared or agent-local `SKILL.md` index entries. Use `name` / `description` for model-facing Skill identity and keep `id` / `summary` / `path` for compatibility and bridge/UI/debug consumers.
- `SkillDetailEntry` describes a loaded `SKILL.md` plus resource index for `skill-detail`.
- `SkillResourceEntry` describes a bundled skill resource file without its content.

## Bridge Consumption

- Play frontends call `bridge.interaction.sendMessage({ content })` to submit player input.
- Play frontends read data through `bridge.query.query(...)`, in particular `session-history` for turn-by-turn dialogue history and turn number.
- Play frontends use `bridge.platform.runAction(...)` only for host-owned actions permitted by the remote caller's closed allowlist. Card-owned Frontend Actions use the semantic SDK `tsian.card.runAction(...)`; frontend code must not call the raw `card.runAction` RPC or generic dispatcher directly.
- `bridge.debug?.onTurnDebugReady(cb)` is a signal to refresh data, not the source of truth.
- Remote iframe frontends use `RemotePlayBridgeMessage` envelopes over `postMessage`; they must expect explicit `{ ok: true, result }` / `{ ok: false, error }` responses instead of thrown exceptions crossing the frame boundary.
- The default remote iframe bridge exposes `interaction.sendMessage`, `interaction.invokeAgent`, `query.query`, `platform.getPlatformContext`, host-owned `platform.runAction`, `workspace.*`, `card.getEntrypoints`, and the internal `card.runAction` / `card.abortAction` methods wrapped by play-bridge. It does not expose the `debug` namespace or any retired diagnostic query resource, and must not offer a Frontend Action enumeration method.
- Use `AgentRegistryEntry` for `bridge.query.query({ resource: "agent-registry" })` results.
- Use `AgentContextEntry` for `bridge.query.query({ resource: "agent-context", params: { agentId } })` results.
- Use `SkillRegistryEntry` for `bridge.query.query({ resource: "skill-registry" })` results. Prefer `name` and `description` when presenting skills to an Agent; use `path` only for platform/debug queries such as `skill-detail`.
- Use `SkillDetailEntry` for `bridge.query.query({ resource: "skill-detail", params: { path } })` results.
- Unified diagnostics are available only through the in-process optional `DebugBridge`; the remote iframe bridge does not expose diagnostic records or retired diagnostic query resources.

## Scenario: Game Card Authoring Source Ownership

### 1. Scope / Trigger

- Trigger: changing a game UI, setup flow, card Skill/custom Tool/Agent/config/docs, generated save skeleton, frontend package script, or whole-card package assembly.

### 2. Signatures

```text
Game-card frontend source: apps/play-frontend-dev/src/**
Frontend build:            npm run build:play-frontend
Frontend package:          npm run package:frontend
Whole-card package:        npm run package:card
Card content source:       cards/<card>.tsian-card/workspace/**
Author card manifest:      cards/<card>.tsian-card/card-manifest.json
Generated whole-card file: game-card.json inside the output ZIP
```

`npm run package:frontend` packages `apps/play-frontend-dev/src/**` as a `.tsian-frontend.zip`; platform upload atomically replaces the target card frontend source and builds its `frontend/dist/**`.

### 3. Contracts

- `apps/play-frontend-dev/**` is the repository source of truth for the game-card frontend. Implement UI/composable/frontend protocol changes there, then build and package it. Do not develop against an extracted card's `frontend/src/**` copy.
- `cards/<card>.tsian-card/workspace/**` is the source of truth for card content: Skills, custom Tools/Frontend Actions, Agent files, config, prompts, and card docs are edited there.
- Modify `apps/platform-web/**` only when the behavior is platform-owned, including automatic generation of save skeletons or package/import/build infrastructure. Platform built-in card/workspace templates are currently unmaintained and must not receive feature synchronization.
- An extracted card directory may contain historical `frontend/src/**`, `frontend/dist/**`, and a package-wrapper `game-card.json`. Treat these as export residue, not parallel authoring sources; do not hand-maintain or manually synchronize them.
- A whole-card packager must assemble canonical card workspace/cover content with a freshly built development frontend, generate the package-wrapper `game-card.json` from a small author-owned manifest input plus enumerated files, and write generated data only to the output archive/staging area.
- The author-owned `card-manifest.json` contains only the stable `GameCardManifest`. It must not contain package inventory, exporter metadata, `exportedAt`, or generated frontend files; card version changes remain an explicit author edit.
- Whole-card packaging must run `buildFrontend -> writeBackDist -> exportGameCardPackage` in a temporary browser profile and origin. It must never connect to the user's platform profile/IndexedDB, and it must not substitute the development Vite `dist` for the platform browser build.
- Every package inventory `size` is the byte length of the corresponding ZIP entry. Text uses encoded UTF-8 bytes, not JavaScript `string.length`; cover and other binary files use their raw byte length.
- Default whole-card output is non-clobbering. An explicit `--out` may replace a regular file only after the new archive passes validation, using a same-directory temporary file and rollback-safe publication.
- Keep frontend-only and whole-card delivery as separate commands or explicit modes. Frontend-only upload is the fast path for UI work; whole-card output is for a complete installable card. Both must reuse the same media-type/path enumeration helpers rather than maintaining two manifest algorithms.

### 4. Validation & Error Matrix

| Change or package condition | Required behavior |
|---|---|
| UI/setup/composable change | Edit `apps/play-frontend-dev/src/**`; build and create frontend package |
| Skill/custom Tool/Agent/config change | Edit `cards/<card>.tsian-card/workspace/**` |
| Generated save skeleton rule changes | Edit the owning platform generator; do not patch one card export |
| Built-in template appears similar | Leave it unchanged unless a separate template-maintenance task explicitly reactivates it |
| Extracted card frontend differs from development frontend | Development frontend wins; no bidirectional/manual synchronization |
| Frontend package manifest and source archive disagree | Packaging/validation fails before upload |
| Whole-card package lacks built `frontend/dist/index.html` | Packaging fails; whole-card import does not build source automatically |
| Generated `game-card.json` file index differs from archive entries | Packaging fails before delivery |
| Workspace text contains Chinese or emoji | Inventory size equals the UTF-8 ZIP entry byte length |
| Default dated output already exists | Choose a numeric suffix; never overwrite the existing package |
| Explicit output is a directory or publication fails | Reject/restore the old regular file and remove temporary artifacts |
| Browser build/export fails or times out | Close the temporary browser/server, preserve sources and existing output |

### 5. Good/Base/Bad Cases

- Good: update setup UI under `apps/play-frontend-dev/src`, run its build and `package:frontend`, then upload the generated frontend package to the card.
- Good: update `cards/沉浸阅读器.tsian-card/workspace/agents/.../SKILL.md` without copying it into a platform template.
- Good: run `npm run package:card`; the isolated browser builds from `apps/play-frontend-dev/src/**`, exports through the platform package code, and publishes only after ZIP validation.
- Base: a workspace-only change uses whole-card packaging when a complete installable package is needed; frontend-only upload is unnecessary.
- Bad: edit `cards/.../frontend/src`, rebuild `cards/.../frontend/dist`, and manually rewrite hundreds of `game-card.json` file entries.
- Bad: copy `apps/play-frontend-dev/dist/**` into a card ZIP or compute text inventory sizes with `content.length`.
- Bad: copy every card workspace change into `apps/platform-web/src/storage/workspace-templates/**` even though built-in templates are no longer maintained.

### 6. Tests Required

- Frontend change: run `npm run build:play-frontend`, run `npm run package:frontend`, parse `frontend.json`, and assert every indexed `src/**` entry matches `apps/play-frontend-dev/src/**` by path, byte size, and byte content.
- Workspace change: parse all changed JSON and `tsian-actions`; compile referenced browser scripts with helpers.
- Whole-card packager: assert source-tree cleanliness, built entry presence, generated manifest schema, exact archive/index path agreement, and byte-for-byte ZIP round trip.
- Exercise the real isolated-browser chain and platform import round trip. Include ASCII, Chinese, emoji, and binary inventory fixtures; assert every manifest size equals the extracted entry byte length.
- Run whole-card packaging twice to prove non-clobbering output and semantic inventory stability, then verify explicit-output replacement and failure rollback preserve the previous bytes.
- Scope audit must distinguish canonical product changes from historical extracted-card residue and must reject new manual synchronization edits.

### 7. Wrong vs Correct

#### Wrong

```text
edit cards/foo.tsian-card/frontend/src/**
manually rebuild cards/foo.tsian-card/frontend/dist/**
manually update cards/foo.tsian-card/game-card.json
copy workspace changes into platform built-in templates
```

#### Correct

```text
UI:        edit apps/play-frontend-dev/src/** -> build -> package:frontend -> upload
Card data: edit cards/foo.tsian-card/workspace/**
Whole card: package:card -> isolated browser build/write-back/export -> validated ZIP
Platform:  edit only platform-owned generators/infrastructure
```

## Scenario: Tool Event Display Name And Player Status

### 1. Scope / Trigger

- Trigger: changing tool-process callbacks, `TurnTimelineItem` tool nodes, `AgentInvocationEvent` tool events, `turn-tool` remote payloads, play-bridge `ToolEvent`, or a player-facing tool activity renderer.

### 2. Signatures

```ts
interface ToolEvent {
  agentId: string
  round: number
  callId: string
  name: string
  displayName?: string
  status: "loading" | "running" | "success" | "failed"
  presentation?: UiToolPresentation
}

type ToolTimelineItem = {
  kind: "tool"
  id: string
  round: number
  agentId?: string
  name: string
  displayName?: string
  status: ToolEvent["status"]
  presentation?: UiToolPresentation
  collapsed: boolean
}
```

Internal `onTool` callbacks carry optional `presentation` followed by `displayName`; formal-turn streaming, persisted timeline collection, `invokeAgent`, and remote bridge forwarding must preserve both fields.

### 3. Contracts

- `name` is the stable wire identifier. `displayName` is an optional opaque player-facing label, sourced from a visible custom `ToolRegistryEntry.title`; it is not a sentence fragment or localization template.
- Platform built-ins, old history, and old senders may omit `displayName`. Consumers render `displayName ?? name`; no migration is required.
- Loading and terminal events for one `callId` carry the same resolved display name when available. Upserts may fill a previously absent display name but must not clear one because a later event omitted the optional field.
- The remote SDK accepts only non-empty string display names; invalid or blank values are omitted rather than coerced. The wire name remains available as fallback.
- Player UI keeps tool identity and state separate. It must not prepend/append tense or outcome text to arbitrary titles. Default visible state mapping is `loading|running -> 运行中`, `success -> 成功`, `failed -> 失败`.
- `UiToolPresentation` is a closed UI-only union; currently only `agent_call` carries target/response/error, and response is bounded. Ordinary tools have no presentation payload. Raw arguments/results never enter bridge events or timeline persistence.

### 4. Validation & Error Matrix

| Condition | Required behavior |
|---|---|
| Visible custom Tool has a non-empty registry title | Emit and persist that title as `displayName` |
| Platform built-in or no visible registry entry | Omit `displayName`; render `name` |
| Old history/event lacks `displayName` | Render normally with `name`; no migration/error |
| Later status event omits `displayName` | Update status/presentation without erasing the existing display name |
| Remote payload has blank/non-string `displayName` | SDK omits the field and retains `name` fallback |
| Unknown future tool name | Display the raw name plus generic status; never synthesize a sentence |

### 5. Good/Base/Bad Cases

- Good: custom `read_entity` emits `{ name: "read_entity", displayName: "读取实体", status: "loading" }`, then updates the same call to success; UI shows `读取实体` and `成功` as separate elements.
- Base: built-in `workspace_read` emits no display name; UI shows `workspace_read` and `运行中`.
- Bad: map unknown tools to `${name}了操作`, mutate `displayName` into `正在${displayName}`, or make title absence a runtime error.
- Bad: add the field only to live `turn-tool` events while omitting persisted `TurnTimelineItem`, causing reload to regress to a different label.

### 6. Verification Required

- Run `npm run build:contracts`, `npm run build:play-bridge`, `npm run build:web`, and `npm run build:play-frontend`.
- Manually verify collector metadata retention, bridge/SDK optional display-name transport, history fallback, timeline order, reduced motion, and terminal animation state.
- Do not restore collector/bridge/component test files for this presentation contract.

### 7. Wrong vs Correct

#### Wrong

```ts
const summary = `${tool.displayName ?? tool.name}了操作`
existing.displayName = next.displayName // erases a title when next omits it
```

#### Correct

```ts
const label = tool.displayName ?? tool.name
const statusLabel = tool.status === "success"
  ? "成功"
  : tool.status === "failed" ? "失败" : "运行中"

existing.status = next.status
if (next.displayName !== undefined) existing.displayName = next.displayName
```

## Scenario: Frontend Action Contract And SDK Boundary

### 1. Scope / Trigger

- Trigger: changing shared `card.runAction` / `card.abortAction` request/result types, play-bridge `tsian.card.runAction`, `FrontendActionError`, strict JSON boundaries, workspace mutation events, session/abort behavior, or remote generic platform-action authorization.

### 2. Signatures

```ts
type CardRunActionResult = JsonValue

interface CardRunActionRequest {
  invocationId: string
  actionId: string
  input: JsonValue
}

interface CardAbortActionRequest { invocationId: string }
interface FrontendActionOptions { signal?: AbortSignal }

tsian.card.runAction(
  actionId: string,
  input: JsonValue,
  options?: FrontendActionOptions,
): Promise<JsonValue>

tsian.onWorkspaceMutation(
  cb: (event: RuntimeWorkspaceMutationEvent) => void,
): () => void
```

```ts
type FrontendActionPublicError =
  | { kind: "runtime"; code: FrontendActionRuntimeErrorCode; message: string; details?: JsonValue; correlationId?: string }
  | { kind: "domain"; code: string; message: string; details?: JsonValue; correlationId?: string }

interface RuntimeWorkspaceMutationEvent {
  invocationId: string
  saveId: string
  source: "frontend-action"
  actionId: string
  writtenPaths: string[]
  deletedPaths: string[]
}
```

### 3. Contracts

- Publication is card-owned fixed content at exact `frontend-actions/<id>/action.json`; it is not declared in `GameCardManifest`, not enumerable through bridge/query APIs, and not represented by Agent/Skill/Tool contract entries.
- Public callers use `tsian.card.runAction`, never a generic `tsian.runAction` / `platform.runAction`. Raw `card.runAction` / `card.abortAction` are package-internal bridge methods.
- `input`, result, public `details`, and mutation event fields remain JSON-serializable shared contracts. Action input/output specifically require strict JSON: finite primitives, dense arrays, and plain/null-prototype records with enumerable string data properties only; no lossy conversion.
- Stable runtime codes are `FRONTEND_ACTION_NOT_FOUND`, `FRONTEND_ACTION_MANIFEST_INVALID`, `FRONTEND_ACTION_INPUT_INVALID`, `FRONTEND_ACTION_OUTPUT_INVALID`, `FRONTEND_ACTION_TIMEOUT`, `FRONTEND_ACTION_ABORTED`, `FRONTEND_ACTION_WORKSPACE_CONFLICT`, `FRONTEND_ACTION_EXECUTION_FAILED`, and `FRONTEND_ACTION_SESSION_REPLACED`.
- `FrontendActionError.kind` discriminates platform/runtime failure from card-defined domain failure. The platform validates domain `code/message/details` but does not maintain a business-code allowlist. Invalid public/transport envelopes are sanitized to runtime execution failure; never expose raw stack, Worker source, internal path, schema compiler details, or Workspace content.
- SDK generates invocationId before transport. A pre-aborted signal sends neither run nor abort request. Active abort sends `card.abortAction`; the host response owns the abort-versus-durable-commit race.
- Pending calls/events are session-bound. Session replacement rejects old pending calls with `FRONTEND_ACTION_SESSION_REPLACED`; stale responses/events are ignored and listeners are cleaned.
- `workspace-mutation` is path-only and emitted only after a durable non-empty Action commit. Paths are stable-sorted actual writes/concrete deletes. Subscribers treat it as invalidation and authoritative reread; invocationId is correlation, not global ordering.
- Existing `tsian.workspace.write` remains a separate immediate API and must not be typed/documented as part of the Action transaction.
- Remote generic `platform.runAction` uses host-fixed caller identity and a closed allowlist; unknown/future and workspace-family actions fail closed. Request params cannot supply authorization identity.

### 4. Validation & Error Matrix

| Condition | Public result |
|---|---|
| Non-strict SDK input | reject locally with runtime `FRONTEND_ACTION_INPUT_INVALID`; no run RPC |
| Strict JSON but input schema mismatch | runtime `FRONTEND_ACTION_INPUT_INVALID`; Worker not started |
| Missing exact action | runtime `FRONTEND_ACTION_NOT_FOUND` |
| Invalid manifest/schema/ref/resource | runtime `FRONTEND_ACTION_MANIFEST_INVALID` |
| Raw/host output is non-strict or schema-invalid | runtime `FRONTEND_ACTION_OUTPUT_INVALID`; no commit |
| Valid dedicated domain envelope | `FrontendActionError { kind: "domain", code, message, details? }` |
| Ordinary throw/invalid domain or transport envelope | sanitized runtime `FRONTEND_ACTION_EXECUTION_FAILED` |
| Pre-aborted signal | runtime `FRONTEND_ACTION_ABORTED`; no run/abort RPC |
| Abort before commit barrier | runtime `FRONTEND_ACTION_ABORTED`; zero commit/event |
| Abort after durable commit | success/commit wins; no rollback to aborted |
| Relevant read-set/binding/resource change | runtime `FRONTEND_ACTION_WORKSPACE_CONFLICT`; no retry/write/event |
| Session replacement | old Promise rejects `FRONTEND_ACTION_SESSION_REPLACED`; stale response/event ignored |
| Empty/byte-identical commit | success, no mutation event |
| Remote generic action outside closed allowlist | `PLATFORM_ACTION_FORBIDDEN` before assistant actor resolution |

### 5. Good/Base/Bad Cases

- Good: import `createTsian`, `FrontendActionError`, and shared Action types from `@tsian/play-bridge`; call `tsian.card.runAction("apply-choice", { choiceId }, { signal })`; branch on `error.kind + error.code`.
- Good: subscribe through `onWorkspaceMutation`, filter if useful, and reread every affected domain file from Workspace rather than trusting event order/content.
- Base: an Action returns a scalar/record `JsonValue` and produces no mutation; Promise resolves and no event is required.
- Bad: redefine the payload as `{ input: unknown }`, accept a Date/Blob, then rely on postMessage/JSON.stringify to coerce it.
- Bad: call `tsian.runAction("apply-choice", ...)`, expose an action registry to generate UI, or reuse `PlatformActionError` without the runtime/domain discriminator.
- Bad: globally refresh one fixed `runtime.json` for every event; actual paths can include any card-owned save state and event ordering is not authoritative.

### 6. Verification Required

- Run `npm run build:contracts`, `npm run build:play-bridge`, `npm run test:frontend-actions`, `npm run build:web`, and `npm run test:frontend-actions:production-browser`.
- The bridge smoke samples the real transaction/event path and CAS failure; the real-browser gate owns production Worker/schema transport.
- Manually verify the remaining strict-JSON/output/error, abort/session, subscriber, and closed-privilege matrices. Do not restore the deleted SDK/lifecycle/privilege suites.

### 7. Wrong vs Correct

#### Wrong

```ts
const result = await tsian.runAction("apply-choice", { choiceId })
if ((result as any).errorCode === "CONFLICT") retry()
```

This sends a card-owned operation to the host generic dispatcher, discards the typed error contract, and retries a snapshot conflict.

#### Correct

```ts
try {
  await tsian.card.runAction("apply-choice", { choiceId }, { signal })
} catch (error) {
  if (!(error instanceof FrontendActionError)) throw error
  if (error.kind === "domain") showBusinessError(error.code, error.message)
  else showRuntimeError(error.code) // conflict is surfaced; caller does not auto-retry
}
```

#### Wrong

```ts
tsian.onWorkspaceMutation(({ writtenPaths }) => {
  if (writtenPaths.length > 0) void reloadRuntimeJson()
})
```

#### Correct

```ts
tsian.onWorkspaceMutation((event) => {
  void rereadAuthoritativeFilesFor(event.actionId, event.writtenPaths, event.deletedPaths)
})
```

## Scenario: invokeAgent AgentInvocation Contract

### 1. Scope / Trigger

- Trigger: changing `InvokeAgentRequest`, `InvokeAgentCheckpointOption`, `InvokeAgentResult`, `AgentInvocationEvent`, remote bridge event payloads, or frontend SDK handling for `invokeAgent` streaming/checkpoint side effects.

### 2. Signatures

- `MessageInteractionRequest`: `{ content: string; injection?: InjectionMessage[] }` — player-turn entry.
- `InvokeAgentRequest`: `{ agentId: string; input: string; invocationId?: string; purpose?: string; checkpoint?: InvokeAgentCheckpointOption; commitMode?: AgentInvocationCommitMode; checkpointReason?: string; injection?: InjectionMessage[]; contextSlot?: string; persist?: boolean }` — frontend/card-flow-selected Agent invocation. `checkpoint` is the preferred checkpoint side-effect option; `commitMode` / `checkpointReason` are deprecated compatibility fields.
- `InvokeAgentResult`: `{ invocationId: string; response: string }` — final text plus the id used by streamed events.
- `AgentInvocationEvent`: discriminated union with `type` = `started | delta | round-end | tool | completed | failed`.
- Remote bridge event name: `agent-invocation`; payload is `AgentInvocationEvent`.

### 3. Contracts

- Public SDK keeps both semantic entries: `send` for formal player turns; `invokeAgent` for explicitly targeting an Agent from frontend/card flow.
- `send` and `invokeAgent` may share internal runtime infrastructure, but consumers must not treat `invokeAgent` as a formal turn: it does not append player history or produce `turn-completed`.
- `invocationId` is optional in the request but required in the result and every `AgentInvocationEvent`; SDK should generate one before sending when omitted.
- `purpose` is a caller label for UI/log filtering only; platform behavior must not depend on parsing particular purpose strings.
- `checkpoint` is an optional post-success side effect on the invokeAgent workspace commit. Omitted/`false` means no checkpoint. `true`/`{ mode: "create" }` creates a checkpoint from post-commit workspace. `{ mode: "overwrite", checkpointId }` overwrites an existing checkpoint snapshot while preserving id. `{ mode: "current-turn-auto" }` overwrites or creates the current turn automatic checkpoint and is the preferred post-turn maintenance shape.
- Legacy `commitMode: "workspace-with-checkpoint"` is accepted only as a compatibility alias for current-turn-auto when no explicit `checkpoint` option is supplied. New callers should use `checkpoint`.
- `agent_call` is not a SDK entry. It is an Agent-internal tool; delegated Agent events produced during an `invokeAgent` call use the same `invocationId` and their own `agentId`.

### 4. Validation & Error Matrix

- Missing/blank `agentId` -> bridge validation error before runtime invocation.
- Non-string `input` -> bridge validation error before runtime invocation.
- Missing `invocationId` -> SDK/platform generates one; this is not an error.
- `checkpoint.mode === "overwrite"` with missing/blank `checkpointId` -> bridge/host validation error.
- Unknown `checkpoint.mode` -> bridge/host validation error before runtime invocation.
- Explicit `checkpoint` combined with legacy `commitMode: "workspace-with-checkpoint"` -> validation error; callers must choose one API shape.
- `commitMode: "workspace"` with `checkpointReason` and no checkpoint option -> validation error.
- Runtime failure -> `agent-invocation` emits `{ type: "failed", invocationId, agentId, error }` with JSON-compatible error payload, then the Promise rejects.
- Successful invocation -> workspace/checkpoint commit is durable, then emits `completed` and resolves `{ invocationId, response }`.

### 5. Good/Base/Bad Cases

- Good: frontend creates `invocationId`, subscribes to `onAgentInvocation`, filters events by id, calls `invokeAgent`, renders deltas, then reconciles with final `response`.
- Good: post-turn maintenance calls `invokeAgent(agentId, input, { invocationId, purpose: "post-turn-maintenance", persist: true, checkpoint: { mode: "current-turn-auto" } })`.
- Good: an explicit repair flow calls `invokeAgent(agentId, input, { checkpoint: { mode: "overwrite", checkpointId } })` to update an existing save point after successful workspace mutation.
- Base: frontend omits `invocationId`; SDK generates one and returns it in `InvokeAgentResult`.
- Bad: frontend listens to `turn-delta` for `invokeAgent` content, or assumes `invokeAgent` fires `turn-completed`.
- Bad: new code uses `commitMode: "workspace-with-checkpoint"` / `checkpointReason` instead of `checkpoint`; those fields are compatibility only.

### 6. Verification Required

- Run `npm run build:contracts` after contract changes.
- Run the consuming frontend build (`npm run build:web`) when platform-web/play-bridge consumes the changed types.
- Manually verify `invokeAgent`/`send` event routing, checkpoint normalization/rejection, and legacy mapping. Do not add a dedicated bridge streaming/checkpoint suite.

### 7. Wrong vs Correct

#### Wrong

```ts
const { response } = await tsian.invokeAgent("stage-manager", prompt)
// No way to associate streaming events before the Promise resolves.
```

#### Correct

```ts
const invocationId = crypto.randomUUID()
const off = tsian.onAgentInvocation((event) => {
  if (event.invocationId !== invocationId) return
  // render event.delta / event.tool / event.completed
})
try {
  const result = await tsian.invokeAgent("stage-manager", prompt, { invocationId })
  renderFinal(result.response)
} finally {
  off()
}
```

#### Wrong

```ts
await tsian.invokeAgent(agentId, input, {
  commitMode: "workspace-with-checkpoint",
  checkpointReason: "post-turn-maintenance",
})
```

#### Correct

```ts
await tsian.invokeAgent(agentId, input, {
  purpose: "post-turn-maintenance",
  persist: true,
  checkpoint: { mode: "current-turn-auto" },
})
```

## Scenario: Transcript-Backed invokeAgent Interview

### 1. Scope / Trigger

- Trigger: a packaged or remote play frontend uses persistent `invokeAgent` calls for a multi-round setup interview outside formal story turns.

### 2. Signatures

```ts
tsian.invokeAgent(agentId, userMarker, {
  invocationId,
  contextSlot: sourceDerivedSlot,
  persist: true,
  transcript: { mode: "full", audience: "player" },
  injection: [{ role: "user", position: "before-input", content: invariants }],
})

type InterviewControl = {
  source: { hash: string }
  session: { id: string; slot: string }
  branch: "canon" | "original"
}
```

A successful invocation transcript is the visible conversation archive. Optional Agent semantic notes are ordinary workspace files and are not frontend control state.

### 3. Contracts

- Derive `session.id` and `contextSlot` from stable source identity. Keep `branch` as one structured invariant and generate its player-language label in the injection.
- The compact control file contains only source identity, session id/slot, and branch. Completion is owned only by the formal setup summary.
- Accept any non-empty displayable successful assistant response. It does not depend on an Agent note write or another per-turn acknowledgement.
- Persistent transcript entries restore every successful player/assistant exchange. Preserve the generic transcript contract: entries have strictly increasing `sequence`, and the final entry sequence equals `lastSequence`.
- Transport failures keep the submitted input only in current-page memory for retry. A reload restores through the last successful transcript entry and may discard the failed draft.
- If invocation resolves but local projection or navigation fails, reread the transcript before resending so an archived successful response is not duplicated.
- Initialization order is completion signal -> valid control/transcript -> bootstrap retry -> fail-closed legacy-state error -> fresh setup. Test-stage legacy state is not migrated or deleted.
- Hidden opening-choice markers are removed from final and streaming display. A single trailing unclosed `[[开局选项]]` block extends to end of response.
- Formal model writes happen once through one transactional final action. It reads source/control itself and blocks malformed payloads, unsafe or duplicate write identities, started play, missing runtime targets, unusable frontier anchors, and an unprojectable first reply.
- The final action derives target names, source chapter metadata, and stable anchor kind/order. Optional semantic content is normalized or retained instead of becoming a speculative hard failure.
- When the setup summary already reports complete, the final action must still inspect `enteredPlay`, `runtime.turn`, and later turn files. It returns complete without rewriting only when all three show that formal play has not started.

### 4. Validation & Error Matrix

| Condition | Required behavior |
|---|---|
| Successful displayable response with no note update | Display immediately and continue |
| Invocation rejects | Keep current-page input and expose retry |
| Reload after a rejected input | Restore successful transcript only |
| Resolved invocation is already present in transcript | Restore it; do not resend |
| Transcript sequence regresses, duplicates, or disagrees with `lastSequence` | Fail closed as invalid archive state |
| Trailing opening-choice block lacks its closing marker | Extract choices through end and hide the block |
| Runtime protagonist or active scene does not exist in the commit | Reject before any write |
| First formal reply cannot project visible content and choices | Reject before any write |
| Legacy incomplete or non-clean formal state exists | Stable new-save error and zero mutation |
| Setup summary is complete; `enteredPlay !== true`, `runtime.turn <= 0`, and no turn after `turn-000000.json` exists | Return complete with zero writes |
| `enteredPlay === true`, `runtime.turn > 0`, or a later turn file exists | Reject final action with `OPENING_PLAY_ALREADY_STARTED` |

### 5. Good/Base/Bad Cases

- Good: an explanatory response changes no semantic note; it is still archived and displayed.
- Good: refresh rebuilds all successful exchanges and latest choices in transcript sequence order.
- Base: bootstrap invocation rejects; the control remains usable for retry.
- Bad: reject a successful response because an optional note is absent or unchanged.
- Bad: persist failed-input retry bookkeeping across refresh.
- Bad: sanitize only complete opening-choice blocks and expose a trailing unclosed block.

### 6. Tests Required

- Type-check and production-build the consuming card frontend.
- Parser assertions: marker removal, partial marker prefixes, trailing unclosed choices, strict transcript sequencing, and source/session control validation.
- Flow assertions: success needs no note update, rejection keeps same-page retry input, refresh restores only successful transcript entries, and completion-first initialization remains authoritative.
- Final-action assertions: minimal success, unsafe/duplicate id, missing runtime target with zero writes, invalid reply projection with zero writes, started play, and already-complete zero-write behavior.
- Package verification: generated frontend entry exists, manifest sizes match sources, and ZIP entries match source bytes.

### 7. Wrong vs Correct

#### Wrong

```ts
const result = await tsian.invokeAgent(agentId, answer, { persist: true })
if (!semanticNoteChangedThisTurn()) throw new Error("response not confirmed")
```

#### Correct

```ts
const result = await tsian.invokeAgent(agentId, encodeAnswer(answer), {
  invocationId,
  contextSlot: control.session.slot,
  persist: true,
  transcript: { mode: "full", audience: "player" },
})
show(parseDisplayableAssistant(result.response))
```



## Scenario: play-frontend Workspace Data Consumption

### 1. Scope / Trigger

- Trigger: a play frontend (`apps/play-frontend-dev/**` or any packaged/remote game card frontend) reading `save/playthrough/runtime.json`, `save/entities/<type>/<localId>.json`, or `save/scenes/<localId>.json` for UI rendering.

### 2. Signatures

- `tsian.workspace.read(path: string, scope?: WorkspaceScope): Promise<WorkspaceReadResult | null>` — the only sanctioned read exit. `WorkspaceReadResult.content` is a **string** and must be `JSON.parse`d by the consumer.
- `WorkspaceScope` for save-scoped runtime data is `"save-runtime"` (covers `save/**`). Pass it explicitly; do not rely on path-prefix inference.

### 3. Contracts

- Read result is `null` when the path does not exist (e.g. fresh save before any runtime write). This is **not** an error — treat it as `"not-found"` and let the UI decide whether to render empty or hide.
- `JSON.parse` may throw on corrupted/partial writes. Catch it locally and surface as `"load-failed"`, not as a thrown exception — play frontends must never crash the游玩面 because of a malformed workspace file.
- Bridge/RPC `read` rejections (platform/bridge errors) follow the same pattern: catch, set `error: "load-failed"`, do not re-throw.

### 4. Validation & Error Matrix

| Condition | Treatment | Surfaces as |
|---|---|---|
| `file === null` | UI hides the panel or shows empty state | `error: "not-found"` |
| `JSON.parse` throws | UI shows "状态暂不可用" or hides | `error: "load-failed"` |
| `workspace.read` rejects | same as parse failure | `error: "load-failed"` |
| Parsed object missing fixed fields | same as parse failure (do not silently coerce) | `error: "load-failed"` |

### 5. Good/Base/Bad Cases

- **Good**: `useRuntime()` catches all three failure modes, writes a typed `error` field on the returned `RuntimeData`, and the UI branch on `error` decides render-vs-hide.
- **Base**: a `useEntity(ref)` helper that returns `{ data, error, load }` with `load()` performing the read+parse+catch and never throwing.
- **Bad**: `const runtime = JSON.parse((await tsian.workspace.read(...)).content)` — no null check, no try/catch, crashes the component on missing/corrupt files.

### 6. Verification Required

- Run `npm run build:play-frontend`.
- Manually verify not-found, malformed JSON, and successful ready/display behavior. Do not add a dedicated composable test.

### 7. Wrong vs Correct

#### Wrong

```ts
async function loadRuntime() {
  const file = await tsian.workspace.read("save/playthrough/runtime.json")
  return JSON.parse(file.content)  // crashes on null file or bad JSON
}
```

#### Correct

```ts
async function refresh() {
  try {
    const file = await tsian.workspace.read(RUNTIME_PATH, "save-runtime")
    if (file === null) { runtimeData.value = { runtime: null, error: "not-found", ... }; return }
    let parsed: unknown
    try { parsed = JSON.parse(file.content) }
    catch { runtimeData.value = { runtime: null, error: "load-failed", ... }; return }
    runtimeData.value = parseRuntime(parsed)   // parseRuntime also validates fixed fields
  } catch {
    runtimeData.value = { runtime: null, error: "load-failed", ... }
  }
}
```

## Scenario: Runtime Extension Parsing Contract

### 1. Scope / Trigger

- Trigger: any play frontend code that turns `runtime.extensions` / `entity.extensions` / `scene.extensions` into display items for status bar, character cards, container panels, or runtime injection UI.

### 2. Signatures

- `parseRuntime(raw: unknown): RuntimeData` — pure function; validates fixed fields, then parses `extensions`.
- `parseEntity(raw: unknown): { displayItems: DisplayItems; itemErrors: DisplayItemError[] }` / `parseScene(raw)` — pure functions; parse `extensions` only (fixed `fields`/`sections`/`status` stay on the raw entity for UI-specific rendering).
- Shared `parseExtensions(ext)` underlies all three — **do not** reimplement extension parsing per UI component (R7).

### 3. Contracts

- **render → category** is a fixed mapping (`lib/render-mapping.ts`): `progress/number → metric`, `tag/tags/text → tag`, `ref/cards/list → ref`, `section → section`. UI components select items by `category`, not by `render`.
- **Unknown render** (value present but not in the 9 presets) → `itemErrors` with `error: "unknown-render"`. Do not degrade unknown renders to text — fail loud so schema drift is visible.
- **Omitted `render`** → treat as `"text"` (schema OQ-2: `render` may be omitted for plain text display). This is **not** an unknown-render error.
- **Missing/typed-wrong fields** (e.g. `progress` without `value`) → degrade per render type and mark `fallback: true` on the `DisplayItem`. Do not push these into `itemErrors` — they are common Agent write slips and the UI can still show something useful.

### 4. Validation & Error Matrix

| Condition | Treatment | Surfaces as |
|---|---|---|
| `render` field omitted | effective render = `"text"`, normal item | `DisplayItem` in `tags` bucket |
| `render` value not in 9 presets | `itemErrors` entry, item dropped from buckets | `DisplayItemError { error: "unknown-render" }` |
| `render` valid but `value` missing | per-render fallback, item stays in bucket | `DisplayItem.fallback = true` |
| `extensions` is not an object | empty buckets, no errors | empty `DisplayItems` |

### 5. Good/Base/Bad Cases

- **Good**: UI status bar reads `displayItems.metrics` + `displayItems.tags` and renders them; separately reads `itemErrors` to show a dev-mode warning.
- **Base**: character card calls `parseEntity` on a `workspace.read` result and renders `displayItems` alongside the fixed `fields`/`sections`.
- **Bad**: a UI component re-implements `if (render === "progress") ...` switches on `extensions` directly — duplicates the shared parser and will diverge.

### 6. Verification Required

- Run `npm run build:play-frontend`.
- Manually verify progress, unknown-render, missing-value fallback, and omitted-render text behavior. Do not add a dedicated parser test.

### 7. Wrong vs Correct

#### Wrong

```ts
// Per-component re-implementation
for (const [key, item] of Object.entries(runtime.extensions)) {
  if (item.render === "progress") metrics.push({ label: key, value: item.value ?? 0 })
  else if (item.render === "tag") tags.push({ label: key, value: item.value })
  // ... and 7 more branches, no unknown-render handling, no fallback marker
}
```

#### Correct

```ts
import { parseRuntime } from "../lib/parse-runtime"
const { displayItems, itemErrors } = parseRuntime(raw)
// UI renders displayItems.metrics / .tags / .refs / .sections by category
// itemErrors rendered separately (dev-mode warning or hidden)
```

## Scenario: Runtime Refresh Trigger Bus

### 1. Scope / Trigger

- Trigger: wiring a play-frontend composable that needs to re-read `runtime.json` after turn completion, post-turn sync, checkpoint restore, or player-initiated workspace mutations.

### 2. Signatures

- `emitRuntimeStale(): void` — module-level payload-less signal that runtime data may be out of date.
- `onRuntimeStale(cb: () => void): () => void` — subscribe; returns unsubscribe. Callbacks are isolated (one throwing callback does not block others).
- `setOnSynced(cb: () => void)` (from `useSyncAfterTurn`) — single-consumer hook for post-turn-sync completion. Currently last-writer-wins; if a second consumer appears, upgrade it to multi-callback before registering.

### 3. Contracts

- The bus is **payload-less**: subscribers respond by re-reading their own data. Do not attach event details (they cause "detail doesn't match my context" false-negatives).
- `useRuntime()` auto-subscribes to `ready`, `onTurnEnd`, `setOnSynced`, and `onRuntimeStale`. UI components calling `useRuntime()` do **not** need to wire these themselves.
- Checkpoint `restore()` has no event broadcast — callers must explicitly invoke `useRuntime().refresh()` after restore succeeds.
- Player-initiated actions that mutate workspace (future UI: use item, move inventory) should call `emitRuntimeStale()` on success. Do **not** globally wrap `runAction`/`invokeAgent` to auto-emit — most calls do not touch runtime and would cause noise refreshes.

### 4. Validation & Error Matrix

| Trigger source | Mechanism | Who wires it |
|---|---|---|
| bridge ready | `watch(ready, immediate)` | `useRuntime` (internal) |
| turn completed | `tsian.onTurnEnd` | `useRuntime` (internal) |
| post-turn sync done | `setOnSynced` | `useRuntime` (internal) |
| checkpoint restore | explicit `refresh()` call | caller (e.g. StoryView) |
| player action mutates workspace | `emitRuntimeStale()` | future UI component |

### 5. Good/Base/Bad Cases

- **Good**: a future inventory panel calls `emitRuntimeStale()` after a successful `tsian.runAction("use-item", ...)`; `useRuntime` re-reads automatically; the panel does not know who subscribes.
- **Base**: StoryView calls `await restore(id)` then `void refreshRuntime()` — restore has no event, so the explicit call is the contract.
- **Bad**: wrapping `tsian.runAction` globally to `emitRuntimeStale()` on every call — read-history / query calls would trigger pointless runtime re-reads.

### 6. Verification Required

- Run the consuming frontend build and manually verify subscriber isolation and unsubscribe behavior. Do not add a dedicated event-bus test.

### 7. Wrong vs Correct

#### Wrong

```ts
// Globally wrap runAction to auto-refresh
const origRunAction = tsian.runAction
tsian.runAction = async (action, params) => {
  const r = await origRunAction(action, params)
  emitRuntimeStale()   // fires even for read-only queries — noise
  return r
}
```

#### Correct

```ts
// The UI that knows it mutated workspace emits explicitly
async function onUseItem() {
  await tsian.runAction("use-item", { itemId })
  emitRuntimeStale()   // this action actually changed runtime
}
```

## Avoid

- Do not call platform-web storage, model config, or platform-host internals from a play frontend.
- Do not assume platform-owned events/archives/mod resources exist.
- Do not widen bridge payloads to `unknown` to bypass a compile error; update the shared contract or normalize at the boundary.
- Do not reimplement `extensions` parsing per UI component — use the shared `parseExtensions`/`parseRuntime`/`parseEntity` so render→category, unknown-render, and fallback rules stay consistent (R7).
- Do not degrade unknown `render` values to text — push them to `itemErrors` so schema drift is visible. (Omitted `render` is a separate case and maps to `text`.)
- Do not throw out of workspace-read composables — surface `error: "not-found" | "load-failed"` and let the UI decide.
- Do not globally wrap `runAction`/`invokeAgent` to auto-emit `runtimeStale`; only the component that knows it mutated workspace should emit.
