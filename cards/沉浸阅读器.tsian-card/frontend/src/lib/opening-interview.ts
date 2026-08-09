import type { SourceManifest } from "./source"

export const OPENING_CONTROL_PATH = "save/playthrough/opening-interview.json"
export const OPENING_TURN_SCHEMA = "novel-airp.opening-turn.v1"
export const OPENING_CONTROL_SCHEMA = "novel-airp.opening-interview.v1"

const STATE_BLOCK_RE = /\[\[开局会话\]\]\s*([\s\S]*?)\s*\[\[\/开局会话\]\]/g
const CHOICES_BLOCK_RE = /\[\[开局选项\]\]\s*([\s\S]*?)\s*\[\[\/开局选项\]\]/g
const OPENING_HIDDEN_MARKERS = ["[[开局会话]]", "[[/开局会话]]", "[[开局选项]]", "[[/开局选项]]"] as const
const START_MARKER_RE = /^opening-interview:start:([a-z0-9-]+)$/
const ANSWER_MARKER_RE = /^opening-interview:answer:([a-z0-9-]+)\n([\s\S]*)$/
const SOURCE_HASH_RE = /^[a-f0-9]{8}$/
const SESSION_ID_RE = /^opening-[a-f0-9]{8}$/
const SESSION_SLOT_RE = /^opening-interview-[a-f0-9]{8}$/

export type CharacterBranch = "canon" | "original"
export type OpeningInterviewStatus = "idle" | "running" | "ready" | "recovering" | "failed" | "complete"

export interface OpeningSourceIdentity {
  importedAt: string
  normalizationVersion: string
  title: string
  chapterCount: number
  hash: string
}

export interface OpeningTurnState {
  schema: typeof OPENING_TURN_SCHEMA
  sessionId: string
  sourceHash: string
  branch: CharacterBranch
  revision: number
  processedAttemptId: string
  readSlices: Array<{
    ref: string
    start?: number
    end?: number
    purpose: string
  }>
  protagonist?: {
    mode: CharacterBranch
    ref?: string
    name?: string
  }
  decisions: Record<string, { value: string; evidenceRefs?: string[] }>
  unresolved: Record<string, { reason: string }>
  phase: "interviewing" | "ready-to-commit" | "complete"
}

export interface OpeningAttempt {
  id: string
  input: string
  inputHash: string
  basedOnRevision: number
  status: "submitted" | "failed"
  createdAt: string
}

export interface OpeningInterviewControl {
  schema: typeof OPENING_CONTROL_SCHEMA
  source: OpeningSourceIdentity
  session: {
    id: string
    slot: string
    revision: number
  }
  branch: CharacterBranch
  status: "interviewing" | "complete"
  attempt?: OpeningAttempt
  receipt?: {
    revision: number
    payloadHash: string
    committedAt: string
  }
}

export interface ParsedOpeningAssistant {
  displayContent: string
  choices: string[]
  state: OpeningTurnState
}

export type ParsedOpeningUser =
  | { kind: "start"; sessionId: string }
  | { kind: "answer"; attemptId: string; content: string }

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

export function openingInputHash(input: string): string {
  return hashText(input)
}

export function openingSourceIdentity(manifest: SourceManifest): OpeningSourceIdentity {
  const base = {
    importedAt: manifest.importedAt,
    normalizationVersion: manifest.normalizationVersion,
    title: manifest.title,
    chapterCount: manifest.chapterCount,
  }
  return {
    ...base,
    hash: hashText(JSON.stringify(base)),
  }
}

export function openingSession(identity: OpeningSourceIdentity): { id: string; slot: string; contextPath: string } {
  const id = `opening-${identity.hash}`
  const slot = `opening-interview-${identity.hash}`
  return {
    id,
    slot,
    contextPath: `save/agents/world-architect/context-${slot}.json`,
  }
}

export function createOpeningControl(manifest: SourceManifest, branch: CharacterBranch): OpeningInterviewControl {
  const source = openingSourceIdentity(manifest)
  const session = openingSession(source)
  return {
    schema: OPENING_CONTROL_SCHEMA,
    source,
    session: { id: session.id, slot: session.slot, revision: 0 },
    branch,
    status: "interviewing",
  }
}

