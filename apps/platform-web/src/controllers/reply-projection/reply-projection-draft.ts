import { REPLY_PROJECTION_SCHEMA } from "@/platform-host/reply-projection-constants"

export type ReplyProjectionReplacementMode = "none" | "text" | "split"

export interface ReplyProjectionProjectRowDraft {
  clientKey: string
  key: string
  expression: string
}

export interface ReplyProjectionRuleDraft {
  clientKey: string
  extras: Record<string, unknown>
  idPresent: boolean
  id: string
  match: string
  replacementMode: ReplyProjectionReplacementMode
  text: string
  contentPresent: boolean
  content: string
  displayPresent: boolean
  display: string
  projectPresent: boolean
  projectRows: ReplyProjectionProjectRowDraft[]
}

export interface ReplyProjectionDraft {
  topLevelExtras: Record<string, unknown>
  rules: ReplyProjectionRuleDraft[]
}

export type ReplyProjectionDraftParseResult =
  | { ok: true; draft: ReplyProjectionDraft }
  | { ok: false; reason: string }

export type ReplyProjectionDraftSerializeResult =
  | { ok: true; content: string }
  | { ok: false; reason: string }

const TOP_LEVEL_KEYS = new Set(["schema", "rules"])
const RULE_KEYS = new Set(["id", "match", "text", "content", "display", "project"])
let clientKeyCounter = 0

function nextClientKey(prefix: string): string {
  clientKeyCounter += 1
  return `${prefix}-${clientKeyCounter}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key)
}

function cloneJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(cloneJsonValue)
  if (!isRecord(value)) return value
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneJsonValue(item)]))
}

function extrasWithout(
  record: Record<string, unknown>,
  knownKeys: ReadonlySet<string>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(record)
      .filter(([key]) => !knownKeys.has(key))
      .map(([key, value]) => [key, cloneJsonValue(value)]),
  )
}

export function createReplyProjectionProjectRowDraft(
  input: Partial<Pick<ReplyProjectionProjectRowDraft, "key" | "expression">> = {},
): ReplyProjectionProjectRowDraft {
  return {
    clientKey: nextClientKey("project"),
    key: input.key ?? "",
    expression: input.expression ?? "",
  }
}

export function createReplyProjectionRuleDraft(index = 0): ReplyProjectionRuleDraft {
  return {
    clientKey: nextClientKey("rule"),
    extras: {},
    idPresent: true,
    id: `rule-${index + 1}`,
    match: "/pattern/g",
    replacementMode: "none",
    text: "",
    contentPresent: false,
    content: "",
    displayPresent: false,
    display: "",
    projectPresent: false,
    projectRows: [],
  }
}

export function createReplyProjectionDraft(): ReplyProjectionDraft {
  return { topLevelExtras: {}, rules: [] }
}

export function cloneReplyProjectionRuleDraft(
  rule: ReplyProjectionRuleDraft,
): ReplyProjectionRuleDraft {
  return {
    ...rule,
    clientKey: nextClientKey("rule"),
    extras: cloneJsonValue(rule.extras) as Record<string, unknown>,
    projectRows: rule.projectRows.map((row) => ({
      ...row,
      clientKey: nextClientKey("project"),
    })),
  }
}

export function parseReplyProjectionDraft(content: string): ReplyProjectionDraftParseResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? `配置不是有效的 JSON：${error.message}` : "配置不是有效的 JSON。",
    }
  }

  if (!isRecord(parsed)) {
    return { ok: false, reason: "配置顶层必须是对象。" }
  }
  if (parsed.schema !== REPLY_PROJECTION_SCHEMA) {
    return { ok: false, reason: "配置版本不受当前编辑器支持。" }
  }
  if (!Array.isArray(parsed.rules)) {
    return { ok: false, reason: "规则列表必须是数组。" }
  }

  const rules: ReplyProjectionRuleDraft[] = []
  for (let index = 0; index < parsed.rules.length; index += 1) {
    const source = parsed.rules[index]
    if (!isRecord(source)) {
      return { ok: false, reason: `第 ${index + 1} 条规则不是对象。` }
    }
    if (typeof source.match !== "string") {
      return { ok: false, reason: `第 ${index + 1} 条规则的 match 必须是字符串。` }
    }

    const idPresent = hasOwn(source, "id")
    if (idPresent && typeof source.id !== "string") {
      return { ok: false, reason: `第 ${index + 1} 条规则的 id 必须是字符串。` }
    }

    const textPresent = hasOwn(source, "text")
    const contentPresent = hasOwn(source, "content")
    const displayPresent = hasOwn(source, "display")
    for (const key of ["text", "content", "display"] as const) {
      if (hasOwn(source, key) && typeof source[key] !== "string") {
        return { ok: false, reason: `第 ${index + 1} 条规则的 ${key} 必须是字符串。` }
      }
    }
    if (textPresent && (contentPresent || displayPresent)) {
      return { ok: false, reason: `第 ${index + 1} 条规则同时包含互斥的文本替换字段。` }
    }

    const projectPresent = hasOwn(source, "project")
    const projectRows: ReplyProjectionProjectRowDraft[] = []
    if (projectPresent) {
      if (!isRecord(source.project)) {
        return { ok: false, reason: `第 ${index + 1} 条规则的数据投影必须是对象。` }
      }
      for (const [key, expression] of Object.entries(source.project)) {
        if (typeof expression !== "string") {
          return { ok: false, reason: `第 ${index + 1} 条规则的数据投影表达式必须是字符串。` }
        }
        projectRows.push(createReplyProjectionProjectRowDraft({ key, expression }))
      }
    }

    rules.push({
      clientKey: nextClientKey("rule"),
      extras: extrasWithout(source, RULE_KEYS),
      idPresent,
      id: idPresent ? source.id as string : "",
      match: source.match,
      replacementMode: textPresent ? "text" : contentPresent || displayPresent ? "split" : "none",
      text: textPresent ? source.text as string : "",
      contentPresent,
      content: contentPresent ? source.content as string : "",
      displayPresent,
      display: displayPresent ? source.display as string : "",
      projectPresent,
      projectRows,
    })
  }

  return {
    ok: true,
    draft: {
      topLevelExtras: extrasWithout(parsed, TOP_LEVEL_KEYS),
      rules,
    },
  }
}

export function serializeReplyProjectionDraft(
  draft: ReplyProjectionDraft,
): ReplyProjectionDraftSerializeResult {
  const rules: Record<string, unknown>[] = []
  for (let index = 0; index < draft.rules.length; index += 1) {
    const source = draft.rules[index]
    const rule: Record<string, unknown> = {
      ...cloneJsonValue(source.extras) as Record<string, unknown>,
      ...(source.idPresent ? { id: source.id } : {}),
      match: source.match,
    }

    if (source.replacementMode === "text") {
      rule.text = source.text
    } else if (source.replacementMode === "split") {
      if (source.contentPresent) rule.content = source.content
      if (source.displayPresent) rule.display = source.display
    }

    if (source.projectPresent) {
      const project = Object.create(null) as Record<string, string>
      for (const row of source.projectRows) {
        if (hasOwn(project, row.key)) {
          return { ok: false, reason: `第 ${index + 1} 条规则包含重复的数据投影 key：“${row.key}”。` }
        }
        project[row.key] = row.expression
      }
      rule.project = project
    }
    rules.push(rule)
  }

  return {
    ok: true,
    content: `${JSON.stringify({
      schema: REPLY_PROJECTION_SCHEMA,
      ...cloneJsonValue(draft.topLevelExtras) as Record<string, unknown>,
      rules,
    }, null, 2)}\n`,
  }
}
