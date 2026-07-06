# Agent 工具机制：类 MCP 工具发现与卡定制层 — Implement Plan

## Preconditions / Review Gate

- Task remains `planning` until this plan, `design.md`, and PRD convergence are reviewed.
- Do not run `task.py start` until the user approves the final planning artifacts.
- Before editing code in Phase 2, load the relevant specs:
  - `.trellis/spec/contracts/frontend/index.md`
  - `.trellis/spec/contracts/frontend/type-safety.md`
  - `.trellis/spec/platform-web/frontend/index.md`
  - `.trellis/spec/platform-web/frontend/type-safety.md`
  - `.trellis/spec/platform-web/frontend/state-management.md`
  - `.trellis/spec/platform-web/frontend/component-guidelines.md`
  - `.trellis/spec/platform-web/storage/index.md`
  - `.trellis/spec/guides/agent-skill-design-principles.md`
  - `.trellis/spec/guides/ai-facing-content-changes.md`
  - `.trellis/spec/guides/data-fileification-principle.md`

## Implementation Checklist

### 0. Baseline / preflight

- [ ] Confirm git status is clean or record existing changes.
- [ ] Run `npm run build:contracts` and `npm run build:web` if baseline confidence is needed; otherwise at least run them after implementation.
- [ ] Re-open key anchors from `design.md` before editing.

### 1. Contracts / types

- [ ] Extend contract types for Agent config:
  - add `tools: { enabled: string[]; disabled: string[] }` to agent registry/config shapes;
  - default missing `tools` to empty arrays for old cards;
  - preserve existing `skills` and `platformTools` behavior.
- [ ] Add Tool registry model types:
  - `ToolRegistryEntry`;
  - `ToolRegistryScope`;
  - `ToolRegistryQueryOptions`;
  - `RegistryDiagnostic`.
- [ ] Extend `AgentContextEntry` / Studio snapshot types to carry `toolIndex` and registry diagnostics.
- [ ] Ensure new public types use strict, explicit fields; no `any`.

Rollback point: if type changes cascade too widely, back out contracts first and re-evaluate whether diagnostics should live in a platform-web-local type for v1.

### 2. Registry discovery and diagnostics

- [ ] In `apps/platform-web/src/agent-runtime/registry.ts`, add path parsing for:
  - `tools/<id>/tool.json`;
  - `agents/<agent>/tools/<id>/tool.json`;
  - `.tsian/local/<agent>/tools/<id>/tool.json` if symmetry is cheap.
- [ ] Implement `parseToolManifest`:
  - validates JSON object;
  - requires `name`, `description`, `parameters`, `executor.type === "browser_script"`, `executor.path`;
  - accepts optional `title`, `timeoutMs`, `helpers`, `outputSchema`;
  - normalizes `title` fallback to `name`.
- [ ] Implement `buildToolRegistry(files)` returning `{ tools, diagnostics }`.
- [ ] Implement conflict handling:
  - platform-reserved names -> error diagnostic + skip;
  - same-scope duplicate `name` -> error diagnostics + skip all conflicting entries;
  - agent-local overrides shared -> info diagnostic + local wins at filter time.
- [ ] Implement `filterToolsForAgent`, `isToolEnabledForAgent`, `toolMatchesReference` mirroring Skill helper semantics.
- [ ] Keep Skill registry behavior unchanged.

Rollback point: if diagnostics threading becomes large, keep `buildToolRegistry` pure and return diagnostics only to Studio first; runtime can ignore diagnostics until final pass.

### 3. Agent context and permission/gating path

- [ ] Update agent config parsing to default `tools.enabled/disabled`.
- [ ] In `context.ts`, build `toolIndex` next to `skillIndex`.
- [ ] Update `deriveAgentRuntimePermissionProfile` only if needed; custom tools may also be carried directly in `AgentContextEntry.toolIndex` rather than permission profile.
- [ ] Ensure `tools.enabled` is a whitelist when non-empty and `tools.disabled` is always a blacklist.
- [ ] Ensure agent-local tools are never visible to other agents.

Rollback point: if permission profile changes create too many callsite updates, keep custom tool visibility as a registry/context concern and leave `permissions.ts` platform-only.

### 4. Native function schema injection

- [ ] Extend `buildEnabledToolSchemas` with `userTools?: ToolRegistryEntry[]`.
- [ ] Map each visible Tool to `{ name, description, parameters }`.
- [ ] Preserve current unconditional `use_skill` / `run_script` exposure; do not fix that out-of-scope gap.
- [ ] In `index.ts`, pass `agentContext.toolIndex` into `buildEnabledToolSchemas`.
- [ ] Add defense-in-depth against name collisions with existing schema names.

Rollback point: if model provider schema type rejects a JSON Schema shape produced by tool manifests, restrict accepted `parameters` subset and add diagnostics.

### 5. Browser script runner generalization

- [ ] Generalize `RuntimeBrowserScriptExecutorRequest` to carry owner/root info without breaking existing Skill callers.
- [ ] Replace `isScriptUnderSkillDirectory` with root-directory validation:
  - Skill: derive root from `skillPath` when `rootDirectory` absent;
  - Tool: require `rootDirectory` from `ToolRegistryEntry.directoryPath`.
- [ ] Generalize `resolveAndInlineImportScripts` path and error messages from “skill directory” to “declaring directory”.
- [ ] Generalize helper resolution similarly.
- [ ] Preserve existing Skill `skill.config` merge; Tool scripts get empty config unless a future feature adds tool config.
- [ ] Keep sandbox globals and workspace SDK behavior unchanged.