export function openingBootstrapMarker(sessionId: string): string {
  return `opening-interview:start:${sessionId}`
}

export function openingAnswerMarker(attemptId: string, input: string): string {
  return `opening-interview:answer:${attemptId}\n${input}`
}

export function parseOpeningUser(content: string): ParsedOpeningUser | null {
  const start = START_MARKER_RE.exec(content)
  if (start?.[1]) return { kind: "start", sessionId: start[1] }
  const answer = ANSWER_MARKER_RE.exec(content)
  if (answer?.[1] !== undefined && answer[2] !== undefined) {
    const answerContent = cleanString(answer[2], 4_000)
    if (!answerContent) return null
    return { kind: "answer", attemptId: answer[1], content: answerContent }
  }
  return null
}

function parseStringRecord(value: unknown, kind: "decisions" | "unresolved"): Record<string, { value: string; evidenceRefs?: string[] } | { reason: string }> | null {
  if (!isRecord(value) || Object.keys(value).length > 48) return null
  const result: Record<string, { value: string; evidenceRefs?: string[] } | { reason: string }> = {}
  for (const [rawKey, rawItem] of Object.entries(value)) {
    const key = cleanString(rawKey, 80)
    if (!key || key !== rawKey || !isRecord(rawItem)) return null
    if (kind === "decisions") {
      if (!hasOnlyKeys(rawItem, ["value", "evidenceRefs"])) return null
      const decisionValue = cleanString(rawItem.value, 800)
      if (!decisionValue) return null
      let refs: string[] = []
      if (rawItem.evidenceRefs !== undefined) {
        if (!Array.isArray(rawItem.evidenceRefs) || rawItem.evidenceRefs.length > 16) return null
        const seenRefs = new Set<string>()
        for (const rawRef of rawItem.evidenceRefs) {
          const ref = cleanString(rawRef, 240)
          if (!ref || seenRefs.has(ref)) return null
          seenRefs.add(ref)
          refs.push(ref)
        }
      }
      result[key] = { value: decisionValue, ...(refs.length > 0 ? { evidenceRefs: refs } : {}) }
    } else {
      if (!hasOnlyKeys(rawItem, ["reason"])) return null
      const reason = cleanString(rawItem.reason, 800)
      if (!reason) return null
      result[key] = { reason }
    }
  }
  return result
}

