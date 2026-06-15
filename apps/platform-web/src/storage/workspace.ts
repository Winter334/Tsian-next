import type {
  GameCardWorkspaceTemplateFile,
  WorkspaceEntry,
  WorkspaceFile,
  WorkspaceSearchResult,
} from "@tsian/contracts"
import { localDb, type LocalWorkspaceFileRecord } from "./db"

export type CheckpointWorkspaceFile = Omit<LocalWorkspaceFileRecord, "id" | "saveId">

export interface WorkspaceListInput {
  path?: unknown
}

export interface WorkspaceSearchInput {
  query?: string
  limit?: number
}

export interface WorkspaceWriteInput {
  path?: unknown
  content?: unknown
  mediaType?: unknown
}

export interface RuntimeWorkspaceTransaction {
  readonly workspaceFiles: WorkspaceFile[]
  write(input: WorkspaceWriteInput): WorkspaceFile
  writePlatformFile(input: WorkspaceWriteInput): WorkspaceFile
  delete(path: unknown): { deletedPaths: string[] }
  finalWorkspaceFiles(): WorkspaceFile[]
  discard(): void
}

export class WorkspaceStorageError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = "WorkspaceStorageError"
  }
}

const DEFAULT_SEARCH_LIMIT = 50
const MAX_SEARCH_LIMIT = 200
const DEFAULT_WORKSPACE_VERSION = 4
const WORKSPACE_MANIFEST_PATH = ".tsian/manifest.json"
const DEFAULT_WORKSPACE_UPGRADE_FILE_PATHS = new Set([
  "state/README.md",
  "state/schemas/README.md",
  "state/data/README.md",
  "skills/memory-maintenance/SKILL.md",
  "skills/memory-maintenance/scripts/apply-maintenance-plan.js",
  "docs/README.md",
  "docs/tsian-framework-knowledge.md",
  "agents/studio-assistant/AGENT.md",
  "agents/studio-assistant/notes.md",
  "agents/studio-assistant/session.jsonl",
  "agents/studio-assistant/skills/framework-knowledge/SKILL.md",
])

const MEMORY_MAINTENANCE_SKILL_MD = [
  "---",
  "name: memory-maintenance",
  "title: Memory Maintenance",
  "description: Apply explicit workspace maintenance plans for Agent notes, timeline, and memory summaries.",
  "triggers:",
  "  - Agent notes need a durable update",
  "  - timeline or memory summaries should be refreshed",
  "appliesTo:",
  "  - master",
  "  - narrative",
  "  - memory",
  "---",
  "",
  "# Memory Maintenance",
  "",
  "Use this Skill only when this turn has produced durable information that should be written to Agent notes, the timeline, or memory summaries. Do not run it automatically every turn.",
  "",
  "Before calling the action, read any file you intend to replace and prepare the full next content. The action only accepts explicit replacement writes.",
  "",
  "Allowed targets:",
  "",
  "- `agents/<agent>/notes.md`",
  "- `history/timeline.md`",
  "- `memory/summaries/current.md`",
  "- `memory/summaries/long-term.md`",
  "",
  "Use an empty `writes` array only when you explicitly considered maintenance and decided no files should change.",
  "",
  "```json tsian-actions",
  "[",
  "  {",
  "    \"name\": \"apply_maintenance_plan\",",
  "    \"description\": \"Validate and apply an explicit memory maintenance plan through staged workspace writes.\",",
  "    \"inputSchema\": {",
  "      \"type\": \"object\",",
  "      \"required\": [\"schema\", \"writes\"],",
  "      \"properties\": {",
  "        \"schema\": { \"type\": \"string\" },",
  "        \"writes\": { \"type\": \"array\" }",
  "      }",
  "    },",
  "    \"outputSchema\": {",
  "      \"type\": \"object\",",
  "      \"required\": [\"schema\", \"status\", \"writes\"],",
  "      \"properties\": {",
  "        \"schema\": { \"type\": \"string\" },",
  "        \"status\": { \"type\": \"string\" },",
  "        \"writes\": { \"type\": \"array\" }",
  "      }",
  "    },",
  "    \"executor\": {",
  "      \"type\": \"browser_script\",",
  "      \"path\": \"scripts/apply-maintenance-plan.js\",",
  "      \"timeoutMs\": 10000",
  "    }",
  "  }",
  "]",
  "```",
  "",
  "Plan schema:",
  "",
  "```json",
  "{",
  "  \"schema\": \"tsian.runtime.maintenance.plan.v1\",",
  "  \"writes\": [",
  "    {",
  "      \"path\": \"memory/summaries/current.md\",",
  "      \"mode\": \"replace\",",
  "      \"content\": \"# Current Summary\\n\\n...\\n\",",
  "      \"reason\": \"The current scene changed enough to refresh the summary.\"",
  "    }",
  "  ]",
  "}",
  "```",
  "",
].join("\n")

