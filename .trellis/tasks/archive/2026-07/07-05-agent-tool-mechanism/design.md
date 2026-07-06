# Agent 工具机制：类 MCP 工具发现与卡定制层 — Design

## Status

Planning artifact for `.trellis/tasks/07-05-agent-tool-mechanism/`.

This task is a platform-web infrastructure change. It adds a card/workspace-defined Tool layer parallel to the existing Skill layer, while preserving current Skill behavior.

## Repository Evidence

Current implementation facts used by this design:

- Skill discovery is path-convention based in `apps/platform-web/src/agent-runtime/registry.ts:41-47`, with shared `skills/<id>/SKILL.md` and agent-local `agents/<agent>/skills/<id>/SKILL.md` patterns.
- Skill action declarations only support `browser_script` today (`apps/platform-web/src/agent-runtime/registry.ts:65-68`, `apps/platform-web/src/agent-runtime/workspace-tools.ts:1699-1715`).
- Agent-local Skill overrides shared Skill for the same id in `filterSkillsForAgent` (`apps/platform-web/src/agent-runtime/registry.ts:843-859`).
- Agent context currently includes a filtered `skillIndex` built by `buildSkillRegistry(..., { agentId })` + `filterSkillsForAgent` (`apps/platform-web/src/agent-runtime/context.ts:127-133`).
- Platform tool gating is derived from `agent.platformTools.enabled/disabled` in `enabledAgentPlatformTools` and `deriveAgentRuntimePermissionProfile` (`apps/platform-web/src/agent-runtime/permissions.ts:53-105`).
- Native function schemas are assembled once per turn in `callAgentModelWithWorkspaceToolsNative` (`apps/platform-web/src/agent-runtime/index.ts:1345-1378`) using `buildEnabledToolSchemas`.
- `use_skill` / `run_script` are always included by `buildEnabledToolSchemas` (`apps/platform-web/src/agent-runtime/tool-schemas.ts:485-518`); this is a known out-of-scope gap.
- Skill script execution uses `createBrowserSkillScriptRunner` and currently rejects scripts outside the declaring Skill directory (`apps/platform-web/src/platform-host/browser-skill-script-executor.ts:459-467`, `apps/platform-web/src/platform-host/browser-skill-script-executor.ts:909-925`).
- `importScripts(...)` is already statically inlined from files under the Skill directory (`apps/platform-web/src/platform-host/browser-skill-script-executor.ts:490-601`), and declared helpers are concatenated afterward (`apps/platform-web/src/platform-host/browser-skill-script-executor.ts:604-617`).
- Skill action execution passes `agentContext` and `exposedWorkspaceOperations` into the browser script runner (`apps/platform-web/src/agent-runtime/workspace-tools.ts:1738-1763`).
- Tool-call dispatch for current platform tools happens in `executeRuntimeWorkspaceToolCall` (`apps/platform-web/src/agent-runtime/workspace-tools.ts:2088-2215`).
- Default agents, skills, and scripts are seeded into the workspace from `apps/platform-web/src/storage/workspace-templates.ts:1250-1280` and adjacent entries; there is no physical checked-in `agents/` tree.
- Studio already has an Agent management surface with Skill and platform tool toggles (`apps/platform-web/src/views/StudioView.vue:46-184`, `apps/platform-web/src/views/StudioView.vue:610-622`).

## Architecture Overview

The new Tool layer mirrors the Skill layer in storage and discovery, but exposes each Tool directly as a native function-calling schema.

```text
Workspace files
  ├─ tools/<tool-id>/tool.json                  # card-level public tool
  ├─ tools/<tool-id>/run.js                     # self-contained implementation
  ├─ agents/<agent-id>/tools/<tool-id>/tool.json # agent-local override/custom tool
  └─ agents/<agent-id>/agent.json               # adds tools.enabled/disabled

Registry build
  ├─ buildToolRegistry(files)                   # all valid tool.json entries + diagnostics
  ├─ filterToolsForAgent(tools, agent)          # enabled/disabled + local overrides
  └─ AgentContextEntry.toolIndex                # visible tools for this agent

Agent turn
  ├─ deriveAgentRuntimePermissionProfile(agent) # platform tools, workspace ops
  ├─ buildEnabledToolSchemas(..., userTools)    # platform schemas + toolIndex schemas
  ├─ model native function call: roll_dice(...)
  └─ executeRuntimeWorkspaceToolCall(...)       # platform or user tool dispatch

Execution
  └─ generalized browser_script runner
       ├─ rootDirectory = tools/roll_dice or agents/<agent>/tools/<id>
       ├─ scriptPath must remain under rootDirectory
       ├─ importScripts('./helper.js') stays under rootDirectory
       ├─ tsian.workspace.* inherited from Skill scripts
       └─ tsian.lib.random/math injected for Skill and Tool scripts
```

