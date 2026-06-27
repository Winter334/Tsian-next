# Type Safety

`platform-web` is strict TypeScript. Normalize unknown data at runtime boundaries and keep shared shapes in `@tsian/contracts`.

## Shared Contracts

- Import bridge, runtime, debug, frontend package, workspace, Agent, Skill, and diagnostic shapes from `@tsian/contracts`.
- Do not redefine cross-package payloads in platform-web.

## Runtime Boundaries

- Treat AI responses as untrusted strings unless a later task adds structured output validation.
- Validate bridge/platform action inputs before mutating storage.
- Keep workspace write/delete inputs normalized at platform-host or storage boundaries and fail loudly on invalid writes.
- Convert query params at the platform-host boundary before passing to storage helpers.

## Module Resolution

- `tsconfig` uses `moduleResolution: "Bundler"`. Under this mode TypeScript does not auto-append `.vue` when resolving a path alias, so importing a `.vue` SFC requires the **explicit `.vue` suffix**: `import Foo from "@/components/Foo.vue"`. An extensionless `from "@/components/Foo"` compiles in Vite (Rollup resolves it) but fails `vue-tsc` with `TS2307: Cannot find module`. This is a split between the bundler and the type-checker — always include the `.vue` suffix in SFC imports. (Plain `.ts` module imports stay extensionless; `Bundler` resolution handles those.)

## Scenario: Game Card Package And Packaged Frontend

### Scope / Trigger

- When platform-web imports/exports Game Card packages, changes packaged-frontend storage, or loads a `packaged` frontend binding.

### Contracts

- Game Card packages are reusable card-content packages, not Save Instance exports. They must not include save snapshots, save history, checkpoints, traces, or player-mutated save runtime files.
- The package container is a zip with a `game-card.json` manifest, card-owned content under `workspace/*`, optional `frontend/*`, and reserved `cover/*`.
- `GameCardManifest.summary` is the single player-facing intro field. Do not add or persist a parallel Game Card `description`; legacy imports may fold an old `description` into `summary` only when `summary` is missing/blank.
- `GameCardManifest.id` and `version` remain package/runtime metadata; ordinary player-facing UI should not expose them as editable fields.
- `GameCardManifest.frontend` is optional. A frontend-less Game Card is reusable card content, not a playable card. When provided it must be `remote` or `packaged`; same-realm `builtin` frontends are not supported.
- Card content files are stored per-file (one row per file), not embedded on the card row, so a single file write touches one row and bumps the card's `updatedAt` rather than rewriting the whole card.
- Packaged frontends are built static files; the platform must not run source builds, npm install, or framework-specific bundling on them. Their files are stored beside the reusable Game Card; saves created from a card do not copy those files or the card content files.
- A `packaged` frontend must run in an iframe reusing the play-bridge protocol; it must not run in the platform JS realm.
- Packaged frontends use a same-origin virtual resource URL backed by Service Worker/IndexedDB. Keep `allow-same-origin` in the iframe sandbox while the loader relies on Service Worker-controlled same-origin clients; sandboxed opaque-origin navigations bypass the local virtual resource layer. The virtual resource layer should return CORS-friendly headers for module chunks and built assets.

### Validation & Error Matrix

- Missing/unsupported package schema -> reject import with a clear package error.
- Missing or malformed embedded manifest -> reject import.
- Legacy manifest with blank/missing `summary` and non-empty `description` -> import by storing that text as `summary`, then omit `description` from future storage/export.
- Built-in blank card id -> reject import; built-in templates are refreshed by platform seed helpers only.
- `frontend.kind === "builtin"` -> reject import/write with a clear unsupported frontend-kind error.
- Missing frontend -> allow import/write, but `/play` must show a not-configured error until a remote or packaged frontend is configured.
- Packaged frontend without a matching entry file -> reject import.
- Unsafe paths (absolute, traversal, empty, NUL bytes, unknown top-level roots) -> reject import.
- Importing a package creates or updates the reusable Game Card only; it does not create a Save Instance.
- Importing card content under reserved `workspace/save/*` or `workspace/.tsian/*` must fail; those roots are runtime/platform-owned in effective workspaces.
- Exporting a Game Card writes manifest, card content files, and stored packaged frontend files only.

## Scenario: Remote Iframe Play Frontend Bridge

### Scope / Trigger

- When platform-web loads a `remote` frontend binding or changes the remote/packaged iframe bridge mounting.

### Contracts

- The play view is a thin active-frontend loader: wait for platform-host readiness, resolve the active card, then mount a sandboxed iframe for remote or packaged bindings. It routes into phases — `launcher` (save select/create/rename/delete, then mount on continue), `unplayable-guide` (active card has no playable frontend — show guidance with links, not an error state), or `playing` (mount the frontend). The view itself only routes phases and reuses the existing frontend mount logic; it does not inline save-list business UI.
- The play view must not mount same-realm built-in game UI. If the active Game Card has no playable frontend, show the unplayable-guide phase (not an error state) with links to load a different card or configure a frontend.
- Remote frontend URLs are normalized at the iframe adapter boundary. Accept browser-loadable `http:`/`https:` and relative URLs resolving to those; reject dangerous/non-web schemes (`javascript:`, `data:`, `vbscript:`) before iframe creation.
- The iframe sandbox is compatibility-first: `allow-scripts allow-same-origin allow-forms`. Do not add top navigation, popups, downloads, or broader permissions without a new product/security decision.
- Remote bridge messages use shared contract types; runtime validation belongs in platform-web, not in shared contracts.
- The adapter must filter by mounted iframe content window, generated session id, and accepted handshake origin before dispatching requests.
- The allowed remote methods are `interaction.sendMessage`, `interaction.invokeAgent`, `query.query`, `platform.getPlatformContext`, `platform.runAction`, and the `workspace.*` methods (`workspace.read`, `workspace.list`, `workspace.search`, `workspace.write`). The default remote bridge must not expose the `debug` namespace and must reject `ai-debug` queries; a `turn-debug-ready` notification may be sent without debug records.
- Workspace read/list/search/write are independent `workspace.*` RPC methods (split out of `query.query`), each with its own request/response shape and normalize validation. `workspace.read` returns `WorkspaceReadResult | null` (null = file not found; errors are not swallowed). Checkpoint restore reuses existing `platform.runAction` behavior. Agent `workspace_read`/`workspace_write` tools go through `agent-runtime/workspace-tools.ts`, not the bridge `workspace.*` methods — two independent paths.

### Validation & Error Matrix

- Missing active Game Card or missing frontend binding -> show a compact not-configured error state.
- Unsupported persisted frontend kind, including stale `builtin` records -> show a compact unsupported frontend error state instead of silently mounting a different frontend.
- Invalid or forbidden remote URL -> show a compact error state before iframe creation.
- Malformed remote request payload -> return a structured bridge error response when the request has a valid session/id; otherwise ignore.
- Remote `ai-debug` query -> structured forbidden error response.
- Iframe load error -> show a compact error state and do not mutate save data.

## Scenario: Runtime Workspace Registry And Detail Queries

### Scope / Trigger

- When platform-web exposes cross-layer bridge query resources backed by Runtime Workspace files (`agent-registry`, `agent-context`, `skill-registry`, `skill-detail`).

### Contracts

- `agent-registry` returns lightweight entries built from `agents/*/agent.json`; each entry is valid only when the same directory also has a required card-owned `AGENT.md` SOP file.
- Agent config lives in `agent.json` (machine-readable); `AGENT.md` is the required SOP. `defaultSkills` remains a compatibility field, but new Agent config must use `agent.json.skills`.
- `agent-context` returns zero or one assembled bundles from one agent's `AGENT.md`, optional `SOUL.md`, save runtime notes/session files, a visible skill index, and `contextPaths` declared in `agent.json`.
- `skill-registry` returns lightweight entries built from `skills/*/SKILL.md` and `agents/*/skills/*/SKILL.md`. `name`/`description` are the model-facing Skill identifiers (built from frontmatter, with compatibility fallbacks to `id`/`summary`/path-derived values).
- Registry entries carry path, metadata, and lightweight action summaries (name + description + `browser_script` executor type) only. Do not expose full skill instructions, full action declarations, schemas, examples, scripts, or references through the registry query — that breaks progressive disclosure.
- Agent context skill indexes must remain lightweight; do not load `SKILL.md` bodies through `agent-context`.
- Agent context skill indexes are filtered through the selected Agent's `agent.json.skills` enablement: `disabledSkills` always removes matching Skills; non-empty `enabledSkills` allows only matching Skills; otherwise compatibility defaults apply.
- Skill detail entries include the selected `SKILL.md` content and a resource index; resource entries must not include file contents.
- Registry parsing, skill-detail loading, and agent-context assembly must stay pure: workspace files in, entries out — no Dexie/bridge/host imports.

