import type {
  AgentConfig,
  GameCardContentFile,
  WorkspaceEntry,
  WorkspaceFile,
} from "@tsian/contracts"
import {
  binaryPlaceholderText,
  inferMediaTypeFromPath,
  isTextMediaType,
} from "@/lib/media-type"
import { normalizeWorkspacePath } from "@/lib/workspace-path"
import {
  listLocalGameCardContentFiles,
  listLocalGameCardFrontendFiles,
  type LocalGameCardContentFile,
} from "./game-cards"
import { normalizeGameCardManifest } from "./game-card-packages"
import {
  localDb,
  type LocalGameCardRecord,
  type LocalWorkspaceFileRecord,
} from "./db"

export type CheckpointWorkspaceFile = Omit<LocalWorkspaceFileRecord, "id" | "saveId">

export interface WorkspaceListInput {
  path?: unknown
}

export interface WorkspaceWriteInput {
  path?: unknown
  /** Text content (string) or binary payload (Blob). One or the other. */
  content?: unknown
  data?: unknown
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

const DEFAULT_WORKSPACE_VERSION = 8
const WORKSPACE_MANIFEST_PATH = ".tsian/manifest.json"
const DEFAULT_SAVE_RUNTIME_UPGRADE_FILE_PATHS = new Set([
  "save/README.md",
  "save/agents/master/notes.md",
  "save/agents/retrieval/notes.md",
  "save/agents/retrieval/agent.json",
  "save/agents/retrieval/AGENT.md",
  "save/agents/post-processing/notes.md",
  "save/state/README.md",
  "save/state/schemas/README.md",
  "save/state/data/README.md",
  "save/history/README.md",
  "save/history/turns/README.md",
  "save/world/README.md",
  "save/memory/README.md",
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

const ENTITY_READER_SKILL_MD = [
  "---",
  "name: entity-reader",
  "title: Entity Reader",
  "description: Read an entity file and auto-expand one level of _ref/_dir references, returning the complete object with direct children inlined.",
  "triggers:",
  "  - Need to read an entity (character, location, etc.) and get its index.json plus direct sub-files/sub-directories in one call",
  "appliesTo:",
  "  - retrieval",
  "  - master",
  "---",
  "",
  "# Entity Reader",
  "",
  "Use `read_entity` to read an entity's `index.json` and automatically expand one level of `_ref`/`_dir` markers.",
  "This saves context: instead of reading index.json then manually following each reference, one call returns the entity with direct children inlined.",
  "",
  "Only **one level** is expanded. If the expanded content itself contains `_ref`/`_dir` markers, they are preserved (not expanded).",
  "Call `read_entity` again on the deeper path if you need to go further.",
  "",
  "```json tsian-actions",
  "[",
  "  {",
  "    \"name\": \"read_entity\",",
  "    \"description\": \"Read a JSON file and auto-expand one level of _ref/_dir references.\",",
  "    \"inputSchema\": {",
  "      \"type\": \"object\",",
  "      \"required\": [\"path\"],",
  "      \"properties\": {",
  "        \"path\": { \"type\": \"string\", \"description\": \"Workspace path to the entity's index.json (or any JSON file with _ref/_dir markers).\" }",
  "      }",
  "    },",
  "    \"outputSchema\": {",
  "      \"type\": \"object\",",
  "      \"required\": [\"path\", \"data\"],",
  "      \"properties\": {",
  "        \"path\": { \"type\": \"string\" },",
  "        \"data\": { \"type\": \"object\" },",
  "        \"expandedFields\": { \"type\": \"array\" }",
  "      }",
  "    },",
  "    \"executor\": {",
  "      \"type\": \"browser_script\",",
  "      \"path\": \"scripts/read-entity.js\",",
  "      \"timeoutMs\": 10000",
  "    }",
  "  }",
  "]",
  "```",
  "",
].join("\n")

const ENTITY_READER_SCRIPT_JS = [
  "const MAX_SUB_FILES = 50;",
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
  "function dirOf(path) {",
  "  const i = path.lastIndexOf(\"/\");",
  "  return i >= 0 ? path.slice(0, i) : \"\";",
  "}",
  "",
  "async function expandRef(value, baseDir, tsian, signal) {",
  "  if (!isRecord(value) || typeof value._ref !== \"string\") return { expanded: false, value };",
  "  signal.throwIfAborted();",
  "  const refPath = value._ref.startsWith(\"/\") ? value._ref.slice(1) : (baseDir ? baseDir + \"/\" + value._ref : value._ref);",
  "  try {",
  "    const file = await tsian.workspace.read({ scope: \"effective\", path: refPath });",
  "    let parsed;",
  "    try { parsed = JSON.parse(file.content); } catch { parsed = file.content; }",
  "    return { expanded: true, value: parsed, refPath };",
  "  } catch (error) {",
  "    return { expanded: false, value: { ...value, _error: String(error && error.message || error) }, refPath };",
  "  }",
  "}",
  "",
  "async function expandDir(value, baseDir, tsian, signal) {",
  "  if (!isRecord(value) || typeof value._dir !== \"string\") return { expanded: false, value };",
  "  signal.throwIfAborted();",
  "  const dirPath = value._dir.replace(/\\/+$/, \"\").startsWith(\"/\") ? value._dir.replace(/\\/+$/, \"\").slice(1) : (baseDir ? baseDir + \"/\" + value._dir.replace(/\\/+$/, \"\") : value._dir.replace(/\\/+$/, \"\"));",
  "  try {",
  "    const entries = await tsian.workspace.list({ scope: \"effective\", path: dirPath });",
  "    const files = (Array.isArray(entries) ? entries : []).filter((e) => e && e.kind === \"file\" && e.name.endsWith(\".json\"));",
  "    if (files.length > MAX_SUB_FILES) {",
  "      return { expanded: false, value: { ...value, _error: \"Too many files in directory (max \" + MAX_SUB_FILES + \")\" }, dirPath };",
  "    }",
  "    const result = {};",
  "    for (const f of files) {",
  "      signal.throwIfAborted();",
  "      const filePath = dirPath + \"/\" + f.name;",
  "      const file = await tsian.workspace.read({ scope: \"effective\", path: filePath });",
  "      const key = f.name.replace(/\\.json$/, \"\");",
  "      try { result[key] = JSON.parse(file.content); } catch { result[key] = file.content; }",
  "    }",
  "    return { expanded: true, value: result, dirPath };",
  "  } catch (error) {",
  "    return { expanded: false, value: { ...value, _error: String(error && error.message || error) }, dirPath };",
  "  }",
  "}",
  "",
  "async function readEntity(input, tsian, signal) {",
  "  try {",
  "    signal.throwIfAborted();",
  "    if (!isRecord(input) || typeof input.path !== \"string\") {",
  "      fail(\"ENTITY_PATH_REQUIRED\", \"read_entity requires a non-empty string path.\");",
  "    }",
  "    const path = input.path.trim();",
  "    if (!path) fail(\"ENTITY_PATH_REQUIRED\", \"read_entity requires a non-empty string path.\");",
  "    tsian.trace(\"entity_read_started\", { path });",
  "    const file = await tsian.workspace.read({ scope: \"effective\", path });",
  "    let data;",
  "    try { data = JSON.parse(file.content); } catch (e) {",
  "      fail(\"ENTITY_JSON_INVALID\", \"Entity file is not valid JSON: \" + (e && e.message || e), { path });",
  "    }",
  "    if (!isRecord(data)) {",
  "      return { path, data, expandedFields: [] };",
  "    }",
  "    const baseDir = dirOf(path);",
  "    const expandedFields = [];",
  "    const result = {};",
  "    for (const key of Object.keys(data)) {",
  "      const val = data[key];",
  "      if (isRecord(val) && typeof val._ref === \"string\") {",
  "        const r = await expandRef(val, baseDir, tsian, signal);",
  "        result[key] = r.value;",
  "        if (r.expanded) expandedFields.push({ field: key, kind: \"_ref\", refPath: r.refPath });",
  "      } else if (isRecord(val) && typeof val._dir === \"string\") {",
  "        const r = await expandDir(val, baseDir, tsian, signal);",
  "        result[key] = r.value;",
  "        if (r.expanded) expandedFields.push({ field: key, kind: \"_dir\", dirPath: r.dirPath });",
  "      } else {",
  "        result[key] = val;",
  "      }",
  "    }",
  "    tsian.trace(\"entity_read_completed\", { path, expandedFields });",
  "    return { path, data: result, expandedFields };",
  "  } catch (error) {",
  "    tsian.trace(\"entity_read_failed\", { code: error && error.code || \"ENTITY_READ_FAILED\", message: error && error.message || String(error) });",
  "    throw error;",
  "  }",
  "}",
  "",
  "return readEntity(input, tsian, signal);",
  "",
].join("\n")

const WORLD_STATE_MAINTENANCE_SKILL_MD = [
  "---",
  "name: world-state-maintenance",
  "title: World State Maintenance",
  "description: Apply explicit world-state maintenance plans—update entity state and maintain relationships via staged workspace writes.",
  "triggers:",
  "  - Entity state (attributes/status/lastUpdated) needs updating",
  "  - An explicit relationships.json (if the game-card author set one up) needs updating",
  "appliesTo:",
  "  - post-processing",
  "---",
  "",
  "# World State Maintenance",
  "",
  "Use this Skill only when this turn has produced durable world-state changes that should be written to the workspace.",
  "Do not run it automatically every turn—only when there is world state to update.",
  "",
  "Before calling the action, read any file you intend to replace and prepare the full next content.",
  "The action only accepts explicit replacement writes.",
  "",
  "Allowed targets:",
  "",
  "- `save/world/**/*.json` (entity index.json, sub-files, sub-directory files, optional relationships.json)",
  "- `save/world/**/*.md` (entity journals, rules, etc.)",
  "",
  "Use an empty `writes` array only when you explicitly considered maintenance and decided no files should change.",
  "",
  "```json tsian-actions",
  "[",
  "  {",
  "    \"name\": \"apply_world_state_plan\",",
  "    \"description\": \"Validate and apply an explicit world-state maintenance plan through staged workspace writes.\",",
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
  "      \"path\": \"scripts/apply-world-state-plan.js\",",
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
  "  \"schema\": \"tsian.runtime.world-state.plan.v1\",",
  "  \"writes\": [",
  "    {",
  "      \"path\": \"save/world/characters/李四/index.json\",",
  "      \"mode\": \"replace\",",
  "      \"content\": \"{\\\"id\\\":\\\"李四\\\",\\\"status\\\":\\\"出关\\\",...}\",",
  "      \"reason\": \"李四 finished seclusion this turn.\"",
  "    }",
  "  ]",
  "}",
  "```",
  "",
].join("\n")

const WORLD_STATE_MAINTENANCE_SCRIPT_JS = [
  "const PLAN_SCHEMA = \"tsian.runtime.world-state.plan.v1\";",
  "const MAX_WRITES = 20;",
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
  "    fail(\"WORLD_STATE_PATH_REQUIRED\", \"World-state write path must be a string.\");",
  "  }",
  "  const raw = value.trim();",
  "  const hadTrailingSlash = /[\\\\/]$/.test(raw);",
  "  const normalized = raw",
  "    .replace(/\\\\/g, \"/\")",
  "    .replace(/^\\/+/, \"\")",
  "    .replace(/\\/+/g, \"/\")",
  "    .replace(/\\/+$/, \"\");",
  "  if (!normalized) {",
  "    fail(\"WORLD_STATE_PATH_REQUIRED\", \"World-state write path is required.\");",
  "  }",
  "  if (hadTrailingSlash) {",
  "    fail(\"WORLD_STATE_FILE_PATH_REQUIRED\", \"World-state write path must not end with a slash.\", { path: value });",
  "  }",
  "  const segments = normalized.split(\"/\");",
  "  if (segments.some((segment) => segment === \".\" || segment === \"..\" || segment === \"\")) {",
  "    fail(\"WORLD_STATE_PATH_INVALID\", \"World-state write path must not contain empty, current, or parent directory segments.\", { path: value });",
  "  }",
  "  if (normalized === \".tsian\" || normalized.startsWith(\".tsian/\")) {",
  "    fail(\"WORLD_STATE_PLATFORM_METADATA_FORBIDDEN\", \"World-state writes cannot target .tsian platform metadata.\", { path: normalized });",
  "  }",
  "  return normalized;",
  "}",
  "",
  "function isAllowedTarget(path) {",
  "  return (/^save\\/world\\//.test(path) && /\\.(json|md)$/.test(path))",
  "    || /^save\\/history\\/turns\\/.*\\.json$/.test(path);",
  "}",
  "",
  "function inferMediaType(path) {",
  "  if (path.endsWith(\".json\")) return \"application/json\";",
  "  if (path.endsWith(\".md\")) return \"text/markdown\";",
  "  return \"text/plain\";",
  "}",
  "",
  "function validateWrite(rawWrite, index) {",
  "  if (!isRecord(rawWrite)) {",
  "    fail(\"WORLD_STATE_WRITE_INVALID\", \"Each world-state write must be an object.\", { index });",
  "  }",
  "  const path = normalizePath(rawWrite.path);",
  "  if (!isAllowedTarget(path)) {",
  "    fail(\"WORLD_STATE_TARGET_NOT_ALLOWED\", \"World-state write target is not allowed in this Skill.\", { index, path });",
  "  }",
  "  if (rawWrite.mode !== \"replace\") {",
  "    fail(\"WORLD_STATE_MODE_UNSUPPORTED\", \"World-state write mode must be replace.\", { index, path, mode: rawWrite.mode });",
  "  }",
  "  if (typeof rawWrite.content !== \"string\") {",
  "    fail(\"WORLD_STATE_CONTENT_REQUIRED\", \"World-state write content must be a string.\", { index, path });",
  "  }",
  "  if (rawWrite.content.length > MAX_CONTENT_LENGTH) {",
  "    fail(\"WORLD_STATE_CONTENT_TOO_LARGE\", \"World-state write content exceeds the allowed size.\", { index, path, size: rawWrite.content.length, maxSize: MAX_CONTENT_LENGTH });",
  "  }",
  "  if (typeof rawWrite.reason !== \"string\" || !rawWrite.reason.trim()) {",
  "    fail(\"WORLD_STATE_REASON_REQUIRED\", \"World-state write reason must be a non-empty string.\", { index, path });",
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
  "    fail(\"WORLD_STATE_PLAN_INVALID\", \"World-state plan must be an object.\");",
  "  }",
  "  if (plan.schema !== PLAN_SCHEMA) {",
  "    fail(\"WORLD_STATE_SCHEMA_INVALID\", \"World-state plan schema is invalid.\", { expected: PLAN_SCHEMA, actual: plan.schema });",
  "  }",
  "  if (!Array.isArray(plan.writes)) {",
  "    fail(\"WORLD_STATE_WRITES_INVALID\", \"World-state plan writes must be an array.\");",
  "  }",
  "  if (plan.writes.length > MAX_WRITES) {",
  "    fail(\"WORLD_STATE_TOO_MANY_WRITES\", \"World-state plan contains too many writes.\", { count: plan.writes.length, maxWrites: MAX_WRITES });",
  "  }",
  "  return plan.writes.map(validateWrite);",
  "}",
  "",
  "async function applyWorldStatePlan(input, tsian, signal) {",
  "  try {",
  "    signal.throwIfAborted();",
  "    const writes = validatePlan(input);",
  "    tsian.trace(\"world_state_started\", { schema: PLAN_SCHEMA, writeCount: writes.length, paths: writes.map((w) => w.path) });",
  "    if (writes.length === 0) {",
  "      tsian.trace(\"world_state_completed\", { status: \"noop\", writeCount: 0 });",
  "      return { schema: PLAN_SCHEMA, status: \"noop\", writes: [] };",
  "    }",
  "    const applied = [];",
  "    for (const write of writes) {",
  "      signal.throwIfAborted();",
  "      const file = await tsian.workspace.write({",
  "        scope: \"save-runtime\",",
  "        path: write.path,",
  "        content: write.content,",
  "        mediaType: inferMediaType(write.path),",
  "      });",
  "      applied.push({ path: file.path, size: file.content.length, reason: write.reason });",
  "    }",
  "    tsian.trace(\"world_state_completed\", { status: \"applied\", writeCount: applied.length, writes: applied });",
  "    return { schema: PLAN_SCHEMA, status: \"applied\", writes: applied };",
  "  } catch (error) {",
  "    tsian.trace(\"world_state_failed\", { code: error && error.code || \"WORLD_STATE_FAILED\", message: error && error.message || String(error), details: error && error.details });",
  "    throw error;",
  "  }",
  "}",
  "",
  "return applyWorldStatePlan(input, tsian, signal);",
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
      summary: "The sole conversational agent for each AIRP turn. Decides, writes narrative prose directly, and calls retrieval/post-processing as tools when useful.",
      contacts: ["retrieval", "post-processing"],
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
      entryMode: "persistent",
      system: true,
    }),
  },
  {
    path: "agents/master/AGENT.md",
    content: [
      "# Master Agent",
      "",
      "You are the sole conversational agent for each AIRP turn. You directly produce the player-facing reply, including narrative prose.",
      "Inspect relevant workspace context when the next step depends on established facts or current scene state.",
      "Contact the retrieval agent when you need background facts, entity details, or relationship context without filling your own context with raw files.",
      "Contact the post-processing agent at the end of a turn to update world state and maintain memory.",
      "Keep durable identity and work style in `SOUL.md`.",
      "",
    ].join("\n"),
  },
  {
    path: "agents/master/SOUL.md",
    content: [
      "# Master Agent Soul",
      "",
      "You are the sole conversational agent for an AIRP turn. You directly write the player-facing narrative prose.",
      "Decide what needs to happen next, write the reply, and call retrieval/post-processing as tools when their responsibilities match the current situation.",
      "Contact the retrieval agent when you need focused background material—returning concise findings so your context stays clean.",
      "Contact the post-processing agent when the turn has produced world state to update or memory to maintain.",
      "Use historyMode `recent` by default, and use `scene` only when the continuity question depends on more of the current scene.",
      "",
    ].join("\n"),
  },
  {
    path: "agents/master/notes.md",
    content: "# Master Notes\n\n",
  },
  {
    path: "agents/retrieval/agent.json",
    content: agentConfigContent({
      id: "retrieval",
      title: "Retrieval Agent",
      summary: "A smart retrieval tool for the master agent. Finds the most relevant creation material from workspace and runtime state, returns concise findings.",
      contacts: ["master"],
      contextPaths: [
        "save/world/README.md",
        "save/memory/README.md",
      ],
      skills: {
        enabled: ["entity-reader"],
        disabled: [],
      },
      platformTools: {
        enabled: ["workspace_read", "workspace_semantic_search"],
        disabled: [],
      },
      workspaceAccess: {
        level: 1,
      },
    }),
  },
  {
    path: "agents/retrieval/AGENT.md",
    content: [
      "# Retrieval Agent",
      "",
      "You are a smart retrieval tool for the master agent, not an independent character.",
      "Given a retrieval intent, run multi-step workspace.search to find the most relevant content, then read and refine it.",
      "Use `read_entity` (the entity-reader Skill) instead of bare `read` when reading entity files—it auto-expands one level of `_ref`/`_dir` references so you get index.json plus direct children in one call.",
      "If the returned object still contains `_ref`/`_dir` markers and you need deeper detail, call `read_entity` again on that path.",
      "`semantic_search` recalls distant past events/lore by meaning when the player's words share no surface terms with the stored text (e.g. 玩家说\"灯塔的事\" but the text says \"她走向海边那座塔\"). It returns small-K candidates with path/type/preview—read the preview to judge, then `read` the chosen path for full text. `typeFilter` narrows the corpus: turn (raw narrative), agent-notes, or memory-summary.",
      "`search` is still the tool for exact wording or structural markers (a specific symbol, a JSON field). Use both in one turn when useful: semantic recall for candidates + literal search to verify details.",
      "When `semantic_search` returns empty (index not built or nothing relevant), fall back to `search`.",
      "Only return refined conclusions—what the master agent needs to know, not raw file dumps.",
      "Navigate by entity id (directory names) and tags anchors; rely on semantic search rather than a pre-built relationship graph.",
      "Keep durable identity and work style in `SOUL.md`.",
      "",
    ].join("\n"),
  },
  {
    path: "agents/retrieval/SOUL.md",
    content: [
      "# Retrieval Agent Soul",
      "",
      "You are a retrieval specialist that saves the master agent's context window.",
      "Return only refined, concise findings. Use `read_entity` to read entities—one call gets one level of complete data.",
      "",
    ].join("\n"),
  },
  {
    path: "agents/retrieval/notes.md",
    content: "# Retrieval Notes\n\n",
  },
  {
    path: "agents/post-processing/agent.json",
    content: agentConfigContent({
      id: "post-processing",
      title: "Post-Processing Agent",
      summary: "A post-processing tool for the master agent. Maintains world state and governs memory.",
      contacts: ["master"],
      contextPaths: [
        "save/world/README.md",
        "save/history/README.md",
        "save/memory/README.md",
      ],
      skills: {
        enabled: ["world-state-maintenance"],
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
    path: "agents/post-processing/AGENT.md",
    content: [
      "# Post-Processing Agent",
      "",
      "You are a post-processing tool for the master agent, responsible for maintaining world state and governing memory.",
      "Each turn: update involved entity state—write to the agreed location (index.json field, agreed file, or agreed subdirectory).",
      "Render-contract data (attributes/status/inventory etc. that the frontend renders with a fixed shape) must keep the game-card-agreed fixed format and location—frontend code depends on the exact shape and position. Format and location are agreed by the game-card author in schema README / agent definitions / skills; you must follow them.",
      "Semantic data (description/journal etc. agent-facing only) may be organized flexibly, including `_ref`/`_dir` upgrades.",
      "Relationships exist implicitly in entity descriptions; update them there. If the game-card author has set up an explicit `relationships.json`, update it too when relationships change.",
      "Periodically (not every turn): update `current.md`, `timeline.md`, `long-term.md` (cognitive folding—folding the turn stream into increasingly abstract memory layers).",
      "Use the world-state-maintenance Skill for writes. Entity state files are small (one entity per file), so full-file `write` is usually fine. For larger files (long markdown, big JSON), prefer `edit` (localized string replacement) to avoid regenerating the whole file.",
      "Keep durable identity and work style in `SOUL.md`.",
      "",
    ].join("\n"),
  },
  {
    path: "agents/post-processing/SOUL.md",
    content: [
      "# Post-Processing Agent Soul",
      "",
      "You maintain world state and govern memory.",
      "Keep render-contract data in its agreed fixed shape and location.",
      "Perform cognitive folding: derive reflection (summaries/timeline) and experience (world entities) from the turn stream.",
      "",
    ].join("\n"),
  },
  {
    path: "agents/post-processing/notes.md",
    content: "# Post-Processing Notes\n\n",
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
  },
  {
    path: "skills/entity-reader/SKILL.md",
    content: ENTITY_READER_SKILL_MD,
  },
  {
    path: "skills/entity-reader/scripts/read-entity.js",
    content: ENTITY_READER_SCRIPT_JS,
  },
  {
    path: "skills/world-state-maintenance/SKILL.md",
    content: WORLD_STATE_MAINTENANCE_SKILL_MD,
  },
  {
    path: "skills/world-state-maintenance/scripts/apply-world-state-plan.js",
    content: WORLD_STATE_MAINTENANCE_SCRIPT_JS,
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
    path: "world/README.md",
    content: [
      "# World",
      "",
      "Store world facts, rules, entities (characters, locations, ...), relationships, and structured state here.",
      "This README is both the schema specification and the template/paradigm reference for new authors.",
      "",
      "## Entity Organization: One Entity Per Directory",
      "",
      "Each entity is a directory, not a single file. The directory name is the entity `id`.",
      "Every entity directory has an `index.json` as its fixed entry point, holding the entity's main information.",
      "",
      "```",
      "save/world/",
      "  characters/",
      "    README.md          # format spec for this entity type",
      "    李四/               # one entity per directory, dir name = id",
      "      index.json        # fixed entry point",
      "      inventory.json    # optional sub-file (when inventory needs more detail)",
      "    王五/",
      "      index.json",
      "  locations/",
      "    README.md",
      "    凌烟阁/",
      "      index.json",
      "```",
      "",
      "## Granularity Upgrade: `_ref` / `_dir` Markers",
      "",
      "When a field in `index.json` grows complex, it can be upgraded to a sub-file or sub-directory.",
      "The `entity-reader` Skill's `read_entity` action auto-expands **one level** of these markers:",
      "",
      "- `{ \"_ref\": \"filename\" }` — detail is in a sibling file (full content, usually array or object).",
      "- `{ \"_dir\": \"dirname/\" }` — detail is in a sibling sub-directory (one file per entry, file name = entry id).",
      "- No marker → the field value is inline and complete.",
      "",
      "`_ref`/`_dir` are **position markers only**—they do not determine whether data is a render-contract or semantic.",
      "",
      "## Render-Contract vs Semantic Data (Key Distinction)",
      "",
      "Entity data falls into two categories. The distinction is **whether the format is fixed + frontend depends on it**, not \"inline vs upgraded\":",
      "",
      "**Render-contract data (frontend renders with fixed shape)**:",
      "- Frontend code needs the exact shape to render reliably.",
      "- **Format is fixed** (agreed by the game-card author) but **location is flexible**: can be an index.json field, a `_ref` file, a `_dir` sub-directory, or a mix.",
      "- The game-card author agrees the format and location, then constrains the post-processing agent (via AGENT.md / Skill) to always write in that shape and location.",
      "- The platform does not enforce this—it is an internal game-card contract; frontend code and agent definitions are controlled by the same author, aligned at both ends.",
      "",
      "**Semantic data (agent-facing, flexible)**:",
      "- Agent / retrieval relies on semantic search and can handle flexible structure.",
      "- Format is flexible; can be upgraded (`_ref`/`_dir`) as complexity grows.",
      "- No frontend dependency—frontend does not read this data.",
      "",
      "When the same concept needs both fixed frontend rendering and rich semantic detail, you may split it into a render-contract part (fixed shape) + a semantic part (flexible). But you don't have to—if the fixed shape is enough for the agent, no extra semantic part is needed.",
      "",
      "## Default Entity Categories",
      "",
      "Only `characters/` and `locations/` are demonstrated by default—almost every world setting has them.",
      "Other categories (techniques, arts, items, factions, ...) are **not included in the default structure** because:",
      "- Naming collision: `skills/` is already used by Agent Skills (`skills/<skill>/SKILL.md`).",
      "- World settings vary widely: different settings have different names, presence, and organization for these things.",
      "- The default schema's job is to demonstrate **how to organize**, not to enumerate **what to organize**.",
      "",
      "## Extending Entity Categories",
      "",
      "Authors can add new entity type directories (e.g. `techniques/`, `arts/`, `items/`, `factions/`).",
      "Just add a `README.md` explaining the format. Use directory names that do not collide with Agent Skill `skills/`.",
      "Categories can also be removed—if a world setting has no locations, delete `locations/`.",
      "",
      "### Optional: Relationship Graph",
      "",
      "Relationships exist implicitly via natural-language mentions in entity `description` fields—the retrieval agent finds them through semantic search without a pre-built graph.",
      "If your world needs an explicit, centralized relationship graph (e.g. complex faction networks), you may add a `relationships.json` file:",
      "```json",
      "[",
      "  { \"from\": \"李四\", \"to\": \"王五\", \"type\": \"对手\", \"description\": \"因旧怨结为对手\", \"since\": 3, \"lastUpdated\": 42 }",
      "]",
      "```",
      "This is optional. The post-processing agent only maintains it if the game-card author instructs it to (via AGENT.md / Skill).",
      "",
      "### Optional: World Rules",
      "",
      "World rules can live implicitly in `canon.md` (natural language)—the retrieval agent finds them through semantic search.",
      "If your world needs a separate, structured rules file (e.g. a cultivation system, combat rules), you may add a `rules.md`.",
      "This is optional, just like `relationships.json`.",
      "",
      "## Retrieval Convention",
      "",
      "The retrieval agent uses `workspace.search` (semantic) + entity id (directory names) and tags anchors to navigate.",
      "No pre-built global index is needed—`workspace.search` is semantic retrieval; directory names, tags, and `summary` fields are anchors; `description` fields are semantic match material.",
      "Use `read_entity` (entity-reader Skill) to read entities—it auto-expands one level of `_ref`/`_dir`.",
      "",
      "## Frontend Convention",
      "",
      "The frontend reads render-contract data at the agreed fixed location and format (the author hardcodes the read paths in frontend code).",
      "The frontend does not do generic `_ref`/`_dir` parsing—it reads directly at the agreed paths.",
      "Pure frontend UI state (active tabs, expanded panels) goes in `save/frontend/view-state.json`; the platform does not interpret it.",
      "",
    ].join("\n"),
  },
  {
    path: "world/canon.md",
    content: "# Canon\n\n",
  },
  {
    path: "world/characters/README.md",
    content: [
      "# Characters",
      "",
      "Each character is a directory under `characters/`. The directory name is the character `id`.",
      "Every character directory has an `index.json` as the fixed entry point.",
      "",
      "## index.json Format (simple — all inline)",
      "",
      "```json",
      "{",
      "  \"id\": \"李四\",",
      "  \"type\": \"character\",",
      "  \"tags\": [\"主角\", \"剑修\", \"凌烟阁\"],",
      "  \"summary\": \"年轻的剑客，师承令狐冲，目前在凌烟阁修行。\",",
      "  \"description\": \"李四是江南李家的独子，自幼拜入令狐冲门下……\",",
      "  \"attributes\": { \"境界\": \"筑基后期\", \"气血\": 85, \"气血上限\": 100, \"攻击\": 42 },",
      "  \"status\": \"正在凌烟阁闭关\",",
      "  \"inventory\": [",
      "    { \"name\": \"回血丹\", \"effect\": \"恢复30气血\", \"count\": 2 },",
      "    { \"name\": \"青锋剑\", \"effect\": \"攻击+15\", \"count\": 1 }",
      "  ],",
      "  \"firstAppeared\": 1,",
      "  \"lastUpdated\": 42",
      "}",
      "```",
      "",
      "## Field Conventions",
      "",
      "- `id`: primary key, = directory name. Navigation anchor.",
      "- `type`: entity type (always `\"character\"` here). Free text, extensible.",
      "- `tags`: fuzzy aggregation anchors (scene/faction/theme). Optional.",
      "- `summary`: one-line refined summary. retrieval can read just this to decide if full read is needed. [semantic]",
      "- `description`: natural language为主. Relationships exist implicitly via natural-language mentions. [semantic, can be upgraded]",
      "- `attributes`: key-value pairs, fixed structure. Frontend status bar renders directly + agent references. Key names are free, follow world setting, but once agreed keep fixed format. [render-contract]",
      "- `status`: current status text string. Frontend status bar + agent shared. [render-contract]",
      "- `inventory`: item array, fixed structure (e.g. `[{name, count, effect}]`). Frontend inventory bar renders. Specific fields agreed by author, keep fixed once agreed. [render-contract]",
      "- `firstAppeared`/`lastUpdated`: recency anchors (turn number). [semantic]",
      "- Extension fields allowed (additionalFields opt-in). New fields self-declare render-contract vs semantic.",
      "",
      "Note: do not use the field name `skills` to avoid confusion with Agent Skill concept. Use `knownTechniques`, `abilities`, etc. as the world setting dictates.",
      "",
      "## Upgrading to Sub-file / Sub-directory",
      "",
      "When `inventory` needs richer detail (lore, source, durability), upgrade to a sibling file:",
      "",
      "```json",
      "// index.json",
      "{ \"id\": \"李四\", ..., \"inventory\": { \"_ref\": \"inventory.json\" }, ... }",
      "",
      "// inventory.json",
      "[",
      "  { \"name\": \"回血丹\", \"effect\": \"恢复30气血\", \"count\": 2, \"description\": \"以百年灵草炼制……\", \"source\": \"令狐冲所赠\" }",
      "]",
      "```",
      "",
      "When items are numerous and each needs an independent file, upgrade to a sub-directory:",
      "",
      "```json",
      "// index.json",
      "{ \"id\": \"李四\", ..., \"inventory\": { \"_dir\": \"inventory/\" }, ... }",
      "",
      "// inventory/回血丹.json",
      "{ \"name\": \"回血丹\", \"effect\": \"恢复30气血\", \"count\": 2 }",
      "```",
      "",
      "`_ref`/`_dir` are position markers only. A render-contract field can also be a `_ref` file or `_dir` directory—as long as the format is fixed and the author constrains post-processing to write there.",
      "",
      "## Frontend Convention",
      "",
      "- Status bar: read `attributes` (fixed key-value) + `status` (fixed string) from index.json.",
      "- Inventory bar: read `inventory` at the agreed location (inline field, `_ref` file, or `_dir` directory—author hardcodes the path).",
      "- The frontend reads render-contract data at agreed fixed paths directly, no generic `_ref`/`_dir` parsing.",
      "- The author constrains post-processing (via AGENT.md / Skill) to keep render-contract data in the agreed fixed shape and location.",
      "",
    ].join("\n"),
  },
  {
    path: "world/locations/README.md",
    content: [
      "# Locations",
      "",
      "Each location is a directory under `locations/`. The directory name is the location `id`.",
      "Every location directory has an `index.json` as the fixed entry point.",
      "",
      "## index.json Format (example)",
      "",
      "```json",
      "{",
      "  \"id\": \"凌烟阁\",",
      "  \"type\": \"location\",",
      "  \"tags\": [\"修仙门派\", \"山巅\"],",
      "  \"summary\": \"坐落于天柱峰巅的修仙门派，以剑道闻名。\",",
      "  \"description\": \"凌烟阁依山而建，云雾缭绕……\",",
      "  \"attributes\": { \"势力\": \"正道\", \"规模\": \"中型\" },",
      "  \"status\": \"太平\",",
      "  \"firstAppeared\": 1,",
      "  \"lastUpdated\": 42",
      "}",
      "```",
      "",
      "Field conventions follow the same pattern as characters (see `characters/README.md`).",
      "Extension fields and `_ref`/`_dir` upgrades work the same way.",
      "",
    ].join("\n"),
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
      "Summary files (e.g. `summaries/current.md`, `summaries/long-term.md`) are created on demand by the memory-maintenance Skill.",
      "",
    ].join("\n"),
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
  "agents/retrieval/notes.md",
  "agents/post-processing/notes.md",
  "history/README.md",
  "history/turns/README.md",
  "memory/README.md",
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
    path: "save/agents/retrieval/notes.md",
    content: "# Retrieval Notes\n\n",
  },
  {
    path: "save/agents/post-processing/notes.md",
    content: "# Post-Processing Notes\n\n",
  },
  {
    path: "save/history/README.md",
    content: [
      "# History",
      "",
      "Keep this playthrough's durable conversation records and timeline summaries here.",
      "Raw player-facing AIRP turns are stored under `save/history/turns/` as one JSON file per successful turn.",
      "A `timeline.md` summary may be created on demand by the memory-maintenance Skill—it is not pre-created.",
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
    path: "save/world/README.md",
    content: [
      "# Runtime World Data",
      "",
      "Generated characters, locations, relationships, and other playthrough world state live here.",
      "Card-owned world canon, rules, and schema documentation live outside `save/` (see `world/README.md`).",
      "",
      "Entities follow the one-entity-per-directory model with `index.json` entry points.",
      "See `world/README.md` (card content) for the full schema specification and conventions.",
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
      "Summary files (e.g. `summaries/current.md`, `summaries/long-term.md`) are created on demand by the memory-maintenance Skill—",
      "they are not pre-created as empty files.",
      "",
    ].join("\n"),
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

function normalizeDirectoryPath(value: unknown): string {
  const result = normalizeWorkspacePath(value ?? "", {
    allowEmpty: true,
    rejectTrailingSlash: false,
  })
  if (!result.ok) {
    throw new WorkspaceStorageError(result.code, result.message)
  }
  return result.path
}

export function normalizeWorkspaceFilePath(value: unknown): string {
  const result = normalizeWorkspacePath(value, {
    allowEmpty: false,
    rejectTrailingSlash: true,
  })
  if (!result.ok) {
    throw new WorkspaceStorageError(result.code, result.message)
  }
  return result.path
}

function normalizeWorkspaceTargetPath(value: unknown): string {
  const result = normalizeWorkspacePath(value, {
    allowEmpty: false,
    rejectTrailingSlash: false,
  })
  if (!result.ok) {
    throw new WorkspaceStorageError(result.code, result.message)
  }
  return result.path
}

function toContentFile(file: {
  path: string
  content: string
}): GameCardContentFile {
  const path = normalizeWorkspaceFilePath(file.path)
  return {
    path,
    content: file.content,
    mediaType: inferMediaTypeFromPath(path, { fallback: "text/plain" }),
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
  if (record.data) {
    return {
      path: record.path,
      // Binary files surface a placeholder string (not "") so agents do not
      // misjudge the file as empty. Future multimodal support will replace
      // this with an image content block through an independent channel.
      content: binaryPlaceholderText(record.data, record.path),
      binary: record.data,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    }
  }
  return {
    path: record.path,
    content: record.content,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  }
}

export function toWorkspaceFileFromGameCardContent(
  file: LocalGameCardContentFile,
): WorkspaceFile {
  const path = normalizeWorkspaceFilePath(file.path)
  if (file.data) {
    return {
      path,
      content: binaryPlaceholderText(file.data, path),
      binary: file.data,
      createdAt: file.createdAt,
      updatedAt: file.updatedAt,
    }
  }
  return {
    path,
    content: typeof file.content === "string" ? file.content : "",
    createdAt: file.createdAt,
    updatedAt: file.updatedAt,
  }
}

function cloneWorkspaceFile(file: WorkspaceFile): WorkspaceFile {
  return {
    path: file.path,
    content: file.content,
    ...(file.binary ? { binary: file.binary } : {}),
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
    ...(file.data ? { data: file.data } : {}),
    createdAt: typeof file.createdAt === "number" ? file.createdAt : Date.now(),
    updatedAt: typeof file.updatedAt === "number" ? file.updatedAt : Date.now(),
  }
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
        createdAt: now,
        updatedAt: now,
      })
    }

    await localDb.workspaceFiles.put({
      id: createTableId(saveId, WORKSPACE_MANIFEST_PATH),
      saveId,
      path: WORKSPACE_MANIFEST_PATH,
      content: serializeWorkspaceManifest(manifest?.content),
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
        ...(file.data ? { data: file.data } : {}),
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

  // 前端文件（card-frontend，纯二进制存储）只读接入 effective list。与
  // cardFrontendVolume.enumerate 同构（storage 层不依赖 host 层 volume，直接用原生
  // API）。文本类前端文件（html/css/js/json/svg）→ await data.text() 填 content；
  // 媒体类（图片/音视频）→ binary + placeholder。write/delete 路径经 host 层 dispatch
  // 走 volume，待子3 补单文件 API。
  for (const frontendFile of await listLocalGameCardFrontendFiles(card.id)) {
    const mediaType = inferMediaTypeFromPath(frontendFile.path)
    if (isTextMediaType(mediaType) || mediaType === "image/svg+xml") {
      filesByPath.set(frontendFile.path, {
        path: frontendFile.path,
        content: await frontendFile.data.text(),
        createdAt: frontendFile.createdAt,
        updatedAt: frontendFile.updatedAt,
      })
    } else {
      filesByPath.set(frontendFile.path, {
        path: frontendFile.path,
        content: binaryPlaceholderText(frontendFile.data, frontendFile.path),
        binary: frontendFile.data,
        createdAt: frontendFile.createdAt,
        updatedAt: frontendFile.updatedAt,
      })
    }
  }

  // 合成 manifest 文件（game-card.json，不存表，list 时 JSON.stringify 注入）。
  // 与 manifestVolume.enumerate 同构（storage 层不依赖 host 层 volume，直接合成）。
  filesByPath.set("game-card.json", {
    path: "game-card.json",
    content: JSON.stringify(normalizeGameCardManifest(card.manifest), null, 2),
    createdAt: card.createdAt,
    updatedAt: card.updatedAt,
  })

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
      ...(file.binary ? { data: file.binary } : {}),
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
        size: file.binary?.size ?? file.content.length,
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

  const isTextContent = typeof input.content === "string"
  const binaryData = input.data instanceof Blob ? input.data : undefined
  if (!isTextContent && !binaryData) {
    throw new WorkspaceStorageError(
      "WORKSPACE_CONTENT_REQUIRED",
      "Workspace file write requires either content (string) or data (Blob).",
    )
  }

  const now = Date.now()
  const existingIndex = workspaceFiles.findIndex((file) => file.path === path)
  const existing = existingIndex >= 0 ? workspaceFiles[existingIndex] : undefined
  const nextFile: WorkspaceFile = binaryData
    ? {
        path,
        content: binaryPlaceholderText(binaryData, path),
        binary: binaryData,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      }
    : {
        path,
        content: input.content as string,
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

  const isTextContent = typeof input.content === "string"
  const binaryData = input.data instanceof Blob ? input.data : undefined
  if (!isTextContent && !binaryData) {
    throw new WorkspaceStorageError(
      "WORKSPACE_CONTENT_REQUIRED",
      "Workspace file write requires either content (string) or data (Blob).",
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
      content: isTextContent ? (input.content as string) : "",
      ...(binaryData ? { data: binaryData } : {}),
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
