import type { AgentConfig, WorkspaceFile } from "@tsian/contracts"
import { localDb } from "./db"
import {
  defaultFrameworkKnowledgeFileMap,
  obsoleteFrameworkKnowledgePaths,
  type LocalAssistantKnowledgeRefreshResult,
} from "./local-assistant-knowledge"

export type { LocalAssistantKnowledgeRefreshResult } from "./local-assistant-knowledge"

const LOCAL_ASSISTANT_FILES_KEY = "assistant-local-files"
const LOCAL_ASSISTANT_SKIP_DEFAULT_MERGE_KEY = "assistant-local-files-skip-default-merge"

export const LOCAL_ASSISTANT_DIR = ".tsian/local/assistant"

export const LOCAL_ASSISTANT_AGENT_ID = "assistant"

interface StoredAssistantFile {
  content: string
}

interface StoredAssistantFileMap {
  [path: string]: StoredAssistantFile
}

const DEFAULT_AGENT_MD = [
  "# Desktop Assistant",
  "",
  "This SOP helps you answer questions about the current game card and workspace.",
  "Keep durable identity and work style in `SOUL.md`.",
  "Read relevant workspace docs and Skill instructions before giving framework or maintenance advice.",
  "",
  "## Knowledge Base",
  "",
  "Your `knowledge/` directory is a mount to the current game card's `docs/` directory.",
  "Files you read and write there are distributable card knowledge.",
  "When you learn something useful about this card that other players' assistants would benefit from, write it to your knowledge base.",
  "",
  "## Self-Improvement",
  "",
  "Your personal notes live at `notes.md` in this directory.",
  "When the player corrects you, shares a preference, or you notice a recurring pattern, append a concise note there.",
  "These notes are local to this player and do not distribute with the game card.",
  "",
].join("\n")

const DEFAULT_SOUL_MD = [
  "# Desktop Assistant Soul",
  "",
  "You are the player's personal desktop assistant.",
  "Help players and authors understand the Tsian framework, inspect workspace conventions, and plan safe changes to Agents, Skills, state files, frontend data, memory, diagnostics, and game-card content.",
  "",
  "When the user asks framework, authoring, workspace, or diagnostics questions, load the `framework-knowledge` Skill before giving a confident answer.",
  "Treat current workspace files as the source of truth. Read local README files, schemas, Agent definitions, Skill definitions, and diagnostics when the answer depends on local content.",
  "",
  "Do not claim hidden platform powers. You can only use the tools, bridge APIs, or future UI actions explicitly made available to you.",
  "Do not edit files unless the current UI/tooling asks you to perform or prepare a concrete change.",
  "",
].join("\n")

const AGENT_AUTHORING_SKILL_MD = [
  "---",
  "name: agent-authoring",
  "title: Agent Authoring",
  "description: Generate and validate agent.json / AGENT.md / SOUL.md files for the Runtime Workspace.",
  "triggers:",
  "  - The user wants to create or modify an Agent",
  "  - The user asks about agent.json schema, permissions, contacts, or contextPaths",
  "appliesTo:",
  "  - assistant",
  "---",
  "",
  "# Agent Authoring",
  "",
  "Use this Skill when creating, modifying, or validating Runtime Workspace Agent definitions.",
  "",
  "## AgentConfig Schema (`agent.json`)",
  "",
  "| Field | Type | Required | Notes |",
  "|-------|------|----------|-------|",
  "| `id` | string | yes | Agent identifier; must match the directory name under `agents/`. |",
  "| `title` | string | yes | Display name. |",
  "| `summary` | string | yes | One-line description. |",
  "| `contacts` | string[] | yes | Agent ids this agent may call via `agent_call`. |",
  "| `contextPaths` | (string\\|{path?,template?,role?,position?})[] | yes | Workspace files or inline templates loaded into the agent's prompt context. Strings are backward-compatible file paths (role=user, position=runtime). Objects allow specifying `path` XOR `template`, `role` (system/user/assistant), and `position` (prelude/runtime/framing). |",
  "| `enabledModules` | string[] | no | Enabled rule module names (file stems) for `{{file:...?enabled}}` conditional inclusion. |",
  "| `skills.enabled` | string[] | yes | Whitelist of exact Skill paths (`.../SKILL.md`); non-empty narrows visible skills. |",
  "| `skills.disabled` | string[] | yes | Blacklist of exact Skill paths (`.../SKILL.md`). |",
  "| `platformTools.enabled` | string[] | yes | Allowed: `agent_call`, `workspace_read`, `workspace_write`, `inspect_frontend`, `test_skill_script`. |",
  "| `platformTools.disabled` | string[] | yes | Blocked platform tools. |",
  "| `workspaceAccess.level` | number | yes | Permission level (see below). |",
  "| `knowledgeMount` | string | no | Path to knowledge base directory (default `docs/`). |",
  "| `providerPresetId` | string | no | Provider preset id for per-agent model selection. |",
  "",
  "Source: `AgentConfig` in `packages/contracts/src/runtime.ts`.",
  "",
  "## Permission Levels",
  "",
  "- Level 1: runtime game agents. Can only write `save-runtime` (editLevel 1). Card-content writes are rejected.",
  "- Level 4: desktop assistant. Can manage all scopes (card-content, card-frontend, save-runtime, platform-meta).",
  "- New runtime agents default to level 1. Only the desktop assistant uses level 4.",
  "",
  "## AGENT.md vs SOUL.md",
  "",
  "- `AGENT.md`: SOP and procedures — what the agent does, how it handles turns, when it delegates.",
  "- `SOUL.md`: durable identity and style — personality, expression preferences, work style. Optional but recommended.",
  "- Runtime notes live under `save/agents/<agent>/notes.md` (save-runtime, not card content).",
  "",
  "## Generation Flow",
  "",
  "1. Ask the user for: `id`, `title`, `summary`, `contacts`, and any `contextPaths`.",
  "2. Generate `agents/<id>/agent.json` with the full AgentConfig schema.",
  "3. Generate `agents/<id>/AGENT.md` with a SOP skeleton.",
  "4. Optionally generate `agents/<id>/SOUL.md` if the user specifies a personality or style.",
  "5. Set `workspaceAccess.level` to 1 for runtime agents. Use `skills.enabled: []` unless the user specifies skills.",
  "6. Write files via `workspace_write` (the assistant has level 4 access).",
  "",
  "## Validation Checklist",
  "",
  "- `id` is non-empty and matches the directory name.",
  "- `title` and `summary` are non-empty strings.",
  "- `contacts` is an array of valid agent ids.",
  "- `contextPaths` entries exist in the workspace (or are documented as future files).",
  "- `skills` and `platformTools` have `enabled` and `disabled` arrays.",
  "- `workspaceAccess.level` is a number (1 for runtime agents, 4 for assistant).",
  "- `AGENT.md` exists in the same directory (required SOP file).",
  "",
  "After writing files, run `validate_agent_definition` to verify the result deterministically.",
  "",
  "## Actions",
  "",
  "This Skill declares two `browser_script` actions that automate agent creation:",
  "",
  "- `generate_agent_skeleton` — generate `agent.json` + `AGENT.md` (+ optional `SOUL.md`) skeletons in one call. Pass `{ id, title, summary, contacts?, contextPaths?, skillsEnabled?, platformToolsEnabled?, level?, generateSoul?, soulHint?, overwrite? }`. Defaults: `level: 1`, `platformToolsEnabled: [\"agent_call\", \"workspace_read\"]`. Refuses to overwrite an existing `agent.json` unless `overwrite: true`.",
  "- `validate_agent_definition` — validate an existing agent definition against the `AgentConfig` schema. Pass `{ agentId: \"<id>\" }` or `{ path: \"agents/<id>\" }`. Returns `{ ok, errors, warnings }`; checks id matches directory, required fields, platformTools against the allow-list, `AGENT.md` presence, and warns on dangling `contacts` references.",
  "",
  "Use `run_script` after `use_skill` to invoke either action. After `generate_agent_skeleton`, read the generated `AGENT.md` / `SOUL.md` and flesh out the real SOP and personality via `workspace_edit` / `workspace_write`.",
  "",
  "```json tsian-actions",
  "[",
  "  {",
  "    \"name\": \"generate_agent_skeleton\",",
  "    \"description\": \"Generate agent.json + AGENT.md (+ optional SOUL.md) skeletons under agents/<id>/.\",",
  "    \"inputSchema\": { \"type\": \"object\", \"required\": [\"id\", \"title\", \"summary\"], \"properties\": { \"id\": { \"type\": \"string\" }, \"title\": { \"type\": \"string\" }, \"summary\": { \"type\": \"string\" }, \"contacts\": { \"type\": \"array\", \"items\": { \"type\": \"string\" } }, \"contextPaths\": { \"type\": \"array\", \"items\": { \"oneOf\": [{ \"type\": \"string\" }, { \"type\": \"object\", \"properties\": { \"path\": { \"type\": \"string\" }, \"template\": { \"type\": \"string\" }, \"role\": { \"type\": \"string\", \"enum\": [\"system\", \"user\", \"assistant\"] }, \"position\": { \"type\": \"string\", \"enum\": [\"prelude\", \"runtime\", \"framing\"] } } }] } }, \"skillsEnabled\": { \"type\": \"array\", \"items\": { \"type\": \"string\" } }, \"platformToolsEnabled\": { \"type\": \"array\", \"items\": { \"type\": \"string\" } }, \"level\": { \"type\": \"number\" }, \"generateSoul\": { \"type\": \"boolean\" }, \"soulHint\": { \"type\": \"string\" }, \"overwrite\": { \"type\": \"boolean\" } } },",
  "    \"outputSchema\": { \"type\": \"object\", \"required\": [\"schema\", \"ok\", \"agentId\", \"createdFiles\"], \"properties\": { \"schema\": { \"type\": \"string\" }, \"ok\": { \"type\": \"boolean\" }, \"agentId\": { \"type\": \"string\" }, \"createdFiles\": { \"type\": \"array\", \"items\": { \"type\": \"string\" } } } },",
  "    \"executor\": { \"type\": \"browser_script\", \"path\": \"scripts/generate-agent-skeleton.js\", \"timeoutMs\": 15000 }",
  "  },",
  "  {",
  "    \"name\": \"validate_agent_definition\",",
  "    \"description\": \"Validate an agent definition (agent.json + AGENT.md) against the AgentConfig schema.\",",
  "    \"inputSchema\": { \"type\": \"object\", \"properties\": { \"agentId\": { \"type\": \"string\" }, \"path\": { \"type\": \"string\" } } },",
  "    \"outputSchema\": { \"type\": \"object\", \"required\": [\"schema\", \"ok\", \"errors\"], \"properties\": { \"schema\": { \"type\": \"string\" }, \"agentId\": { \"type\": \"string\" }, \"ok\": { \"type\": \"boolean\" }, \"errors\": { \"type\": \"array\", \"items\": { \"type\": \"string\" } }, \"warnings\": { \"type\": \"array\", \"items\": { \"type\": \"string\" } } } },",
  "    \"executor\": { \"type\": \"browser_script\", \"path\": \"scripts/validate-agent-definition.js\", \"timeoutMs\": 15000 }",
  "  }",
  "]",
  "```",
  "",
].join("\n")

