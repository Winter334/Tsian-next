import type { AgentConfig, WorkspaceFile } from "@tsian/contracts"
import { localDb } from "./db"

const LOCAL_ASSISTANT_FILES_KEY = "assistant-local-files"

const LOCAL_ASSISTANT_DIR = ".tsian/local/assistant"

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

const DEFAULT_FRAMEWORK_KNOWLEDGE_SKILL_MD = [
  "---",
  "name: framework-knowledge",
  "title: Framework Knowledge",
  "description: Consult the official Tsian framework knowledge base and local workspace conventions before answering authoring, diagnostics, or workspace-management questions.",
  "triggers:",
  "  - The user asks how Tsian, Game Cards, Save Instances, checkpoints, Runtime Workspace, Agents, Skills, frontend bridge, traces, or diagnostics work",
  "  - The user asks how to edit, fix, or design workspace files",
  "  - The assistant is unsure whether an answer depends on platform or workspace conventions",
  "appliesTo:",
  "  - assistant",
  "---",
  "",
  "# Framework Knowledge",
  "",
  "Use this Skill when answering questions about Tsian framework behavior, workspace layout, game-card authoring, diagnostics, or maintenance decisions.",
  "",
  "Procedure:",
  "",
  "1. Read `docs/tsian-framework-knowledge.md` first. If the question uses terms you cannot find directly, search the workspace for those terms.",
  "2. If the answer depends on local content, inspect the relevant files before answering. Common files include `README.md`, `agents/README.md`, `skills/README.md`, `state/README.md`, `frontend/README.md`, Agent `AGENT.md` files, Skill `SKILL.md` files, and schemas near the data being discussed.",
  "3. Answer from workspace facts. Mention the specific files or conventions you relied on when that helps the user verify the answer.",
  "4. If the knowledge base is incomplete or the requested behavior is future work, say that clearly and separate current facts from suggestions.",
  "",
  "## Workspace Permission Matrix",
  "",
  "Workspace scopes have read/edit access levels. The actor's `workspaceAccess.level` must meet or exceed the scope's `editLevel` to write.",
  "",
  "| Scope | readLevel | editLevel | Paths |",
  "|-------|-----------|-----------|-------|",
  "| card-content | 0 | 2 | workspace root (agents/, skills/, world/, docs/, ...) |",
  "| card-frontend | 0 | 2 | frontend/ |",
  "| save-runtime | 0 | 1 | save/ |",
  "| platform-meta | 4 | 4 | .tsian/ |",
  "",
  "Actor levels:",
  "- Runtime game agents (defined in card `agents/`): default level 1. They can only write `save-runtime` (editLevel 1). Card-content writes are rejected (level 1 < editLevel 2).",
  "- Desktop assistant (`.tsian/local/assistant/`): level 4. It can manage every visible path across all scopes — the user's right hand, including its own definition.",
  "",
  "Source: `DEFAULT_SCOPE_ACCESS` in `workspace-operations.ts`.",
  "",
  "## Skill Lifecycle",
  "",
  "1. Index: skill metadata (name, description, triggers, action summaries) is parsed eagerly from `SKILL.md` frontmatter into the Skill Index.",
  "2. Activate: `use_skill` declares intent; the framework injects the full `SKILL.md` body as a new message in the next round.",
  "3. Execute: `run_script` invokes a skill's `browser_script` action through the Tsian SDK.",
  "",
  "Full `SKILL.md` content never loads eagerly — progressive disclosure is preserved.",
  "",
  "## Assistant vs Runtime Agent Boundary",
  "",
  "The desktop assistant is a platform management agent at `.tsian/local/assistant/`, not a runtime game agent. It runs at workspace access level 4 and can manage card content, save runtime, and platform metadata. Runtime game agents run at level 1 during play turns and can only write save-runtime data. The assistant manages its own definition (agent.json, SOUL.md, AGENT.md, skills/).",
  "",
  "## Reference Documents",
  "",
  "Detailed knowledge is split into reference files under `references/`. Read the relevant one before answering in-depth questions:",
  "",
  "- `references/platform-architecture.md` — Platform model, Runtime Workspace, scopes, agent vs assistant boundary, checkpoint model.",
  "- `references/frontend-development.md` — Game frontend 3-file structure, postMessage bridge API, what frontends can/can't do, assistant's frontend editing capability.",
  "- `references/memory-system.md` — Memory layering model, event cards, summary maintenance, relationship graph conventions, recall strategies.",
  "",
  "Read a reference with `workspace_read({ path: \".tsian/local/assistant/skills/framework-knowledge/references/<file>\" })`.",
  "",
  "This Skill declares no actions. It uses ordinary workspace read, list, and search tools.",
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
  "| `contextPaths` | string[] | yes | Workspace files loaded into the agent's prompt context. |",
  "| `skills.enabled` | string[] | yes | Whitelist of skill names; non-empty narrows visible skills. |",
  "| `skills.disabled` | string[] | yes | Blacklist of skill names. |",
  "| `platformTools.enabled` | string[] | yes | Allowed: `agent_call`, `workspace_read`, `workspace_write`, `inspect_frontend`. |",
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
  "This Skill declares no actions. File generation uses the assistant's `workspace_write` tool (level 4).",
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
  "Actions are declared in a fenced JSON block with the info string `json tsian-actions`:",
  "",
  "```json tsian-actions",
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
  "- `tsian.workspace.read / list / search / glob / diff / patch / write / move / delete / validate` — workspace operations via RPC to the host.",
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
  "This Skill declares no actions. File generation uses the assistant's `workspace_write` tool (level 4).",
  "",
].join("\n")