### Validation & Error Matrix

- No active save -> return `{ items: [] }`.
- Missing/malformed `agent.json` or missing adjacent `AGENT.md` -> omit that Agent from `agent-registry`.
- `agent-context` missing/blank/unknown `agentId` -> return `{ items: [] }`.
- `agent-context` missing `SOUL.md` -> return the entry without `soulFile` (valid, not an error).
- `agent-context` missing declared `contextPaths` -> return the entry with `missingContextPaths` populated.
- `skill-detail` missing/invalid/non-skill/absent path -> return `{ items: [] }`.
- Missing/partial/malformed Skill frontmatter -> degrade to path/body fallbacks; never throw from the whole registry query.
- Non-boolean `includeShared`/`includeLocal` or blank `agentId` -> treat as omitted.

## Workspace State

- Workspace JSON file content should remain JSON-compatible when a local convention declares JSON data.
- Structured state belongs in Runtime Workspace files documented by README, schema, Agent, or Skill conventions; do not add a platform-owned table or universal record model for gameplay state.
- Do not loosen contract fields to `unknown` to hide caller bugs.

## Workspace Binary Storage And mediaType Removal

- Internal workspace records (`WorkspaceFile`, `WorkspaceEntry`, `WorkspaceSearchResult`, `WorkspaceOperationRequest`, `SkillResourceEntry`) do not carry `mediaType`; derive it at consumption points from the path. Only zip manifest entries (external format contracts) keep a stored `mediaType`, populated from path inference on export.
- Workspace files are text + binary dual-track: `content: string` for text, optional `binary: Blob` for media (mutually exclusive with meaningful content). The operation request content is `string | Blob`; storage records mirror this.
- Binary files surface `content` as a placeholder string (not empty) so agents don't misjudge them as empty. `workspace_read` on an image binary returns base64 + mime type instead of the placeholder; the agent runtime injects image data as a separate multimodal content part — **never** as base64 text in the JSON observation (that would explode the context window). Multimodal content occurs only in user input; assistant/tool role content stays `string`.
- `mediaType` is never stored on internal records; the Service Worker reads the Blob's built-in type. Covers are stored as Blob, not base64 data URIs.
- DB name bumps are breaking changes with no migration (prototype project). The Service Worker `DB_NAME` must mirror `db.ts` — a mismatch makes packaged frontends 404.
- `workspace.read` returns a superset of `WorkspaceFile` (old consumers reading `path`/`content`/`updatedAt` are unaffected; new consumers gain line/offset/truncation/binary-placeholder metadata). `workspace.search` adds match metadata while keeping `preview`. Binary files are skipped by search/validate.
- `game-card.json` is a synthesized workspace file (not stored as a content row) injected into studio/effective workspace listings. Writing it parses + normalizes the manifest and force-overwrites protected fields (`id`, `schema`, `frontend.bridgeVersion`) before persisting; the content table is untouched. Builtin card manifests are read-only. This synthesized file is `GameCardManifest` directly, distinct from the zip package's `game-card.json` (which wraps it in a package manifest).
- Card frontend single-file writes follow the same per-row pattern as content files: one row put/delete + bump card `updatedAt` in the same transaction, no full card rewrite.
- Workspace tool `scope` is invisible to the agent. It is auto-inferred from the path prefix on edit ops (and defaults to `effective` on read ops); explicit scope from internal callers still wins. The agent-facing tool schemas do **not** expose `scope` as a parameter, and tool descriptions/prompts never mention it — the agent only knows paths. Permission enforcement is path-based, so auto-inference does not change the actor-level boundary.

## Scenario: Card Content And Save Runtime Effective Workspace

### Scope / Trigger

- When platform-web creates saves, imports/exports Game Cards, lists Runtime Workspace files, runs Agent Runtime turns, commits workspace mutations, checkpoints, or restores checkpoints.

### Contracts