const SKILL_AUTHORING_SKILL_MD = [
  "---",
  "name: skill-authoring",
  "title: Skill Authoring",
  "description: Generate and validate SKILL.md files with frontmatter and optional tsian-actions declarations.",
  "triggers:",
  "  - The user wants to create or modify a Skill",
  "  - The user asks about SKILL.md format, action declarations, or browser_script executors",
  "appliesTo:",
  "  - assistant",
  "---",
  "",
  "# Skill Authoring",
  "",
  "Use this Skill when creating, modifying, or validating Skill definitions.",
  "",
  "## SKILL.md Frontmatter",
  "",
  "| Field | Type | Required | Notes |",
  "|-------|------|----------|-------|",
  "| `name` | string | yes | Skill identifier; must match the directory name. |",
  "| `title` | string | yes | Display name. |",
  "| `description` | string | yes | Model-facing summary of what the Skill does. |",
  "| `triggers` | string[] | yes | Natural-language cues that suggest activating this Skill. |",
  "| `appliesTo` | string[] | yes | Agent scopes this Skill applies to (e.g. `assistant`). |",
  "",
  "## Skill Locations",
  "",
  "- Shared skills: `skills/<skill>/SKILL.md` (available to all agents).",
  "- Agent-local skills: `agents/<agent>/skills/<skill>/SKILL.md` (available only to that agent).",
  "- Assistant-local skills: `.tsian/local/assistant/skills/<skill>/SKILL.md` (desktop assistant only).",
  "",
  "## tsian-actions Fence",
  "",
  "Actions are declared in a fenced JSON block with the info string `json tsian-actions`. The example below uses a plain `json` info string so the registry does not parse it as a real declaration:",
  "",
  "```json",
  "[",
  "  {",
  "    \"name\": \"example_action\",",
  "    \"description\": \"Run a Skill-local browser script.\",",
  "    \"inputSchema\": { \"type\": \"object\", \"properties\": {} },",
  "    \"outputSchema\": { \"type\": \"object\", \"properties\": {} },",
  "    \"executor\": {",
  "      \"type\": \"browser_script\",",
  "      \"path\": \"scripts/example.js\",",
  "      \"timeoutMs\": 10000",
  "    }",
  "  }",
  "]",
  "```",
  "",
  "## Executor Constraints",
  "",
  "- `executor.type` must be `browser_script` (the only supported type).",
  "- `executor.path` is relative to the Skill directory (e.g. `scripts/run.js`).",
  "- `executor.timeoutMs` must be positive and must not exceed 60000.",
  "- `inputSchema` root must be `object`.",
  "- `outputSchema` is optional; if present, root must be `object`.",
  "",
  "## Browser Script API Surface",
  "",
  "Scripts run in a Web Worker with these APIs available:",
  "",
  "**Tsian SDK** (`tsian` — injected object):",
  "- `tsian.workspace.read / list / search / glob / diff / patch / write / copy / move / delete / validate` — workspace operations via RPC to the host.",
  "- `tsian.log(message, data?)` — emit a log entry (visible in trace).",
  "- `tsian.trace(label, data?)` — emit a trace entry (visible in trace).",
  "",
  "**Worker-native globals** (use directly, no prefix):",
  "- `fetch(resource, init?)` — standard browser `fetch`; returns a full `Response` (supports `.text()`, `.json()`, `.blob()`, `.arrayBuffer()`, streaming, `AbortSignal`).",
  "- `console.log / warn / error / info` — output to the browser DevTools console.",
  "- `setTimeout / setInterval / clearTimeout / clearInterval` — standard timers.",
  "- `self` / `globalThis` — the Worker global scope (vendor libraries attach here).",
  "",
  "**Not available** (shielded — do not use):",
  "- `window`, `document`, `localStorage`, `sessionStorage` — no DOM in a Worker.",
  "- `navigator`, `location`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `Worker`, `SharedWorker`, `indexedDB`, `caches`.",
  "- `import` / `export` (ESM syntax) — the Worker is classic, not a module worker. Use `importScripts` for libraries (see below).",
  "",
  "## Vendor Libraries (importScripts)",
  "",
  "A script can load third-party UMD/classic libraries from the Skill directory via `importScripts`:",
  "",
  "```text",
  "1. Place the library file under the Skill directory:",
  "   skills/my-skill/lib/marked.min.js",
  "",
  "2. At the top of the script, declare the import:",
  "   importScripts('lib/marked.min.js')",
  "",
  "3. Use it — the library attaches to the Worker global:",
  "   const html = self.marked.parse(text)",
  "   // or simply: marked.parse(text)",
  "```",
  "",
  "Rules:",
  "- Paths are **relative to the Skill directory** (same as `executor.path`).",
  "- Only **UMD / classic** builds work (files loadable via `<script src>`). Most libraries ship a `.min.js` UMD build (marked, lodash, chart.js, three.js, etc.).",
  "- **ESM-only libraries do NOT work** — `import`/`export` syntax causes a SyntaxError. Find a UMD build instead.",
  "- Paths **cannot escape** the Skill directory (`../` or absolute URLs are rejected).",
  "- Libraries must be placed in the Skill directory first (no CDN URLs).",
  "- `importScripts` paths must be **string literals** (dynamic path concatenation is not supported).",
  "",
  "Example: a Skill that parses Markdown and writes the HTML back to the workspace:",
  "",
  "```javascript",
  "importScripts('lib/marked.min.js')",
  "const md = await tsian.workspace.read('world/canon.md')",
  "const html = self.marked.parse(md.content)",
  "await tsian.workspace.write({ path: 'world/canon.html', content: html })",
  "return { ok: true, html }",
  "```",
  "",
  "## Generation Flow",
  "",
  "1. Ask the user for: skill `name`, `title`, `description`, `triggers`, and `appliesTo`.",
  "2. Determine if the skill needs a `browser_script` action or is pure guidance.",
  "3. Generate `SKILL.md` with frontmatter + body instructions.",
  "4. If actions are needed, add a `tsian-actions` fence and write `scripts/<name>.js`.",
  "5. Write files via `workspace_write` (shared/agent-local) or to `.tsian/local/assistant/skills/` (assistant-local).",
  "",
  "## Validation Checklist",
  "",
  "- Frontmatter has `name`, `title`, `description`, `triggers`, `appliesTo`.",
  "- `name` matches the Skill directory name.",
  "- `tsian-actions` fence (if present) is valid JSON.",
  "- Every action's `executor.type` is `browser_script`.",
  "- Every action's `executor.path` is under the Skill directory (no `..` or absolute paths).",
  "- Every action's `executor.timeoutMs` is positive and <= 60000.",
  "- `inputSchema` root type is `object`.",
  "",
  "Run `validate_skill_definition` to apply this checklist deterministically instead of self-review.",
  "",
  "## Actions",
  "",
  "This Skill declares one `browser_script` action to validate Skill definitions:",
  "",
  "- `validate_skill_definition` — validate a `SKILL.md` against the frontmatter + `tsian-actions` rules. Pass `{ skillPath: \"skills/my-skill/SKILL.md\" }`. Returns `{ ok, errors, actions }`; checks frontmatter fields (`name`/`title`/`description`/`triggers`/`appliesTo`), that `name` matches the directory, and every `tsian-actions` declaration (executor type, path escaping, timeoutMs bounds, inputSchema root).",
  "",
  "Skill files themselves are generated via `workspace_write` (the assistant has level 4); this action validates them after writing. Use `run_script` after `use_skill`.",
  "",
  "```json tsian-actions",
  "[",
  "  {",
  "    \"name\": \"validate_skill_definition\",",
  "    \"description\": \"Validate a SKILL.md frontmatter and tsian-actions fence declarations.\",",
  "    \"inputSchema\": { \"type\": \"object\", \"required\": [\"skillPath\"], \"properties\": { \"skillPath\": { \"type\": \"string\" } } },",
  "    \"outputSchema\": { \"type\": \"object\", \"required\": [\"schema\", \"ok\", \"errors\"], \"properties\": { \"schema\": { \"type\": \"string\" }, \"skillPath\": { \"type\": \"string\" }, \"ok\": { \"type\": \"boolean\" }, \"errors\": { \"type\": \"array\", \"items\": { \"type\": \"string\" } }, \"warnings\": { \"type\": \"array\", \"items\": { \"type\": \"string\" } }, \"actions\": { \"type\": \"array\", \"items\": { \"type\": \"object\" } } } },",
  "    \"executor\": { \"type\": \"browser_script\", \"path\": \"scripts/validate-skill-definition.js\", \"timeoutMs\": 15000 }",
  "  }",
  "]",
  "```",
  "",
].join("\n")

