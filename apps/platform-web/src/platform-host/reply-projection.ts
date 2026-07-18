import type { JsonValue, WorkspaceFile } from "@tsian/contracts"
import { readWorkspaceFileFromFiles } from "../storage"

export const REPLY_PROJECTION_CONFIG_PATH = "config/reply-projection.json"
export const REPLY_PROJECTION_SCHEMA = "tsian.reply-projection.v1"

export type ReplyProjectionDiagnosticScope = "config" | "rule"

export interface ReplyProjectionDiagnostic {
  scope: ReplyProjectionDiagnosticScope
  code: string
  message: string
  path?: string
  ruleId?: string
  ruleIndex?: number
}

export interface ReplyProjectionResult {
  content: string
  displayContent?: string
  projections?: Record<string, JsonValue>
  diagnostics: ReplyProjectionDiagnostic[]
  configPresent: boolean
  ruleCount: number
  appliedRuleCount: number
}

interface ReplyProjectionRule {
  id?: unknown
  match?: unknown
  text?: unknown
  content?: unknown
  display?: unknown
  project?: unknown
}

interface ParsedRule {
  id: string
  index: number
  regex: RegExp
  text?: string
  content?: string
  display?: string
  project?: Record<string, string>
}

type ProjectionValue = string | string[]

const OPTION_LINE_RE = /^\s*[-*+][\s.)]+\s*|^\s*\d+\.\s+/
const VALID_REGEX_FLAGS_RE = /^[dgimsuvy]*$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function toJsonValue(value: ProjectionValue): JsonValue {
  return Array.isArray(value) ? value : value
}

function configDiagnostic(code: string, message: string): ReplyProjectionDiagnostic {
  return {
    scope: "config",
    code,
    message,
    path: REPLY_PROJECTION_CONFIG_PATH,
  }
}

function ruleDiagnostic(
  code: string,
  message: string,
  ruleId: string,
  ruleIndex: number,
): ReplyProjectionDiagnostic {
  return {
    scope: "rule",
    code,
    message,
    path: REPLY_PROJECTION_CONFIG_PATH,
    ruleId,
    ruleIndex,
  }
}

function parseRegexLiteral(input: string): RegExp {
  if (!input.startsWith("/")) {
    throw new Error("match must be a JavaScript regex literal string such as /pattern/g.")
  }

  let escaped = false
  let closingIndex = -1
  for (let index = 1; index < input.length; index += 1) {
    const char = input[index]
    if (escaped) {
      escaped = false
      continue
    }
    if (char === "\\") {
      escaped = true
      continue
    }
    if (char === "/") {
      closingIndex = index
      break
    }
  }

  if (closingIndex <= 0) {
    throw new Error("match regex literal is missing a closing slash.")
  }

  const source = input.slice(1, closingIndex)
  const flags = input.slice(closingIndex + 1)
  if (!VALID_REGEX_FLAGS_RE.test(flags)) {
    throw new Error("match regex literal contains invalid flags.")
  }
  if (new Set(flags).size !== flags.length) {
    throw new Error("match regex literal contains duplicate flags.")
  }

  return new RegExp(source, flags)
}

function safeRuleId(rule: ReplyProjectionRule, index: number): string {
  return typeof rule.id === "string" && rule.id.trim()
    ? rule.id.trim()
    : `rule-${index + 1}`
}

function parseProject(value: unknown, ruleId: string, ruleIndex: number, diagnostics: ReplyProjectionDiagnostic[]): Record<string, string> | undefined {
  if (value === undefined) {
    return undefined
  }
  if (!isRecord(value)) {
    diagnostics.push(ruleDiagnostic(
      "REPLY_PROJECTION_PROJECT_INVALID",
      "project must be an object mapping projection keys to value-pipe strings.",
      ruleId,
      ruleIndex,
    ))
    return undefined
  }

  const project: Record<string, string> = {}
  for (const [key, expression] of Object.entries(value)) {
    const projectionKey = key.trim()
    if (!projectionKey) {
      diagnostics.push(ruleDiagnostic(
        "REPLY_PROJECTION_PROJECT_KEY_INVALID",
        "project keys must be non-empty strings.",
        ruleId,
        ruleIndex,
      ))
      continue
    }
    if (typeof expression !== "string") {
      diagnostics.push(ruleDiagnostic(
        "REPLY_PROJECTION_PROJECT_VALUE_INVALID",
        "project values must be value-pipe strings.",
        ruleId,
        ruleIndex,
      ))
      continue
    }
    project[projectionKey] = expression
  }

  return Object.keys(project).length > 0 ? project : undefined
}