- Game Card content owns Agents, Skills, schemas, rules, docs, frontend definitions, manifest metadata. The assistant agent identity is platform-local under `.tsian/local/assistant/`, not Game Card content.
- Save runtime data owns dialogue/history, generated entities, maps, relationships, memory summaries, frontend view state, Agent notes/session transcripts, and `.tsian` diagnostics for one playthrough.
- Effective workspace composition is deterministic: card content appears at its card path, active save runtime data appears under `save/`, and `.tsian/` is visible in the resource manager (C-drive model) but remains hidden from ordinary Agent/Skill/frontend read/list/search APIs (actor level 4 required).
- Game Card content must not define `save/...` or `.tsian/...`.
- **Two distinct actor classes share the workspace operation path, distinguished by actor level (not by turn vs. non-turn):**
  - **Runtime game agents** (the agents defined in a card's `agents/`, running during a play turn): default `workspaceAccess.level` is `1`. `card-content` scope `editLevel` is `2`, so `assertEditAccess` rejects their card-content writes before any mutation runs. They can only write `save-runtime` (editLevel 1). Runtime game agents must not mutate card content during play.
  - **Desktop assistant** (the platform management assistant at `.tsian/local/assistant/`): default `workspaceAccess.level` is `4` (highest), resolved from the agent config (never hardcoded). At level 4 it passes `assertEditAccess` for all scopes, so it can manage every resource-manager-visible path — the user's right hand, including its own definition.
- **Card-content writes bypass the save transaction, not the permission gate.** When the desktop assistant writes `card-content` during a runtime turn, the non-staged branch routes the write through dispatch → the card-content volume → the per-file content table — **not** the save transaction, because the save transaction only accepts `save/...` paths. Card content is not part of save checkpoints (checkpoints snapshot save-runtime only), so routing it around the save transaction is correct. `assertEditAccess` is the sole authority gate — it already blocks runtime game agents and admits the assistant. Never route card-content mutations through the save transaction; that is a semantic contradiction (accepting the scope but delegating to a transaction that rejects its paths).
- **"Visible = editable = manageable" principle**: if a path is visible in the resource manager, the user can edit it (via the Studio editor) and the desktop assistant can manage it (via `workspace_write`/`workspace_delete` at its configured actor level). There is no "visible but assistant cannot touch" gray zone — the resource manager's visibility is the contract for both human and assistant editability. This includes the assistant managing its own definition. See also the [Data Fileification Principle](../../guides/data-fileification-principle.md).
- Checkpoints snapshot and restore save runtime files only. Restored checkpoints continue to use current Game Card content.

### Validation & Error Matrix

- Card content path under `save/...` or `.tsian/...` -> reject card write/import.
- Runtime game agent (level 1) workspace write/delete on `card-content` -> `WORKSPACE_EDIT_ACCESS_DENIED` (editLevel 2 required). They can only write `save-runtime` (editLevel 1).
- Runtime game agent workspace write/delete under `.tsian/...` without actor level 4 -> `WORKSPACE_PLATFORM_METADATA_FORBIDDEN`.
- Desktop assistant write/delete denied when its configured `workspaceAccess.level` < the target scope's `editLevel` (`card-content`: 2, `save-runtime`: 1, `platform-meta`: 4). The level is resolved from the agent config, never hardcoded.
- Effective workspace read/list/search -> hides `.tsian/...` and can surface both card content and `save/...` files.
- **Never hardcode `actorLevel` for the desktop assistant path** — a hardcoded value short-circuits the fallback chain and silently overrides the user's configured level. Always resolve it dynamically (undefined when config is missing, so the default applies).
- **Never route `card-content` mutations through the save transaction** — it only accepts `save/...`, so routing card-content there throws a path-required error, a semantic contradiction. Route card-content write/delete through dispatch instead.

## Scenario: Runtime Tool Boundary Classification

### Scope / Trigger

- When platform-web adds or changes Agent Runtime tools, action executors, platform actions, or Skill action conventions.

### Contracts

- Add a platform runtime primitive only when the ability is small, stable, cross-playstyle, and requires runtime internals such as Agent registry, Skill registry, context assembly, model invocation, trace, checkpoint behavior, workspace indexes, or tool/session state.
- Keep primitives few. Current examples: `use_skill` (declare intent + framework injects full SKILL.md next round), `run_script` (execute a Skill's `browser_script` action), generic workspace operations (`workspace.read/list/search/...`), and contacts-gated `agent_call`.
- Add a platform controlled action/executor when the ability performs side effects or needs platform execution control (scoped workspace mutation, browser-limited script execution, remote HTTP, WASM, abort/timeout, result normalization, frontend-data mutation).
- Add a Skill action when the ability is gameplay/world/memory/rules/narrative/style/author-policy specific, or when it packages several primitive/controlled actions into a reusable business operation.
- Keep gameplay data structures in Runtime Workspace files, README files, and schemas. Platform code should not hardcode world-state semantics when a Skill plus workspace schema can own them.
- Do not add platform tools merely because Web lacks Bash. Bash-like breadth should be approximated through controlled executors plus reusable Skill actions, not an unbounded built-in tool list.
- `browser_script` is the **only** supported Skill action executor. `builtin`, `platform_action`, and `workspace_operation` executor types are rejected at parse time and registry build. Single workspace operations use the top-level `workspace.read/write/...` tools directly; multi-step workspace orchestration is written as a `browser_script` that chains SDK calls.

### Validation & Error Matrix

- New runtime primitive without runtime-internal dependency -> reject in review; implement as Skill action.
- New platform action that mutates workspace/state without allow-listing and input validation -> reject in review.
- New Skill action that bypasses `use_skill` activation gating -> reject in review.
- New Skill action declaring a non-`browser_script` executor -> reject in review.
- New platform code that hardcodes gameplay-specific state semantics -> reject in review unless a task explicitly promotes that semantic to platform scope.
- New tool/action that can produce large raw prompt/context output -> require summary behavior, pagination, or explicit read-by-path semantics.

## Scenario: Workspace-Defined Agent Runtime

### Scope / Trigger

- When `interaction.sendMessage` runs AIRP turns using Runtime Workspace Agent definitions.

### Contracts

- `platform-host` owns storage access. It must initialize the save runtime defaults, assemble the effective workspace, then pass it into Agent Runtime.
- `agent-runtime` owns prompt composition. It assembles context for the single entry agent call; the entry agent orchestrates other agents through `agent_call` as directed by its `AGENT.md`, `SOUL.md`, and contacts configuration.
- Model messages may include `AGENT.md`, optional `SOUL.md`, notes/session files, declared context files, missing context paths, filtered lightweight skill index, recent history, turn number, and player input.
- Skill indexes inside runtime prompts must remain lightweight; do not load `SKILL.md` bodies from the default turn path.
- `agent-runtime` must not import Dexie tables, platform bridge objects, or platform-host helpers (purity boundary).

### Validation & Error Matrix

- Empty save runtime data on an active save -> fill `save/...` defaults before runtime reads files.
- Effective workspace missing the entry agent definition -> fail with a clear runtime error; do not fall back to legacy hardcoded prompts.
- Effective workspace missing `agents/<agent>/SOUL.md` -> continue without `soulFile`; this is compatibility input, not a runtime error.
- Missing declared `contextPaths` -> include missing path diagnostics in prompt context; do not fail the turn for that reason alone.
- Model returns empty reply -> keep existing empty-reply error behavior.

## Scenario: Runtime Agent Tool Calls

### Scope / Trigger

- When the Agent Runtime lets a model request Skill detail, invoke Skill actions, call workspace operations, or delegate to other Agents during a turn.

### Contracts

- `agent-runtime` must not import Dexie, storage helpers, bridge objects, or `platform-host` (purity boundary).
- The Agent Runtime supports two tool-call modes, selected per model via `toolCallMode`:
  - `text` (default): the legacy text-embedding protocol. `callModel` returns a string; the tool loop parses calls and threads observations back as user messages.
  - `native`: API-native function calling. The runtime sends the provider's native `tools` field and structured messages (assistant `toolCalls` + tool observation role with `toolCallId`), and returns a structured result. Tool execution logic is shared with the text path.
- Tool-schema building and prompt instructions branch on `toolCallMode`: native mode removes the text-protocol format teaching (the API owns tool-call formatting); text mode keeps it.
- The `toolCallMode` capability is resolved once per turn from the entry/local-assistant agent's model config and drives the whole turn's dispatch. Delegated `agent_call` targets resolve their own model config; if their model is `text` while the turn is `native`, the turn's native dispatch still applies (single-turn mode assumption — configure all contacted Agents' models consistently for now).
- Streaming (SSE) is native-mode only. Delegated `agent_call` targets are built without `onDelta`, so only the entry agent streams to the UI. Tool-call arguments stream incrementally; the stream loop accumulates tool calls in the background and pushes every text delta to `onDelta`.
- Effective runtime permissions are derived from the current Agent's `agent.json` (`platformTools` and `workspaceAccess`).
- `use_skill`/`run_script` are available by default (Skill installation/enablement is player/card-author controlled). `ask_user` is on for the assistant by default, off for game agents by default. `agent_call` only with contacts + `agent_call` enabled. Workspace read tools under `workspace_read`; workspace write/delete/move/validate under `workspace_write`.
- `workspace_read` maps to `list`, `search`, `read` (+ `semantic_search`). `workspace_write` maps to `diff`, `write`, `edit`, `move`, `delete`, `validate`.
- **`use_skill` is the two-step flow's first step**: it declares intent, parses `tsian-actions` fenced JSON blocks from the `SKILL.md` body, and registers declared actions into the session state. Its observation returns only a lightweight confirmation (activated skill + action summaries) — it must NOT return the full `SKILL.md` content, a resource index, or resource file contents.
- After a round in which `use_skill` activated new skills, the framework injects each newly-activated skill's full `SKILL.md` as an extra user message (after that round's tool observations, before the next model call). Injection is de-duplicated so repeated `use_skill` on the same skill does not re-inject. The model sees the full SKILL.md in the next round's context without spending a tool-result round on it.
- `use_skill` resolves only against the current Agent's visible `skillIndex` (a Skill on disk but removed by `disabledSkills` or a non-matching non-empty `enabledSkills` list cannot be activated). Match `name` first, then `id` for compatibility. If a local and shared Skill share a name, prefer the current Agent's local Skill. `use_skill` is parallel-safe (only mutates session state, not workspace).
- Declared Skill action summaries (name + description + `browser_script` executor type) are parsed at registry build time into the Skill Index so the model can see which actions a Skill offers before `use_skill`. Full action declarations (inputSchema/outputSchema/executor path) are NOT in the eager Skill Index or `agent-context` — progressive disclosure is preserved.
- `run_script` requires that the named Skill has already been activated via `use_skill` by the same Agent during the same tool loop; otherwise `SKILL_NOT_ACTIVATED`. It validates action availability, executor type (`browser_script` only), and input before invoking the executor. It checks the lightweight executor-class policy before running (default allows `browser_script`; injected policy may deny it — no Settings UI/localStorage/trust state for this slice). It may validate successful executor output when the action declares optional `outputSchema`. It is kept serial (not parallel) because `browser_script` has side effects and a bounded timeout.
- `agent_call` is exposed only when the current Agent has visible contacts, the tool loop allows Agent calls, and the Agent's platform tool config enables `agent_call`. It validates the target against the caller's `contacts` (a runtime stability boundary, not a full security model). It builds the target Agent's own context (`AGENT.md`, optional `SOUL.md`, notes/session, declared context files, filtered lightweight Skill Index) and returns a structured observation; the target response does not directly become player-visible history. `historyMode` defaults to `recent`.
- Agent Runtime collaboration policy is code-level/default-only: defaults are `maxDepth=2`, `historyWindows={ minimal: 0, recent: 6, scene: 12 }`; runtime capabilities may inject policy overrides, but there is no Settings UI/localStorage/trust state. The tool loop has **no per-Agent round limit** and `agent_call` has **no per-turn call-count limit** — termination relies on `finishReason: stop`, abort, and the mode-specific budget fallback. `maxDepth=2` remains as the recursion safety net. The root turn shares one `agent_call` budget across the entry agent and nested delegated steps.
- Delegated Agents derive their own runtime permissions from the target Agent's `agent.json`; the caller Agent's permissions must not leak into the target Agent step. They may use their own workspace operations, `use_skill`/`run_script`, and limited nested `agent_call` (contacts-gated at every hop, depth-limited). There is no per-turn call-count budget; frequency is bounded by the turn token budget, not a count cap.
- `SKILL.md` action declarations use a fenced JSON block whose info string includes `tsian-actions`. Each action specifies `{ name, description, inputSchema, outputSchema?, executor: { type: "browser_script", path, timeoutMs? } }`. `browser_script` is the only supported executor type; `builtin`/`platform_action`/`workspace_operation` are rejected at parse time and reported in `actionDeclarationErrors`. `path` resolves relative to the declaring Skill directory and must stay under that directory.
- The first browser script capability profile is a strong Tsian SDK, not raw browser/internal access. Scripts can use SDK workspace read/list/search/glob/diff/patch/write/move/delete/validate, SDK fetch where browser policy permits, structured log/trace, timeout/abort, and JSON-compatible input/output. SDK `tsian.workspace` methods mirror the top-level workspace tools and must pass the same Agent `workspace_read`/`workspace_write` exposure gates — they must not bypass the operation allow-list or actor-level checks. The first slice must not expose raw DOM, `window`, internal bridge objects, Vue app state, or platform-host internals as supported script APIs.
- Generic workspace operations pass two hard gates: the operation must be exposed in the current runtime context, and the actor level must satisfy the target read/edit level. Missing/invalid `workspaceAccess.level` defaults to `1`. **Exception — desktop assistant**: its actor level is resolved live from `.tsian/local/assistant/agent.json` (default `4`), not from the runtime agent context. The `executePlatformAction` path must never hardcode `actorLevel`.
- Inside `interaction.sendMessage`, save-runtime workspace mutations run against a staged transaction. Same-turn tools and scripts must see staged writes/deletes, but ordinary workspace mutations persist only when the turn succeeds. Successful turns commit the staged state atomically with accepted snapshot/history and after-turn checkpoint creation. Failed or aborted turns discard ordinary staged mutations.
- Ordinary Agent/Skill workspace mutations must reject `.tsian/*` targets — that is platform-owned metadata space.
- Frontend bridge `platform.runAction` workspace actions remain immediate platform actions, not part of the Agent Runtime turn transaction.
- Runtime prompts should display Skill Index entries as `name/description/triggers/applicability` (plus parsed `actions` summaries) and should not default to exposing `path=...`.
- Use `workspace.read/list/search` for third-layer files only: files explicitly referenced by the injected `SKILL.md`, world data, memory, README files, or other current-task context.
- Workspace path rules: normalize backslashes to slashes; trim leading slashes; reject empty file paths, trailing slash file paths, `.`, `..`, and empty path segments; allow empty directory path for root listing. `workspace.read` returns a superset of `WorkspaceFile` carrying line-slice metadata (`totalLines`/`returnedLines`/`offset`/`truncated`/`isBinaryPlaceholder`); binary files return the placeholder untouched and must not be sliced. `workspace.search` `query` (substring) and `pattern` (regex) are mutually exclusive; per-file matches are capped with `matchesTruncated`.
- Tool observations are returned to the same Agent as a normal user message. Final entry agent output must strip tool-call blocks and must not expose tool observations to players.