const MEMORY_MAINTENANCE_SCRIPT_JS = [
  "const PLAN_SCHEMA = \"tsian.runtime.maintenance.plan.v1\";",
  "const MAX_WRITES = 12;",
  "const MAX_CONTENT_LENGTH = 200000;",
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
  "function normalizePath(value) {",
  "  if (typeof value !== \"string\") {",
  "    fail(\"MAINTENANCE_PATH_REQUIRED\", \"Maintenance write path must be a string.\");",
  "  }",
  "  const raw = value.trim();",
  "  const hadTrailingSlash = /[\\\\/]$/.test(raw);",
  "  const normalized = raw",
  "    .replace(/\\\\/g, \"/\")",
  "    .replace(/^\\/+/, \"\")",
  "    .replace(/\\/+/g, \"/\")",
  "    .replace(/\\/+$/, \"\");",
  "  if (!normalized) {",
  "    fail(\"MAINTENANCE_PATH_REQUIRED\", \"Maintenance write path is required.\");",
  "  }",
  "  if (hadTrailingSlash) {",
  "    fail(\"MAINTENANCE_FILE_PATH_REQUIRED\", \"Maintenance write path must not end with a slash.\", { path: value });",
  "  }",
  "  const segments = normalized.split(\"/\");",
  "  if (segments.some((segment) => segment === \".\" || segment === \"..\" || segment === \"\")) {",
  "    fail(\"MAINTENANCE_PATH_INVALID\", \"Maintenance write path must not contain empty, current, or parent directory segments.\", { path: value });",
  "  }",
  "  if (normalized === \".tsian\" || normalized.startsWith(\".tsian/\")) {",
  "    fail(\"MAINTENANCE_PLATFORM_METADATA_FORBIDDEN\", \"Maintenance writes cannot target .tsian platform metadata.\", { path: normalized });",
  "  }",
  "  return normalized;",
  "}",
  "",
  "function isAllowedTarget(path) {",
  "  return /^agents\\/[^/]+\\/notes\\.md$/.test(path)",
  "    || path === \"history/timeline.md\"",
  "    || path === \"memory/summaries/current.md\"",
  "    || path === \"memory/summaries/long-term.md\";",
  "}",
  "",
  "function validateWrite(rawWrite, index) {",
  "  if (!isRecord(rawWrite)) {",
  "    fail(\"MAINTENANCE_WRITE_INVALID\", \"Each maintenance write must be an object.\", { index });",
  "  }",
  "  const path = normalizePath(rawWrite.path);",
  "  if (!isAllowedTarget(path)) {",
  "    fail(\"MAINTENANCE_TARGET_NOT_ALLOWED\", \"Maintenance write target is not allowed in this Skill.\", { index, path });",
  "  }",
  "  if (rawWrite.mode !== \"replace\") {",
  "    fail(\"MAINTENANCE_MODE_UNSUPPORTED\", \"Maintenance write mode must be replace.\", { index, path, mode: rawWrite.mode });",
  "  }",
  "  if (typeof rawWrite.content !== \"string\") {",
  "    fail(\"MAINTENANCE_CONTENT_REQUIRED\", \"Maintenance write content must be a string.\", { index, path });",
  "  }",
  "  if (rawWrite.content.length > MAX_CONTENT_LENGTH) {",
  "    fail(\"MAINTENANCE_CONTENT_TOO_LARGE\", \"Maintenance write content exceeds the allowed size.\", { index, path, size: rawWrite.content.length, maxSize: MAX_CONTENT_LENGTH });",
  "  }",
  "  if (typeof rawWrite.reason !== \"string\" || !rawWrite.reason.trim()) {",
  "    fail(\"MAINTENANCE_REASON_REQUIRED\", \"Maintenance write reason must be a non-empty string.\", { index, path });",
  "  }",
  "  return {",
  "    path,",
  "    mode: \"replace\",",
  "    content: rawWrite.content,",
  "    reason: rawWrite.reason.trim(),",
  "  };",
  "}",
  "",
  "function validatePlan(plan) {",
  "  if (!isRecord(plan)) {",
  "    fail(\"MAINTENANCE_PLAN_INVALID\", \"Maintenance plan must be an object.\");",
  "  }",
  "  if (plan.schema !== PLAN_SCHEMA) {",
  "    fail(\"MAINTENANCE_SCHEMA_INVALID\", \"Maintenance plan schema is invalid.\", { expected: PLAN_SCHEMA, actual: plan.schema });",
  "  }",
  "  if (!Array.isArray(plan.writes)) {",
  "    fail(\"MAINTENANCE_WRITES_INVALID\", \"Maintenance plan writes must be an array.\");",
  "  }",
  "  if (plan.writes.length > MAX_WRITES) {",
  "    fail(\"MAINTENANCE_TOO_MANY_WRITES\", \"Maintenance plan contains too many writes.\", { count: plan.writes.length, maxWrites: MAX_WRITES });",
  "  }",
  "  return plan.writes.map(validateWrite);",
  "}",
  "",
  "async function applyMaintenancePlan(input, tsian, signal) {",
  "  try {",
  "    signal.throwIfAborted();",
  "    const writes = validatePlan(input);",
  "    tsian.trace(\"maintenance_started\", { schema: PLAN_SCHEMA, writeCount: writes.length, paths: writes.map((write) => write.path) });",
  "    if (writes.length === 0) {",
  "      tsian.trace(\"maintenance_completed\", { status: \"noop\", writeCount: 0 });",
  "      return { schema: PLAN_SCHEMA, status: \"noop\", writes: [] };",
  "    }",
  "    const applied = [];",
  "    for (const write of writes) {",
  "      signal.throwIfAborted();",
  "      const file = await tsian.workspace.write({",
  "        path: write.path,",
  "        content: write.content,",
  "        mediaType: \"text/markdown\",",
  "      });",
  "      applied.push({ path: file.path, size: file.content.length, reason: write.reason });",
  "    }",
  "    tsian.trace(\"maintenance_completed\", { status: \"applied\", writeCount: applied.length, writes: applied });",
  "    return { schema: PLAN_SCHEMA, status: \"applied\", writes: applied };",
  "  } catch (error) {",
  "    tsian.trace(\"maintenance_failed\", { code: error && error.code || \"MAINTENANCE_FAILED\", message: error && error.message || String(error), details: error && error.details });",
  "    throw error;",
  "  }",
  "}",
  "",
  "return applyMaintenancePlan(input, tsian, signal);",
  "",
].join("\n")

const STUDIO_ASSISTANT_AGENT_MD = [
  "---",
  "id: studio-assistant",
  "title: Studio Assistant",
  "summary: Helps players and authors understand, inspect, and maintain this Tsian workspace.",
  "contacts:",
  "defaultSkills:",
  "  - framework-knowledge",
  "contextPaths:",
  "  - README.md",
  "  - docs/tsian-framework-knowledge.md",
  "  - agents/README.md",
  "  - skills/README.md",
  "  - state/README.md",
  "  - frontend/README.md",
  "---",
  "",
  "# Studio Assistant",
  "",
  "You are the workspace assistant for this game card and save instance.",
  "Help players and authors understand the Tsian framework, inspect workspace conventions, and plan safe changes to Agents, Skills, state files, frontend data, memory, diagnostics, and game-card content.",
  "",
  "When the user asks framework, authoring, workspace, or diagnostics questions, load the `framework-knowledge` Skill before giving a confident answer.",
  "Treat current workspace files as the source of truth for this save. Read local README files, schemas, Agent definitions, Skill definitions, and diagnostics when the answer depends on local content.",
  "",
  "Do not claim hidden platform powers. You are ordinary workspace content and can only use the tools, bridge APIs, or future UI actions explicitly made available to you.",
  "Do not edit files unless the current UI/tooling asks you to perform or prepare a concrete change.",
  "",
  "The polished first-launch world creation flow is future content-layer work. For now, help authors clarify world settings and point them to the files that would hold those settings.",
  "",
].join("\n")