const CARD_CONTENT_DRAFTING_SKILL_MD = [
  "---",
  "name: card-content-drafting",
  "title: Card Content Drafting",
  "description: Draft world canon, characters, timeline, and memory summaries for game card content.",
  "triggers:",
  "  - The user wants to build a world, characters, timeline, or memory",
  "  - The user wants to draft or flesh out game card content",
  "appliesTo:",
  "  - assistant",
  "---",
  "",
  "# Card Content Drafting",
  "",
  "Use this Skill when drafting or fleshing out game card content: world canon, characters, timelines, memory summaries, and state data.",
  "",
  "## Directory Conventions",
  "",
  "| Path | Scope | Content |",
  "|------|-------|---------|",
  "| `world/` | card-content | World canon, setting, locations, lore. |",
  "| `world/canon.md` | card-content | Core world facts and rules. |",
  "| `agents/` | card-content | Agent definitions (agent.json, AGENT.md, SOUL.md). |",
  "| `skills/` | card-content | Shared skill definitions. |",
  "| `save/history/timeline.md` | save-runtime | Chronological event log. |",
  "| `save/memory/summaries/current.md` | save-runtime | Current-scene summary. |",
  "| `save/memory/summaries/long-term.md` | save-runtime | Durable long-term memory. |",
  "| `save/state/` | save-runtime | Runtime gameplay state. |",
  "",
  "## Drafting Flow",
  "",
  "1. Ask the user for the world setting: genre, tone, key locations, core conflicts.",
  "2. Draft `world/canon.md` with structured world facts (replace empty `# Canon` placeholders).",
  "3. Ask about key characters; draft character files under `world/characters/` if the card uses that convention.",
  "4. Draft `save/history/timeline.md` with an initial timeline skeleton.",
  "5. Draft `save/memory/summaries/current.md` and `long-term.md` with starter summaries.",
  "6. Write files via `workspace_write`. Card-content files use `card-content` scope; save files use `save-runtime` scope.",
  "",
  "## Content Templates",
  "",
  "Canon skeleton:",
  "",
  "```markdown",
  "# Canon",
  "",
  "## Setting",
  "",
  "[One-paragraph world premise.]",
  "",
  "## Core Rules",
  "",
  "- [Rule 1]",
  "- [Rule 2]",
  "",
  "## Key Locations",
  "",
  "- [Location]: [Description]",
  "```",
  "",
  "Timeline skeleton:",
  "",
  "```markdown",
  "# Timeline",
  "",
  "## Epoch: [Name]",
  "",
  "- [Event]: [Description]",
  "```",
  "",
  "Current summary skeleton:",
  "",
  "```markdown",
  "# Current Summary",
  "",
  "[Active scene summary — who, where, what is happening.]",
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
  "Use `run_script` after `use_skill` to invoke `validate_workspace_layout`. It checks expected README files and reports which are present or missing.",
  "",
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

const FRAMEWORK_KNOWLEDGE_REF_PLATFORM_ARCHITECTURE = [
  "# Platform Architecture",
  "",
  "Reference document for the `framework-knowledge` Skill. Covers the Tsian platform model, Runtime Workspace, scopes, agent boundary, and checkpoint model.",
  "",
  "## Product Model",
  "",
  "- Tsian is an Agent-Orchestrated Runtime platform for AIRP (AI Role Play).",
  "- Platform owns: model configuration, API-key boundaries, local storage, checkpoints, bridge APIs, execution policy, and sandboxing.",
  "- A Game Card is reusable content definition plus optional frontend binding and metadata. One card → many Save Instances.",
  "- A Save Instance stores runtime play data for one playthrough. It is card-scoped, not a top-level object.",
  "- A Checkpoint is a rollback point inside one Save Instance — not a top-level game card or save card.",
  "- Game frontends are supplied by Game Cards. The platform UI is not a universal gameplay renderer.",
  "",
  "## Runtime Workspace",
  "",
  "The Runtime Workspace is an effective virtual file system composed from Game Card content plus the active save slot mounted at `save/`.",
  "",
  "- Ordinary workspace paths are visible to Agents, Skills, and game frontends.",
  "- `.tsian/` is platform-owned metadata. It is hidden from ordinary runtime-agent workspace read/list/search unless the actor has platform-meta access level (4).",
  "- Directory README files explain local conventions for data the platform intentionally does not hardcode.",
  "",
  "### Scope Model",
  "",
  "Every workspace path belongs to exactly one scope. The scope determines the access level required to read or write.",
  "",
  "| Scope | readLevel | editLevel | Path prefix |",
  "|-------|-----------|-----------|-------------|",
  "| card-content | 0 | 2 | workspace root (`agents/`, `skills/`, `world/`, `docs/`, ...) |",
  "| card-frontend | 0 | 2 | `frontend/` |",
  "| save-runtime | 0 | 1 | `save/` |",
  "| platform-meta | 4 | 4 | `.tsian/` |",
  "",
  "Source: `DEFAULT_SCOPE_ACCESS` in `apps/platform-web/src/agent-runtime/workspace-operations.ts`.",
  "",
  "### Actor Levels",
  "",
  "- Level 1: runtime game agents (defined in card `agents/`). Can only write `save-runtime` (editLevel 1). Card-content and card-frontend writes are rejected (1 < 2).",
  "- Level 4: desktop assistant (`.tsian/local/assistant/`). Can manage every scope — the user's right hand, including its own definition.",
  "",
  "## Agents",
  "",
  "Agent configuration is Game Card content under `agents/<agent>/agent.json`. Required SOP instructions live under `agents/<agent>/AGENT.md`. Durable identity and work-style prompts live under optional `agents/<agent>/SOUL.md`. Runtime notes live under `save/agents/<agent>/` (save-runtime, not card content).",
  "",
  "The default AIRP runtime uses the entry Agent declared in the workspace; additional Agents act as delegated specialists called via `agent_call`.",
  "",
  "`agent.json` stores: id, title, summary, contacts, contextPaths, skills (enabled/disabled), platformTools (enabled/disabled), workspaceAccess.level, and optional knowledgeMount / providerPresetId.",
  "",
  "See `AgentConfig` in `packages/contracts/src/runtime.ts` for the full schema.",
  "",
  "## Skills",
  "",
  "Skills are on-demand capability packages. Shared Skills live under `skills/<skill>/SKILL.md`; Agent-local Skills live under `agents/<agent>/skills/<skill>/SKILL.md`.",
  "",
  "### Skill Lifecycle",
  "",
  "1. Index: skill metadata (name, description, triggers, appliesTo, action summaries) is parsed eagerly from `SKILL.md` frontmatter into the Skill Index.",
  "2. Activate: `use_skill` declares intent; the framework injects the full `SKILL.md` body as a new message in the next round.",
  "3. Execute: `run_script` invokes a skill's `browser_script` action through the Tsian SDK.",
  "",
  "Full `SKILL.md` content never loads eagerly — progressive disclosure is preserved.",
  "",
  "### Action Executors",
  "",
  "- `executor.type` must be `browser_script` (the only supported type).",
  "- `executor.path` is relative to the Skill directory (e.g. `scripts/run.js`).",
  "- `executor.timeoutMs` must be positive and <= 60000.",
  "- Actions are declared in a fenced JSON block with info string `json tsian-actions`.",
  "",
  "## Assistant vs Runtime Agent Boundary",
  "",
  "The desktop assistant is a platform management agent at `.tsian/local/assistant/`, not a runtime game agent.",
  "",
  "- It runs at workspace access level 4 and can manage card content, card frontend, save runtime, and platform metadata.",
  "- It manages its own definition: agent.json, SOUL.md, AGENT.md, and skills/ under `.tsian/local/assistant/`.",
  "- Runtime game agents run at level 1 during play turns and can only write save-runtime data.",
  "- A Game Card may replace or remove the assistant. The manifest assistant metadata tells platform UI which Agent should be used as the workspace assistant entrypoint.",
  "",
  "The assistant should consult this knowledge base and local workspace files before giving framework advice. If current docs do not answer a question, it should say so rather than inventing platform behavior.",
  "",
  "## Checkpoint Model",
  "",
  "- Checkpoints are created automatically after each successful AIRP turn inside a Save Instance.",
  "- A checkpoint captures the full runtime snapshot (state + messages) at that point.",
  "- The play frontend can restore a checkpoint via `platform.runAction({ action: \"restore-checkpoint\", params: { checkpointId } })`.",
  "- Checkpoint creation, save management, card import/export, and card switching are desktop-assistant / platform-shell operations, not play-frontend operations.",
  "",
].join("\n")

const FRAMEWORK_KNOWLEDGE_REF_FRONTEND_DEVELOPMENT = [
  "# Frontend Development",
  "",
  "Reference document for the `framework-knowledge` Skill. Covers the game frontend file structure, the postMessage bridge API, what frontends can and cannot do, and the assistant's frontend editing capability.",
  "",
  "## File Structure",
  "",
  "A packaged card frontend lives under `frontend/` and needs at minimum 3 files:",
  "",
  "| File | Role |",
  "|------|------|",
  "| `frontend/index.html` | Entry point. References `style.css` and `app.js` via relative paths. |",
  "| `frontend/style.css` | Styles. |",
  "| `frontend/app.js` | Bridge client + rendering logic. |",
  "",
  "The entry path must start with `frontend/` and must not contain `..` (enforced by `normalizePackagedFrontendEntry`). The host only requires the entry file to exist, so a single-file frontend is possible, but the 3-file convention is the default.",
  "",
  "Files are served by a Service Worker at `/__tsian_game_card_frontends/<cardId>/<entry>`. Relative references in `index.html` resolve under this virtual prefix.",
  "",
  "## Bridge Protocol",
  "",
  "The frontend communicates with the platform via `postMessage` on channel `tsian.play-bridge.v1`. There is no `window.tsian` global — the frontend speaks to `window.parent`.",
  "",
  "### Handshake",
  "",
  "1. Frontend posts `{ channel, kind: \"hello\" }` to `window.parent`.",
  "2. Host responds with `{ channel, kind: \"ready\", sessionId }`.",
  "3. Frontend stores `sessionId` and includes it in all subsequent requests.",
  "",
  "### RPC Methods",
  "",
  "| Method | Purpose |",
  "|--------|---------|",
  "| `runtime.getRuntimeSnapshot` | Read current state: turn number + messages array. |",
  "| `interaction.sendMessage` | Send player input; runs a full AIRP turn; returns post-turn snapshot. |",
  "| `query.query` | Deep-query platform resources (history, checkpoints, workspace, agent/skill registries, diagnostics). |",
  "| `platform.getPlatformContext` | Get platform context (version, active frontend/save ids). |",
  "| `platform.runAction` | Execute a platform action (restore-checkpoint, workspace operations). |",
  "",
  "### Streaming Events (host → iframe)",
  "",
  "| Event | Payload | When |",
  "|-------|---------|------|",
  "| `turn-delta` | `{ agentId, delta, turn, round, kind }` | Streamed text. `kind: \"content\"` = visible reply, `kind: \"reasoning\"` = chain-of-thought. |",
  "| `turn-round-end` | `{ agentId, turn, round, kind }` | Round boundary. `kind: \"thought\"` (tool_calls finish) or `final` (stop finish). |",
  "| `turn-tool` | `{ agentId, turn, round, callId, name, status, output? }` | Tool-call card. `status: loading/running/success/failed`. |",
  "| `turn-completed` | `{ snapshot }` | Turn done — canonical re-render signal. |",
  "| `turn-debug-ready` | `{ turn }` | AI debug records ready (but remote frontends cannot query `ai-debug`). |",
  "",
  "### request envelope",
  "",
  "```json",
  "{",
  "  \"channel\": \"tsian.play-bridge.v1\",",
  "  \"kind\": \"request\",",
  "  \"sessionId\": \"<from ready>\",",
  "  \"id\": \"<unique call id>\",",
  "  \"method\": \"interaction.sendMessage\",",
  "  \"params\": { \"content\": \"player text\" }",
  "}",
  "```",
  "",
  "## What Frontends Can Do",
  "",
  "- Read runtime state (turn + messages).",
  "- Send player input and drive a full AIRP turn.",
  "- Stream turn output in real time (deltas, tool calls, round boundaries).",
  "- Query history, checkpoints, workspace (read/list/search at actor level 1), agent/skill registries, runtime diagnostics.",
  "- Restore a checkpoint via `platform.runAction`.",
  "- Read/write workspace files via `platform.runAction({ action: \"workspace.write\", ... })` (mutations default to `save-runtime` scope).",
  "",
  "## What Frontends Cannot Do",
  "",
  "- No `window.tsian` global — bridge is exclusively postMessage-based.",
  "- No ad-hoc RPC methods — only the 5 in the allow-list; others return `REMOTE_METHOD_UNSUPPORTED`.",
  "- Raw AI debug records (`ai-debug` resource) are blocked for remote frontends (`REMOTE_RESOURCE_FORBIDDEN`).",
  "- No checkpoint creation, save management, card import/export, or card switching — those are platform-shell operations.",
  "- Iframe is sandboxed (`allow-scripts allow-same-origin allow-forms`). Remote URLs must be `http:`/`https:`.",
  "- Origin pinning: after the first `hello`, only messages from the same origin are accepted.",
  "",
  "## Assistant Frontend Editing Capability",
  "",
  "The desktop assistant (level 4) can edit card-frontend files (editLevel 2) via `workspace_write`:",
  "",
  "```json",
  "{ \"scope\": \"card-frontend\", \"path\": \"frontend/app.js\", \"content\": \"...\" }",
  "```",
  "",
  "- Text files (html/css/js/json/svg) are written as `content` strings; the volume wraps them into Blobs.",
  "- Media files (images/audio/video) require a `data: Blob` payload — the assistant cannot synthesize binary, so media assets are a blind spot. Players must import media themselves or use external URLs.",
  "- Writes are single-file (not batch), no side effects on other frontend files.",
  "- The Service Worker reads from IndexedDB, so refreshing the play iframe loads the new content immediately — no dev-server restart or card re-import needed.",
  "",
  "## Default Template",
  "",
  "The platform seeds a working 3-file default frontend (`FRONTEND_INDEX_HTML` / `FRONTEND_STYLE_CSS` / `FRONTEND_APP_JS` in `apps/platform-web/src/storage/default-frontend-files.ts`). It demonstrates the full bridge client: handshake, RPC `call()` helper, streaming delta buffer, tool-call timeline, and snapshot re-render on `turn-completed`.",
  "",
  "Source: `packages/contracts/src/bridge.ts` for the full protocol. `apps/platform-web/src/bridge/remote-iframe-bridge.ts` for the host-side implementation.",
  "",
].join("\n")

const FRAMEWORK_KNOWLEDGE_REF_MEMORY_SYSTEM = [
  "# Memory System",
  "",
  "Reference document for the `framework-knowledge` Skill. Covers the memory layering model, event cards, summary maintenance, relationship graph conventions, and recall strategies.",
  "",
  "## Design Principle",
  "",
  "Memory in Tsian is not a platform-owned database. It is workspace files maintained by Agents and Skills. The platform provides the file system, scopes, and tool access; the content structure is a convention documented here and refined per card.",
  "",
  "## Layered Memory Model",
  "",
  "Memory is organized in layers, each derived from the one below:",
  "",
  "| Layer | Path | Content | Maintained by |",
  "|-------|------|---------|---------------|",
  "| Raw turns | `save/history/turns/turn-*.json` | Player input + final reply per turn. | Auto-generated by the runtime. |",
  "| Timeline | `save/history/timeline.md` | Chronological event log (one bullet per major event). | memory agent / maintenance skill. |",
  "| Event cards | `save/memory/events/<id>.json` | Structured event: who/when/where/what. | memory agent / event-extraction skill. |",
  "| Current summary | `save/memory/summaries/current.md` | Active scene summary — who, where, what is happening. | memory agent / summary skill. |",
  "| Long-term summary | `save/memory/summaries/long-term.md` | Durable cross-scene facts. | memory agent / summary skill. |",
  "| Relationship graph | `save/memory/graph.json` | Nodes = characters, edges = relationship type + intensity. | memory agent / relationship skill. |",
  "| Agent notes | `save/agents/<agent>/notes.md` | Per-agent working memory. | Each agent writes its own. |",
  "",
  "All paths are `save-runtime` scope (editLevel 1). Runtime agents (level 1) can write them. The assistant (level 4) can also write them.",
  "",
  "## Event Card Schema Convention",
  "",
  "An event card is a JSON file under `save/memory/events/`. Suggested shape:",
  "",
  "```json",
  "{",
  "  \"id\": \"evt-001\",",
  "  \"timestamp\": \"turn-042\",",
  "  \"scene\": \"tavern-evening\",",
  "  \"participants\": [\"player\", \"elena\", \"bartender\"],",
  "  \"location\": \"golden-leaf-tavern\",",
  "  \"type\": \"dialogue | action | discovery | conflict | relationship-change\",",
  "  \"summary\": \"Elena revealed she knows the merchant's secret.\",",
  "  \"tags\": [\"elena\", \"merchant\", \"secret\", \"trust\"],",
  "  \"facts\": [\"Elena knows the merchant is smuggling.\", \"Elena trusts the player enough to share this.\"]",
  "}",
  "```",
  "",
  "- `id` is unique and stable (used for recall and deduplication).",
  "- `timestamp` references the turn number for temporal recall.",
  "- `facts` are distilled, durable statements — the most valuable part for long-term recall.",
  "- This is a convention, not a platform-enforced schema. Cards may adapt it.",
  "",
  "## Summary Maintenance Strategy",
  "",
  "Summaries are maintained by the memory agent, triggered at appropriate moments (not every turn):",
  "",
  "- **current.md**: Updated when the scene changes or after significant turns. Overwrites the previous current summary. Should be compact (a few paragraphs).",
  "- **long-term.md**: Appended to when durable facts emerge. Rarely rewritten. May be reorganized periodically to stay readable.",
  "- **timeline.md**: Appended to when a major event occurs. One line per event with a turn reference.",
  "",
  "A maintenance skill (like `memory-maintenance`) applies a structured plan: the memory agent decides what to extract, and the skill's `browser_script` action writes the files.",
  "",
  "## Relationship Graph Convention",
  "",
  "`save/memory/graph.json` is a simple JSON graph:",
  "",
  "```json",
  "{",
  "  \"nodes\": [",
  "    { \"id\": \"elena\", \"label\": \"Elena\", \"type\": \"character\" },",
  "    { \"id\": \"player\", \"label\": \"Player\", \"type\": \"player\" }",
  "  ],",
  "  \"edges\": [",
  "    { \"from\": \"elena\", \"to\": \"player\", \"type\": \"trust\", \"intensity\": 7, \"since\": \"turn-042\", \"note\": \"Shared a secret.\" }",
  "  ]",
  "}",
  "```",
  "",
  "- `intensity` is a 1-10 scale.",
  "- A changelog at `save/memory/graph-changelog.md` can track how relationships evolve, making the graph's history traceable.",
  "- This is a convention. Cards may use a richer schema.",
  "",
  "## Recall Strategies",
  "",
  "When a retrieval agent (or the entry agent itself) needs past context, it can combine multiple recall paths:",
  "",
  "| Path | Source | Method | Best for |",
  "|------|--------|--------|----------|",
  "| Entity recall | Event cards + character state | Filter by participant/location | \"What has this character done?\" |",
  "| Temporal recall | timeline.md + event sequence | Filter by turn range | \"What happened last time we met?\" |",
  "| Semantic recall | All save/ files | Vector similarity (top-k) | \"Something similar to this situation\" |",
  "| Relationship recall | graph.json | Graph traversal | \"Who is connected to this person?\" |",
  "",
  "### Semantic recall via Skills",
  "",
  "Semantic (vector) recall can be implemented as a Skill with a `browser_script` action, without platform changes:",
  "",
  "- The script reads workspace files, chunks them, and calls an embedding API via `fetch`.",
  "- The vector index is stored as a workspace file (e.g. `save/memory/index.json`).",
  "- On query, the script computes cosine similarity and returns top-k chunks.",
  "",
  "Limitations of the Skill-based approach:",
  "- `timeoutMs` is capped at 60000 — large corpus re-embedding may time out.",
  "- The index is a visible workspace file (enters checkpoints, appears in the explorer).",
  "- No incremental indexing or resident cache — the index is reloaded per query.",
  "",
  "When these become bottlenecks, the platform may add native vector index support. Until then, the Skill path is the recommended way to validate which recall strategies actually improve AIRP quality.",
  "",
  "## Character Runtime State",
  "",
  "Beyond the memory layers, characters can have per-save runtime state:",
  "",
  "| Path | Content |",
  "|------|---------|",
  "| `world/characters/<id>/card.md` | Persistent character profile (card-content, ships with the card). |",
  "| `save/world/characters/<id>/state.json` | Runtime state for this save: location, mood, attitude, known info. |",
  "| `save/world/characters/<id>/log.md` | Behavior log — what the character has been doing, including off-screen. |",
  "",
  "Off-screen characters can be advanced by the memory agent during scene transitions, creating the impression of a living world. This is a convention, not a platform-enforced mechanism.",
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
      enabled: ["framework-knowledge", "agent-authoring", "skill-authoring", "card-content-drafting"],
      disabled: [],
    },
    platformTools: {
      enabled: ["agent_call", "workspace_read", "workspace_write", "inspect_frontend"],
      disabled: [],
    },
    workspaceAccess: {
      level: 4,
    },
    knowledgeMount: "docs/",
  }
}