### Validation & Error Matrix

- Malformed/non-object tool payload, missing name, non-object arguments, or unknown tool name -> error observation.
- `use_skill`: missing/blank name -> `SKILL_NAME_REQUIRED`; unknown/invisible Skill -> `SKILL_NOT_FOUND`; ambiguous after local/shared priority -> `SKILL_NAME_AMBIGUOUS`; missing `SKILL.md` after resolution -> `SKILL_DETAIL_NOT_FOUND`.
- `run_script`: missing skill/action -> required errors; before `use_skill` -> `SKILL_NOT_ACTIVATED`; undeclared action -> `ACTION_NOT_FOUND`; non-`browser_script` executor -> `ACTION_NOT_BROWSER_SCRIPT`; schema-invalid input -> `ACTION_INPUT_INVALID`; executor denied by policy -> `ACTION_EXECUTOR_DISABLED`; timeout -> `ACTION_EXECUTOR_TIMEOUT`; abort -> `ACTION_EXECUTOR_ABORTED`; output fails `outputSchema` -> `ACTION_OUTPUT_INVALID` (with output summary, not raw large output); malformed `outputSchema` -> `ACTION_OUTPUT_SCHEMA_INVALID`; path outside declaring Skill directory -> `BROWSER_SCRIPT_PATH_INVALID`.
- `agent_call`: missing agentId/request -> required errors; no active Agent context -> `AGENT_CALL_CONTEXT_REQUIRED`; target not found -> `AGENT_CALL_TARGET_NOT_FOUND`; target not in contacts -> `AGENT_CALL_TARGET_NOT_CONTACT`; beyond `maxDepth` or unavailable -> `AGENT_CALL_UNAVAILABLE` with compact depth/budget metadata (no per-turn call-count limit; `callCount` is diagnostic only); invalid `historyMode` -> `AGENT_CALL_HISTORY_MODE_INVALID`; delegated execution failure -> `AGENT_CALL_FAILED` (timeout -> `{ timeout: true }`).
- Workspace: unexposed operation or disabled read/write group (generic or browser script SDK) -> `WORKSPACE_OPERATION_NOT_EXPOSED`; actor level below target read/edit level -> `WORKSPACE_READ_ACCESS_DENIED`/`WORKSPACE_EDIT_ACCESS_DENIED`; `.tsian/*` without level 4 -> structured workspace error; missing file on read -> `WORKSPACE_FILE_NOT_FOUND`; invalid path -> workspace path error.
- Action executor declaration missing or non-`browser_script` type, or invalid `path`/`timeoutMs` -> `ACTION_EXECUTOR_INVALID` at parse time, reported in `actionDeclarationErrors`, that action not registered.
- Runtime turn fails/aborts after staged ordinary workspace writes -> persisted state remains equivalent to the pre-turn accepted state (except host-owned failed trace diagnostics).
- Malformed `tsian-actions` blocks -> report declaration errors without failing the whole Skill activation.
- **Narrative mode**: turn token budget reached a second time after one in-turn narrative compression (or budget reached when no agent-context snapshot is available) -> return the last round's stripped text if present; otherwise throw a budget-exhausted error surfaced as a soft "上下文已满" prompt (keeps already-streamed thought, not a hard error). The first budget crossing triggers in-turn compression on the narrative span (tool interactions preserved). No per-Agent round limit.
- **Task mode** (delegated + assistant): budget crossing -> timeout check -> multi-compress on the tool-interaction span (no count cap) -> stall early-exit if yield < 10% -> budget-exhausted error when nothing left to compress. All surface as soft prompts (delegated: `AGENT_CALL_FAILED` observation with timeout/stalled details). See the "Turn Token Budget And In-Turn Compression" scenario.

## Scenario: Native AIRP History Writeback

### Scope / Trigger

- When `interaction.sendMessage` persists player-facing AIRP history into Runtime Workspace.

### Contracts

- Raw AIRP history is the native fallback memory substrate: complete, reliable, minimally interpreted, and checkpoint-scoped.
- Raw history stores only the player input and final assistant narrative output for a successful turn. It must not store model prompts, tool observations, trace events, delegated Agent intermediate outputs, or hidden debug data.
- Store raw history at turn granularity (one file per turn under `save/history/turns/`), not as a monolithic all-history JSONL file, so workspace search can return matching individual turns.
- Keep raw history separate from `.tsian/traces/`; trace is platform debug material and normal workspace list/search hides it by default.
- Enhanced AIRP memory (timelines, summaries, world facts, character state, relationships, vector indexes, semantic retrieval) are derived workspace projections belonging to Skills, Agents, or content-specific conventions — not a platform-owned gameplay memory schema.
- Direct manual correction of a raw turn file is acceptable; do not add an amendment/revision overlay unless a future task explicitly chooses it.
- Successful raw history writes are staged as ordinary Runtime Workspace files and committed atomically with accepted snapshot/history and after-turn checkpoint creation.
- Failed or aborted turns must not leave ordinary raw history records.
- Existing `saveHistory` and snapshots remain the current chat display source; raw workspace history intentionally duplicates the player-facing exchange for runtime memory/feedstock use.

### Validation & Error Matrix