const FRAMEWORK_KNOWLEDGE_SKILL_MD = [
  "---",
  "name: framework-knowledge",
  "title: Framework Knowledge",
  "description: Consult the official Tsian framework knowledge base and local workspace conventions before answering authoring, diagnostics, or workspace-management questions.",
  "triggers:",
  "  - The user asks how Tsian, Game Cards, Save Instances, checkpoints, Runtime Workspace, Agents, Skills, frontend bridge, traces, or diagnostics work",
  "  - The user asks how to edit, fix, or design workspace files",
  "  - The assistant is unsure whether an answer depends on platform or workspace conventions",
  "appliesTo:",
  "  - studio-assistant",
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
  "This Skill declares no actions. It uses ordinary workspace read, list, and search tools.",
  "",
].join("\n")

const TSIAN_FRAMEWORK_KNOWLEDGE_MD = [
  "# Tsian Framework Knowledge",
  "",
  "This is a temporary official knowledge base for the workspace assistant. It is intentionally compact and will be expanded as the project matures.",
  "",
  "## Product Model",
  "",
  "- Tsian is an Agent-Orchestrated Runtime platform for AIRP.",
  "- Platform owns model configuration, API-key boundaries, local storage, checkpoints, bridge APIs, execution policy, and sandboxing.",
  "- A Game Card is a reusable workspace template plus optional frontend binding and metadata.",
  "- A Save Instance is the playable copy created from a Game Card. Its workspace is independent and mutates during play.",
  "- A Checkpoint is a rollback point inside one Save Instance, not a top-level game card or save card.",
  "- Game frontends are supplied by Game Cards. Platform UI should not become a universal gameplay renderer.",
  "",
  "## Runtime Workspace",
  "",
  "Runtime Workspace is the save-scoped virtual file system. It can contain Agents, Skills, world data, memory, state files, frontend data, history, archives, and platform-owned metadata.",
  "",
  "Ordinary workspace paths are visible to Agents, Skills, and game frontends. `.tsian/` is platform-owned metadata and is hidden from ordinary workspace read/list/search APIs.",
  "",
  "Directory README files are important. They explain local conventions for data that the platform intentionally does not hardcode.",
  "",
  "## Agents",
  "",
  "Agents are ordinary workspace participants under `agents/<agent>/AGENT.md`. Agent directories may also include `notes.md`, `session.jsonl`, and local Skills under `agents/<agent>/skills/`.",
  "",
  "The default AIRP runtime still uses `master` and `narrative` as the normal turn path. The `studio-assistant` Agent is for future/player-facing workspace help and should not change normal AIRP turn behavior by existing alone.",
  "",
  "An Agent definition should state responsibility, when to act, output expectations, contacts, default or optional Skills, and useful context paths.",
  "",
  "## Skills",
  "",
  "Skills are on-demand capability packages. Shared Skills live under `skills/<skill>/SKILL.md`; Agent-local Skills live under `agents/<agent>/skills/<skill>/SKILL.md`.",
  "",
  "Only Skill names, descriptions, triggers, and applicability belong in the eager Skill Index. Detailed instructions load through `skill_load` only when needed.",
  "",
  "Skill actions must stay gated behind a loaded Skill. Gameplay-specific behavior belongs in Skills and workspace conventions instead of hardcoded platform tools.",
  "",
  "## State And Frontend Data",
  "",
  "Structured state is not a platform-owned table model. It belongs in workspace files documented by README files, schemas, Agents, Skills, or frontend conventions.",
  "",
  "The `frontend/` directory is for data agreed between the runtime and the active game frontend. The platform does not interpret those gameplay fields.",
  "",
  "## Memory, History, And Diagnostics",
  "",
  "Raw AIRP turn history under `history/turns/` stores successful player input and final narrative output. It is ordinary memory feedstock, not trace data.",
  "",
  "Enhanced memory such as timeline summaries, durable facts, or long-term summaries is derived workspace content maintained by Agents and Skills.",
  "",
  "Runtime traces live under `.tsian/traces/` as platform-owned diagnostics. Agent-facing diagnostics should expose compact facts, not raw prompts, full tool observations, or repair guesses.",
  "",
  "## Assistant Boundary",
  "",
  "The workspace assistant is game-card/workspace content. It is not a hidden official persona baked into the platform.",
  "",
  "A Game Card may replace or remove the assistant. The manifest assistant metadata tells future platform UI which Agent should be used as the workspace assistant entrypoint.",
  "",
  "The assistant should consult this knowledge base and local workspace files before giving framework advice. If current docs do not answer a question, it should say so rather than inventing platform behavior.",
  "",
  "## Deferred Content Work",
  "",
  "A polished first-launch world creation flow is not part of the current foundation. The likely future flow will collect world/theme/settings from the player while using official default Agents, Skills, state contracts, and frontend content, then write the result into ordinary workspace files.",
  "",
].join("\n")