export function parseOpeningTurnState(value: unknown): OpeningTurnState | null {
  if (!isRecord(value) || value.schema !== OPENING_TURN_SCHEMA
    || !hasOnlyKeys(value, ["schema", "sessionId", "sourceHash", "branch", "revision", "processedAttemptId", "readSlices", "protagonist", "decisions", "unresolved", "phase"])) return null
  const sessionId = cleanString(value.sessionId, 80)
  const sourceHash = cleanString(value.sourceHash, 32)
  const branch = value.branch === "canon" || value.branch === "original" ? value.branch : null
  const revision = typeof value.revision === "number" && Number.isSafeInteger(value.revision) && value.revision > 0 && value.revision <= 999_999 ? value.revision : null
  const processedAttemptId = cleanString(value.processedAttemptId, 100)
  const phase = value.phase === "interviewing" || value.phase === "ready-to-commit" || value.phase === "complete" ? value.phase : null
  if (!sessionId || !SESSION_ID_RE.test(sessionId) || !sourceHash || !SOURCE_HASH_RE.test(sourceHash)
    || !branch || revision === null || !processedAttemptId
    || (processedAttemptId !== "start" && !/^attempt-[a-z0-9-]+$/.test(processedAttemptId)) || !phase) return null

  if (!Array.isArray(value.readSlices) || value.readSlices.length > 48) return null
  const readSlices: OpeningTurnState["readSlices"] = []
  for (const rawSlice of value.readSlices) {
    if (!isRecord(rawSlice) || !hasOnlyKeys(rawSlice, ["ref", "start", "end", "purpose"])) return null
    const ref = cleanString(rawSlice.ref, 240)
    const purpose = cleanString(rawSlice.purpose, 500)
    if (!ref || !purpose) return null
    const start = typeof rawSlice.start === "number" && Number.isSafeInteger(rawSlice.start) && rawSlice.start >= 0 ? rawSlice.start : undefined
    const end = typeof rawSlice.end === "number" && Number.isSafeInteger(rawSlice.end) && rawSlice.end >= 0 ? rawSlice.end : undefined
    if (start !== undefined && end !== undefined && end < start) return null
    readSlices.push({ ref, ...(start !== undefined ? { start } : {}), ...(end !== undefined ? { end } : {}), purpose })
  }

  const decisions = parseStringRecord(value.decisions, "decisions")
  const unresolved = parseStringRecord(value.unresolved, "unresolved")
  if (!decisions || !unresolved) return null

  let protagonist: OpeningTurnState["protagonist"]
  if (value.protagonist !== undefined) {
    if (!isRecord(value.protagonist) || !hasOnlyKeys(value.protagonist, ["mode", "ref", "name"])
      || value.protagonist.mode !== branch) return null
    const ref = value.protagonist.ref === undefined ? undefined : cleanString(value.protagonist.ref, 120)
    const name = value.protagonist.name === undefined ? undefined : cleanString(value.protagonist.name, 120)
    if (value.protagonist.ref !== undefined && !ref) return null
    if (value.protagonist.name !== undefined && !name) return null
    protagonist = { mode: branch, ...(ref ? { ref } : {}), ...(name ? { name } : {}) }
  }

  return {
    schema: OPENING_TURN_SCHEMA,
    sessionId,
    sourceHash,
    branch,
    revision,
    processedAttemptId,
    readSlices,
    ...(protagonist ? { protagonist } : {}),
    decisions: decisions as OpeningTurnState["decisions"],
    unresolved: unresolved as OpeningTurnState["unresolved"],
    phase,
  }
}

export function parseOpeningAssistant(content: string): ParsedOpeningAssistant | null {
  if (content.length > 80_000) return null
  const stateMatches = [...content.matchAll(STATE_BLOCK_RE)]
  if (stateMatches.length !== 1) return null
  const stateSource = stateMatches[0]?.[1]
  if (!stateSource || stateSource.length > 24_000) return null

  let stateValue: unknown
  try {
    stateValue = JSON.parse(stateSource)
  } catch {
    return null
  }
  const state = parseOpeningTurnState(stateValue)
  if (!state) return null

  const choicesMatches = [...content.matchAll(CHOICES_BLOCK_RE)]
  if (choicesMatches.length > 1) return null
  const choices = (choicesMatches[0]?.[1] ?? "")
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*[-*+]\s*/, "").trim())
    .filter(Boolean)
  if (choices.length > 12 || choices.some((choice) => choice.length > 300)) return null
  const displayContent = sanitizeOpeningDisplay(content)
  if (displayContent.length > 12_000 || (!displayContent && state.phase !== "complete")) return null
  return { displayContent, choices, state }
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
  return visible.replace(STATE_BLOCK_RE, "").replace(CHOICES_BLOCK_RE, "").trim()
}

export function openingRevisionContinues(previousRevision: number | null, nextRevision: number): boolean {
  return previousRevision === null ? nextRevision === 1 : nextRevision === previousRevision + 1
}