- Successful turn -> one raw history turn file exists, including exactly one user and one assistant message for that turn.
- Aborted turn before final acceptance / Agent Runtime failure -> no raw history turn file is written.
- Later successful-turn commit failure -> no partial raw history/snapshot/checkpoint state is accepted.
- Existing saves -> no backfill required; they start writing per-turn raw history on future successful turns.

## Scenario: Agent Session Transcript And Skill-Triggered Maintenance

### Scope / Trigger

- When successful Agent Runtime turns persist Agent-facing transcripts, or an activated Skill action applies notes/timeline/summary maintenance.

### Contracts

- Session transcripts are Agent-facing replay/debug substrate, not platform operational logs. They live under `save/agents/<agent>/session.jsonl`, append-only for this slice (do not segment/trim/compress/archive here).
- Transcript records may include model messages sent to the Agent, injected context snapshots inside those messages, model output, parsed tool calls, tool observations, Agent id/path/title, debug label, model-call index, round, status, timestamp, and turn. They must exclude storage internals (Dexie ids, hidden transaction snapshots, full trace payloads not returned to the Agent).
- Session transcript writes are staged after Agent Runtime succeeds and committed atomically with raw history, trace, snapshot/history, and checkpoint. Failed or aborted turns must discard ordinary session transcript writes.
- Enhanced memory maintenance does not run automatically every turn. It runs only when an Agent loads a Skill that declares an action and calls that action.
- The official maintenance Skill uses the existing `browser_script` executor and Tsian SDK workspace writes. Do not add a maintenance-specific platform action unless a future task explicitly revises this contract.
- Valid maintenance writes are limited to `save/agents/<agent>/notes.md`, `save/history/timeline.md`, `save/memory/summaries/current.md`, and `save/memory/summaries/long-term.md`.
- Empty `writes` is a valid explicit no-op maintenance decision.
- Invalid maintenance plans become structured action/script observations and trace summaries; they must not mutate ordinary workspace files.
- `.tsian/*` remains host-owned platform metadata and is never a valid ordinary maintenance target.
- New saves include the official maintenance Skill and the official workspace-assistant substrate. Existing non-empty saves receive missing official default files through a versioned default workspace upgrade that preserves same-path user files and does not recreate those files after the upgrade marker is current.

### Validation & Error Matrix

- Successful no-tool turn -> entry agent session JSONL record is appended.
- Successful `agent_call` -> the delegated Agent also receives its own session JSONL records.
- Successful turn with no maintenance action -> no notes/timeline/summary maintenance mutation is synthesized.
- Loaded maintenance Skill plus valid plan -> approved target files are written through the staged workspace transaction.
- Loaded maintenance Skill plus empty plan -> action returns no-op and no maintenance files are mutated.
- Invalid schema, invalid path, invalid mode, non-string content/reason, oversized content, or `.tsian/*` target -> action observation is an error and no maintenance writes are applied.
- Existing save with runtime workspace version below current -> missing official save runtime files are created, existing same-path files preserved, manifest advances.
- Existing save with current runtime workspace version -> deleted official save runtime files are not recreated on every turn.

## Scenario: Runtime Trace Persistence

### Scope / Trigger

- When Agent Runtime emits turn/tool/action trace and platform-host persists it into Runtime Workspace.

### Contracts

- Trace is platform-owned workspace content: platform writes it, Agent context does not inject it by default, and ordinary workspace read/list/search hides it as part of `.tsian/*` metadata.
- Trace lives under `.tsian/save/traces/turns/` as JSONL (one file per turn), follows checkpoint/restore, and successful turns include trace in the accepted workspace state before the after-turn checkpoint is created.
- Failed turns attempt to write a `turn_failed` trace if workspace files are available, but failed-turn trace persistence must not mask the original runtime error.
- Trace records **metadata only, no business content fragments** (no reply text / tool result previews — those live in turn files / workspace files). See the "Trace Diagnostics" section in the frontend spec index.
- Trace must record summaries, not large raw payloads:
  - model calls: message count, output length, tool-call count, finishReason, usage (input/output/total tokens when available), toolCalls summary (tool name + argument key names, not values);
  - Skill loads: skill name/path, action count, declaration error count;
  - Agent calls: caller/target ids, target title, input/output summaries, status or error, durationMs;
  - workspace tools: path/query/limit, result count, file metadata for reads, no file content, durationMs;
  - action executor policy checks: skill/action/executor metadata and compact allow/deny reason/source, no action input or script content;
  - action calls: skill/action/executor, input/output summaries, status or error;
  - browser scripts: script path/source size/start events and script log/trace summaries, no script source or large raw data;
  - workspace mutations: write path/size or delete `deletedPaths` (no `updatedAt` file-metadata — not a diagnostic field);
  - context compression: before/after token counts + ratio (the compression *effect*, not just the parameters);
  - failed events (turn/agent_step/model): error message/code + truncated `errorStack` (`TRACE_ERROR_STACK_LIMIT`).
  - Do not record mechanism-internal state (caller depth, max depth, call count, history mode) or skill固有属性 (scope, agentId) — they are not runtime diagnostics.
- `agent-runtime` must not import Dexie/storage/bridge/host; it emits trace through an injected callback. `platform-host` owns trace persistence through explicit platform-owned workspace storage helpers.
- Ordinary generic workspace reads must not expose `.tsian/*` unless the actor has platform-meta read level. Use dedicated resources (`runtime-diagnostics`) for Agent-facing facts.

### Validation & Error Matrix

- Successful turn -> one valid JSONL trace file under `.tsian/save/traces/turns/`.
- Runtime failure after workspace is available -> failed trace is attempted and original error is rethrown.
- Trace write failure on successful turn -> fail loudly before checkpoint creation.
- Trace `data` contains non-JSON values -> collector normalizes to JSON-compatible values.
- Workspace read/list/search on root or `.tsian` path -> no platform metadata contents are exposed.

## Scenario: Agent-Facing Runtime Diagnostics

### Scope / Trigger

- When platform-web exposes compact Agent-facing diagnostics derived from Runtime Trace files.

### Contracts

- Diagnostics are an on-demand query view over `.tsian/save/traces/turns/*.jsonl`; do not persist derived diagnostic workspace files. The trace path pattern in `diagnostics.ts` must match `formatRuntimeTracePath` (`.tsian/save/traces/turns/turn-*.jsonl`).
- `runtime-diagnostics` returns one summary per trace file / turn attempt, not one top-level item per raw trace event.
- Default behavior prioritizes failed/anomalous traces. Successful-turn health summaries are returned only when `includeHealth` is true or an exact `turn` query requests them.
- Summaries are facts-only. Do not add platform-authored repair suggestions, probable-cause narratives, or hardcoded `nextChecks`.
- Lightweight normalization is allowed for runtime-area identification: `source`, `eventType`, raw `code`/`message`, Agent id/debug label, Skill/action/tool/executor names, and directly related workspace paths. Related paths must come from direct trace facts; drop `.tsian/*` paths from Agent-facing `relatedPaths`.
- Diagnostics must stay bounded: result limit, lookback window, per-summary fact limit, related path limit, and message/details previews.
- Malformed trace lines must not crash the whole query; return compact trace parse facts or counts.
- The diagnostics builder must stay pure (workspace files in, summaries out; no Dexie/storage/bridge/host imports). `platform-host` owns the bridge query wiring.
- Do not add `runtime-diagnostics` as a default live-turn Agent tool or prompt instruction.

### Validation & Error Matrix

- No active save / no trace files -> query returns `{ items: [] }`.
- Failed trace file -> query returns a failed summary with raw error code/message facts when present.
- Successful trace with `includeHealth` false and no anomalies -> omitted from default results.
- Successful trace with `includeHealth` true -> compact health summary only; no raw event stream.
- Trace with malformed JSONL line -> query still returns valid summaries and records malformed-line facts/counts.
- Trace paths or details under `.tsian/*` -> omitted from `relatedPaths`.

## Scenario: Turn Token Budget And In-Turn Compression (Narrative + Task modes)

### Scope / Trigger

- When Agent Runtime tool loops estimate runtime message tokens before each model call and compress when the budget is crossed. Two compression modes: `narrative` (master) and `task` (delegated `agent_call` targets + desktop assistant).

### Contracts