const DEFAULT_WORKSPACE_FILES: Array<{
  path: string
  content: string
  mediaType?: string
}> = [
  {
    path: "README.md",
    content: [
      "# Runtime Workspace",
      "",
      "This save-scoped workspace stores runtime data as virtual files.",
      "Agents, skills, world data, generic state, memory, frontend data, and platform metadata can all live here.",
      "Ordinary workspace file content is text; binary/blob content is not part of this workspace version.",
      "The `.tsian/` directory is platform-owned metadata and is hidden from ordinary Agent, Skill, and frontend workspace APIs.",
      "",
      "Read directory README files before changing data conventions.",
      "",
    ].join("\n"),
  },
  {
    path: "agents/README.md",
    content: [
      "# Agents",
      "",
      "Agent definitions live under `agents/<agent>/AGENT.md`.",
      "Agent-local skills can live under `agents/<agent>/skills/`.",
      "A game card can declare a workspace assistant Agent in its manifest; the built-in blank card uses `agents/studio-assistant/AGENT.md`.",
      "",
    ].join("\n"),
  },
  {
    path: "agents/master/AGENT.md",
    content: [
      "---",
      "id: master",
      "title: Master Agent",
      "summary: Coordinates each AIRP turn, manages shared context, and delegates to specialist agents when useful.",
      "contacts:",
      "  - memory",
      "defaultSkills:",
      "contextPaths:",
      "  - README.md",
      "  - history/timeline.md",
      "  - world/README.md",
      "  - state/README.md",
      "  - memory/summaries/current.md",
      "---",
      "",
      "# Master Agent",
      "",
      "You are the entry agent for an AIRP turn.",
      "Read the relevant workspace context, decide what needs to happen next, and contact specialist agents when their responsibilities match the current situation.",
      "Contact the memory agent when continuity, current-scene recall, durable facts, or summary maintenance could affect the turn.",
      "Use historyMode `recent` by default, and use `scene` only when the continuity question depends on more of the current scene.",
      "",
    ].join("\n"),
  },
  {
    path: "agents/master/notes.md",
    content: "# Master Notes\n\n",
  },
  {
    path: "agents/master/session.jsonl",
    content: "",
    mediaType: "application/x-ndjson",
  },
  {
    path: "agents/narrative/AGENT.md",
    content: [
      "---",
      "id: narrative",
      "title: Narrative Agent",
      "summary: Turns plans, world facts, and character state into player-facing prose.",
      "contacts:",
      "  - master",
      "defaultSkills:",
      "contextPaths:",
      "  - history/timeline.md",
      "  - world/README.md",
      "  - world/canon.md",
      "  - memory/summaries/current.md",
      "---",
      "",
      "# Narrative Agent",
      "",
      "You write the player-facing narrative for a turn.",
      "Use established world facts and recent history, preserve continuity, and ask the master agent when the requested direction needs coordination.",
      "",
    ].join("\n"),
  },
  {
    path: "agents/narrative/notes.md",
    content: "# Narrative Notes\n\n",
  },
  {
    path: "agents/narrative/session.jsonl",
    content: "",
    mediaType: "application/x-ndjson",
  },
  {
    path: "agents/memory/AGENT.md",
    content: [
      "---",
      "id: memory",
      "title: Memory Agent",
      "summary: Checks continuity, current-scene memory, and durable fact candidates for AIRP turns.",
      "contacts:",
      "defaultSkills:",
      "contextPaths:",
      "  - README.md",
      "  - history/timeline.md",
      "  - memory/README.md",
      "  - memory/summaries/current.md",
      "  - memory/summaries/long-term.md",
      "  - world/canon.md",
      "---",
      "",
      "# Memory Agent",
      "",
      "You support AIRP continuity and memory decisions for the calling agent.",
      "Check whether the current request conflicts with known timeline, summaries, canon, character facts, or recent scene details.",
      "Return concise findings, current-scene summary suggestions, long-term memory candidates, and any facts worth preserving.",
      "Do not claim that you wrote or updated memory files unless you explicitly used a loaded Skill action that performs that write.",
      "",
    ].join("\n"),
  },
  {
    path: "agents/memory/notes.md",
    content: "# Memory Notes\n\n",
  },
  {
    path: "agents/memory/session.jsonl",
    content: "",
    mediaType: "application/x-ndjson",
  },
  {
    path: "agents/studio-assistant/AGENT.md",
    content: STUDIO_ASSISTANT_AGENT_MD,
  },
  {
    path: "agents/studio-assistant/notes.md",
    content: "# Studio Assistant Notes\n\n",
  },
  {
    path: "agents/studio-assistant/session.jsonl",
    content: "",
    mediaType: "application/x-ndjson",
  },
  {
    path: "agents/studio-assistant/skills/framework-knowledge/SKILL.md",
    content: FRAMEWORK_KNOWLEDGE_SKILL_MD,
  },
  {
    path: "skills/README.md",
    content: [
      "# Shared Skills",
      "",
      "Shared skills live under `skills/<skill>/SKILL.md`.",
      "Only summaries and triggers should be indexed eagerly; details load on demand.",
      "",
    ].join("\n"),
  },
  {
    path: "skills/memory-maintenance/SKILL.md",
    content: MEMORY_MAINTENANCE_SKILL_MD,
  },
  {
    path: "skills/memory-maintenance/scripts/apply-maintenance-plan.js",
    content: MEMORY_MAINTENANCE_SCRIPT_JS,
    mediaType: "text/javascript",
  },
  {
    path: "docs/README.md",
    content: [
      "# Docs",
      "",
      "Official and game-card-authored documentation for Agents, Skills, frontends, and authors can live here.",
      "The built-in `docs/tsian-framework-knowledge.md` file is temporary official framework knowledge used by the workspace assistant.",
      "",
    ].join("\n"),
  },
  {
    path: "docs/tsian-framework-knowledge.md",
    content: TSIAN_FRAMEWORK_KNOWLEDGE_MD,
  },
  {
    path: "history/README.md",
    content: [
      "# History",
      "",
      "Keep durable conversation records and timeline summaries here.",
      "Raw player-facing AIRP turns are stored under `history/turns/` as one JSON file per successful turn.",
      "These turn files are the native fallback memory source and can be searched, read, and manually corrected like ordinary workspace files.",
      "Avoid storing every intermediate trace in this directory.",
      "",
    ].join("\n"),
  },
  {
    path: "history/turns/README.md",
    content: [
      "# Raw AIRP Turns",
      "",
      "Each successful AIRP turn is stored here as `turn-000001.json`, `turn-000002.json`, and so on.",
      "Turn files contain the player input and final assistant narrative only.",
      "They should not contain prompts, tool observations, trace events, or hidden Agent intermediate outputs.",
      "",
    ].join("\n"),
  },
  {
    path: "history/timeline.md",
    content: "# Timeline\n\n",
  },
  {
    path: "world/README.md",
    content: [
      "# World",
      "",
      "Store world facts, rules, characters, places, relationships, and structured state here.",
      "Use local README or schema files to document conventions.",
      "",
    ].join("\n"),
  },
  {
    path: "world/canon.md",
    content: "# Canon\n\n",
  },
  {
    path: "state/README.md",
    content: [
      "# State",
      "",
      "Use this directory for generic structured state only when no more specific workspace directory exists.",
      "Prefer `world/`, `memory/`, `frontend/`, Skill-owned paths, or Agent-owned paths when those conventions are clearer.",
      "State files are ordinary Runtime Workspace files. Document local file layouts near the data with README files, schemas, or Skill instructions.",
      "Do not treat this directory as a universal record table; it does not define namespace, collection, or record id semantics.",
      "Generated indexes, caches, embeddings, and semantic retrieval belong to general workspace capabilities, not to state-specific platform code.",
      "",
    ].join("\n"),
  },
  {
    path: "state/schemas/README.md",
    content: [
      "# State Schemas",
      "",
      "Place optional schemas, examples, or convention notes for generic `state/` files here.",
      "These files are documentation for Agents, Skills, frontends, and authors; they are not a platform schema registry.",
      "",
    ].join("\n"),
  },
  {
    path: "state/data/README.md",
    content: [
      "# State Data",
      "",
      "Store generic structured state here only when a local convention needs this neutral area.",
      "Use whatever file layout the local README, schema, Agent, or Skill defines.",
      "Do not mirror the retired namespace/collection/id record model here.",
      "",
    ].join("\n"),
  },
  {
    path: "memory/README.md",
    content: [
      "# Memory",
      "",
      "Store long-term summaries, durable facts, and retrieval-oriented notes here.",
      "",
    ].join("\n"),
  },
  {
    path: "memory/summaries/current.md",
    content: "# Current Summary\n\n",
  },
  {
    path: "memory/summaries/long-term.md",
    content: "# Long-Term Summary\n\n",
  },
  {
    path: "frontend/README.md",
    content: [
      "# Frontend Data",
      "",
      "Store data agreed between the runtime and active frontend package here.",
      "The platform does not interpret these fields.",
      "",
    ].join("\n"),
  },
  {
    path: "frontend/view-state.json",
    content: "{}\n",
    mediaType: "application/json",
  },
  {
    path: "archive/README.md",
    content: "# Archive\n\nRetired, compressed, or inactive workspace material can live here.\n",
  },
  {
    path: WORKSPACE_MANIFEST_PATH,
    content: JSON.stringify({
      version: "0.0.0",
      workspaceVersion: DEFAULT_WORKSPACE_VERSION,
      contentModel: {
        fileContent: "text",
        binaryContent: false,
      },
      platformMetadata: {
        path: ".tsian/",
        ordinaryWorkspaceVisible: false,
      },
    }, null, 2) + "\n",
    mediaType: "application/json",
  },
  {
    path: ".tsian/README.md",
    content: [
      "# Tsian Platform Metadata",
      "",
      "Files under `.tsian/` are owned by the platform.",
      "They are preserved by full save/checkpoint snapshots but hidden from ordinary Agent, Skill, and frontend workspace APIs.",
      "Use dedicated platform or debug resources for diagnostics instead of reading raw metadata through normal workspace tools.",
      "",
    ].join("\n"),
  },
  {
    path: ".tsian/traces/README.md",
    content: [
      "# Traces",
      "",
      "Runtime trace files are platform-owned diagnostics input.",
      "Agent-facing summaries are exposed through `runtime-diagnostics`, not ordinary workspace browsing.",
      "",
    ].join("\n"),
  },
  {
    path: ".tsian/checkpoints/README.md",
    content: "# Checkpoints\n\nCheckpoint metadata is platform-owned and preserved with full save snapshots.\n",
  },
  {
    path: ".tsian/indexes/README.md",
    content: "# Indexes\n\nGenerated workspace indexes are platform-owned derived data and may be rebuilt.\n",
  },
  {
    path: ".tsian/cache/README.md",
    content: "# Cache\n\nTemporary platform cache data is platform-owned and may be dropped or rebuilt.\n",
  },
]

