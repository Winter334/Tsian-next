import type { SourceManifest } from "./source"

export const OPENING_CONTROL_PATH = "save/playthrough/opening-interview.json"
export const OPENING_CONTROL_SCHEMA = "novel-airp.opening-interview.v2"

const CLOSED_CHOICES_BLOCK_RE = /\[\[开局选项\]\]\s*([\s\S]*?)\s*\[\[\/开局选项\]\]/g
const OPENING_CHOICE_START = "[[开局选项]]"
const OPENING_CHOICE_END = "[[/开局选项]]"
export const OPENING_CONTINUE_MARKER = "[[开局继续]]"
const OPENING_HIDDEN_MARKERS = [OPENING_CHOICE_START, OPENING_CHOICE_END, OPENING_CONTINUE_MARKER] as const
const START_MARKER_RE = /^opening-interview:start:([a-z0-9-]+)$/
const ANSWER_MARKER_RE = /^opening-interview:answer\n([\s\S]*)$/
const CONTINUE_MARKER_RE = /^opening-interview:continue:([a-z0-9-]+)$/
const SOURCE_HASH_RE = /^[a-f0-9]{8}$/
const SESSION_ID_RE = /^opening-[a-f0-9]{8}$/
const SESSION_SLOT_RE = /^opening-interview-[a-f0-9]{8}$/

export type CharacterBranch = "canon" | "original"
export type OpeningInterviewStatus = "idle" | "running" | "ready" | "recovering" | "failed" | "complete"

const OPENING_BRANCH_LABELS: Record<CharacterBranch, string> = {
  canon: "原著角色",
  original: "原创角色",
}

export interface OpeningSourceIdentity {
  importedAt: string
  normalizationVersion: string
  title: string
  chapterCount: number
  hash: string
}

export interface OpeningInterviewControl {
  schema: typeof OPENING_CONTROL_SCHEMA
  source: OpeningSourceIdentity
  session: {
    id: string
    slot: string
  }
  branch: CharacterBranch
}

export interface ParsedOpeningAssistant {
  displayContent: string
  choices: string[]
  openingContinue: boolean
}

export interface OpeningTranscriptEntry {
  sequence: number
  invocationId: string
  request: string
  assistant: {
    kind: "assistant"
    content: string
    displayContent?: string
    projections?: Record<string, unknown>
  }
}

export type ParsedOpeningUser =
  | { kind: "start"; sessionId: string }
  | { kind: "answer"; content: string }
  | { kind: "continue"; sessionId: string }

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const allowedSet = new Set(allowed)
  return Object.keys(value).every((key) => allowedSet.has(key))
}

function cleanString(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null
  const text = value.trim()
  return text && text.length <= maxLength ? text : null
}

function hashText(input: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, "0")
}

export function openingSourceIdentity(manifest: SourceManifest): OpeningSourceIdentity {
  const base = {
    importedAt: manifest.importedAt,
    normalizationVersion: manifest.normalizationVersion,
    title: manifest.title,
    chapterCount: manifest.chapterCount,
  }
  return { ...base, hash: hashText(JSON.stringify(base)) }
}

export function openingSession(identity: OpeningSourceIdentity): { id: string; slot: string; transcriptPath: string } {
  const id = `opening-${identity.hash}`
  const slot = `opening-interview-${identity.hash}`
  return {
    id,
    slot,
    transcriptPath: `save/agents/world-architect/transcripts/${slot}.json`,
  }
}

export function createOpeningControl(manifest: SourceManifest, branch: CharacterBranch): OpeningInterviewControl {
  const source = openingSourceIdentity(manifest)
  const session = openingSession(source)
  return {
    schema: OPENING_CONTROL_SCHEMA,
    source,
    session: { id: session.id, slot: session.slot },
    branch,
  }
}

export function openingBootstrapMarker(sessionId: string): string {
  return `opening-interview:start:${sessionId}`
}

export function openingAnswerMarker(input: string): string {
  return `opening-interview:answer\n${input}`
}

export function openingContinueMarker(sessionId: string): string {
  return `opening-interview:continue:${sessionId}`
}

export function parseOpeningUser(content: string): ParsedOpeningUser | null {
  const start = START_MARKER_RE.exec(content)
  if (start?.[1]) return { kind: "start", sessionId: start[1] }
  const answer = ANSWER_MARKER_RE.exec(content)
  if (answer?.[1] !== undefined) {
    const answerContent = cleanString(answer[1], 4_000)
    if (answerContent) return { kind: "answer", content: answerContent }
  }
  const continuation = CONTINUE_MARKER_RE.exec(content)
  if (continuation?.[1]) return { kind: "continue", sessionId: continuation[1] }
  return null
}