- The tool loop has **no per-Agent round limit**. Termination conditions are: `finishReason === "stop"` / no tool calls; abort; and the mode-specific budget fallback.
- Before every model call, the loop estimates runtime-message tokens. When tokens exceed the budget trigger threshold (85%), the loop branches on `compressionMode`:

  **Narrative mode (master):**
  - First crossing: compress the narrative span (compress only the narrative summary + recent turns, preserve all tool interactions), update the agent-context snapshot in place, splice-replace the narrative span in the runtime messages, mark `compressedThisTurn = true`, continue the loop.
  - Only the entry-agent steady-state path (an agent-context snapshot was injected) performs in-turn narrative compression. The `最近对话：` fallback path has no injectable snapshot and skips compression; it still runs the budget fallback.
  - A second budget crossing (or any crossing when narrative compression is unavailable) is the fallback: return the last round's stripped text if present; otherwise throw `ContextBudgetExhaustedError`.
  - In-turn narrative compression is allowed at most once per turn.
  - Master does **not** create a timeout controller — narrative mode relies on one-shot compression + user abort; a timeout would mis-kill narrative deep thought.

  **Task mode (delegated `agent_call` targets + desktop assistant):**
  - Every crossing is a compression attempt (no cap; multi-compress unlimited). Before compressing, check elapsed time: if the task timeout has elapsed, throw `TaskTimeoutError`.
  - Locate the tool-interaction span. If no span exists, fall back (return last stripped text / throw `ContextBudgetExhaustedError`).
  - Compress: slice the tool-interaction span, keep the recent 5 tool rounds, summarize earlier rounds into one `已完成工作摘要` user message. If the early span is empty or tool interactions ≤ 5, fall back.
  - After compression, if yield < 10% (compression barely reduced tokens), throw `TaskCompressionStalledError` (stall early-exit, do not burn budget waiting for timeout).
  - Task compression never touches the agent-context snapshot (in-turn tool-interaction compression is separate from cross-turn snapshot). The in-turn summary text lives only within the turn. The **assistant** has cross-turn snapshot persistence (see "Assistant Cross-Turn Context Persistence"); **delegated `agent_call` targets** have no cross-turn persistence.

- **Timeout fallback (task mode only):** delegated `agent_call` and the desktop assistant each create an independent `AbortController` + timeout, merged with the user-abort signal into a composite signal. On timeout, the catch re-surfaces `TaskTimeoutError` (delegated: wrapped as `AGENT_CALL_FAILED` observation with `{ timeout: true }` so master can distinguish; assistant: thrown to the view).
- The view recognizes `ContextBudgetExhaustedError`, `TaskTimeoutError`, and `TaskCompressionStalledError` by error name (no runtime-internal import). All three route to the same soft-halt branch (symmetric with abort): keep already-streamed thought, append a soft note when content exists (or set content to the soft prompt when empty), persist the session, and do **not** set an error message or pop the placeholder.

### Validation & Error Matrix

- Narrative first crossing with a snapshot available -> compress narrative span, continue loop (trace `mode: narrative`).
- Narrative second crossing (or no snapshot) -> return last stripped text if present, otherwise `ContextBudgetExhaustedError`.
- Task crossing -> check timeout; if elapsed `TaskTimeoutError`; else locate span, compress, check stall; if compressed continue (trace `mode: task`); if not compressible or no span -> fallback.
- Task timeout (delegated) -> `AGENT_CALL_FAILED` with `{ timeout: true }`; master continues its own loop. (assistant) -> soft prompt "任务超时，已中止".
- Task compression stall (yield < 10%) -> `TaskCompressionStalledError` -> delegated: `AGENT_CALL_FAILED` with `{ stalled: true }`; assistant: soft prompt "上下文持续膨胀且压缩无效，已中止".
- Compression failure (model call fails/empty summary) -> `ContextCompressionFailedError` (routes to the error-message branch, not the soft-halt branch).
- Tool interactions are never compressed in narrative mode; task mode compresses only the tool-interaction span.
- Master passes `narrative` mode and no `timeoutMs`; master behavior is unchanged.

## Scenario: Parallel agent_call Within A Round

### Scope / Trigger

- When a single tool-loop round issues multiple `agent_call` tool calls, or any `agent_call` needs its process visible upstream.

### Contracts

- `executeRuntimeWorkspaceToolCalls` splits tool calls into three groups: parallel (read-only, stateless tools), `agentCallGroup` (all `agent_call` calls in the round), and serial (writes, `run_script`, unparseable calls). The parallel group runs first via `Promise.all`, then the agent-call group via `Promise.all`, then the serial group in original order. Observations are collected keyed by original call index so the returned array stays aligned with calls.
- Multiple `agent_call` calls in the same round run concurrently. `agent_call` is NOT in the parallel group (it runs a delegated tool loop with workspace writes and nested agent_call); it has its own group because same-round agent_calls are independent of each other.
- The serial group runs after the agent-call group so delegated workspace writes are visible to this round's serial writes. `run_script` stays serial (side effects + bounded timeout).
- `agent_call` observations travel the tool-observation channel; they are NOT wrapped as narrative user messages (would pollute the story span and break narrative compression).
- Parallel `agent_call` targets each run in task compression mode with independent timeout + compression state: each creates its own timeout controller, start time, summary accumulator, and compression count. One agent's compression/timeout does not affect another's. See the "Turn Token Budget And In-Turn Compression" scenario.
- `callCount` increments atomically under JS single-threaded async interleaving; `agentCallDepth` is passed by value (caller-depth snapshot), so parallel agent_calls do not share depth state. No locking is required.
- Workspace writes from parallel agent_calls land in the shared staged transaction array; last-write-wins by path (same semantics as serial). Parallel execution does not introduce a new conflict model.
- There is no per-turn `agent_call` count limit (the turn token budget bounds total volume). `maxDepth=2` remains to prevent unbounded recursion.
- Event sinks (`onDelta`/`onRoundEnd`/`onTool`) carry `agentId` as the first parameter, identifying the emitting agent. The entry agent emits with its own id; a delegated target emits with the target agent id. The native tool loop emits; the text-protocol loop does not (delegated text-protocol agents stay silent). `round` in a delegated event is that delegated agent's own tool-loop round, not the entry agent's round — subscribers distinguish agents by `agentId`, not by comparing `round`.
- The streaming-events bus forwards `agentId` to subscribers; the remote iframe bridge includes `agentId` in event payloads so game frontends can distinguish parallel delegated agents. The desktop assistant view accepts `agentId` for signature uniformity but does not use it (single-agent view).

### Validation & Error Matrix

- Multiple `agent_call` in one round -> run concurrently; observations aligned to original call index.
- Single `agent_call` in one round -> runs in the agent-call group (Promise.all of one) equivalent to serial; behavior unchanged except events carry `agentId`.
- `agent_call` beyond `maxDepth` -> `AGENT_CALL_UNAVAILABLE` with compact depth/budget metadata. No per-turn count-limit error exists.
- `run_script` mixed with `agent_call` in one round -> `run_script` runs in the serial group after the agent-call group.
- Workspace write conflict between parallel agent_calls -> last-write-wins in the staged transaction (no conflict detection).
- Delegated native-mode agent -> emits events with target agent id; delegated text-mode agent -> silent.
- Abort -> shared signal cancels all parallel agent_calls.

## Scenario: Assistant Cross-Turn Context Persistence

### Scope / Trigger

- When the desktop assistant persists its agent context snapshot across turns/loads, or changes the assistant context snapshot lifecycle, schema, storage path, compression prompt, or session-delete cleanup.

### Contracts