const CARD_CONTENT_DRAFTING_SKILL_MD = [
  "---",
  "name: card-content-drafting",
  "title: Card Content Drafting",
  "description: Draft or revise game-card docs, Agents, Skills, and starter workspace content from the current card's own conventions.",
  "triggers:",
  "  - The user wants to create or revise game-card content",
  "  - The user wants help drafting card docs, Agent definitions, Skill definitions, or starter save files",
  "appliesTo:",
  "  - assistant",
  "---",
  "",
  "# Card Content Drafting",
  "",
  "Use this Skill when drafting or revising game-card content. A Game Card may define its own world model, schema, frontend conventions, and authoring SOP, so read the current card's `docs/` and local README/schema files before writing.",
  "",
  "## Directory Conventions",
  "",
  "| Path | Scope | Content |",
  "|------|-------|---------|",
  "| `docs/` | card-content | Card-specific world, schema, frontend, and authoring guidance. |",
  "| `agents/` | card-content | Agent definitions (`agent.json`, `AGENT.md`, optional `SOUL.md`). |",
  "| `skills/` | card-content | Shared Skill definitions. |",
  "| `agents/<agent>/skills/` | card-content | Agent-local Skill definitions. |",
  "| `save/agents/<agent>/notes.md` | save-runtime | Per-save Agent notes. |",
  "| `save/history/turns/` | save-runtime | Player-facing turn history written by runtime. |",
  "| `save/playthrough/` | save-runtime | Card-defined runtime summaries and playthrough variables. |",
  "| `save/memory/` | save-runtime | Card-defined memory files, if the card uses them. |",
  "",
  "## Drafting Flow",
  "",
  "1. Ask what kind of card content the user wants to create or revise.",
  "2. Read the current card's `docs/`, root README, relevant schema files, Agent definitions, and Skill definitions before proposing paths.",
  "3. Keep platform-generic facts out of card docs unless the card needs a short pointer. Card-specific world, schema, frontend, and SOP belong in the card's own `docs/`.",
  "4. Write card templates under card-content paths and per-playthrough starter/runtime material under `save/...` only when the user is editing a specific save.",
  "5. Prefer small, explicit files and local edits over rewriting unrelated content.",
  "",
  "## Minimal Templates",
  "",
  "Card guide skeleton:",
  "",
  "```markdown",
  "# Card Guide",
  "",
  "## What this card defines",
  "",
  "[World, gameplay, frontend, and authoring assumptions specific to this card.]",
  "",
  "## Important workspace paths",
  "",
  "- `docs/`: [card-specific knowledge]",
  "- `agents/`: [card Agents]",
  "- `skills/`: [shared Skills]",
  "- `save/...`: [runtime files this card expects]",
  "```",
  "",
  "Agent SOP skeleton:",
  "",
  "```markdown",
  "# <Agent Name>",
  "",
  "## Responsibility",
  "",
  "[What this Agent owns.]",
  "",
  "## Before acting",
  "",
  "- Read [card-specific docs/schema/context paths].",
  "",
  "## Output expectations",
  "",
  "[What the Agent should produce or maintain.]",
  "```",
  "",
  "## Validation Action",
  "",
  "This Skill declares one read-only action to check workspace layout conventions:",
  "",
  "```json tsian-actions",
  "[",
  "  {",
  "    \"name\": \"validate_workspace_layout\",",
  "    \"description\": \"Check that key workspace directories and README files exist; report missing conventions.\",",
  "    \"inputSchema\": { \"type\": \"object\", \"properties\": { \"paths\": { \"type\": \"array\" } } },",
  "    \"outputSchema\": { \"type\": \"object\", \"required\": [\"schema\", \"ok\", \"missing\"], \"properties\": { \"schema\": { \"type\": \"string\" }, \"ok\": { \"type\": \"boolean\" }, \"missing\": { \"type\": \"array\" }, \"present\": { \"type\": \"array\" } } },",
  "    \"executor\": { \"type\": \"browser_script\", \"path\": \"scripts/validate-workspace-layout.js\", \"timeoutMs\": 10000 }",
  "  }",
  "]",
  "```",
  "",
  "Use `run_script` after `use_skill` to invoke `validate_workspace_layout`. Pass the paths that matter for the current card instead of assuming one universal game schema."
].join("\n")