Tool and Skill remain distinct:

- Skill = workflow document + optional internal scripts, activated through `use_skill`.
- Tool = atomic callable interface, listed directly in the model's native `tools` array.

## Data Model

### Workspace `tool.json`

```ts
interface ToolManifest {
  name: string              // English snake_case function symbol, e.g. roll_dice
  title?: string            // Chinese UI label, fallback to name
  description: string       // Chinese, consumed by LLM tool description and UI detail
  parameters: JsonSchemaObject
  executor: {
    type: "browser_script"
    path: string            // relative path under the tool directory, e.g. ./run.js
    timeoutMs?: number
    helpers?: string[]      // optional, same semantics as Skill action helpers but relative to tool root
  }
  outputSchema?: JsonSchemaObject // optional; diagnostic-only, not a hard runtime gate
}
```

`outputSchema` is intentionally soft. A tool that returns output not matching the schema should produce a diagnostic/debug signal, not fail a live play turn solely because its output shape drifted.

### Runtime registry entries

Extend contracts adjacent to existing `SkillRegistryEntry` / `AgentRegistryEntry` types:

```ts
type ToolRegistryScope = "shared" | "agent-local"

interface ToolRegistryEntry {
  id: string                 // path-derived id, e.g. roll_dice
  name: string               // manifest.name, native function name
  title: string
  description: string
  path: string               // path to tool.json
  directoryPath: string      // tools/<id> or agents/<agent>/tools/<id>
  scope: ToolRegistryScope
  agentId?: string
  parameters: JsonSchemaObject
  executor: RuntimeActionExecutorReference
  outputSchema?: JsonSchemaObject
  updatedAt?: number
}

interface RegistryDiagnostic {
  severity: "error" | "warn" | "info"
  code: string
  message: string            // Chinese, player-facing
  path?: string
  hint?: string              // Chinese, player-facing fix suggestion
  details?: unknown
}
```

`AgentRegistryEntry` gains:

```ts
interface AgentToolConfig {
  enabled: string[]          // optional whitelist; empty = all discovered visible tools
  disabled: string[]         // blacklist
}

interface AgentRegistryEntry {
  // existing fields ...
  tools: AgentToolConfig
}
```

Parsing must default missing `tools` to `{ enabled: [], disabled: [] }` so existing cards remain compatible.

`AgentContextEntry` gains `toolIndex: ToolRegistryEntry[]`. Existing `skillIndex` remains unchanged.

## Discovery and Conflict Resolution

### Path patterns

Add patterns parallel to Skill patterns in `registry.ts`:

```ts
const SHARED_TOOL_CONFIG_FILE_PATH_PATTERN = /^tools\/([^/]+)\/tool\.json$/
const AGENT_LOCAL_TOOL_CONFIG_FILE_PATH_PATTERN = /^(?:agents\/([^/]+)|\.tsian\/local\/([^/]+))\/tools\/([^/]+)\/tool\.json$/
```

The `.tsian/local/<agent>/tools/<id>/tool.json` form should be supported for symmetry with existing local Skill / Agent patterns.

### Registry functions

New registry API:

```ts
function buildToolRegistry(files: WorkspaceFile[], options?: ToolRegistryQueryOptions): {
  tools: ToolRegistryEntry[]
  diagnostics: RegistryDiagnostic[]
}

function filterToolsForAgent(
  tools: ToolRegistryEntry[],
  agent: AgentRegistryEntry,
  platformToolNames: Iterable<string>,
): { tools: ToolRegistryEntry[]; diagnostics: RegistryDiagnostic[] }

function isToolEnabledForAgent(tool: ToolRegistryEntry, agent: AgentRegistryEntry): boolean
function toolMatchesReference(tool: ToolRegistryEntry, reference: string): boolean
```

Reference matching should mirror Skill matching: path, directory path, manifest `name`, and `title` all become lookup keys. This allows `agent.json.tools.enabled/disabled` to use stable paths (`tools/roll_dice`) while still tolerating a short `roll_dice` reference in hand-authored cards.

### Visibility and gating