- The desktop assistant persists a per-session agent context snapshot as a **virtual file** at `.tsian/local/assistant/sessions/<sessionId>/context.json`. This lives in the `local-assistant-files` Dexie map (same map as agent identity files); the `sessions/` subdirectory separates session state from cross-session identity. The snapshot is agent-visible: the assistant can `workspace_read`/`workspace_list`/`workspace_write` it.
- Multi-session isolation: each session has its own `sessions/<sessionId>/context.json`; switching sessions does not cross-contaminate context. This is why the path is per-session, not a single shared file.
- The snapshot is separate from visible messages (the UI display layer, max 200). Visible messages are the UI display layer; the snapshot is the agent context steady-state layer. This mirrors master's `saveHistory` vs `agents/master/context.json` separation.
- Turn-start: when a context file is absent (legacy session), reconstruct recentTurns from visible-message history (no summary). Derive the next turn from the snapshot so `lastCompressedTurn` dedup works (fixing the prior turn=1-always bug). Inject the snapshot + token budget into the turn.
- Entry turn-start compression runs in **both** modes (narrative and task). Task mode (assistant) compresses the snapshot with a task-summary prompt + 用户/助手 labels; narrative mode (master) uses defaults (unchanged). This snapshot compression is independent of in-turn tool-interaction compression.
- Turn-end (success path only): append the turn to the snapshot and persist directly via `saveLocalAssistantFiles` (merge). It does **not** go through the save transaction — `.tsian/local/` paths have no entry in the save transaction layer (both path validators reject `.tsian/local/`). The direct-merge is the correct local-basket channel, consistent with the resource manager and identity-file writes.
- Turn failure: discard; do not append the failed turn. The snapshot on disk stays at its turn-start state (symmetric to master).
- **Assistant `workspace.write`/`workspace.delete` for `.tsian/local/`**: route directly to `saveLocalAssistantFiles`/`deleteLocalAssistantFile` (bypass the save transaction), so the assistant's level-4 write permission to `.tsian/` actually lands in the local basket. Non-local-assistant `platform-meta` writes still go through the platform file path. This closes the gap where the permission layer allowed the write but the transaction layer rejected `.tsian/local/`.
- **Three-layer write routing for the assistant** (level 4): `card-content` → save transaction → commit → card content files (edits the mounted card — swap card swaps data); `save-runtime` → save transaction → commit → save files; `platform-meta` + local-assistant path → direct local-basket (not in save transaction/checkpoint/distribute). Runtime card agents (level 1) cannot reach `.tsian/` at all — the permission layer blocks them.
- Session delete cleans up the context virtual file alongside the visible-messages key (no orphan data).
- Cross-load recovery: the Dexie map (including `sessions/<id>/context.json`) restores on browser refresh/reopen; the next turn recovers the snapshot — the assistant does not lose context across loads.
- Master is unaffected: master's path, compression prompt, and `interaction.sendMessage` path are unchanged.
- **Tool-call + process-node cross-turn persistence (dual-layer, mirroring the model where UI render context ≠ agent context):**
  - **Agent layer** (snapshot `recentTurns` → `context.json`): tool calls live with the prose, same compression lifespan (recent K rounds raw, earlier compressed into summary). Reconstruction is mode-split: native → structured messages (assistant.toolCalls + tool result role); text → tool-call blocks + observation user messages. Compression presents tool calls to the model (not "discard tool details"). Master does not fill tool calls.
  - **UI layer** (session messages store): tool calls (agent-layer fallback) + process nodes (UI display: thought/tool/interim in occurrence order). Both not compressed, retained up to the message cap. The view reconstructs process nodes 1:1 into the timeline (preserves interleaved order, no type-grouping).
  - **Process-node collection (eliminates double-write)**: both native + text loops accumulate process nodes (thought from delta accumulation, interim from tool_calls round content, tool from the tool callback). The host writes everything on the success path; the UI success path no longer calls `persistCurrentSession` (eliminates the host-write + UI-rewrite double-IO race). Catch paths (abort/error) still use `persistCurrentSession` as fallback.
  - **Observation volume**: the persistence layer does not truncate — stores the tool-return-layer result as-is. `workspace_read` already truncates at the return layer (line limit + offset paging); the agent pages via `offset`. `agent_call`/`inspect_frontend` etc. have no paging yet (tool deficiency, to be patched later).

### Validation & Error Matrix

- No context virtual file for a session (new or legacy) -> reconstruct from visible-message history -> turn proceeds, snapshot written at turn-end.
- Corrupted context virtual file -> fall back to an empty snapshot -> turn proceeds.
- Turn failure -> snapshot on disk unchanged (no append of the failed turn).
- Session delete -> both visible-messages key and context virtual file removed (no orphan).
- Master turn -> unchanged (narrative mode, master path, default compression prompt).
- `AssistantChatInput` without `sessionId` -> compile error (required field).

## Avoid

- Do not reintroduce old prompt/world-book/workflow resource contracts for new Agent Runtime work.
- Do not leak Dexie table records directly into contracts unless they are intentionally shared.
- Do not silently swallow invalid platform action input.

## Scenario: Play Bridge Event Payload Type Alignment

### Scope / Trigger

- When platform-web changes the remote play bridge event payload types, the event-forwarding code, or the streaming-events `turn-delta`/`turn-round-end` `kind` taxonomy.

### Contracts

- `turn-delta` event payload carries `kind: "reasoning" | "content"` (the streaming-text classification). The bridge forwards it verbatim.
- `turn-round-end` event payload carries `kind: "thought" | "final"`. These are distinct `kind` enums on distinct event payloads — do not conflate them.
- The two `kind` fields are separate from the message-envelope `kind` (`hello|ready|request|response|event`). When touching event payloads, verify the union member shape matches what the bridge actually posts.

## Scenario: Assistant Frontend Inspection Tool (inspect_frontend)

### Scope / Trigger

- When platform-web adds or changes the `inspect_frontend` platform tool, the frontend inspector capability, or the inspection bridge/session lifecycle.

### Contracts

- **Inspect types live in agent-runtime**, not platform-host. This respects the spec rule "agent-runtime must not import platform-host." The implementation (orchestration logic) lives in platform-host and imports the types — never the reverse.
- **Special-tool registration touches many files** (mirrors `agent_call`): contracts, permissions, registry allow-set (a tool missing from this Set is silently filtered out on read), workspace-tools (name + types + dispatch), tool-schemas (gating), runtime capabilities threading, assistant default config, the inspector factory, and capability injection. UI switch definitions live in a single shared source imported by both the assistant config panel and studio view. **Default enablement is explicit config, not runtime derivation**: each agent type's default-on tools are written as an explicit array; a runtime-derivation approach was removed because it made "enable a default-on tool" misjudge as already-on and skip the write.
- **Loading reuse**: the inspector calls the same packaged-frontend URL resolver + mount helper as `/play` (1:1 mirror). Does not reimplement mounting.
- **Dedicated bridge**: the inspector uses its own bridge with `interaction.sendMessage` → `runEphemeralTurn`. Must NOT use the play bridge (it ensures an active save, broadcasts streaming to the player frontend, and uses a module-level controller that aborts player turns). `query` reuses the read-only base bridge; `platform.runAction` returns unavailable; no `debug` bridge.
- **Ephemeral save isolation**: `runEphemeralTurn` creates a local save without setting it active or emitting saves-changed, uses its own `AbortController` (not the module-level one), does not commit the turn, and deletes the ephemeral save in `finally`. Capabilities must mirror the `sendMessage` path completely — missing any one causes master agent tool-call failures.
- **send bypasses mount's request path**: the inspector calls `bridge.interaction.sendMessage` directly (not via frontend RPC). Mount's `turn-completed` event is bound to the request-response path, so mount will NOT forward it for inspector-driven turns. The inspector must self-postMessage a `turn-completed` event to the iframe with the session id so the frontend renders message bubbles.
- **Streaming delta forwarding** still works via the mount's bus subscriptions (independent of request path), but only after handshake (origin accepted). The inspector must guard `bridgeReady` before `send` — if handshake hasn't completed, all delta events are swallowed and the turn runs blind to the frontend.
- **Collection is parent-window-side**: the inspector reads `iframe.contentDocument` and hijacks the iframe content window's `onerror`/`unhandledrejection`/`console` (same-origin required — `allow-same-origin` sandbox). Does not require frontend cooperation — blank/broken frontends that never send `ready` can still be diagnosed via DOM empty-state + resource 404 inference.
- **`renderedText` after send/refresh is ephemeral-turn-sourced**, not DOM-sourced: the inspector reads the ephemeral turn result (replyText + history) to populate `renderedText`, bypassing unreliable frontend render timing. `domSummary` still reads real DOM (with a micro-tick buffer). This dual approach ensures `renderedText` is always populated after a turn even if DOM rendering is slow.
- **DOM serialization**: limits depth, skips empty text nodes, truncates long attributes. For input/textarea/select elements, reads `.value` and injects it as a virtual attribute (because `.value` is a JS property, not a DOM attribute).
- **Single-session serial**: a new inspect call disposes the previous hidden iframe first. Dispose also resets the ephemeral turn result and save id (not resetting causes cross-call state leakage where a previous turn's messages appear in the next inspect's initial DOM). The diff baseline is intentionally preserved across calls.
- **diff baseline**: the previous inspect's `structure` + `diagnostics.errors` is retained. First inspect has no diff. Cross-card inspect pollutes the baseline (not bucketed by card) — known boundary, acceptable since the inspector only checks the active card.
- **Deferred options**: `runtime:"mock"` and `screenshot:true` return not-supported errors (interface reserved, not implemented in v1).