const VALIDATE_WORKSPACE_LAYOUT_JS = [
  "const RESULT_SCHEMA = \"tsian.workspace.layout.validate.v1\";",
  "",
  "const DEFAULT_EXPECTED_PATHS = [",
  "  \"README.md\",",
  "  \"agents/README.md\",",
  "  \"skills/README.md\",",
  "  \"world/README.md\",",
  "];",
  "",
  "function isRecord(value) {",
  "  return typeof value === \"object\" && value !== null && !Array.isArray(value);",
  "}",
  "",
  "function fail(code, message, details) {",
  "  const error = new Error(message);",
  "  error.code = code;",
  "  if (details !== undefined) error.details = details;",
  "  throw error;",
  "}",
  "",
  "function resolveExpectedPaths(input) {",
  "  if (input === undefined || input === null) {",
  "    return DEFAULT_EXPECTED_PATHS;",
  "  }",
  "  if (!isRecord(input)) {",
  "    fail(\"LAYOUT_INPUT_INVALID\", \"Validation input must be an object.\", { input });",
  "  }",
  "  if (input.paths === undefined || input.paths === null) {",
  "    return DEFAULT_EXPECTED_PATHS;",
  "  }",
  "  if (!Array.isArray(input.paths)) {",
  "    fail(\"LAYOUT_PATHS_INVALID\", \"Validation paths must be an array.\", { paths: input.paths });",
  "  }",
  "  const paths = [];",
  "  for (const entry of input.paths) {",
  "    if (typeof entry !== \"string\" || !entry.trim()) {",
  "      fail(\"LAYOUT_PATH_INVALID\", \"Each validation path must be a non-empty string.\", { entry });",
  "    }",
  "    paths.push(entry.trim());",
  "  }",
  "  return paths.length > 0 ? paths : DEFAULT_EXPECTED_PATHS;",
  "}",
  "",
  "async function checkExists(tsian, path) {",
  "  try {",
  "    await tsian.workspace.read(path);",
  "    return true;",
  "  } catch {",
  "    return false;",
  "  }",
  "}",
  "",
  "async function validateWorkspaceLayout(input, tsian, signal) {",
  "  try {",
  "    signal.throwIfAborted();",
  "    const expectedPaths = resolveExpectedPaths(input);",
  "    tsian.trace(\"layout_validation_started\", { schema: RESULT_SCHEMA, pathCount: expectedPaths.length });",
  "    const present = [];",
  "    const missing = [];",
  "    for (const path of expectedPaths) {",
  "      signal.throwIfAborted();",
  "      const exists = await checkExists(tsian, path);",
  "      if (exists) {",
  "        present.push(path);",
  "      } else {",
  "        missing.push(path);",
  "      }",
  "    }",
  "    const ok = missing.length === 0;",
  "    tsian.trace(\"layout_validation_completed\", { schema: RESULT_SCHEMA, ok, presentCount: present.length, missingCount: missing.length });",
  "    return { schema: RESULT_SCHEMA, ok, missing, present };",
  "  } catch (error) {",
  "    tsian.trace(\"layout_validation_failed\", { code: error && error.code || \"LAYOUT_VALIDATION_FAILED\", message: error && error.message || String(error) });",
  "    throw error;",
  "  }",
  "}",
  "",
  "return validateWorkspaceLayout(input, tsian, signal);",
  "",
].join("\n")

const GENERATE_AGENT_SKELETON_JS = [
  "const RESULT_SCHEMA = 'tsian.agent.skeleton.generate.v1';",
  "",
  "const DEFAULT_PLATFORM_TOOLS = ['agent_call', 'workspace_read'];",
  "const VALID_PLATFORM_TOOLS = [",
  "  'agent_call',",
  "  'workspace_read',",
  "  'workspace_write',",
  "  'inspect_frontend',",
  "  'workspace_semantic_search',",
  "  'ask_user',",
"  'test_skill_script',",
"];",
"",
"const VALID_CONTEXT_PATH_POSITIONS = [",
"  'prelude',",
"  'runtime',",
"  'framing',",
"];",
"",
"function isRecord(value) {",
  "  return typeof value === 'object' && value !== null && !Array.isArray(value);",
  "}",
  "function isNonEmptyString(value) {",
  "  return typeof value === 'string' && value.trim().length > 0;",
  "}",
"function asStringArray(value, fallback) {",
"  if (Array.isArray(value) && value.every(function (i) { return typeof i === 'string'; })) return value;",
"  return fallback;",
"}",
"function asContextPathArray(value, fallback) {",
"  if (!Array.isArray(value)) return fallback;",
"  var result = [];",
"  for (var i = 0; i < value.length; i++) {",
"    var item = value[i];",
"    if (typeof item === 'string') {",
"      result.push(item);",
"    } else if (isRecord(item)) {",
"      var hasPath = typeof item.path === 'string' && item.path.trim();",
"      var hasTemplate = typeof item.template === 'string' && item.template.trim();",
"      if (hasPath === hasTemplate) continue;",
"      var entry = {};",
"      if (hasPath) entry.path = item.path.trim();",
"      if (hasTemplate) entry.template = item.template;",
"      if (item.role && ['system', 'user', 'assistant'].indexOf(item.role) !== -1) entry.role = item.role;",
"      if (item.position && VALID_CONTEXT_PATH_POSITIONS.indexOf(item.position) !== -1) entry.position = item.position;",
"      result.push(entry);",
"    }",
"  }",
"  return result;",
"}",
  "function fail(code, message, details) {",
  "  const error = new Error(message);",
  "  error.code = code;",
  "  if (details !== undefined) error.details = details;",
  "  throw error;",
  "}",
  "",
  "function buildAgentJson(input) {",
  "  const id = input.id.trim();",
  "  const level = typeof input.level === 'number' ? input.level : 1;",
  "  const enabledTools = asStringArray(input.platformToolsEnabled, DEFAULT_PLATFORM_TOOLS);",
  "  for (const t of enabledTools) {",
  "    if (VALID_PLATFORM_TOOLS.indexOf(t) === -1) {",
  "      fail('AGENT_TOOL_INVALID', 'platformToolsEnabled lists unknown tool [' + t + ']. Valid: ' + VALID_PLATFORM_TOOLS.join(', ') + '.', { tool: t });",
  "    }",
  "  }",
  "  const config = {",
  "    id: id,",
  "    title: input.title.trim(),",
  "    summary: input.summary.trim(),",
  "    contacts: asStringArray(input.contacts, []),",
  "    contextPaths: asContextPathArray(input.contextPaths, []),",
  "    skills: {",
  "      enabled: asStringArray(input.skillsEnabled, []),",
  "      disabled: [],",
  "    },",
  "    platformTools: {",
  "      enabled: enabledTools,",
  "      disabled: [],",
  "    },",
  "    workspaceAccess: { level: level },",
  "  };",
  "  return JSON.stringify(config, null, 2) + '\\n';",
  "}",
  "",
  "function buildAgentMd(input) {",
  "  const contacts = asStringArray(input.contacts, []);",
  "  return [",
  "    '# ' + input.title.trim(),",
  "    '',",
  "    'SOP for the ' + input.id.trim() + ' agent.',",
  "    '',",
  "    '## Responsibilities',",
  "    '',",
  "    '- [Describe what this agent does during a turn.]',",
  "    '',",
  "    '## Delegation',",
  "    '',",
  "    '- contacts: ' + (contacts.join(', ') || '(none)'),",
  "    '- Call a contact via `agent_call` when its specialty is needed.',",
  "    '',",
  "  ].join('\\n');",
  "}",
  "",
  "function buildSoulMd(input) {",
  "  const hint = isNonEmptyString(input.soulHint) ? input.soulHint.trim() : '[Durable identity and expression style for this agent.]';",
  "  return [",
  "    '# ' + input.title.trim() + ' Soul',",
  "    '',",
  "    hint,",
  "    '',",
  "  ].join('\\n');",
  "}",
  "",
  "async function pathExists(tsian, path) {",
  "  try { await tsian.workspace.read(path); return true; } catch { return false; }",
  "}",
  "",
  "async function generateAgentSkeleton(input, tsian, signal) {",
  "  try {",
  "    signal.throwIfAborted();",
  "    if (!isRecord(input)) {",
  "      fail('SKELETON_INPUT_INVALID', 'Generation input must be an object.', { input: input });",
  "    }",
  "    if (!isNonEmptyString(input.id)) {",
  "      fail('SKELETON_ID_MISSING', 'Field `id` is required (non-empty string).');",
  "    }",
  "    if (!isNonEmptyString(input.title)) {",
  "      fail('SKELETON_TITLE_MISSING', 'Field `title` is required (non-empty string).');",
  "    }",
  "    if (!isNonEmptyString(input.summary)) {",
  "      fail('SKELETON_SUMMARY_MISSING', 'Field `summary` is required (non-empty string).');",
  "    }",
  "    const id = input.id.trim();",
  "    if (id.indexOf('/') !== -1 || id.indexOf('..') !== -1 || id.indexOf('\\\\') !== -1) {",
  "      fail('SKELETON_ID_INVALID', 'id must not contain path separators or traversal sequences.', { id: id });",
  "    }",
  "    const agentDir = 'agents/' + id;",
  "    const overwrite = input.overwrite === true;",
  "    tsian.trace('agent_skeleton_started', { schema: RESULT_SCHEMA, agentDir: agentDir, overwrite: overwrite });",
  "",
  "    const agentJsonPath = agentDir + '/agent.json';",
  "    if (!overwrite && await pathExists(tsian, agentJsonPath)) {",
  "      fail('SKELETON_ALREADY_EXISTS', agentJsonPath + ' already exists. Set overwrite: true to regenerate.', { path: agentJsonPath });",
  "    }",
  "",
  "    const createdFiles = [];",
  "    await tsian.workspace.write({ scope: 'card-content', path: agentJsonPath, content: buildAgentJson(input) });",
  "    createdFiles.push(agentJsonPath);",
  "",
  "    const agentMdPath = agentDir + '/AGENT.md';",
  "    if (overwrite || !await pathExists(tsian, agentMdPath)) {",
  "      await tsian.workspace.write({ scope: 'card-content', path: agentMdPath, content: buildAgentMd(input) });",
  "      createdFiles.push(agentMdPath);",
  "    }",
  "",
  "    if (input.generateSoul === true) {",
  "      const soulMdPath = agentDir + '/SOUL.md';",
  "      if (overwrite || !await pathExists(tsian, soulMdPath)) {",
  "        await tsian.workspace.write({ scope: 'card-content', path: soulMdPath, content: buildSoulMd(input) });",
  "        createdFiles.push(soulMdPath);",
  "      }",
  "    }",
  "",
  "    tsian.trace('agent_skeleton_completed', { schema: RESULT_SCHEMA, agentDir: agentDir, createdCount: createdFiles.length });",
  "    return { schema: RESULT_SCHEMA, agentId: id, ok: true, createdFiles: createdFiles };",
  "  } catch (error) {",
  "    tsian.trace('agent_skeleton_failed', { code: (error && error.code) || 'SKELETON_GENERATION_FAILED', message: (error && error.message) || String(error) });",
  "    throw error;",
  "  }",
  "}",
  "",
  "return generateAgentSkeleton(input, tsian, signal);",
  "",
].join("\n")