function extractChoicesText(content: string): string | null {
  const startCount = content.split(OPENING_CHOICE_START).length - 1
  if (startCount > 1) return null
  const closedMatches = [...content.matchAll(CLOSED_CHOICES_BLOCK_RE)]
  if (closedMatches.length > 1) return null
  if (closedMatches[0]) return closedMatches[0][1] ?? ""

  const start = content.indexOf(OPENING_CHOICE_START)
  if (start < 0) return ""
  if (content.indexOf(OPENING_CHOICE_START, start + OPENING_CHOICE_START.length) >= 0) return null
  if (content.indexOf(OPENING_CHOICE_END, start + OPENING_CHOICE_START.length) >= 0) return null
  return content.slice(start + OPENING_CHOICE_START.length)
}

export function parseOpeningAssistant(content: string, projections?: Record<string, unknown>): ParsedOpeningAssistant | null {
  if (content.length > 80_000) return null
  const choicesText = extractChoicesText(content)
  if (choicesText === null) return null
  const projectedChoices = Array.isArray(projections?.openingChoices)
    ? projections.openingChoices.filter((item): item is string => typeof item === "string")
    : []
  const choices = projectedChoices.length > 0
    ? projectedChoices
    : choicesText
        .split(/\r?\n/)
        .map((line) => line.replace(/^\s*[-*+]\s*/, "").trim())
        .filter(Boolean)
  if (choices.length > 12 || choices.some((choice) => choice.length > 300)) return null
  const displayContent = sanitizeOpeningDisplay(content)
  if (displayContent.length > 12_000 || !displayContent) return null
  const openingContinue = content.includes(OPENING_CONTINUE_MARKER)
    || projections?.openingContinue === OPENING_CONTINUE_MARKER
  return { displayContent, choices, openingContinue }
}

export function sanitizeOpeningDisplay(content: string): string {
  const cutAt = OPENING_HIDDEN_MARKERS
    .map((marker) => content.indexOf(marker))
    .filter((index) => index >= 0)
    .sort((a, b) => a - b)[0]
  let visible = cutAt === undefined ? content : content.slice(0, cutAt)
  for (let prefixLength = Math.min(visible.length, Math.max(...OPENING_HIDDEN_MARKERS.map((marker) => marker.length)) - 1); prefixLength > 0; prefixLength -= 1) {
    const suffix = visible.slice(-prefixLength)
    if (OPENING_HIDDEN_MARKERS.some((marker) => marker.startsWith(suffix))) {
      visible = visible.slice(0, -prefixLength)
      break
    }
  }
  return visible.replace(CLOSED_CHOICES_BLOCK_RE, "").trim()
}

export function parseOpeningTranscript(value: unknown, expectedSlot: string): OpeningTranscriptEntry[] | null {
  if (!isRecord(value)
    || !hasOnlyKeys(value, ["schema", "agentId", "slot", "lastSequence", "entries"])
    || value.schema !== "tsian.agent.invocation-transcript.v1"
    || value.agentId !== "world-architect"
    || value.slot !== expectedSlot
    || typeof value.lastSequence !== "number"
    || !Number.isSafeInteger(value.lastSequence)
    || value.lastSequence < 0
    || !Array.isArray(value.entries)) return null
  const entries: OpeningTranscriptEntry[] = []
  let previous = 0
  for (const raw of value.entries) {
    if (!isRecord(raw) || !isRecord(raw.assistant)
      || !hasOnlyKeys(raw, ["sequence", "invocationId", "purpose", "createdAt", "request", "assistant", "timeline"])
      || !hasOnlyKeys(raw.assistant, ["kind", "content", "displayContent", "projections"])
      || typeof raw.sequence !== "number" || !Number.isSafeInteger(raw.sequence) || raw.sequence <= previous
      || typeof raw.invocationId !== "string" || !cleanString(raw.invocationId, 200)
      || typeof raw.createdAt !== "string" || !raw.createdAt.trim()
      || typeof raw.request !== "string"
      || raw.assistant.kind !== "assistant" || typeof raw.assistant.content !== "string") return null
    if (raw.purpose !== undefined && (typeof raw.purpose !== "string" || !raw.purpose.trim())) return null
    if (raw.timeline !== undefined && !Array.isArray(raw.timeline)) return null
    if (raw.assistant.displayContent !== undefined && typeof raw.assistant.displayContent !== "string") return null
    if (raw.assistant.projections !== undefined && !isRecord(raw.assistant.projections)) return null
    previous = raw.sequence
    entries.push({
      sequence: raw.sequence,
      invocationId: raw.invocationId,
      request: raw.request,
      assistant: {
        kind: "assistant",
        content: raw.assistant.content,
        ...(typeof raw.assistant.displayContent === "string" ? { displayContent: raw.assistant.displayContent } : {}),
        ...(isRecord(raw.assistant.projections) ? { projections: raw.assistant.projections } : {}),
      },
    })
  }
  return previous === value.lastSequence ? entries : null
}