### Validation & Error Matrix

- No active game card -> `INSPECT_FRONTEND_NO_ACTIVE_CARD`.
- Active card frontend missing or not `packaged` -> `INSPECT_FRONTEND_NOT_PACKAGED` (with `cardId` + `frontendKind` details).
- `send` with `wait !== "turn-completed"` -> `INSPECT_FRONTEND_SEND_WAIT_MISMATCH` (send requires waiting for turn completion to collect timeline).
- `send` when `bridgeReady` is false (handshake timeout) -> `INSPECT_FRONTEND_BRIDGE_NOT_READY` (delta events would be swallowed; turn would run blind).
- `runtime:"mock"` / `screenshot:true` -> not-supported errors.
- DOM action selector not found -> `INSPECT_SELECTOR_NOT_FOUND`.
- Large results (timeline > 200 entries, actionSnapshots > 50, domSummary at limit) -> `truncated: true`.

## Scenario: Save-Runtime Semantic Search

### Scope / Trigger

- When platform-web adds or changes save-runtime semantic retrieval, embedding config, the embedding index table, or the `semantic_search` workspace operation.

### Contracts

- **Why native, not Skill**: access face (reads Dexie + workspace volumes in-process), permission propagation (native tool exposure + per-agent gating), GC tied to save lifecycle. NOT "write-path bottleneck free increment" — play-time writes all go through staged transaction → commit → direct storage put, bypassing the workspace mutation dispatch. A write hook on that dispatch is dead code for the main corpus.
- **Correctness source = cheap staleness check, not write hooks.** Search-time and turn-commit-time staleness compares `file.updatedAt` vs indexed `fileUpdatedAt`; stale/missing files get re-embedded. This covers all write paths (staged commit, direct volume, card import, studio edit) — losing only freshness, never correctness.
- **Proactive enqueue lives at turn commit**, not on the workspace mutation dispatch. The commit is the real play-time write bottleneck. Enqueue is fire-and-forget (does not block the turn; turn is already persisted).
- **The workspace mutation dispatch has NO embedding hook.** Studio / non-turn writes are covered by search-time staleness; do not add a hook there (dead code for the main corpus).
- **Two-switch decoupling**: embedding capability (control panel, platform-global) vs tool exposure (agent.json, per-agent). Four quadrants (tool × data) are all legal, no error. The two chains meet only at tool execution, best-effort (empty result, not pre-gate throw).
- **Corpus三分**: raw turn (`save/history/turns/*.json`) — one file one chunk, direct user/assistant join; agent condensed (`save/agents/*/notes.md`, `save/memory/summaries/*`) — markdown split by section/paragraph; JSON state (`save/world/`, `save/state/`, `save/frontend/`) — skipped (literal search suffices). Preprocessing belongs to agent/Skill; indexing belongs to native; the two are never done in the same place.
- **No reranker / no query-rewrite LLM pass**: the consumer is the per-turn agent already running; small-K candidates with preview let it self-rerank + `workspace.read` for full text — the already-paid agent inference does the reranker's job.
- **No entity tags / no entityFilter**: cut (narrow benefit, no gain on raw turn, covered by agent self-select). Type pre-filter is the only filter (free, solves cross-type semantic pollution).
- **embeddingConfig is an independent section, not folded into chat provider**: chat model config fields (toolCallMode/streaming/sampling params/contextWindow) are meaningless for embedding, and `toolCallMode` is a required validation — folding would force dummy values or validation branches. `dimensions` is required (hard constraint for vector storage + cosine; wrong value = silent bug).
- **MVP openai-compatible only**: standard embeddings endpoint, no protocol inference. Other protocols added when needed (YAGNI).
- **GC**: save deletion drops the corresponding embeddings. Storage-layer direct (no cross-layer call into agent-runtime).
- **ownerId propagation**: the host injects the active save id as a capability; the runtime threads it to the operation execution context. The runtime layer intentionally does not hold the real save id.
- **DB name bump** (rename-and-reset convention: no migration, old store abandoned). The Service Worker `DB_NAME` must mirror.
- A retrieval agent is seeded with `workspace_semantic_search` enabled + semantic-vs-literal guidance; existing saves upgrade via the default workspace version bump.

### Validation & Error Matrix

- embeddingConfig not configured / incomplete (incl. missing dimensions) -> config resolves null -> index does not grow, `semantic_search` returns `[]` (no throw). Agent falls back to literal `search`.
- Embedding API failure (network / dimension mismatch) -> `semanticSearch` catches -> returns `[]`; embed-queue drops the job (staleness re-discovers it next search).
- Index empty for an owner -> `[]`, no throw.
- Tool enabled but data absent -> `[]`; tool absent but data present -> background indexing legal; both absent -> all off. Four quadrants legal.
- `semantic_search` without ownerId in context (non-save scenario) -> `[]`, no throw.
- Save deletion -> corresponding embeddings dropped (GC).
- Malformed raw turn JSON -> chunker skips that file (no index crash).
- `typeFilter` narrows corpus; omit to search all kinds.

## Scenario: Turn-Tool Event Output And Tool Process Display

### Scope / Trigger

- When platform-web changes the `turn-tool` event payload, tool output building, tool-card rendering, or how tool-call process data flows from runtime to UI.

### Contracts

- **Two independent paths from the same observation**: (1) model path via the observation formatter — full `JSON.stringify(observations)`, fed back to the model, **never truncated, never touched by UI display changes**; (2) UI path via the tool-output builder → `onTool` → `turn-tool` event — for display only, does not enter model context.
- **Truncation lives in UI, not runtime.** The tool-output builder returns complete output. The default game frontend and desktop assistant decide whether to display, fold, or length-limit. The old fixed-length truncation constant and summarizer are removed.
- **agent_call structured output**: the builder detects `agent_call` and extracts `{type:"agent_call", targetAgent, response, status}` instead of `JSON.stringify`-ing the whole result. `response` is the delegated agent's final natural-language reply (player-readable), passed complete. Failure -> `{type:"agent_call", status:"failed", error}`.
- **Ordinary tools**: the builder returns `JSON.stringify(result)` complete, no truncation. The default game frontend and desktop assistant **do not render ordinary tool output** — only tool name + success/failed status icon. This is a product decision (structured output is not player-readable), not a technical limitation.
- **Process zone cross-turn retention (default game frontend only)**: an in-memory array accumulates completed turns' process nodes (`thought`/`tool`/`interim`), rendered in a process-history-zone before snapshot messages. **Not persisted** — page reload / save reload clears it (only snapshot text remains). The desktop assistant already had this via its reactive timeline array.
- **ask_user rendering model (desktop assistant only)**: an active `ask_user` request does **not** render an interactive card in the timeline. Instead the view deforms the footer input area into a question surface (question + option buttons + optional custom input + cancel) — the normal textarea/send/stop are hidden, so only one input region exists at a time and the question stays pinned at the focus position regardless of scroll. The thinking bubble is gated off while ask is active. A read-only `ask` node is written into the timeline only *after* the player answers or cancels — preserving the Q&A as scrollable history. Re-introducing an interactive ask card in the timeline regresses the two-input-box / scrolling-question problem — don't.
- **`TurnToolOutput` is a discriminated union**: frontends branch on `typeof output === "string"` (ordinary) vs object with `type === "agent_call"`. Old remote frontends receiving an object output worst-case skip rendering it — does not break RPC responses. Contract version stays tolerant (superset extension).
- Runtime validation of `turn-tool` output belongs in platform-web, not in shared contracts (contracts only defines the type).

### Validation & Error Matrix

- Builder with `call === undefined` (parse error) -> ordinary branch -> `result === undefined` -> returns `undefined` (failed tool card shows status only).
- agent_call success with missing `targetAgent`/`response` -> degrades to empty strings (never throws).
- agent_call failure (`ok === false`) -> structured `{type:"agent_call", status:"failed", error}`.
- `JSON.stringify(result)` throws (cyclic) -> ordinary branch catch -> returns `undefined`.