const VALIDATE_AGENT_DEFINITION_JS = [
  "const RESULT_SCHEMA = 'tsian.agent.definition.validate.v1';",
  "",
  "const VALID_PLATFORM_TOOLS = [",
  "  'agent_call',",
  "  'workspace_read',",
  "  'workspace_write',",
  "  'inspect_frontend',",
  "  'workspace_semantic_search',",
  "  'ask_user',",
  "  'test_skill_script',",
  "];",
  "",
  "const VALID_CONTEXT_PATH_POSITIONS = [",
  "  'prelude',",
  "  'runtime',",
  "  'framing',",
  "];",
  "",
  "function isRecord(value) {",
  "  return typeof value === 'object' && value !== null && !Array.isArray(value);",
  "}",
  "function isNonEmptyString(value) {",
  "  return typeof value === 'string' && value.trim().length > 0;",
  "}",
  "function isStringArray(value) {",
  "  return Array.isArray(value) && value.every(function (item) { return typeof item === 'string'; });",
  "}",
  "function isContextPathEntryArray(value) {",
  "  if (!Array.isArray(value)) return false;",
  "  return value.every(function (item) {",
  "    if (typeof item === 'string') return true;",
  "    if (!isRecord(item)) return false;",
  "    var hasPath = typeof item.path === 'string' && item.path.trim();",
  "    var hasTemplate = typeof item.template === 'string' && item.template.trim();",
  "    // path and template are mutually exclusive; exactly one required.",
  "    if (hasPath === hasTemplate) return false;",
  "    if (item.role !== undefined && ['system', 'user', 'assistant'].indexOf(item.role) === -1) return false;",
  "    if (item.position !== undefined && VALID_CONTEXT_PATH_POSITIONS.indexOf(item.position) === -1) return false;",
  "    return true;",
  "  });",
  "}",
  "function fail(code, message, details) {",
  "  const error = new Error(message);",
  "  error.code = code;",
  "  if (details !== undefined) error.details = details;",
  "  throw error;",
  "}",
  "",
  "function resolveAgentDir(input) {",
  "  if (!isRecord(input)) {",
  "    fail('AGENT_INPUT_INVALID', 'Validation input must be an object.', { input: input });",
  "  }",
  "  if (isNonEmptyString(input.path)) {",
  "    return input.path.trim();",
  "  }",
  "  if (isNonEmptyString(input.agentId)) {",
  "    const id = input.agentId.trim();",
  "    if (id.indexOf('/') !== -1 || id.indexOf('..') !== -1) {",
  "      fail('AGENT_ID_INVALID', 'agentId must not contain path separators or traversal sequences.', { agentId: id });",
  "    }",
  "    return 'agents/' + id;",
  "  }",
  "  fail('AGENT_TARGET_MISSING', 'Provide either { path: agents/<id> } or { agentId: <id> }.');",
  "}",
  "",
  "function dirName(dirPath) {",
  "  const parts = dirPath.split('/').filter(Boolean);",
  "  return parts.length > 0 ? parts[parts.length - 1] : '';",
  "}",
  "",
  "async function readAgentJson(tsian, path, signal) {",
  "  signal.throwIfAborted();",
  "  const result = await tsian.workspace.read(path);",
  "  signal.throwIfAborted();",
  "  const content = (result && result.content) || '';",
  "  try {",
  "    return JSON.parse(content);",
  "  } catch (error) {",
  "    fail('AGENT_JSON_INVALID', 'agent.json is not valid JSON: ' + (error && error.message), { path: path });",
  "  }",
  "}",
  "",
  "async function fileExists(tsian, path, signal) {",
  "  try {",
  "    signal.throwIfAborted();",
  "    await tsian.workspace.read(path);",
  "    return true;",
  "  } catch { return false; }",
  "}",
  "",
  "function validateAgentConfig(config, agentDir, errors, warnings) {",
  "  if (!isRecord(config)) {",
  "    errors.push('agent.json root must be a JSON object.');",
  "    return;",
  "  }",
  "  const expectedId = dirName(agentDir);",
  "",
  "  if (!isNonEmptyString(config.id)) {",
  "    errors.push('Field `id` must be a non-empty string.');",
  "  } else if (config.id !== expectedId) {",
  "    errors.push('Field `id` [' + config.id + '] must match the directory name [' + expectedId + '].');",
  "  }",
  "  if (!isNonEmptyString(config.title)) errors.push('Field `title` must be a non-empty string.');",
  "  if (!isNonEmptyString(config.summary)) errors.push('Field `summary` must be a non-empty string.');",
  "  if (!isStringArray(config.contacts)) errors.push('Field `contacts` must be an array of strings.');",
  "  if (!isContextPathEntryArray(config.contextPaths)) errors.push('Field `contextPaths` must be an array of strings or objects with path/template (mutually exclusive), optional role, and optional position (one of: prelude, runtime, framing).');",
  "  if (config.enabledModules !== undefined && !isStringArray(config.enabledModules)) errors.push('Field `enabledModules` must be an array of strings when present.');",
  "",
  "  if (!isRecord(config.skills)) {",
  "    errors.push('Field `skills` must be an object with `enabled` and `disabled` arrays.');",
  "  } else {",
  "    if (!isStringArray(config.skills.enabled)) errors.push('Field `skills.enabled` must be an array of strings.');",
  "    if (!isStringArray(config.skills.disabled)) errors.push('Field `skills.disabled` must be an array of strings.');",
  "  }",
  "",
  "  if (!isRecord(config.platformTools)) {",
  "    errors.push('Field `platformTools` must be an object with `enabled` and `disabled` arrays.');",
  "  } else {",
  "    if (!isStringArray(config.platformTools.enabled)) {",
  "      errors.push('Field `platformTools.enabled` must be an array of strings.');",
  "    } else {",
  "      for (const tool of config.platformTools.enabled) {",
  "        if (VALID_PLATFORM_TOOLS.indexOf(tool) === -1) {",
  "          errors.push('platformTools.enabled lists unknown tool [' + tool + ']. Valid: ' + VALID_PLATFORM_TOOLS.join(', ') + '.');",
  "        }",
  "      }",
  "    }",
  "    if (!isStringArray(config.platformTools.disabled)) {",
  "      errors.push('Field `platformTools.disabled` must be an array of strings.');",
  "    } else {",
  "      for (const tool of config.platformTools.disabled) {",
  "        if (VALID_PLATFORM_TOOLS.indexOf(tool) === -1) {",
  "          warnings.push('platformTools.disabled lists unknown tool [' + tool + ']. Valid: ' + VALID_PLATFORM_TOOLS.join(', ') + '.');",
  "        }",
  "      }",
  "    }",
  "  }",
  "",
  "  if (!isRecord(config.workspaceAccess) || typeof config.workspaceAccess.level !== 'number') {",
  "    errors.push('Field `workspaceAccess.level` must be a number (1 for runtime agents, 4 for assistant).');",
  "  }",
  "  if (config.knowledgeMount !== undefined && typeof config.knowledgeMount !== 'string') {",
  "    errors.push('Field `knowledgeMount` must be a string when present.');",
  "  }",
  "  if (config.providerPresetId !== undefined && typeof config.providerPresetId !== 'string') {",
  "    errors.push('Field `providerPresetId` must be a string when present.');",
  "  }",
  "  if (config.messageLayers !== undefined) {",
  "    if (!isRecord(config.messageLayers)) {",
  "      warnings.push('Field `messageLayers` must be a JSON object when present; ignoring.');",
  "    } else {",
  "      const layerKeys = ['historySummary', 'contextMeta', 'toolMemory', 'turnRuntime'];",
  "      const validRoles = ['system', 'user', 'assistant'];",
  "      for (const key of layerKeys) {",
  "        if (config.messageLayers[key] !== undefined) {",
  "          if (!isRecord(config.messageLayers[key]) || config.messageLayers[key].role === undefined) {",
  "            warnings.push('messageLayers.' + key + ' must be an object with a `role` field; ignoring.');",
  "          } else if (validRoles.indexOf(config.messageLayers[key].role) === -1) {",
  "            warnings.push('messageLayers.' + key + '.role must be one of: system, user, assistant; ignoring.');",
  "          }",
  "        }",
  "      }",
  "    }",
  "  }",
  "}",
  "",
  "async function validateAgentDefinition(input, tsian, signal) {",
  "  try {",
  "    signal.throwIfAborted();",
  "    const agentDir = resolveAgentDir(input);",
  "    const errors = [];",
  "    const warnings = [];",
  "    tsian.trace('agent_validation_started', { schema: RESULT_SCHEMA, agentDir: agentDir });",
  "",
  "    const agentJsonPath = agentDir + '/agent.json';",
  "    let config = null;",
  "    try {",
  "      config = await readAgentJson(tsian, agentJsonPath, signal);",
  "    } catch (error) {",
  "      if (error && error.code === 'AGENT_JSON_INVALID') {",
  "        errors.push(error.message);",
  "      } else {",
  "        errors.push('agent.json not found at ' + agentJsonPath + '.');",
  "      }",
  "    }",
  "",
  "    if (config !== null) {",
  "      validateAgentConfig(config, agentDir, errors, warnings);",
  "    }",
  "",
  "    signal.throwIfAborted();",
  "    const agentMdExists = await fileExists(tsian, agentDir + '/AGENT.md', signal);",
  "    if (!agentMdExists) {",
  "      errors.push('AGENT.md not found at ' + agentDir + '/AGENT.md (required SOP file).');",
  "    }",
  "",
  "    if (config && isStringArray(config.contacts)) {",
  "      signal.throwIfAborted();",
  "      for (const contactId of config.contacts) {",
  "        const exists = await fileExists(tsian, 'agents/' + contactId + '/agent.json', signal);",
  "        if (!exists) {",
  "          warnings.push('contacts references [' + contactId + '] but agents/' + contactId + '/agent.json was not found.');",
  "        }",
  "      }",
  "    }",
  "",
  "    const ok = errors.length === 0;",
  "    tsian.trace('agent_validation_completed', { schema: RESULT_SCHEMA, ok: ok, errorCount: errors.length, warningCount: warnings.length });",
  "    return { schema: RESULT_SCHEMA, agentId: dirName(agentDir), ok: ok, errors: errors, warnings: warnings };",
  "  } catch (error) {",
  "    tsian.trace('agent_validation_failed', { code: (error && error.code) || 'AGENT_VALIDATION_FAILED', message: (error && error.message) || String(error) });",
  "    throw error;",
  "  }",
  "}",
  "",
  "return validateAgentDefinition(input, tsian, signal);",
  "",
].join("\n")