function createTableId(saveId: string, path: string): string {
  return [
    saveId,
    "workspace",
    encodeURIComponent(path),
  ].join(":")
}

function normalizePathBase(value: unknown, options: {
  allowEmpty: boolean
  rejectTrailingSlash: boolean
}): string {
  if (typeof value !== "string") {
    throw new WorkspaceStorageError(
      "WORKSPACE_PATH_REQUIRED",
      "Workspace path must be a string.",
    )
  }

  const hadTrailingSlash = /[\\/]$/.test(value.trim())
  const normalized = value
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/\/+/g, "/")
    .replace(/\/+$/, "")

  if (!normalized) {
    if (options.allowEmpty) {
      return ""
    }
    throw new WorkspaceStorageError(
      "WORKSPACE_PATH_REQUIRED",
      "Workspace path is required.",
    )
  }

  if (options.rejectTrailingSlash && hadTrailingSlash) {
    throw new WorkspaceStorageError(
      "WORKSPACE_FILE_PATH_REQUIRED",
      "Workspace file path must not end with a slash.",
    )
  }

  const segments = normalized.split("/")
  if (segments.some((segment) => segment === "." || segment === ".." || segment === "")) {
    throw new WorkspaceStorageError(
      "WORKSPACE_PATH_INVALID",
      "Workspace path must not contain empty, current, or parent directory segments.",
    )
  }

  return normalized
}

function normalizeDirectoryPath(value: unknown): string {
  return normalizePathBase(value ?? "", {
    allowEmpty: true,
    rejectTrailingSlash: false,
  })
}

export function normalizeWorkspaceFilePath(value: unknown): string {
  return normalizePathBase(value, {
    allowEmpty: false,
    rejectTrailingSlash: true,
  })
}

function normalizeWorkspaceTargetPath(value: unknown): string {
  return normalizePathBase(value, {
    allowEmpty: false,
    rejectTrailingSlash: false,
  })
}

function normalizeMediaType(value: unknown, path: string): string {
  if (typeof value === "string" && value.trim()) {
    return value.trim()
  }

  if (path.endsWith(".md")) return "text/markdown"
  if (path.endsWith(".json")) return "application/json"
  if (path.endsWith(".jsonl")) return "application/x-ndjson"
  if (path.endsWith(".ts")) return "text/typescript"
  if (path.endsWith(".js")) return "text/javascript"
  return "text/plain"
}

export function createDefaultWorkspaceTemplateFiles(): GameCardWorkspaceTemplateFile[] {
  return DEFAULT_WORKSPACE_FILES.map((file) => {
    const path = normalizeWorkspaceFilePath(file.path)
    return {
      path,
      content: file.content,
      mediaType: normalizeMediaType(file.mediaType, path),
    }
  })
}

function fileName(path: string): string {
  const parts = path.split("/")
  return parts[parts.length - 1] || path
}

export function isPlatformMetadataPath(path: string): boolean {
  return path === ".tsian" || path.startsWith(".tsian/")
}

export function isOrdinaryWorkspacePath(path: string): boolean {
  return !isPlatformMetadataPath(path)
}

function assertOrdinaryMutationPath(path: string): void {
  if (!isPlatformMetadataPath(path)) {
    return
  }

  throw new WorkspaceStorageError(
    "WORKSPACE_PLATFORM_METADATA_FORBIDDEN",
    "Platform metadata paths under .tsian are host-owned.",
  )
}