function parseRules(config: Record<string, unknown>, diagnostics: ReplyProjectionDiagnostic[]): ParsedRule[] | null {
  if (config.schema !== REPLY_PROJECTION_SCHEMA) {
    diagnostics.push(configDiagnostic(
      "REPLY_PROJECTION_SCHEMA_INVALID",
      `reply projection config schema must be ${REPLY_PROJECTION_SCHEMA}.`,
    ))
    return null
  }

  if (!Array.isArray(config.rules)) {
    diagnostics.push(configDiagnostic(
      "REPLY_PROJECTION_RULES_INVALID",
      "reply projection config must contain a rules array.",
    ))
    return null
  }

  const parsedRules: ParsedRule[] = []
  for (const [index, rawRule] of config.rules.entries()) {
    if (!isRecord(rawRule)) {
      diagnostics.push(ruleDiagnostic(
        "REPLY_PROJECTION_RULE_INVALID",
        "rule must be an object.",
        `rule-${index + 1}`,
        index,
      ))
      continue
    }

    const rule = rawRule as ReplyProjectionRule
    const ruleId = safeRuleId(rule, index)
    if (typeof rule.match !== "string" || !rule.match.trim()) {
      diagnostics.push(ruleDiagnostic(
        "REPLY_PROJECTION_MATCH_INVALID",
        "rule.match must be a non-empty regex literal string.",
        ruleId,
        index,
      ))
      continue
    }

    let regex: RegExp
    try {
      regex = parseRegexLiteral(rule.match)
    } catch (error) {
      diagnostics.push(ruleDiagnostic(
        "REPLY_PROJECTION_REGEX_INVALID",
        error instanceof Error ? error.message : "rule.match is not a valid regex literal.",
        ruleId,
        index,
      ))
      continue
    }

    const hasText = rule.text !== undefined
    const hasContent = rule.content !== undefined
    const hasDisplay = rule.display !== undefined
    if (hasText && (hasContent || hasDisplay)) {
      diagnostics.push(ruleDiagnostic(
        "REPLY_PROJECTION_REPLACEMENT_GROUP_INVALID",
        "rule.text cannot be combined with rule.content or rule.display.",
        ruleId,
        index,
      ))
      continue
    }

    if (hasText && typeof rule.text !== "string") {
      diagnostics.push(ruleDiagnostic(
        "REPLY_PROJECTION_REPLACEMENT_INVALID",
        "rule.text must be a string when provided.",
        ruleId,
        index,
      ))
      continue
    }
    if (hasContent && typeof rule.content !== "string") {
      diagnostics.push(ruleDiagnostic(
        "REPLY_PROJECTION_REPLACEMENT_INVALID",
        "rule.content must be a string when provided.",
        ruleId,
        index,
      ))
      continue
    }
    if (hasDisplay && typeof rule.display !== "string") {
      diagnostics.push(ruleDiagnostic(
        "REPLY_PROJECTION_REPLACEMENT_INVALID",
        "rule.display must be a string when provided.",
        ruleId,
        index,
      ))
      continue
    }

    const project = parseProject(rule.project, ruleId, index, diagnostics)
    parsedRules.push({
      id: ruleId,
      index,
      regex,
      ...(typeof rule.text === "string" ? { text: rule.text } : {}),
      ...(typeof rule.content === "string" ? { content: rule.content } : {}),
      ...(typeof rule.display === "string" ? { display: rule.display } : {}),
      ...(project ? { project } : {}),
    })
  }

  return parsedRules
}