const VALIDATE_SKILL_DEFINITION_JS = [
  "const RESULT_SCHEMA = 'tsian.skill.definition.validate.v1';",
  "",
  "function isRecord(value) {",
  "  return typeof value === 'object' && value !== null && !Array.isArray(value);",
  "}",
  "function isNonEmptyString(value) {",
  "  return typeof value === 'string' && value.trim().length > 0;",
  "}",
  "function fail(code, message, details) {",
  "  const error = new Error(message);",
  "  error.code = code;",
  "  if (details !== undefined) error.details = details;",
  "  throw error;",
  "}",
  "",
  "function stripQuotes(s) {",
  "  if (s.length >= 2 && s.charAt(0) === '\\'' && s.charAt(s.length - 1) === '\\'') return s.slice(1, -1);",
  "  if (s.length >= 2 && s.charAt(0) === '\"' && s.charAt(s.length - 1) === '\"') return s.slice(1, -1);",
  "  return s;",
  "}",
  "",
  "function parseFrontmatter(content) {",
  "  const lines = content.split(/\\r?\\n/);",
  "  if (!lines.length || lines[0].trim() !== '---') {",
  "    return { ok: false, error: 'Missing opening --- frontmatter delimiter.' };",
  "  }",
  "  let end = -1;",
  "  for (let i = 1; i < lines.length; i++) {",
  "    if (lines[i].trim() === '---') { end = i; break; }",
  "  }",
  "  if (end === -1) {",
  "    return { ok: false, error: 'Missing closing --- frontmatter delimiter.' };",
  "  }",
  "  const yamlLines = lines.slice(1, end);",
  "  const data = {};",
  "  let currentKey = null;",
  "  for (const line of yamlLines) {",
  "    if (!line.trim()) continue;",
  "    const listMatch = line.match(/^\\s+-\\s+(.*)$/);",
  "    if (listMatch && currentKey) {",
  "      if (!Array.isArray(data[currentKey])) data[currentKey] = [];",
  "      data[currentKey].push(stripQuotes(listMatch[1].trim()));",
  "      continue;",
  "    }",
  "    const inlineArrMatch = line.match(/^([\\w-]+):\\s*\\[(.*)\\]\\s*$/);",
  "    if (inlineArrMatch) {",
  "      const key = inlineArrMatch[1];",
  "      const items = inlineArrMatch[2].split(',').map(function (s) { return stripQuotes(s.trim()); }).filter(Boolean);",
  "      data[key] = items;",
  "      currentKey = key;",
  "      continue;",
  "    }",
  "    const kvMatch = line.match(/^([\\w-]+):\\s*(.*)$/);",
  "    if (kvMatch) {",
  "      const key = kvMatch[1];",
  "      const val = kvMatch[2].trim();",
  "      data[key] = val === '' ? null : stripQuotes(val);",
  "      currentKey = key;",
  "      continue;",
  "    }",
  "  }",
  "  return { ok: true, data: data };",
  "}",
  "",
  "const FENCE_RE = /```([^\\n`]*)\\r?\\n([\\s\\S]*?)```/g;",
  "function parseActionDeclarations(body) {",
  "  const actions = [];",
  "  const errors = [];",
  "  const seen = {};",
  "  let match;",
  "  FENCE_RE.lastIndex = 0;",
  "  while ((match = FENCE_RE.exec(body)) !== null) {",
  "    const info = (match[1] || '').toLowerCase();",
  "    if (info.split(/\\s+/).indexOf('tsian-actions') === -1) continue;",
  "    let parsed;",
  "    try { parsed = JSON.parse(match[2] || ''); } catch (e) {",
  "      errors.push('tsian-actions fence JSON is invalid: ' + (e && e.message));",
  "      continue;",
  "    }",
  "    const arr = Array.isArray(parsed) ? parsed : [parsed];",
  "    for (const raw of arr) {",
  "      if (!isRecord(raw)) { errors.push('Action declaration must be a JSON object.'); continue; }",
  "      const name = typeof raw.name === 'string' ? raw.name.trim() : '';",
  "      if (!name) { errors.push('Action declaration requires a non-empty name.'); continue; }",
  "      const key = name.toLowerCase();",
  "      if (seen[key]) { errors.push('Duplicate action declaration: ' + name); continue; }",
  "      seen[key] = true;",
  "      const executor = isRecord(raw.executor) ? raw.executor : null;",
  "      const execType = (executor && typeof executor.type === 'string') ? executor.type.trim() : '';",
  "      if (execType !== 'browser_script') {",
  "        errors.push('Action [' + name + '] executor.type must be browser_script (got ' + execType + ').');",
  "      }",
  "      const path = (executor && typeof executor.path === 'string') ? executor.path : '';",
  "      if (!path) {",
  "        errors.push('Action [' + name + '] requires executor.path.');",
  "      } else if (path.indexOf('..') !== -1 || path.charAt(0) === '/') {",
  "        errors.push('Action [' + name + '] executor.path must not escape the skill directory: ' + path);",
  "      }",
  "      const timeoutMs = executor ? executor.timeoutMs : undefined;",
  "      if (typeof timeoutMs !== 'number' || timeoutMs <= 0 || timeoutMs > 60000) {",
  "        errors.push('Action [' + name + '] executor.timeoutMs must be a positive number <= 60000.');",
  "      }",
  "      const inputSchema = isRecord(raw.inputSchema) ? raw.inputSchema : null;",
  "      if (inputSchema && inputSchema.type !== 'object') {",
  "        errors.push('Action [' + name + '] inputSchema root type must be object.');",
  "      }",
  "      actions.push({ name: name, path: path });",
  "    }",
  "  }",
  "  return { actions: actions, errors: errors };",
  "}",
  "",
  "function dirNameFromSkillPath(skillPath) {",
  "  const parts = skillPath.split('/').filter(Boolean);",
  "  if (parts.length >= 2) return parts[parts.length - 2];",
  "  return '';",
  "}",
  "",
  "async function validateSkillDefinition(input, tsian, signal) {",
  "  try {",
  "    signal.throwIfAborted();",
  "    if (!isRecord(input)) {",
  "      fail('SKILL_INPUT_INVALID', 'Validation input must be an object.', { input: input });",
  "    }",
  "    if (!isNonEmptyString(input.skillPath)) {",
  "      fail('SKILL_PATH_MISSING', 'Field `skillPath` is required (e.g. skills/my-skill/SKILL.md).');",
  "    }",
  "    const skillPath = input.skillPath.trim();",
  "    tsian.trace('skill_validation_started', { schema: RESULT_SCHEMA, skillPath: skillPath });",
  "",
  "    const errors = [];",
  "    const warnings = [];",
  "",
  "    signal.throwIfAborted();",
  "    let content = '';",
  "    try {",
  "      const result = await tsian.workspace.read(skillPath);",
  "      content = (result && result.content) || '';",
  "    } catch {",
  "      fail('SKILL_NOT_FOUND', 'SKILL.md not found at ' + skillPath + '.', { skillPath: skillPath });",
  "    }",
  "",
  "    const fm = parseFrontmatter(content);",
  "    if (!fm.ok) {",
  "      errors.push(fm.error);",
  "    } else {",
  "      const data = fm.data;",
  "      if (!isNonEmptyString(data.name)) {",
  "        errors.push('Frontmatter `name` must be a non-empty string.');",
  "      } else {",
  "        const expectedName = dirNameFromSkillPath(skillPath);",
  "        if (expectedName && data.name !== expectedName) {",
  "          errors.push('Frontmatter `name` [' + data.name + '] must match the skill directory name [' + expectedName + '].');",
  "        }",
  "      }",
  "      if (!isNonEmptyString(data.title)) errors.push('Frontmatter `title` must be a non-empty string.');",
  "      if (!isNonEmptyString(data.description)) errors.push('Frontmatter `description` must be a non-empty string.');",
  "      if (!Array.isArray(data.triggers) || data.triggers.length === 0) errors.push('Frontmatter `triggers` must be a non-empty array.');",
  "      if (!Array.isArray(data.appliesTo) || data.appliesTo.length === 0) errors.push('Frontmatter `appliesTo` must be a non-empty array.');",
  "    }",
  "",
  "    signal.throwIfAborted();",
  "    const actionResult = parseActionDeclarations(content);",
  "    for (const i in actionResult.errors) errors.push(actionResult.errors[i]);",
  "",
  "    const ok = errors.length === 0;",
  "    tsian.trace('skill_validation_completed', { schema: RESULT_SCHEMA, ok: ok, errorCount: errors.length, actionCount: actionResult.actions.length });",
  "    return { schema: RESULT_SCHEMA, skillPath: skillPath, ok: ok, errors: errors, warnings: warnings, actions: actionResult.actions };",
  "  } catch (error) {",
  "    tsian.trace('skill_validation_failed', { code: (error && error.code) || 'SKILL_VALIDATION_FAILED', message: (error && error.message) || String(error) });",
  "    throw error;",
  "  }",
  "}",
  "",
  "return validateSkillDefinition(input, tsian, signal);",
  "",
].join("\n")