1. Start from all registry-visible tools:
   - shared tools: visible to all agents;
   - agent-local tools: visible only to the matching agent.
2. Apply `agent.tools.enabled` if non-empty as a whitelist.
3. Apply `agent.tools.disabled` as a blacklist.
4. Apply local-over-shared shadowing by `name` for the target agent.
5. Reject any custom tool whose `name` is a platform-reserved name.

Platform-reserved names are the names emitted by current platform schemas: `workspace_read`, `agent_call`, `use_skill`, `run_script`, etc. The reserved set should be derived centrally from `RUNTIME_WORKSPACE_TOOL_NAMES` / `tool-schemas.ts`, not duplicated in user code.

### Conflict diagnostics

Tool registry construction should never crash the card load for user mistakes. It should produce diagnostics and skip invalid entries:

| Code | Severity | Behavior |
|---|---|---|
| `TOOL_MANIFEST_INVALID_JSON` | error | skip that tool |
| `TOOL_MANIFEST_INVALID` | error | skip that tool |
| `TOOL_NAME_RESERVED` | error | skip custom tool |
| `TOOL_NAME_DUPLICATE_SAME_SCOPE` | error | skip same-scope conflicting entries |
| `TOOL_AGENT_LOCAL_OVERRIDES_SHARED` | info | keep agent-local, shadow shared for that agent |
| `TOOL_SCRIPT_PATH_INVALID` | error | skip or mark non-executable |
| `TOOL_OUTPUT_SCHEMA_MISMATCH` | warn | runtime/diagnostic only; do not block turn |

Same-scope duplicate policy should be conservative: if two entries at the same precedence level resolve to the same `name`, skip both and surface both paths. That avoids an arbitrary winner.

## Tool Schema Injection

Extend `buildEnabledToolSchemas` to accept visible custom tools:

```ts
buildEnabledToolSchemas({
  enabledPlatformTools,
  allowAgentCall,
  visibleContacts,
  userTools,
})
```

Each `ToolRegistryEntry` maps to a native `ToolSchema`:

```ts
{
  name: tool.name,
  description: tool.description,
  parameters: tool.parameters,
}
```

The tool list remains per-turn, matching current behavior in `index.ts:1345-1378`. No textual system prompt injection is needed.

If a custom tool would collide with a platform schema name, it must already have been filtered out by registry diagnostics. `buildEnabledToolSchemas` can still guard against collisions as defense-in-depth.

## Tool Call Dispatch

Add a user-tool dispatch branch before the unsupported-tool fallback in `executeRuntimeWorkspaceToolCall` (`workspace-tools.ts:2088-2215`):

```ts
if (isUserToolCall(call.name, context.agentContext?.toolIndex)) {
  observation = {
    index,
    name: call.name,
    ok: true,
    result: await executeUserTool(context, call),
  }
}
```

Ordering should be:

1. Built-in platform tools (`use_skill`, `run_script`, `agent_call`, workspace ops, etc.).
2. Custom user/card tools.
3. Unsupported fallback.

This preserves platform-reserved behavior even if a malformed registry entry somehow survived earlier filtering.

`executeUserTool` mirrors `executeSkillAction` but resolves from `ToolRegistryEntry` instead of `RuntimeLoadedSkill`:

```ts
async function executeUserTool(
  tool: ToolRegistryEntry,
  input: Record<string, unknown>,
  context: RuntimeWorkspaceToolExecutionContext,
): Promise<unknown> {
  // validate executor.type === "browser_script"
  // resolve script path against tool.directoryPath + executor.path
  // run context.runBrowserScript({
  //   ownerType: "tool",
  //   ownerName: tool.name,
  //   ownerPath: tool.path,
  //   rootDirectory: tool.directoryPath,
  //   actionName: tool.name,
  //   scriptPath,
  //   input,
  //   timeoutMs,
  //   helpers,
  // }, { agentContext, exposedWorkspaceOperations })
  // return result.item ?? null
}
```

Tool parameter schema validation is primarily delegated to native function calling. Runtime should still normalize unknown/missing arguments to `{}` and let the script return a clear error if necessary. Full JSON Schema runtime validation can be added later if needed.

## Browser Script Runner Generalization

Current `RuntimeBrowserScriptExecutorRequest` is Skill-specific (`skillName`, `skillPath`, `actionName`) and `isScriptUnderSkillDirectory` checks paths against `skillPath` (`workspace-tools-types.ts:257-278`, `browser-skill-script-executor.ts:459-467`). Generalize without changing the executor sandbox:

```ts
interface RuntimeBrowserScriptExecutorRequest {
  ownerType?: "skill" | "tool" // default skill for compatibility
  ownerName?: string            // skill name or tool name
  ownerPath?: string            // SKILL.md or tool.json
  rootDirectory?: string        // declaring directory; required for tools

  // backward-compatible skill aliases:
  skillName?: string
  skillPath?: string
  actionName: string
  scriptPath: string
  input: Record<string, unknown>
  timeoutMs: number
  helpers?: string[]
  configItems?: SkillConfigItem[] // Skill only
}
```

Resolution rules:

- Root directory = `request.rootDirectory` if provided; otherwise derive from `request.skillPath` for old Skill callers.
- `scriptPath` must start with `${rootDirectory}/` after normalization.
- `importScripts('./helper.js')` resolves relative to the same root directory and must not escape it. This replaces current Skill-only messages in `resolveAndInlineImportScripts` (`browser-skill-script-executor.ts:490-601`).
- Declared `helpers` resolve relative to the same root directory. Absolute helper paths should remain discouraged; for tools, treat absolute helper paths as invalid to preserve self-containment. For Skill backward compatibility, keep current behavior unless implementation proves easy to tighten without breakage.
- Tool scripts receive an empty `tsian.config`; only Skill scripts merge `skill.config` items (`browser-skill-script-executor.ts:977-985`).

The existing worker sandbox remains unchanged: no DOM globals, no fetch/localStorage, workspace only through `tsian.workspace.*`.

## `tsian.lib.*` SDK

Inject `tsian.lib` next to `tsian.workspace` in the browser script worker. It is available to both Skill actions and Tool scripts.

Initial surface (v1):

```ts
tsian.lib.random.nextInt(min: number, max: number): number

tsian.lib.random.dice(options: {
  count?: number
  sides: number
  modifier?: number
  advantage?: boolean
  disadvantage?: boolean
}): {
  rolls: number[]
  keptRolls: number[]
  subtotal: number
  modifier: number
  total: number
}
```

Design constraints:

- Pure, synchronous, no I/O, no workspace access.
- No business rules such as character sheet semantics.
- `dice` should use `Math.random()` for v1. Cryptographic fairness is not required for a narrative AIRP tool.

**No expression evaluation in v1.** AIRP value-rule principle (PRD Notes): the platform does not carry precise arithmetic. Derived numbers (attribute modifiers, attack bonuses, damage coefficients) are precomputed by the frontend at state-change points and written into workspace files; the LLM reads final values only. No `tsian.lib.math` namespace and no runtime expression evaluator are introduced in this task.

`roll_dice` uses only `tsian.lib.random`:

```ts
const modifier = Number(input.modifier ?? 0)
const dice = tsian.lib.random.dice({ count, sides, modifier, advantage, disadvantage })
return { ...dice, dc, success: dc == null ? undefined : dice.total >= dc }
```

## Reference Tool: `tools/roll_dice/`

Default workspace seed should add:

```text
tools/roll_dice/tool.json
tools/roll_dice/run.js
```

`tool.json` fields follow PRD R2. Suggested parameter schema:

```json
{
  "type": "object",
  "required": ["sides"],
  "properties": {
    "sides": { "type": "number", "description": "骰子面数，如 20。" },
    "count": { "type": "number", "description": "骰子数量，默认 1。" },
    "modifier": { "type": "number", "description": "修正值，直接传入最终数字。" },
    "dc": { "type": "number", "description": "难度等级；提供时返回 success。" },
    "advantage": { "type": "boolean", "description": "优势：投两个同面骰，取较高结果。" },
    "disadvantage": { "type": "boolean", "description": "劣势：投两个同面骰，取较低结果。" }
  }
}
```

If both `advantage` and `disadvantage` are true, v1 should cancel them to a normal roll and include a warning field in output.

## Diagnostics UI

OQ-6 decision: put the player-visible diagnostics entry in Studio, not gameplay.

Rationale:

- Existing Studio already manages Agents, Skills, platform tool toggles, and workspace access (`StudioView.vue:46-184`, `StudioView.vue:610-622`). Registry diagnostics are authoring/configuration feedback, not runtime story UI.
- Diagnostics should not interrupt gameplay; invalid tools are skipped and reported.
- Workspace editor navigation already exists (`WorkspaceExplorerView.vue` / `WorkspaceEditorView.vue`), so a diagnostic row can link to `workspace-editor` with the affected path.