export function parseOpeningControl(value: unknown): OpeningInterviewControl | null {
  if (!isRecord(value) || value.schema !== OPENING_CONTROL_SCHEMA
    || !hasOnlyKeys(value, ["schema", "source", "session", "branch", "status", "attempt", "receipt"])
    || !isRecord(value.source) || !hasOnlyKeys(value.source, ["importedAt", "normalizationVersion", "title", "chapterCount", "hash"])
    || !isRecord(value.session) || !hasOnlyKeys(value.session, ["id", "slot", "revision"])) return null
  const importedAt = cleanString(value.source.importedAt, 80)
  const normalizationVersion = cleanString(value.source.normalizationVersion, 80)
  const title = cleanString(value.source.title, 300)
  const hash = cleanString(value.source.hash, 32)
  const chapterCount = typeof value.source.chapterCount === "number" && Number.isSafeInteger(value.source.chapterCount) && value.source.chapterCount > 0 ? value.source.chapterCount : null
  const id = cleanString(value.session.id, 80)
  const slot = cleanString(value.session.slot, 100)
  const revision = typeof value.session.revision === "number" && Number.isSafeInteger(value.session.revision) && value.session.revision >= 0 ? value.session.revision : null
  const branch = value.branch === "canon" || value.branch === "original" ? value.branch : null
  const status = value.status === "interviewing" || value.status === "complete" ? value.status : null
  if (!importedAt || !normalizationVersion || !title || !hash || !SOURCE_HASH_RE.test(hash)
    || chapterCount === null || !id || !SESSION_ID_RE.test(id) || !slot || !SESSION_SLOT_RE.test(slot)
    || revision === null || !branch || !status) return null
  const expectedHash = hashText(JSON.stringify({ importedAt, normalizationVersion, title, chapterCount }))
  if (hash !== expectedHash || id !== `opening-${hash}` || slot !== `opening-interview-${hash}`) return null

  const control: OpeningInterviewControl = {
    schema: OPENING_CONTROL_SCHEMA,
    source: { importedAt, normalizationVersion, title, chapterCount, hash },
    session: { id, slot, revision },
    branch,
    status,
  }
  if (value.attempt !== undefined) {
    if (!isRecord(value.attempt) || !hasOnlyKeys(value.attempt, ["id", "input", "inputHash", "basedOnRevision", "status", "createdAt"])) return null
    const attemptId = cleanString(value.attempt.id, 100)
    const input = cleanString(value.attempt.input, 4_000)
    const inputHash = cleanString(value.attempt.inputHash, 32)
    const basedOnRevision = typeof value.attempt.basedOnRevision === "number" && Number.isSafeInteger(value.attempt.basedOnRevision) && value.attempt.basedOnRevision >= 0 ? value.attempt.basedOnRevision : null
    const attemptStatus = value.attempt.status === "submitted" || value.attempt.status === "failed" ? value.attempt.status : null
    const createdAt = cleanString(value.attempt.createdAt, 80)
    if (!attemptId || !/^attempt-[a-z0-9-]+$/.test(attemptId) || !input || !inputHash
      || inputHash !== openingInputHash(input) || basedOnRevision === null || basedOnRevision !== revision
      || !attemptStatus || !createdAt || status !== "interviewing") return null
    control.attempt = { id: attemptId, input, inputHash, basedOnRevision, status: attemptStatus, createdAt }
  }
  if (value.receipt !== undefined) {
    if (!isRecord(value.receipt) || !hasOnlyKeys(value.receipt, ["revision", "payloadHash", "committedAt"])) return null
    const receiptRevision = typeof value.receipt.revision === "number" && Number.isSafeInteger(value.receipt.revision) && value.receipt.revision > 0 ? value.receipt.revision : null
    const payloadHash = cleanString(value.receipt.payloadHash, 128)
    const committedAt = cleanString(value.receipt.committedAt, 80)
    if (!receiptRevision || !payloadHash || !/^[a-f0-9]{64}$/.test(payloadHash) || !committedAt) return null
    control.receipt = { revision: receiptRevision, payloadHash, committedAt }
  }
  if (status === "complete" && (!control.receipt || control.attempt || revision !== control.receipt.revision)) return null
  if (status === "interviewing" && control.receipt) return null
  return control
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

export function createAttemptId(): string {
  const uuid = globalThis.crypto?.randomUUID?.()
  return (uuid ? `attempt-${uuid}` : `attempt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`).toLowerCase()
}

export function buildOpeningInjection(control: OpeningInterviewControl): string {
  return [
    "执行《开局建模》Skill，主持本次开局访谈。",
    "会话不变量如下；不得改写 branch/source/session：",
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
      basedOnRevision: control.attempt?.basedOnRevision ?? control.session.revision,
      attemptId: control.attempt?.id ?? "start",
    }),
  ].join("\n")
}