function defaultAssistantConfig(): AgentConfig {
  return {
    id: LOCAL_ASSISTANT_AGENT_ID,
    title: "Desktop Assistant",
    summary: "Helps players understand and edit the current game card.",
    contacts: [],
    contextPaths: [],
    skills: {
      enabled: [
        ".tsian/local/assistant/skills/framework-knowledge/SKILL.md",
        ".tsian/local/assistant/skills/agent-authoring/SKILL.md",
        ".tsian/local/assistant/skills/skill-authoring/SKILL.md",
        ".tsian/local/assistant/skills/card-content-drafting/SKILL.md",
      ],
      disabled: [],
    },
    platformTools: {
      enabled: ["agent_call", "workspace_read", "workspace_write", "inspect_frontend", "ask_user", "test_skill_script"],
      disabled: [],
    },
    workspaceAccess: {
      level: 4,
    },
    knowledgeMount: "docs/",
    entryMode: "persistent",
    system: true,
  }
}

function defaultLocalAssistantFileMap(skipDefaultMerge?: string): StoredAssistantFileMap {
  const now = Date.now()
  void now
  const config = defaultAssistantConfig()
  const map: StoredAssistantFileMap = {
    [`${LOCAL_ASSISTANT_DIR}/agent.json`]: {
      content: JSON.stringify(config, null, 2) + "\n",
    },
    [`${LOCAL_ASSISTANT_DIR}/AGENT.md`]: {
      content: DEFAULT_AGENT_MD,
    },
    [`${LOCAL_ASSISTANT_DIR}/SOUL.md`]: {
      content: DEFAULT_SOUL_MD,
    },
    [`${LOCAL_ASSISTANT_DIR}/notes.md`]: {
      content: "# Assistant Notes\n\n",
    },
    ...defaultFrameworkKnowledgeFileMap(LOCAL_ASSISTANT_DIR),
    [`${LOCAL_ASSISTANT_DIR}/skills/agent-authoring/SKILL.md`]: {
      content: AGENT_AUTHORING_SKILL_MD,
    },
    [`${LOCAL_ASSISTANT_DIR}/skills/skill-authoring/SKILL.md`]: {
      content: SKILL_AUTHORING_SKILL_MD,
    },
    [`${LOCAL_ASSISTANT_DIR}/skills/card-content-drafting/SKILL.md`]: {
      content: CARD_CONTENT_DRAFTING_SKILL_MD,
    },
    [`${LOCAL_ASSISTANT_DIR}/skills/card-content-drafting/scripts/validate-workspace-layout.js`]: {
      content: VALIDATE_WORKSPACE_LAYOUT_JS,
    },
    [`${LOCAL_ASSISTANT_DIR}/skills/agent-authoring/scripts/generate-agent-skeleton.js`]: {
      content: GENERATE_AGENT_SKELETON_JS,
    },
    [`${LOCAL_ASSISTANT_DIR}/skills/agent-authoring/scripts/validate-agent-definition.js`]: {
      content: VALIDATE_AGENT_DEFINITION_JS,
    },
    [`${LOCAL_ASSISTANT_DIR}/skills/skill-authoring/scripts/validate-skill-definition.js`]: {
      content: VALIDATE_SKILL_DEFINITION_JS,
    },
  }
  if (!skipDefaultMerge) {
    return map
  }
  const withoutFactorySkills: StoredAssistantFileMap = {}
  for (const [path, file] of Object.entries(map)) {
    if (!path.startsWith(`${LOCAL_ASSISTANT_DIR}/skills/`)) {
      withoutFactorySkills[path] = file
    }
  }
  return withoutFactorySkills
}

/** Load local assistant files from the Dexie meta store, seeding defaults if absent. */
export async function loadLocalAssistantFiles(): Promise<WorkspaceFile[]> {
  const record = await localDb.meta.get(LOCAL_ASSISTANT_FILES_KEY)
  if (record?.value) {
    try {
      const parsed = JSON.parse(record.value) as StoredAssistantFileMap
      if (parsed && typeof parsed === "object") {
        // Merge: fill in default keys missing from the stored map so new
        // factory skills reach existing users without overwriting their edits.
        const skipDefaultMerge = await localDb.meta.get(LOCAL_ASSISTANT_SKIP_DEFAULT_MERGE_KEY)
        const defaults = defaultLocalAssistantFileMap(skipDefaultMerge?.value)
        let merged = false
        for (const [path, file] of Object.entries(defaults)) {
          if (!(path in parsed)) {
            parsed[path] = file
            merged = true
          }
        }
        if (merged) {
          await localDb.meta.put({
            key: LOCAL_ASSISTANT_FILES_KEY,
            value: JSON.stringify(parsed),
          })
        }
        return Object.entries(parsed).map(([path, file]) => ({
          path,
          content: file.content,
          createdAt: 0,
          updatedAt: 0,
        }))
      }
    } catch {
      // Fall through to seeding.
    }
  }

  // Seed defaults and persist.
  const map = defaultLocalAssistantFileMap()
  await localDb.meta.put({
    key: LOCAL_ASSISTANT_FILES_KEY,
    value: JSON.stringify(map),
  })
  return Object.entries(map).map(([path, file]) => ({
    path,
    content: file.content,
    createdAt: 0,
    updatedAt: 0,
  }))
}