Rollback point: if helper/import generalization risks Skill regressions, add a wrapper that builds a Skill-shaped request for old paths and a separate Tool root validation helper for new paths.

### 6. `tsian.lib.*` SDK

- [ ] Add `tsian.lib.random` in the worker SDK.
- [ ] Implement `nextInt` and `dice` helpers.
- [ ] Make both Skill scripts and Tool scripts able to call `tsian.lib`.
- [ ] Do **not** add `tsian.lib.math` / expression evaluator in v1 (AIRP value-rule principle; PRD Notes).
- [ ] Add developer-facing docs / comments defining SDK admission rules.

Rollback point: if `tsian.lib.random` surface grows unexpectedly, narrow v1 to just what `roll_dice` needs (`dice`), and keep `nextInt` behind a follow-up.

### 7. Tool runtime execution

- [ ] Add `executeUserTool` near `executeSkillAction` / tool dispatch code.
- [ ] Resolve script path from `tool.directoryPath + executor.path` and validate it exists.
- [ ] Invoke `runBrowserScript` with owner/root fields and `exposedWorkspaceOperations` inherited from the agent.
- [ ] Return `result.item ?? null` as the tool observation result.
- [ ] Add optional `outputSchema` mismatch diagnostic/logging if there is already a lightweight validation utility; otherwise document as registry/runtime diagnostic follow-up within this task.
- [ ] Add dispatch branch after platform built-ins and before unsupported fallback.

Rollback point: if integrating custom tool dispatch with the existing `RuntimeWorkspaceToolExecutionContext` is too invasive, route by a small `resolveVisibleToolByName(agentContext, call.name)` helper and keep execution local to `workspace-tools.ts`.

### 8. Default tool seed: `roll_dice`

- [ ] Add `tools/roll_dice/tool.json` to `workspace-templates.ts`.
- [ ] Add `tools/roll_dice/run.js` implementation.
- [ ] `modifier` accepts a number only (no expression string, no `scope` parameter).
- [ ] Support `dc`, `advantage`, `disadvantage`.
- [ ] Add documentation in template README or docs describing the Tool/Skill split and `roll_dice` as reference.
- [ ] Do **not** add `calculate_expression` as a tool. Do **not** add runtime expression evaluation.

Rollback point: if default seed paths collide with existing user content, decide whether templates should skip when files already exist (follow existing template behavior).

### 9. Studio diagnostics and tool toggles

- [ ] Extend Studio snapshot / platform host API to include registry diagnostics.
- [ ] Add a visible diagnostics entry in Studio:
  - badge with count;
  - panel/tab listing severity, code, message, path, hint;
  - “打开文件” link to workspace editor when path exists.
- [ ] Add a Tool management section for selected Agent if scope permits:
  - visible tool list;
  - scope badge;
  - enabled/disabled switch backed by `agent.json.tools`.
- [ ] Reuse existing UI idioms from Skill and platform tool toggles.

Rollback point: if full Tool toggle UI threatens schedule, preserve diagnostics UI and core config parser, then defer toggle UI to a follow-up only with user approval because PRD currently expects `tools.enabled/disabled` as creative-workshop landing.

### 10. Documentation

- [ ] Update workspace template docs / Agent docs as needed:
  - Tool vs Skill responsibilities;
  - when to use Tool vs Skill action;
  - `tool.json` field contract;
  - self-contained directory rule;
  - `tsian.lib.*` first APIs and admission rule;
  - conflict rules and platform-reserved names;
  - security posture for creative-workshop tools.
- [ ] Keep docs concise and example-driven.

### 11. Validation

Run at minimum:

```bash
npm run build:contracts
npm run build:web
```

Additional focused checks (manual or ad hoc in browser/dev console if no test runner exists):

- [ ] Existing default card/agent loads with no `agent.json.tools` field in old fixtures.
- [ ] `roll_dice` appears in a model request's native tools for a default Agent that has not disabled it.
- [ ] A malformed `tool.json` creates a Studio diagnostic and does not crash card load.
- [ ] A custom tool named `workspace_read` is skipped with a reserved-name diagnostic.
- [ ] Agent-local `agents/storyteller/tools/roll_dice/tool.json` shadows shared `tools/roll_dice/tool.json` only for storyteller.
- [ ] `tools.enabled` whitelist hides unlisted shared tools.
- [ ] `tools.disabled` hides listed shared/local tools.
- [ ] Existing `use_skill` + `run_script` path still runs an existing Skill action.
- [ ] `tsian.lib.random.dice({ sides: 20, modifier: 3 })` returns a well-formed roll result inside both a Skill script and a Tool script.
- [ ] `roll_dice({ sides: 20, modifier: 5, dc: 15 })` returns structured result with `total` and `success`; passing a string `modifier` is either rejected by parameter schema or normalized to 0 (document which).

## Review Gates During Implementation

Stop and ask before continuing if any of these happen:

- Need to introduce a new script executor type or change browser-script sandbox semantics.
- Need to add tool read/write permission declarations despite the PRD's out-of-scope decision.
- Need to make `use_skill` / `run_script` configurable in this same task.
- Need to add external MCP integration or remote tool package execution.
- Need to remove or weaken existing Skill behavior.

## Finalization Steps

- [ ] Run validation commands and record results.
- [ ] Update `.trellis/spec/` only if implementation reveals new lasting conventions beyond this task (likely candidates: agent/skill/tool design principles, platform-web frontend Studio conventions, contracts type-safety notes).
- [ ] Update PRD Acceptance Criteria checkboxes if the project convention allows, or summarize AC status in final task notes.
- [ ] Commit only when the user asks / Trellis finish flow reaches commit step.
