import type {
  AgentConfig,
  GameCardContentFile,
  WorkspaceEntry,
  WorkspaceFile,
  WorkspaceSearchResult,
} from "@tsian/contracts"
import {
  listLocalGameCardContentFiles,
  type LocalGameCardContentFile,
} from "./game-cards"
import {
  localDb,
  type LocalGameCardRecord,
  type LocalWorkspaceFileRecord,
} from "./db"

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
const DEFAULT_WORKSPACE_VERSION = 6
const WORKSPACE_MANIFEST_PATH = ".tsian/manifest.json"
const DEFAULT_SAVE_RUNTIME_UPGRADE_FILE_PATHS = new Set([
  "save/README.md",
  "save/agents/master/notes.md",
  "save/agents/narrative/notes.md",
  "save/agents/memory/notes.md",
  "save/state/README.md",
  "save/state/schemas/README.md",
  "save/state/data/README.md",
  "save/history/README.md",
  "save/history/turns/README.md",
  "save/history/timeline.md",
  "save/world/README.md",
  "save/memory/README.md",
  "save/memory/summaries/current.md",
  "save/memory/summaries/long-term.md",
  "save/frontend/README.md",
  "save/frontend/view-state.json",
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
  "- `save/agents/<agent>/notes.md`",
  "- `save/history/timeline.md`",
  "- `save/memory/summaries/current.md`",
  "- `save/memory/summaries/long-term.md`",
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
  "      \"path\": \"save/memory/summaries/current.md\",",
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
  "  return /^save\\/agents\\/[^/]+\\/notes\\.md$/.test(path)",
  "    || path === \"save/history/timeline.md\"",
  "    || path === \"save/memory/summaries/current.md\"",
  "    || path === \"save/memory/summaries/long-term.md\";",
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
  "        scope: \"save-runtime\",",
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

function agentConfigContent(config: AgentConfig): string {
  return JSON.stringify(config, null, 2) + "\n"
}

const TSIAN_FRAMEWORK_KNOWLEDGE_MD = [
  "# Tsian Framework Knowledge",
  "",
  "This is a temporary official knowledge base for the workspace assistant. It is intentionally compact and will be expanded as the project matures.",
  "",
  "## Product Model",
  "",
  "- Tsian is an Agent-Orchestrated Runtime platform for AIRP.",
  "- Platform owns model configuration, API-key boundaries, local storage, checkpoints, bridge APIs, execution policy, and sandboxing.",
  "- A Game Card is reusable content definition plus optional frontend binding and metadata.",
  "- A Save Instance stores runtime play data for one playthrough.",
  "- A Checkpoint is a rollback point inside one Save Instance, not a top-level game card or save card.",
  "- Game frontends are supplied by Game Cards. Platform UI should not become a universal gameplay renderer.",
  "",
  "## Runtime Workspace",
  "",
  "Runtime Workspace is an effective virtual file system composed from Game Card content plus the active save slot mounted at `save/`.",
  "",
  "Ordinary workspace paths are visible to Agents, Skills, and game frontends. `.tsian/` is platform-owned metadata and is hidden from ordinary workspace read/list/search APIs.",
  "",
  "Directory README files are important. They explain local conventions for data that the platform intentionally does not hardcode.",
  "",
  "## Agents",
  "",
  "Agent configuration is Game Card content under `agents/<agent>/agent.json`. Required Agent SOP instructions live under `agents/<agent>/AGENT.md`. Durable identity and work-style prompts live under optional `agents/<agent>/SOUL.md` files. Runtime notes live under `save/agents/<agent>/`.",
  "",
  "The default AIRP runtime uses the entry Agent declared in the workspace; additional Agents act as delegated specialists.",
  "",
  "`agent.json` stores title, summary, contacts, context paths, Skill enablement, platform tool permissions, and workspace access. `AGENT.md` should state the Agent SOP and procedures. `SOUL.md` should hold durable identity, work style, and expression preferences.",
  "",
  "## Skills",
  "",
  "Skills are on-demand capability packages. Shared Skills live under `skills/<skill>/SKILL.md`; Agent-local Skills live under `agents/<agent>/skills/<skill>/SKILL.md`.",
  "",
  "Only Skill names, descriptions, triggers, applicability, and action summaries belong in the eager Skill Index. Detailed instructions are injected by the framework after `use_skill` declares intent; full SKILL.md never loads eagerly.",
  "",
  "Skill actions must stay gated behind a loaded Skill. Gameplay-specific behavior belongs in Skills and workspace conventions instead of hardcoded platform tools.",
  "",
  "## State And Frontend Data",
  "",
  "Structured state is not a platform-owned table model. It belongs in workspace files documented by README files, schemas, Agents, Skills, or frontend conventions.",
  "",
  "The `save/frontend/` directory is for runtime data agreed between the save and the active game frontend. The platform does not interpret those gameplay fields.",
  "",
  "## Memory, History, And Diagnostics",
  "",
  "Raw AIRP turn history under `save/history/turns/` stores successful player input and final narrative output. It is ordinary memory feedstock, not trace data.",
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
      "This effective workspace combines Game Card content with active save runtime data.",
      "Agents, Skills, rules, docs, schemas, and frontend definitions are Game Card content.",
      "Runtime play data lives under `save/`.",
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
      "Agent configuration lives under `agents/<agent>/agent.json`.",
      "`AGENT.md` is the required SOP/instruction file for that Agent.",
      "Durable Agent identity and work style can live under `SOUL.md`.",
      "Agent-local skills can live under `agents/<agent>/skills/`.",
      "",
    ].join("\n"),
  },
  {
    path: "agents/master/agent.json",
    content: agentConfigContent({
      id: "master",
      title: "Master Agent",
      summary: "Coordinates each AIRP turn, manages shared context, and delegates to specialist agents when useful.",
      contacts: ["memory", "narrative"],
      contextPaths: [
        "README.md",
        "world/README.md",
        "save/history/timeline.md",
        "save/world/README.md",
        "save/state/README.md",
        "save/memory/summaries/current.md",
      ],
      skills: {
        enabled: [],
        disabled: [],
      },
      platformTools: {
        enabled: ["agent_call", "workspace_read"],
        disabled: [],
      },
      workspaceAccess: {
        level: 1,
      },
    }),
  },
  {
    path: "agents/master/AGENT.md",
    content: [
      "# Master Agent",
      "",
      "You are the entry agent for each AIRP turn. You directly produce the player-facing reply.",
      "Inspect relevant workspace context when the next step depends on established facts, current scene state, or recent memory.",
      "Contact the memory agent when continuity, summaries, or durable fact candidates may affect the turn.",
      "Contact the narrative agent when you want it to draft or refine the narrative prose for this turn.",
      "Keep durable identity and work style in `SOUL.md`.",
      "",
    ].join("\n"),
  },
  {
    path: "agents/master/SOUL.md",
    content: [
      "# Master Agent Soul",
      "",
      "You are the entry agent for an AIRP turn. You directly produce the player-facing reply.",
      "Read the relevant workspace context, decide what needs to happen next, and contact specialist agents when their responsibilities match the current situation.",
      "Contact the narrative agent when you want help drafting or refining the narrative prose.",
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
    path: "agents/narrative/agent.json",
    content: agentConfigContent({
      id: "narrative",
      title: "Narrative Agent",
      summary: "Turns plans, world facts, and character state into player-facing prose.",
      contacts: ["master"],
      contextPaths: [
        "save/history/timeline.md",
        "world/README.md",
        "world/canon.md",
        "save/memory/summaries/current.md",
      ],
      skills: {
        enabled: [],
        disabled: [],
      },
      platformTools: {
        enabled: ["agent_call", "workspace_read"],
        disabled: [],
      },
      workspaceAccess: {
        level: 1,
      },
    }),
  },
  {
    path: "agents/narrative/AGENT.md",
    content: [
      "# Narrative Agent",
      "",
      "You are a specialist agent called by the master agent to draft or refine narrative prose.",
      "Use the calling agent's request, recent history, and available workspace context to write immersive, playable narrative.",
      "Preserve continuity, keep the scene playable, and avoid exposing Agent/runtime mechanics to the player.",
      "Keep durable identity and work style in `SOUL.md`.",
      "",
    ].join("\n"),
  },
  {
    path: "agents/narrative/SOUL.md",
    content: [
      "# Narrative Agent Soul",
      "",
      "You are a narrative specialist called by other agents.",
      "Use established world facts and recent history, preserve continuity, and write immersive second-person narrative.",
      "",
    ].join("\n"),
  },
  {
    path: "agents/narrative/notes.md",
    content: "# Narrative Notes\n\n",
  },
  {
    path: "agents/memory/agent.json",
    content: agentConfigContent({
      id: "memory",
      title: "Memory Agent",
      summary: "Checks continuity, current-scene memory, and durable fact candidates for AIRP turns.",
      contacts: [],
      contextPaths: [
        "README.md",
        "save/history/timeline.md",
        "save/memory/README.md",
        "save/memory/summaries/current.md",
        "save/memory/summaries/long-term.md",
        "world/canon.md",
      ],
      skills: {
        enabled: [],
        disabled: [],
      },
      platformTools: {
        enabled: ["workspace_read", "workspace_write"],
        disabled: [],
      },
      workspaceAccess: {
        level: 1,
      },
    }),
  },
  {
    path: "agents/memory/AGENT.md",
    content: [
      "# Memory Agent",
      "",
      "Answer continuity, recall, and memory-maintenance questions for calling agents.",
      "Return concise findings and clearly separate established facts from candidates that should be preserved.",
      "Only claim that you updated memory files after using an available Skill action or workspace tool that actually performed the write.",
      "Keep durable identity and work style in `SOUL.md`.",
      "",
    ].join("\n"),
  },
  {
    path: "agents/memory/SOUL.md",
    content: [
      "# Memory Agent Soul",
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

const RUNTIME_DEFAULT_CARD_PATHS = new Set([
  "agents/master/notes.md",
  "agents/narrative/notes.md",
  "agents/memory/notes.md",
  "history/README.md",
  "history/turns/README.md",
  "history/timeline.md",
  "memory/README.md",
  "memory/summaries/current.md",
  "memory/summaries/long-term.md",
  "frontend/view-state.json",
  WORKSPACE_MANIFEST_PATH,
  ".tsian/README.md",
  ".tsian/traces/README.md",
  ".tsian/checkpoints/README.md",
  ".tsian/indexes/README.md",
  ".tsian/cache/README.md",
])

const DEFAULT_SAVE_RUNTIME_FILES: Array<{
  path: string
  content: string
  mediaType?: string
}> = [
  {
    path: "save/README.md",
    content: [
      "# Save Runtime Data",
      "",
      "This directory contains runtime data for the active save slot.",
      "Game Card content such as Agents, Skills, rules, schemas, and docs lives outside this directory.",
      "",
    ].join("\n"),
  },
  {
    path: "save/agents/master/notes.md",
    content: "# Master Notes\n\n",
  },
  {
    path: "save/agents/narrative/notes.md",
    content: "# Narrative Notes\n\n",
  },
  {
    path: "save/agents/memory/notes.md",
    content: "# Memory Notes\n\n",
  },
  {
    path: "save/history/README.md",
    content: [
      "# History",
      "",
      "Keep this playthrough's durable conversation records and timeline summaries here.",
      "Raw player-facing AIRP turns are stored under `save/history/turns/` as one JSON file per successful turn.",
      "",
    ].join("\n"),
  },
  {
    path: "save/history/turns/README.md",
    content: [
      "# Raw AIRP Turns",
      "",
      "Each successful AIRP turn is stored here as `turn-000001.json`, `turn-000002.json`, and so on.",
      "Turn files contain the player input and final assistant narrative only.",
      "",
    ].join("\n"),
  },
  {
    path: "save/history/timeline.md",
    content: "# Timeline\n\n",
  },
  {
    path: "save/world/README.md",
    content: [
      "# Runtime World Data",
      "",
      "Generated characters, places, relationships, maps, and other playthrough world state can live here.",
      "Card-owned world canon and rules live outside `save/`.",
      "",
    ].join("\n"),
  },
  {
    path: "save/state/README.md",
    content: [
      "# Runtime State",
      "",
      "Use this directory for generic runtime state when no more specific save directory exists.",
      "",
    ].join("\n"),
  },
  {
    path: "save/state/schemas/README.md",
    content: [
      "# Runtime State Schemas",
      "",
      "Prefer card-owned schemas outside `save/`; use this directory only for save-local schema notes.",
      "",
    ].join("\n"),
  },
  {
    path: "save/state/data/README.md",
    content: [
      "# Runtime State Data",
      "",
      "Store generic structured runtime data here only when a local convention needs this neutral area.",
      "",
    ].join("\n"),
  },
  {
    path: "save/memory/README.md",
    content: [
      "# Runtime Memory",
      "",
      "Store this playthrough's long-term summaries, durable facts, and retrieval-oriented notes here.",
      "",
    ].join("\n"),
  },
  {
    path: "save/memory/summaries/current.md",
    content: "# Current Summary\n\n",
  },
  {
    path: "save/memory/summaries/long-term.md",
    content: "# Long-Term Summary\n\n",
  },
  {
    path: "save/frontend/README.md",
    content: [
      "# Runtime Frontend Data",
      "",
      "Store data agreed between this save and the active frontend package here.",
      "The platform does not interpret these fields.",
      "",
    ].join("\n"),
  },
  {
    path: "save/frontend/view-state.json",
    content: "{}\n",
    mediaType: "application/json",
  },
  {
    path: WORKSPACE_MANIFEST_PATH,
    content: JSON.stringify({
      version: "0.0.0",
      workspaceVersion: DEFAULT_WORKSPACE_VERSION,
      contentModel: {
        fileContent: "text",
        binaryContent: false,
        cardContentRoot: "/",
        activeSaveRoot: "save/",
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
      "Files under `.tsian/` are owned by the platform for this save slot.",
      "They are hidden from ordinary Agent, Skill, and frontend workspace APIs.",
      "",
    ].join("\n"),
  },
  {
    path: ".tsian/traces/README.md",
    content: [
      "# Traces",
      "",
      "Runtime trace files are platform-owned diagnostics input for this save.",
      "",
    ].join("\n"),
  },
  {
    path: ".tsian/checkpoints/README.md",
    content: "# Checkpoints\n\nCheckpoint metadata is platform-owned and preserved with save snapshots.\n",
  },
  {
    path: ".tsian/indexes/README.md",
    content: "# Indexes\n\nGenerated save indexes are platform-owned derived data and may be rebuilt.\n",
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

function toContentFile(file: {
  path: string
  content: string
  mediaType?: string
}): GameCardContentFile {
  const path = normalizeWorkspaceFilePath(file.path)
  return {
    path,
    content: file.content,
    mediaType: normalizeMediaType(file.mediaType, path),
  }
}

export function createDefaultWorkspaceTemplateFiles(): GameCardContentFile[] {
  return DEFAULT_WORKSPACE_FILES
    .filter((file) => !RUNTIME_DEFAULT_CARD_PATHS.has(file.path))
    .map(toContentFile)
}

export function createDefaultSaveRuntimeFiles(): CheckpointWorkspaceFile[] {
  const now = Date.now()
  return DEFAULT_SAVE_RUNTIME_FILES.map((file) => {
    const path = normalizeWorkspaceFilePath(file.path)
    return {
      path,
      content: file.content,
      mediaType: normalizeMediaType(file.mediaType, path),
      createdAt: now,
      updatedAt: now,
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

export function isActiveSaveRuntimePath(path: string): boolean {
  return path === "save" || path.startsWith("save/")
}

export function isSaveRuntimePersistencePath(path: string): boolean {
  if (isActiveSaveRuntimePath(path)) {
    return true
  }
  // .tsian/local/ is local-only data excluded from save checkpoint/restore.
  if (path === ".tsian/local" || path.startsWith(".tsian/local/")) {
    return false
  }
  return isPlatformMetadataPath(path)
}

export function isOrdinaryWorkspacePath(path: string): boolean {
  return !isPlatformMetadataPath(path)
}

function assertOrdinarySaveRuntimeMutationPath(path: string): void {
  if (isPlatformMetadataPath(path)) {
    throw new WorkspaceStorageError(
      "WORKSPACE_PLATFORM_METADATA_FORBIDDEN",
      "Platform metadata paths under .tsian are host-owned.",
    )
  }

  if (isActiveSaveRuntimePath(path)) {
    return
  }

  throw new WorkspaceStorageError(
    "WORKSPACE_SAVE_RUNTIME_PATH_REQUIRED",
    "Runtime workspace mutations must target the active save under save/.",
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

function assertPlatformSaveRuntimeMutationPath(path: string): void {
  if (isSaveRuntimePersistencePath(path)) {
    return
  }

  throw new WorkspaceStorageError(
    "WORKSPACE_SAVE_RUNTIME_PATH_REQUIRED",
    "Platform runtime workspace mutations must target save/ or .tsian/.",
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

function toWorkspaceFileFromGameCardContent(
  file: LocalGameCardContentFile,
): WorkspaceFile {
  const path = normalizeWorkspaceFilePath(file.path)
  return {
    path,
    content: typeof file.content === "string" ? file.content : "",
    mediaType: normalizeMediaType(file.mediaType, path),
    createdAt: file.createdAt,
    updatedAt: file.updatedAt,
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
  return DEFAULT_SAVE_RUNTIME_FILES.find((file) => file.path === path)
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
      cardContentRoot: "/",
      activeSaveRoot: "save/",
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
    for (const path of DEFAULT_SAVE_RUNTIME_UPGRADE_FILE_PATHS) {
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
    for (const file of createDefaultSaveRuntimeFiles()) {
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

export async function listEffectiveWorkspaceFilesForSave(
  saveId: string,
  card: LocalGameCardRecord,
): Promise<WorkspaceFile[]> {
  const filesByPath = new Map<string, WorkspaceFile>()
  for (const file of await listLocalGameCardContentFiles(card.id)) {
    const workspaceFile = toWorkspaceFileFromGameCardContent(file)
    filesByPath.set(workspaceFile.path, workspaceFile)
  }

  for (const record of await listLocalWorkspaceFilesForSave(saveId)) {
    const workspaceFile = toWorkspaceFile(record)
    filesByPath.set(workspaceFile.path, workspaceFile)
  }

  return Array.from(filesByPath.values())
    .map(cloneWorkspaceFile)
    .sort((left, right) => left.path.localeCompare(right.path))
}

export async function listCheckpointWorkspaceFilesForSave(
  saveId: string,
): Promise<CheckpointWorkspaceFile[]> {
  return (await listLocalWorkspaceFilesForSave(saveId)).map(toCheckpointWorkspaceFile)
}

export function saveRuntimeFilesFromEffectiveWorkspace(
  workspaceFiles: WorkspaceFile[],
): CheckpointWorkspaceFile[] {
  const filesByPath = new Map<string, CheckpointWorkspaceFile>()
  for (const file of workspaceFiles) {
    const path = normalizeWorkspaceFilePath(file.path)
    if (!isSaveRuntimePersistencePath(path)) {
      continue
    }

    filesByPath.set(path, {
      path,
      content: typeof file.content === "string" ? file.content : "",
      mediaType: normalizeMediaType(file.mediaType, path),
      createdAt: typeof file.createdAt === "number" ? file.createdAt : Date.now(),
      updatedAt: typeof file.updatedAt === "number" ? file.updatedAt : Date.now(),
    })
  }

  return Array.from(filesByPath.values())
    .sort((left, right) => left.path.localeCompare(right.path))
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
  options: { allowPlatformMetadata: boolean },
): WorkspaceFile {
  const path = normalizeWorkspaceFilePath(input.path)
  if (options.allowPlatformMetadata) {
    assertPlatformSaveRuntimeMutationPath(path)
  } else {
    assertOrdinarySaveRuntimeMutationPath(path)
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
  options: { allowPlatformMetadata: boolean },
): { deletedPaths: string[] } {
  const path = normalizeWorkspaceTargetPath(pathInput)
  if (options.allowPlatformMetadata) {
    assertPlatformSaveRuntimeMutationPath(path)
  } else {
    assertOrdinarySaveRuntimeMutationPath(path)
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
        allowPlatformMetadata: false,
      })
    },
    writePlatformFile(input) {
      return writeWorkspaceFileToFiles(stagedFiles, input, {
        allowPlatformMetadata: true,
      })
    },
    delete(path) {
      return deleteWorkspacePathFromFiles(stagedFiles, path, {
        allowPlatformMetadata: false,
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
  options: { allowPlatformMetadata: boolean },
): Promise<WorkspaceFile> {
  const path = normalizeWorkspaceFilePath(input.path)
  if (options.allowPlatformMetadata) {
    assertPlatformSaveRuntimeMutationPath(path)
  } else {
    assertOrdinarySaveRuntimeMutationPath(path)
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
    allowPlatformMetadata: false,
  })
}

export async function writePlatformWorkspaceFileForSave(
  saveId: string,
  input: WorkspaceWriteInput,
): Promise<WorkspaceFile> {
  return writeWorkspaceFileForSaveWithOptions(saveId, input, {
    allowPlatformMetadata: true,
  })
}

export async function deleteWorkspacePathForSave(
  saveId: string,
  pathInput: unknown,
): Promise<{ deletedPaths: string[] }> {
  const path = normalizeWorkspaceTargetPath(pathInput)
  assertOrdinarySaveRuntimeMutationPath(path)
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