Design:

- Platform host exposes a Studio snapshot including `registryDiagnostics: RegistryDiagnostic[]`.
- Studio header shows a red/yellow badge when diagnostics exist.
- A new “诊断” tab/panel lists diagnostics grouped by severity and path.
- Each row shows `severity`, `code`, `message`, `path`, `hint`, and a “打开文件” action when `path` exists.
- This panel is generic, but v1 only feeds tool diagnostics. Skill and `agent.json` diagnostics can reuse it later.

## Studio Tool Management UI

R10 says `tools.enabled/disabled` is the eventual creative-workshop tool switch. This task should add the data model and core update API. UI can be minimal:

- In the selected Agent panel, add a Tool section next to Skill management.
- List visible tools (`toolIndex`) with `title`, `name`, scope badge (`公共` / `本 Agent`), and enabled switch.
- Switch updates `agent.json.tools.enabled/disabled` using the same style as `updatePlatformStudioAgentSkillEnabled` / `updatePlatformStudioAgentPlatformToolEnabled` (`StudioView.vue:567-622`).
- If schedule risk is high, expose diagnostics first and defer the full Tool toggle UI, but keep parser/runtime support in this task.

## Compatibility

- Existing cards without `agent.json.tools` keep working by defaulting to `{ enabled: [], disabled: [] }`.
- Existing Skill behavior, Skill action execution, `use_skill`, and `run_script` remain unchanged.
- Existing Skill helpers and `importScripts` continue to work. Tools add stricter self-containment for tool directories.
- Platform built-in tool names are reserved; cards cannot override them by name.
- No write-scope/read-scope permission model is added.

## Tests and Validation Strategy

Unit tests / focused tests should cover:

1. Tool manifest parsing:
   - valid manifest;
   - invalid JSON;
   - missing required fields;
   - unsupported executor type;
   - invalid script path outside directory.
2. Registry discovery:
   - shared `tools/<id>/tool.json`;
   - agent-local `agents/<agent>/tools/<id>/tool.json`;
   - `.tsian/local/<agent>/tools/<id>/tool.json` if supported.
3. Conflict rules:
   - same-scope duplicate name → error diagnostics and skipped entries;
   - local overrides shared → info diagnostic and local wins;
   - platform-reserved name → error diagnostic and skipped entry.
4. Agent gating:
   - default discovered tools visible;
   - `tools.enabled` acts as whitelist;
   - `tools.disabled` blacklists;
   - local tools only visible to matching agent.
5. Schema injection:
   - `buildEnabledToolSchemas` includes visible custom tools;
   - platform schemas still present/absent according to `platformTools`.
6. Runtime execution:
   - a tool call routes to `executeUserTool` and returns script output;
   - tool script path and `importScripts` cannot escape the tool directory;
   - Skill `run_script` still works.
7. `tsian.lib`:
   - Skill script and Tool script can both call `tsian.lib.random`;
   - `dice` produces valid rolls, `advantage`/`disadvantage` behave as declared.
8. `roll_dice`:
   - normal roll;
   - numeric modifier;
   - DC success/failure;
   - advantage/disadvantage behavior.

Manual validation:

- Start the platform, inspect a default Agent turn, and verify `roll_dice` appears in the native tools array for an Agent that has not disabled it.
- Trigger a malformed `tool.json` and verify Studio diagnostics show a player-readable error and file link.
- Confirm an existing Skill action still runs via `use_skill` + `run_script`.

## Rollback Shape

Rollback is straightforward because the change is additive:

- Remove new tool registry building and tool schema injection.
- Remove `tools` parsing default from `agent.json` (or leave ignored for forward compatibility).
- Remove default `tools/roll_dice/` template entries.
- Keep `tsian.lib.random` if already used by Skill scripts, or remove it if only `roll_dice` used it.
- Existing Skill and platform tool paths remain intact throughout.

## Tradeoffs Accepted

- No external MCP integration: this is an internal mini-MCP layer only.
- No tool permission model: creative-workshop safety is handled by community review and player consent outside the platform.
- No capability/provider abstraction: one active card plus priority rules make name conflicts tractable.
- No independent `calculate_expression` tool and no runtime expression evaluator: AIRP value-rule principle keeps precise arithmetic out of the platform; derived numbers are precomputed by the frontend at state-change points and written to workspace, LLM reads final values only.
- No i18n in `tool.json`: project targets Chinese-native users; `description` and diagnostics are Chinese.