function cloneRegex(regex: RegExp): RegExp {
  return new RegExp(regex.source, regex.flags)
}

function listMatches(regex: RegExp, content: string): RegExpExecArray[] {
  const re = cloneRegex(regex)
  const matches: RegExpExecArray[] = []
  if (!re.global) {
    const match = re.exec(content)
    return match ? [match] : []
  }

  let match: RegExpExecArray | null
  while ((match = re.exec(content)) !== null) {
    matches.push(match)
    if (match[0] === "") {
      re.lastIndex += 1
    }
  }
  return matches
}

function expandMatchReference(expression: string, match: RegExpExecArray): string {
  return expression.replace(/\$(?:<([A-Za-z][A-Za-z0-9_]*)>|(\d+)|[&0])/g, (token: string, name: string | undefined, index: string | undefined) => {
    if (token === "$&" || token === "$0") {
      return match[0] ?? ""
    }
    if (name) {
      const groups = (match as RegExpExecArray & { groups?: Record<string, string> }).groups
      return groups?.[name] ?? ""
    }
    if (index) {
      return match[Number(index)] ?? ""
    }
    return ""
  })
}

function stripList(value: ProjectionValue): string[] {
  const lines = (Array.isArray(value) ? value : value.split(/\r?\n/))
    .flatMap((line) => String(line).split(/\r?\n/))
    .map((line) => line.trim())
    .filter((line) => line !== "")
  const hasListPrefix = lines.some((line) => OPTION_LINE_RE.test(line))
  const items: string[] = []
  for (const line of lines) {
    const prefixMatch = line.match(OPTION_LINE_RE)
    if (hasListPrefix) {
      if (prefixMatch) {
        const item = line.slice(prefixMatch[0].length).trim()
        if (item) items.push(item)
      } else if (items.length > 0) {
        items[items.length - 1] = `${items[items.length - 1]}\n${line}`
      }
    } else {
      items.push(line)
    }
  }
  return items
}

function applyTransform(transform: string, value: ProjectionValue): ProjectionValue {
  if (transform === "trim") {
    return Array.isArray(value) ? value.map((item) => item.trim()) : value.trim()
  }
  if (transform === "lines") {
    return (Array.isArray(value)
      ? value.flatMap((item) => item.split(/\r?\n/))
      : value.split(/\r?\n/))
      .map((line) => line.trim())
      .filter((line) => line !== "")
  }
  if (transform === "stripList") {
    return stripList(value)
  }
  throw new Error(`Unsupported projection transform: ${transform}`)
}

function evaluateProjectionExpression(
  expression: string,
  match: RegExpExecArray,
): ProjectionValue {
  const parts = expression.split("|").map((part) => part.trim())
  let value: ProjectionValue = expandMatchReference(parts[0] ?? "", match)
  for (const transform of parts.slice(1)) {
    if (!transform) continue
    value = applyTransform(transform, value)
  }
  return value
}

function assignProjectionValue(
  projections: Record<string, JsonValue>,
  rawKey: string,
  value: ProjectionValue,
): void {
  const append = rawKey.endsWith("[]")
  const key = append ? rawKey.slice(0, -2).trim() : rawKey.trim()
  if (!key) {
    throw new Error("Projection key must be non-empty.")
  }
  const jsonValue = toJsonValue(value)
  if (!append) {
    projections[key] = jsonValue
    return
  }

  const existing = projections[key]
  const next = Array.isArray(existing) ? [...existing] : []
  if (Array.isArray(jsonValue)) {
    next.push(...jsonValue)
  } else {
    next.push(jsonValue)
  }
  projections[key] = next
}