/** Persist local assistant files back to the Dexie meta store. */
export async function saveLocalAssistantFiles(files: WorkspaceFile[]): Promise<void> {
  const map: StoredAssistantFileMap = {}
  for (const file of files) {
    if (!file.path.startsWith(`${LOCAL_ASSISTANT_DIR}/`)) {
      continue
    }
    map[file.path] = {
      content: file.content,
    }
  }
  // Merge with existing stored files so we don't drop anything not in this batch.
  const record = await localDb.meta.get(LOCAL_ASSISTANT_FILES_KEY)
  if (record?.value) {
    try {
      const existing = JSON.parse(record.value) as StoredAssistantFileMap
      if (existing && typeof existing === "object") {
        for (const [path, file] of Object.entries(existing)) {
          if (!(path in map)) {
            map[path] = file
          }
        }
      }
    } catch {
      // Ignore; we'll overwrite with the merged map.
    }
  }
  await localDb.meta.put({
    key: LOCAL_ASSISTANT_FILES_KEY,
    value: JSON.stringify(map),
  })
}

export async function replaceLocalAssistantFiles(
  deletePaths: string[],
  files: WorkspaceFile[],
  options: { skipDefaultMerge?: boolean } = {},
): Promise<void> {
  const record = await localDb.meta.get(LOCAL_ASSISTANT_FILES_KEY)
  let map: StoredAssistantFileMap = {}
  if (record?.value) {
    try {
      const existing = JSON.parse(record.value) as StoredAssistantFileMap
      if (existing && typeof existing === "object") {
        map = { ...existing }
      }
    } catch {
      map = {}
    }
  }

  for (const target of deletePaths) {
    if (!isLocalAssistantPath(target)) {
      continue
    }
    for (const path of Object.keys(map)) {
      if (path === target || path.startsWith(`${target}/`)) {
        delete map[path]
      }
    }
  }

  for (const file of files) {
    if (!file.path.startsWith(`${LOCAL_ASSISTANT_DIR}/`)) {
      continue
    }
    map[file.path] = { content: file.content }
  }

  await localDb.meta.put({
    key: LOCAL_ASSISTANT_FILES_KEY,
    value: JSON.stringify(map),
  })
  if (options.skipDefaultMerge) {
    await localDb.meta.put({
      key: LOCAL_ASSISTANT_SKIP_DEFAULT_MERGE_KEY,
      value: new Date().toISOString(),
    })
  }
}

export async function refreshLocalAssistantFrameworkKnowledgeFiles(): Promise<LocalAssistantKnowledgeRefreshResult> {
  const defaults = defaultFrameworkKnowledgeFileMap(LOCAL_ASSISTANT_DIR)
  const officialPaths = Object.keys(defaults)
  const record = await localDb.meta.get(LOCAL_ASSISTANT_FILES_KEY)
  let map: StoredAssistantFileMap = record?.value ? {} : defaultLocalAssistantFileMap()
  if (record?.value) {
    try {
      const existing = JSON.parse(record.value) as StoredAssistantFileMap
      if (existing && typeof existing === "object") {
        map = { ...existing }
      }
    } catch {
      map = defaultLocalAssistantFileMap()
    }
  }

  const removedPaths: string[] = []
  for (const stalePath of obsoleteFrameworkKnowledgePaths(LOCAL_ASSISTANT_DIR)) {
    if (stalePath in map) {
      delete map[stalePath]
      removedPaths.push(stalePath)
    }
  }

  for (const [path, file] of Object.entries(defaults)) {
    map[path] = file
  }

  await localDb.meta.put({
    key: LOCAL_ASSISTANT_FILES_KEY,
    value: JSON.stringify(map),
  })

  return { updatedPaths: officialPaths, removedPaths }
}

/** Check whether a path belongs to the local assistant directory. */
export function isLocalAssistantPath(path: string): boolean {
  return path === LOCAL_ASSISTANT_DIR || path.startsWith(`${LOCAL_ASSISTANT_DIR}/`)
}

/**
 * 助手会话 context 快照的虚拟文件路径(design 06-20-assistant-context-persistence).
 * 存本模块 Dexie map 的一项,对外暴露为虚拟文件——agent 可 workspace_read/write 管理,
 * 契合"平台数据收录到文件系统"的产品哲学.每会话独立路径,切换会话不串上下文.
 */
export function assistantContextPath(sessionId: string): string {
  return `${LOCAL_ASSISTANT_DIR}/sessions/${sessionId}/context.json`
}

/**
 * 助手会话 context 快照所在目录前缀(所有 sessions/<id>/context.json 共享).
 * 用于在事务 commit 回写时排除这类"由 stageAssistantContextFile 直写 Dexie 管辖"
 * 的文件——它们不经过 RuntimeWorkspaceTransaction,若把事务 baseline 里的旧版本
 * 一并回写会覆盖直写的新版本(clobber 缺陷:每轮 context.json 被还原成 turn 开头值).
 */
const ASSISTANT_CONTEXT_DIR = `${LOCAL_ASSISTANT_DIR}/sessions/`

/** 判断路径是否属于助手会话 context 快照(stagedAssistantContextFile 专属管辖). */
export function isAssistantContextPath(path: string): boolean {
  return path.startsWith(ASSISTANT_CONTEXT_DIR)
}

/**
 * 判断路径是否属于"直写 Dexie 管辖"的助手运行时文件——这类文件由 stage 函数
 * (stageAssistantContextFile)绕过事务直写,事务 baseline 里是 turn 开头的旧版本.
 * 若 commit 回写会覆盖直写的新版本(clobber).commit 时必须排除它们,只让 stage
 * 函数的直写生效.
 */
export function isAssistantDirectWritePath(path: string): boolean {
  return isAssistantContextPath(path)
}

/**
 * 从 local-assistant-files map 删除单个文件(供会话删除清理 context 快照).
 * saveLocalAssistantFiles 是合并模式(只合并不删项),故需此专用删除函数.
 * 只处理 .tsian/local/assistant/ 前缀路径(安全边界),非该前缀忽略.
 */
export async function deleteLocalAssistantFile(path: string): Promise<void> {
  if (!isLocalAssistantPath(path)) {
    return
  }
  const record = await localDb.meta.get(LOCAL_ASSISTANT_FILES_KEY)
  if (!record?.value) {
    return
  }
  try {
    const map = JSON.parse(record.value) as StoredAssistantFileMap
    if (!map || typeof map !== "object" || !(path in map)) {
      return
    }
    delete map[path]
    await localDb.meta.put({
      key: LOCAL_ASSISTANT_FILES_KEY,
      value: JSON.stringify(map),
    })
  } catch {
    // 损坏 map 忽略,不阻塞会话删除
  }
}

/**
 * 批量删除:一次 IO 删掉精确匹配 + 前缀匹配的所有文件(原子性优于逐个删).
 * 返回实际删除的 path 列表.供资源管理器目录删除使用.
 */
export async function deleteLocalAssistantPath(target: string): Promise<string[]> {
  if (!isLocalAssistantPath(target)) {
    return []
  }
  const record = await localDb.meta.get(LOCAL_ASSISTANT_FILES_KEY)
  if (!record?.value) {
    return []
  }
  try {
    const map = JSON.parse(record.value) as StoredAssistantFileMap
    if (!map || typeof map !== "object") {
      return []
    }
    const deletedPaths: string[] = []
    for (const path of Object.keys(map)) {
      if (path === target || path.startsWith(`${target}/`)) {
        delete map[path]
        deletedPaths.push(path)
      }
    }
    if (deletedPaths.length > 0) {
      await localDb.meta.put({
        key: LOCAL_ASSISTANT_FILES_KEY,
        value: JSON.stringify(map),
      })
    }
    return deletedPaths
  } catch {
    return []
  }
}