function defaultLocalAssistantFileMap(): StoredAssistantFileMap {
  const now = Date.now()
  void now
  const config = defaultAssistantConfig()
  return {
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
    [`${LOCAL_ASSISTANT_DIR}/skills/framework-knowledge/SKILL.md`]: {
      content: DEFAULT_FRAMEWORK_KNOWLEDGE_SKILL_MD,
    },
    [`${LOCAL_ASSISTANT_DIR}/skills/framework-knowledge/references/platform-architecture.md`]: {
      content: FRAMEWORK_KNOWLEDGE_REF_PLATFORM_ARCHITECTURE,
    },
    [`${LOCAL_ASSISTANT_DIR}/skills/framework-knowledge/references/frontend-development.md`]: {
      content: FRAMEWORK_KNOWLEDGE_REF_FRONTEND_DEVELOPMENT,
    },
    [`${LOCAL_ASSISTANT_DIR}/skills/framework-knowledge/references/memory-system.md`]: {
      content: FRAMEWORK_KNOWLEDGE_REF_MEMORY_SYSTEM,
    },
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
  }
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
        const defaults = defaultLocalAssistantFileMap()
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
 * 助手 runtime trace 文件路径(每 turn 一个 jsonl).
 * 对称 assistantContextPath——trace 落盘路径的单一构造点,
 * assistant-chat.ts 调用此函数,避免路径前缀重复定义.
 * 失败 turn 传 failedAt 加 -failed-<ts> 后缀(对称 master 的 formatRuntimeTracePath).
 */
export function assistantTracePath(turn: number, failedAt?: number): string {
  const paddedTurn = String(Math.max(0, Math.floor(turn))).padStart(6, "0")
  const suffix = failedAt === undefined ? "" : `-failed-${failedAt}`
  return `${LOCAL_ASSISTANT_DIR}/traces/turn-${paddedTurn}${suffix}.jsonl`
}

/**
 * 助手会话 context 快照所在目录前缀(所有 sessions/<id>/context.json 共享).
 * 用于在事务 commit 回写时排除这类"由 stageAssistantContextFile 直写 Dexie 管辖"
 * 的文件——它们不经过 RuntimeWorkspaceTransaction,若把事务 baseline 里的旧版本
 * 一并回写会覆盖直写的新版本(clobber 缺陷:每轮 context.json 被还原成 turn 开头值).
 */
const ASSISTANT_CONTEXT_DIR = `${LOCAL_ASSISTANT_DIR}/sessions/`

/**
 * 助手 trace 文件目录前缀(.tsian/local/assistant/traces/).
 * runtime 过程事件序列化落盘于此(见 assistant-chat.ts 的 trace collector).
 * 与 context 快照同属"直写 Dexie 管辖"——commit 回写时排除,防 clobber.
 */
const ASSISTANT_TRACES_DIR = `${LOCAL_ASSISTANT_DIR}/traces/`

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
  return isAssistantContextPath(path) || path.startsWith(ASSISTANT_TRACES_DIR)
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