function applyRule(
  rule: ParsedRule,
  lanes: { content: string; display: string; projections: Record<string, JsonValue> },
  diagnostics: ReplyProjectionDiagnostic[],
): boolean {
  const matches = rule.project ? listMatches(rule.regex, lanes.content) : []
  let applied = matches.length > 0

  if (rule.project) {
    for (const match of matches) {
      for (const [key, expression] of Object.entries(rule.project)) {
        try {
          const value = evaluateProjectionExpression(expression, match)
          assignProjectionValue(lanes.projections, key, value)
        } catch (error) {
          diagnostics.push(ruleDiagnostic(
            "REPLY_PROJECTION_VALUE_PIPE_FAILED",
            error instanceof Error ? error.message : "Projection value pipe failed.",
            rule.id,
            rule.index,
          ))
        }
      }
    }
  }

  try {
    if (rule.text !== undefined) {
      const nextContent = lanes.content.replace(cloneRegex(rule.regex), rule.text)
      const nextDisplay = lanes.display.replace(cloneRegex(rule.regex), rule.text)
      applied = applied || nextContent !== lanes.content || nextDisplay !== lanes.display
      lanes.content = nextContent
      lanes.display = nextDisplay
    } else {
      if (rule.content !== undefined) {
        const nextContent = lanes.content.replace(cloneRegex(rule.regex), rule.content)
        applied = applied || nextContent !== lanes.content
        lanes.content = nextContent
      }
      if (rule.display !== undefined) {
        const nextDisplay = lanes.display.replace(cloneRegex(rule.regex), rule.display)
        applied = applied || nextDisplay !== lanes.display
        lanes.display = nextDisplay
      }
    }
  } catch (error) {
    diagnostics.push(ruleDiagnostic(
      "REPLY_PROJECTION_REPLACEMENT_FAILED",
      error instanceof Error ? error.message : "Projection replacement failed.",
      rule.id,
      rule.index,
    ))
  }

  return applied
}

export function projectAssistantReply(
  rawReply: string,
  workspaceFiles: WorkspaceFile[],
): ReplyProjectionResult {
  const configFile = readWorkspaceFileFromFiles(workspaceFiles, REPLY_PROJECTION_CONFIG_PATH)
  if (!configFile) {
    return {
      content: rawReply,
      diagnostics: [],
      configPresent: false,
      ruleCount: 0,
      appliedRuleCount: 0,
    }
  }

  const diagnostics: ReplyProjectionDiagnostic[] = []
  let parsedConfig: unknown
  try {
    parsedConfig = JSON.parse(configFile.content)
  } catch {
    diagnostics.push(configDiagnostic(
      "REPLY_PROJECTION_CONFIG_JSON_INVALID",
      "reply projection config is not valid JSON.",
    ))
    return {
      content: rawReply,
      diagnostics,
      configPresent: true,
      ruleCount: 0,
      appliedRuleCount: 0,
    }
  }

  if (!isRecord(parsedConfig)) {
    diagnostics.push(configDiagnostic(
      "REPLY_PROJECTION_CONFIG_INVALID",
      "reply projection config must be a JSON object.",
    ))
    return {
      content: rawReply,
      diagnostics,
      configPresent: true,
      ruleCount: 0,
      appliedRuleCount: 0,
    }
  }

  const rules = parseRules(parsedConfig, diagnostics)
  if (!rules) {
    return {
      content: rawReply,
      diagnostics,
      configPresent: true,
      ruleCount: 0,
      appliedRuleCount: 0,
    }
  }

  const lanes = {
    content: rawReply,
    display: rawReply,
    projections: {} as Record<string, JsonValue>,
  }
  let appliedRuleCount = 0
  for (const rule of rules) {
    if (applyRule(rule, lanes, diagnostics)) {
      appliedRuleCount += 1
    }
  }

  const projections = Object.keys(lanes.projections).length > 0 ? lanes.projections : undefined
  return {
    content: lanes.content,
    ...(lanes.display !== lanes.content ? { displayContent: lanes.display } : {}),
    ...(projections ? { projections } : {}),
    diagnostics,
    configPresent: true,
    ruleCount: Array.isArray(parsedConfig.rules) ? parsedConfig.rules.length : rules.length,
    appliedRuleCount,
  }
}