function assertOrdinaryReadPath(path: string): void {
  if (!isPlatformMetadataPath(path)) {
    return
  }

  throw new WorkspaceStorageError(
    "WORKSPACE_PLATFORM_METADATA_FORBIDDEN",
    "Platform metadata paths under .tsian are not available through ordinary workspace reads.",
  )
}

function ordinaryWorkspaceFiles(files: WorkspaceFile[]): WorkspaceFile[] {
  return files.filter((file) => isOrdinaryWorkspacePath(file.path))
}

function toWorkspaceFile(record: LocalWorkspaceFileRecord): WorkspaceFile {
  return {
    path: record.path,
    content: record.content,
    mediaType: record.mediaType,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  }
}

function cloneWorkspaceFile(file: WorkspaceFile): WorkspaceFile {
  return {
    path: file.path,
    content: file.content,
    mediaType: file.mediaType,
    createdAt: file.createdAt,
    updatedAt: file.updatedAt,
  }
}

function toCheckpointWorkspaceFile(
  record: LocalWorkspaceFileRecord,
): CheckpointWorkspaceFile {
  const { id: _id, saveId: _saveId, ...file } = record
  return file
}

export function createLocalWorkspaceFileRecord(
  saveId: string,
  file: CheckpointWorkspaceFile,
): LocalWorkspaceFileRecord {
  const path = normalizeWorkspaceFilePath(file.path)
  return {
    id: createTableId(saveId, path),
    saveId,
    path,
    content: typeof file.content === "string" ? file.content : "",
    mediaType: normalizeMediaType(file.mediaType, path),
    createdAt: typeof file.createdAt === "number" ? file.createdAt : Date.now(),
    updatedAt: typeof file.updatedAt === "number" ? file.updatedAt : Date.now(),
  }
}

function normalizeLimit(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return DEFAULT_SEARCH_LIMIT
  }
  return Math.min(Math.floor(value), MAX_SEARCH_LIMIT)
}

function createPreview(content: string, index: number): string {
  if (index < 0) {
    return ""
  }

  const start = Math.max(0, index - 48)
  const end = Math.min(content.length, index + 96)
  const prefix = start > 0 ? "..." : ""
  const suffix = end < content.length ? "..." : ""
  return `${prefix}${content.slice(start, end)}${suffix}`.replace(/\s+/g, " ").trim()
}

async function touchSave(saveId: string, updatedAt: number): Promise<void> {
  const save = await localDb.saves.get(saveId)
  if (!save) {
    return
  }
  await localDb.saves.put({
    ...save,
    updatedAt,
  })
}

function defaultWorkspaceFileByPath(path: string): {
  path: string
  content: string
  mediaType?: string
} | undefined {
  return DEFAULT_WORKSPACE_FILES.find((file) => file.path === path)
}

function parseWorkspaceManifestVersion(content: string | undefined): number {
  if (!content) {
    return 0
  }

  try {
    const parsed = JSON.parse(content) as unknown
    if (
      typeof parsed === "object"
      && parsed !== null
      && !Array.isArray(parsed)
      && typeof (parsed as { workspaceVersion?: unknown }).workspaceVersion === "number"
      && Number.isFinite((parsed as { workspaceVersion: number }).workspaceVersion)
    ) {
      return Math.max(0, Math.floor((parsed as { workspaceVersion: number }).workspaceVersion))
    }
  } catch {
    return 0
  }

  return 0
}

function plainRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function serializeWorkspaceManifest(content: string | undefined): string {
  let base: Record<string, unknown> = {}
  if (content) {
    try {
      const parsed = JSON.parse(content) as unknown
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        base = parsed as Record<string, unknown>
      }
    } catch {
      base = {}
    }
  }

  return JSON.stringify({
    ...base,
    version: typeof base.version === "string" ? base.version : "0.0.0",
    workspaceVersion: DEFAULT_WORKSPACE_VERSION,
    contentModel: {
      ...plainRecord(base.contentModel),
      fileContent: "text",
      binaryContent: false,
    },
    platformMetadata: {
      ...plainRecord(base.platformMetadata),
      path: ".tsian/",
      ordinaryWorkspaceVisible: false,
    },
  }, null, 2) + "\n"
}

async function upgradeDefaultWorkspaceFilesForSave(saveId: string): Promise<void> {
  const existingRecords = await localDb.workspaceFiles.where("saveId").equals(saveId).toArray()
  const existingByPath = new Map(existingRecords.map((record) => [record.path, record]))
  const manifest = existingByPath.get(WORKSPACE_MANIFEST_PATH)
  if (parseWorkspaceManifestVersion(manifest?.content) >= DEFAULT_WORKSPACE_VERSION) {
    return
  }

  const now = Date.now()
  await localDb.transaction("rw", localDb.workspaceFiles, async () => {
    for (const path of DEFAULT_WORKSPACE_UPGRADE_FILE_PATHS) {
      if (existingByPath.has(path)) {
        continue
      }

      const defaultFile = defaultWorkspaceFileByPath(path)
      if (!defaultFile) {
        continue
      }

      await localDb.workspaceFiles.put({
        id: createTableId(saveId, path),
        saveId,
        path,
        content: defaultFile.content,
        mediaType: normalizeMediaType(defaultFile.mediaType, path),
        createdAt: now,
        updatedAt: now,
      })
    }

    await localDb.workspaceFiles.put({
      id: createTableId(saveId, WORKSPACE_MANIFEST_PATH),
      saveId,
      path: WORKSPACE_MANIFEST_PATH,
      content: serializeWorkspaceManifest(manifest?.content),
      mediaType: "application/json",
      createdAt: manifest?.createdAt ?? now,
      updatedAt: now,
    })
  })
}

export async function initializeWorkspaceForSave(saveId: string): Promise<void> {
  const existingCount = await localDb.workspaceFiles.where("saveId").equals(saveId).count()
  if (existingCount > 0) {
    await upgradeDefaultWorkspaceFilesForSave(saveId)
    return
  }

  const now = Date.now()
  await localDb.transaction("rw", localDb.workspaceFiles, async () => {
    for (const file of DEFAULT_WORKSPACE_FILES) {
      const path = normalizeWorkspaceFilePath(file.path)
      await localDb.workspaceFiles.put({
        id: createTableId(saveId, path),
        saveId,
        path,
        content: file.content,
        mediaType: normalizeMediaType(file.mediaType, path),
        createdAt: now,
        updatedAt: now,
      })
    }
  })
}