export function parseOpeningControl(value: unknown): OpeningInterviewControl | null {
  if (!isRecord(value) || value.schema !== OPENING_CONTROL_SCHEMA
    || !hasOnlyKeys(value, ["schema", "source", "session", "branch"])
    || !isRecord(value.source) || !hasOnlyKeys(value.source, ["importedAt", "normalizationVersion", "title", "chapterCount", "hash"])
    || !isRecord(value.session) || !hasOnlyKeys(value.session, ["id", "slot"])) return null
  const importedAt = cleanString(value.source.importedAt, 80)
  const normalizationVersion = cleanString(value.source.normalizationVersion, 80)
  const title = cleanString(value.source.title, 300)
  const hash = cleanString(value.source.hash, 32)
  const chapterCount = typeof value.source.chapterCount === "number" && Number.isSafeInteger(value.source.chapterCount) && value.source.chapterCount > 0 ? value.source.chapterCount : null
  const id = cleanString(value.session.id, 80)
  const slot = cleanString(value.session.slot, 100)
  const branch = value.branch === "canon" || value.branch === "original" ? value.branch : null
  if (!importedAt || !normalizationVersion || !title || !hash || !SOURCE_HASH_RE.test(hash)
    || chapterCount === null || !id || !SESSION_ID_RE.test(id) || !slot || !SESSION_SLOT_RE.test(slot) || !branch) return null
  const expectedHash = hashText(JSON.stringify({ importedAt, normalizationVersion, title, chapterCount }))
  if (hash !== expectedHash || id !== `opening-${hash}` || slot !== `opening-interview-${hash}`) return null
  return {
    schema: OPENING_CONTROL_SCHEMA,
    source: { importedAt, normalizationVersion, title, chapterCount, hash },
    session: { id, slot },
    branch,
  }
}

export function serializeOpeningControl(control: OpeningInterviewControl): string {
  return `${JSON.stringify(control, null, 2)}\n`
}

export function openingControlMatchesManifest(control: OpeningInterviewControl, manifest: SourceManifest): boolean {
  const identity = openingSourceIdentity(manifest)
  return control.source.hash === identity.hash
    && control.source.importedAt === identity.importedAt
    && control.source.normalizationVersion === identity.normalizationVersion
    && control.source.title === identity.title
    && control.source.chapterCount === identity.chapterCount
}

export function openingControlMatchesSession(control: OpeningInterviewControl, manifest: SourceManifest): boolean {
  if (!openingControlMatchesManifest(control, manifest)) return false
  const expected = openingSession(openingSourceIdentity(manifest))
  return control.session.id === expected.id && control.session.slot === expected.slot
}

export function isRecoverableOpeningModelState(input: {
  manifest: SourceManifest | null
  control: OpeningInterviewControl | null
  setupStatus: "pending" | "complete" | null
  hasOpeningNotes: boolean
  runtimeRecoverable: boolean
  frontierRecoverable: boolean
}): boolean {
  return Boolean(input.manifest
    && input.control
    && openingControlMatchesSession(input.control, input.manifest)
    && input.setupStatus === "pending"
    && input.hasOpeningNotes
    && input.runtimeRecoverable
    && input.frontierRecoverable)
}

export function buildOpeningInjection(control: OpeningInterviewControl): string {
  const branchLabel = OPENING_BRANCH_LABELS[control.branch]
  return [
    "执行《开局建模》Skill，主持本次开局访谈。",
    `玩家已确认角色类型：${branchLabel}（branch=${control.branch}）。将此选择视为当前会话不变量，第一次提问直接进入该分支。`,
    "当前小说与会话如下：",
    JSON.stringify({
      sessionId: control.session.id,
      sourceHash: control.source.hash,
      source: {
        importedAt: control.source.importedAt,
        normalizationVersion: control.source.normalizationVersion,
        title: control.source.title,
        chapterCount: control.source.chapterCount,
      },
      branch: control.branch,
    }),
  ].join("\n")
}