export async function listLocalWorkspaceFilesForSave(
  saveId: string,
): Promise<LocalWorkspaceFileRecord[]> {
  const records = await localDb.workspaceFiles.where("saveId").equals(saveId).toArray()
  return records.sort((left, right) => left.path.localeCompare(right.path))
}

export async function listWorkspaceFilesForSave(
  saveId: string,
): Promise<WorkspaceFile[]> {
  return (await listLocalWorkspaceFilesForSave(saveId)).map(toWorkspaceFile)
}

export async function listCheckpointWorkspaceFilesForSave(
  saveId: string,
): Promise<CheckpointWorkspaceFile[]> {
  return (await listLocalWorkspaceFilesForSave(saveId)).map(toCheckpointWorkspaceFile)
}

export function listWorkspaceEntriesFromFiles(
  workspaceFiles: WorkspaceFile[],
  input: WorkspaceListInput = {},
): WorkspaceEntry[] {
  const directoryPath = normalizeDirectoryPath(input.path)
  const prefix = directoryPath ? `${directoryPath}/` : ""
  const files = new Map<string, WorkspaceEntry>()
  const directories = new Map<string, WorkspaceEntry & { children: Set<string> }>()

  for (const file of ordinaryWorkspaceFiles(workspaceFiles)) {
    if (directoryPath && !file.path.startsWith(prefix)) {
      continue
    }

    const remainder = directoryPath
      ? file.path.slice(prefix.length)
      : file.path
    if (!remainder) {
      continue
    }

    const slashIndex = remainder.indexOf("/")
    if (slashIndex === -1) {
      files.set(file.path, {
        path: file.path,
        name: fileName(file.path),
        kind: "file",
        mediaType: file.mediaType,
        size: file.content.length,
        updatedAt: file.updatedAt,
      })
      continue
    }

    const childName = remainder.slice(0, slashIndex)
    const childPath = prefix ? `${prefix}${childName}` : childName
    const nextSegment = remainder.slice(slashIndex + 1).split("/")[0]
    const existing = directories.get(childPath)
    if (existing) {
      existing.updatedAt = Math.max(existing.updatedAt ?? 0, file.updatedAt)
      if (nextSegment) existing.children.add(nextSegment)
      continue
    }

    const children = new Set<string>()
    if (nextSegment) children.add(nextSegment)
    directories.set(childPath, {
      path: childPath,
      name: childName,
      kind: "directory",
      updatedAt: file.updatedAt,
      childCount: 0,
      children,
    })
  }

  const directoryEntries = Array.from(directories.values()).map(
    ({ children, ...entry }) => ({
      ...entry,
      childCount: children.size,
    }),
  )

  return [
    ...directoryEntries.sort((left, right) => left.name.localeCompare(right.name)),
    ...Array.from(files.values()).sort((left, right) => left.name.localeCompare(right.name)),
  ]
}

export async function listWorkspaceEntriesForSave(
  saveId: string,
  input: WorkspaceListInput = {},
): Promise<WorkspaceEntry[]> {
  return listWorkspaceEntriesFromFiles(
    (await listLocalWorkspaceFilesForSave(saveId)).map(toWorkspaceFile),
    input,
  )
}

export async function readWorkspaceFileForSave(
  saveId: string,
  pathInput: unknown,
): Promise<WorkspaceFile | null> {
  const path = normalizeWorkspaceFilePath(pathInput)
  assertOrdinaryReadPath(path)
  const record = await localDb.workspaceFiles.get(createTableId(saveId, path))
  return record ? toWorkspaceFile(record) : null
}

export function readWorkspaceFileFromFiles(
  workspaceFiles: WorkspaceFile[],
  pathInput: unknown,
): WorkspaceFile | null {
  const path = normalizeWorkspaceFilePath(pathInput)
  const file = workspaceFiles.find((candidate) => candidate.path === path)
  return file ? cloneWorkspaceFile(file) : null
}

export function readOrdinaryWorkspaceFileFromFiles(
  workspaceFiles: WorkspaceFile[],
  pathInput: unknown,
): WorkspaceFile | null {
  const path = normalizeWorkspaceFilePath(pathInput)
  assertOrdinaryReadPath(path)
  const file = workspaceFiles.find((candidate) => candidate.path === path)
  return file ? cloneWorkspaceFile(file) : null
}

function writeWorkspaceFileToFiles(
  workspaceFiles: WorkspaceFile[],
  input: WorkspaceWriteInput,
  options: { rejectPlatformMetadata: boolean },
): WorkspaceFile {
  const path = normalizeWorkspaceFilePath(input.path)
  if (options.rejectPlatformMetadata) {
    assertOrdinaryMutationPath(path)
  }

  if (typeof input.content !== "string") {
    throw new WorkspaceStorageError(
      "WORKSPACE_CONTENT_REQUIRED",
      "Workspace file content must be a string.",
    )
  }

  const now = Date.now()
  const existingIndex = workspaceFiles.findIndex((file) => file.path === path)
  const existing = existingIndex >= 0 ? workspaceFiles[existingIndex] : undefined
  const nextFile: WorkspaceFile = {
    path,
    content: input.content,
    mediaType: normalizeMediaType(input.mediaType, path),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  }

  if (existingIndex >= 0) {
    workspaceFiles[existingIndex] = nextFile
  } else {
    workspaceFiles.push(nextFile)
  }
  workspaceFiles.sort((left, right) => left.path.localeCompare(right.path))
  return cloneWorkspaceFile(nextFile)
}

function deleteWorkspacePathFromFiles(
  workspaceFiles: WorkspaceFile[],
  pathInput: unknown,
  options: { rejectPlatformMetadata: boolean },
): { deletedPaths: string[] } {
  const path = normalizeWorkspaceTargetPath(pathInput)
  if (options.rejectPlatformMetadata) {
    assertOrdinaryMutationPath(path)
  }

  const prefix = `${path}/`
  const deletedPaths = workspaceFiles
    .filter((file) => file.path === path || file.path.startsWith(prefix))
    .map((file) => file.path)
    .sort()

  if (deletedPaths.length === 0) {
    return { deletedPaths: [] }
  }

  const deletedPathSet = new Set(deletedPaths)
  for (let index = workspaceFiles.length - 1; index >= 0; index -= 1) {
    const file = workspaceFiles[index]
    if (file && deletedPathSet.has(file.path)) {
      workspaceFiles.splice(index, 1)
    }
  }

  return { deletedPaths }
}

export function createRuntimeWorkspaceTransaction(
  baselineFiles: WorkspaceFile[],
): RuntimeWorkspaceTransaction {
  const stagedFiles = baselineFiles
    .map(cloneWorkspaceFile)
    .sort((left, right) => left.path.localeCompare(right.path))

  return {
    workspaceFiles: stagedFiles,
    write(input) {
      return writeWorkspaceFileToFiles(stagedFiles, input, {
        rejectPlatformMetadata: true,
      })
    },
    writePlatformFile(input) {
      return writeWorkspaceFileToFiles(stagedFiles, input, {
        rejectPlatformMetadata: false,
      })
    },
    delete(path) {
      return deleteWorkspacePathFromFiles(stagedFiles, path, {
        rejectPlatformMetadata: true,
      })
    },
    finalWorkspaceFiles() {
      return stagedFiles
        .map(cloneWorkspaceFile)
        .sort((left, right) => left.path.localeCompare(right.path))
    },
    discard() {
      stagedFiles.splice(0, stagedFiles.length)
    },
  }
}

async function writeWorkspaceFileForSaveWithOptions(
  saveId: string,
  input: WorkspaceWriteInput,
  options: { rejectPlatformMetadata: boolean },
): Promise<WorkspaceFile> {
  const path = normalizeWorkspaceFilePath(input.path)
  if (options.rejectPlatformMetadata) {
    assertOrdinaryMutationPath(path)
  }

  if (typeof input.content !== "string") {
    throw new WorkspaceStorageError(
      "WORKSPACE_CONTENT_REQUIRED",
      "Workspace file content must be a string.",
    )
  }

  const now = Date.now()
  const id = createTableId(saveId, path)
  let nextRecord: LocalWorkspaceFileRecord | null = null

  await localDb.transaction("rw", localDb.saves, localDb.workspaceFiles, async () => {
    const existing = await localDb.workspaceFiles.get(id)
    nextRecord = {
      id,
      saveId,
      path,
      content: input.content as string,
      mediaType: normalizeMediaType(input.mediaType, path),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    }
    await localDb.workspaceFiles.put(nextRecord)
    await touchSave(saveId, now)
  })

  if (!nextRecord) {
    throw new WorkspaceStorageError(
      "WORKSPACE_WRITE_FAILED",
      "Workspace file write did not produce a record.",
    )
  }

  return toWorkspaceFile(nextRecord)
}

export async function writeWorkspaceFileForSave(
  saveId: string,
  input: WorkspaceWriteInput,
): Promise<WorkspaceFile> {
  return writeWorkspaceFileForSaveWithOptions(saveId, input, {
    rejectPlatformMetadata: true,
  })
}

export async function writePlatformWorkspaceFileForSave(
  saveId: string,
  input: WorkspaceWriteInput,
): Promise<WorkspaceFile> {
  return writeWorkspaceFileForSaveWithOptions(saveId, input, {
    rejectPlatformMetadata: false,
  })
}

export async function deleteWorkspacePathForSave(
  saveId: string,
  pathInput: unknown,
): Promise<{ deletedPaths: string[] }> {
  const path = normalizeWorkspaceTargetPath(pathInput)
  assertOrdinaryMutationPath(path)
  const prefix = `${path}/`
  const rows = (await listLocalWorkspaceFilesForSave(saveId))
    .filter((record) => record.path === path || record.path.startsWith(prefix))

  if (rows.length === 0) {
    return { deletedPaths: [] }
  }

  const now = Date.now()
  await localDb.transaction("rw", localDb.saves, localDb.workspaceFiles, async () => {
    await Promise.all(rows.map((record) => localDb.workspaceFiles.delete(record.id)))
    await touchSave(saveId, now)
  })

  return {
    deletedPaths: rows.map((record) => record.path).sort(),
  }
}

export async function searchWorkspaceFilesForSave(
  saveId: string,
  input: WorkspaceSearchInput = {},
): Promise<WorkspaceSearchResult[]> {
  return searchWorkspaceFilesFromFiles(
    (await listLocalWorkspaceFilesForSave(saveId)).map(toWorkspaceFile),
    input,
  )
}

export function searchWorkspaceFilesFromFiles(
  workspaceFiles: WorkspaceFile[],
  input: WorkspaceSearchInput = {},
): WorkspaceSearchResult[] {
  const query = typeof input.query === "string" ? input.query.trim().toLowerCase() : ""
  if (!query) {
    return []
  }

  const limit = normalizeLimit(input.limit)
  return ordinaryWorkspaceFiles(workspaceFiles)
    .flatMap((file): WorkspaceSearchResult[] => {
      const lowerPath = file.path.toLowerCase()
      const lowerContent = file.content.toLowerCase()
      const contentIndex = lowerContent.indexOf(query)
      const matchesPath = lowerPath.includes(query)
      if (!matchesPath && contentIndex < 0) {
        return []
      }

      return [{
        path: file.path,
        name: fileName(file.path),
        mediaType: file.mediaType,
        updatedAt: file.updatedAt,
        score: (matchesPath ? 2 : 0) + (contentIndex >= 0 ? 1 : 0),
        preview: contentIndex >= 0 ? createPreview(file.content, contentIndex) : file.path,
      }]
    })
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score
      }
      return right.updatedAt - left.updatedAt
    })
    .slice(0, limit)
}

export async function replaceWorkspaceFilesForSave(
  saveId: string,
  files: CheckpointWorkspaceFile[],
): Promise<void> {
  const deduped = new Map<string, LocalWorkspaceFileRecord>()
  for (const file of files) {
    const record = createLocalWorkspaceFileRecord(saveId, file)
    deduped.set(record.path, record)
  }

  const existing = await localDb.workspaceFiles.where("saveId").equals(saveId).toArray()
  await localDb.transaction("rw", localDb.workspaceFiles, async () => {
    await Promise.all(existing.map((record) => localDb.workspaceFiles.delete(record.id)))
    for (const record of deduped.values()) {
      await localDb.workspaceFiles.put(record)
    }
  })
}

export async function deleteWorkspaceForSave(saveId: string): Promise<void> {
  const rows = await localDb.workspaceFiles.where("saveId").equals(saveId).toArray()
  await Promise.all(rows.map((item) => localDb.workspaceFiles.delete(item.id)))
}
