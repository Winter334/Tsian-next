import type {
  DiagnosticAiRequestStatus,
  DiagnosticRecord,
  DiagnosticRecordQuery,
  DiagnosticRecordSummary,
} from "@tsian/contracts"
import type { RuntimeDiagnosticsQueryRunner } from "../agent-runtime/workspace-tools"
import {
  getDiagnosticRecord,
  getDiagnosticRecordSummaries,
  queryDiagnosticRecordSummaries,
  scanDiagnosticRecords,
} from "../storage/diagnostic-records"

const MAX_RECORDS = 20
const DEFAULT_RECORDS = 10
const MAX_SNIPPETS_PER_RECORD = 3
const MAX_SNIPPET_CHARS = 320
const MAX_SECTION_CHARS = 16 * 1024
const MAX_QUERY_RESULT_CHARS = 30 * 1024
const MAX_SUMMARY_FIELD_CHARS = 320

const AI_STATUSES = new Set<DiagnosticAiRequestStatus>([
  "running",
  "succeeded",
  "failed",
  "aborted",
  "interrupted",
])

function boundedPositive(value: number | undefined, fallback: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return fallback
  return Math.min(max, Math.floor(value))
}

function boundedOffset(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return 0
  return Math.floor(value)
}

function snippets(text: string, query: string): string[] {
  const comparable = text.toLocaleLowerCase()
  const needle = query.toLocaleLowerCase()
  const result: string[] = []
  let from = 0
  while (result.length < MAX_SNIPPETS_PER_RECORD) {
    const index = comparable.indexOf(needle, from)
    if (index < 0) break
    const start = Math.max(0, index - 120)
    const end = Math.min(text.length, start + MAX_SNIPPET_CHARS)
    result.push(`${start > 0 ? "…" : ""}${text.slice(start, end)}${end < text.length ? "…" : ""}`)
    from = Math.max(index + needle.length, index + 1)
  }
  return result
}

function boundedText(value: string, limit = MAX_SUMMARY_FIELD_CHARS): string {
  return value.length <= limit ? value : `${value.slice(0, Math.max(0, limit - 1))}…`
}

function projectSummary(summary: DiagnosticRecordSummary): Record<string, unknown> {
  return Object.fromEntries(Object.entries(summary).map(([key, value]) => {
    if (typeof value !== "string") return [key, value]
    return [key, boundedText(value, key === "id" ? 512 : MAX_SUMMARY_FIELD_CHARS)]
  }))
}

function boundedCollectionResult(input: {
  operation: "list" | "search"
  items: Array<Record<string, unknown>>
  truncated: boolean
  continuationHint: string
}): Record<string, unknown> {
  const accepted = [...input.items]
  const build = () => {
    const truncated = input.truncated || accepted.length < input.items.length
    const anchors = accepted.flatMap((item) =>
      typeof item.id === "string" ? [item.id] : [])
    return {
      operation: input.operation,
      items: accepted,
      returned: accepted.length,
      truncated,
      anchors,
      ...(truncated
        ? { continuation: { operation: input.operation, hint: input.continuationHint } }
        : {}),
    }
  }
  while (accepted.length > 0 && JSON.stringify(build()).length > MAX_QUERY_RESULT_CHARS) {
    accepted.pop()
  }
  return build()
}

function readSection(record: DiagnosticRecord, section: string): unknown {
  if (section === "summary") return undefined
  if (record.recordType === "frontend-error") {
    if (section === "error") return record
    return null
  }
  if (section === "error") return record.error ?? null
  if (section === "attempts") return record.attempts
  if (section === "request") return record.request
  if (section === "response") return record.response ?? null
  return null
}

export function createDiagnosticsQueryRunner(): RuntimeDiagnosticsQueryRunner {
  return async (input) => {
    if (input.operation === "list") {
      const query: DiagnosticRecordQuery = {
        limit: boundedPositive(input.limit, DEFAULT_RECORDS, MAX_RECORDS),
        ...(input.recordType ? { recordType: input.recordType } : {}),
        ...(input.status && AI_STATUSES.has(input.status as DiagnosticAiRequestStatus)
          ? { status: input.status as DiagnosticAiRequestStatus }
          : {}),
        ...(input.provider ? { provider: input.provider } : {}),
        ...(input.model ? { model: input.model } : {}),
        ...(input.operationId ? { operationId: input.operationId } : {}),
      }
      const page = await queryDiagnosticRecordSummaries(query)
      return boundedCollectionResult({
        operation: "list",
        items: page.items.map((item) => ({ ...projectSummary(item), id: item.id })),
        truncated: page.hasMore,
        continuationHint: "Narrow the filters.",
      })
    }

    if (input.operation === "search") {
      const limit = boundedPositive(input.limit, DEFAULT_RECORDS, MAX_RECORDS)
      const matched = await scanDiagnosticRecords((record) => {
        if (input.recordType && record.recordType !== input.recordType) return false
        return JSON.stringify(record).toLocaleLowerCase().includes(input.query.toLocaleLowerCase())
      }, limit + 1)
      const returnedRecords = matched.slice(0, limit)
      const summaries = await getDiagnosticRecordSummaries(returnedRecords.map((record) => record.id))
      const summaryById = new Map(summaries.map((summary) => [summary.id, summary]))
      return boundedCollectionResult({
        operation: "search",
        items: returnedRecords.map((record) => ({
          id: record.id,
          ...(summaryById.get(record.id)
            ? { summary: projectSummary(summaryById.get(record.id)!) }
            : {}),
          snippets: snippets(JSON.stringify(record), input.query),
        })),
        truncated: matched.length > limit,
        continuationHint: "Narrow the query or recordType, then read a selected id.",
      })
    }

    const record = await getDiagnosticRecord(input.id)
    if (!record) {
      throw {
        code: "DIAGNOSTIC_RECORD_NOT_FOUND",
        message: `Diagnostic record was not found: ${input.id}`,
      }
    }
    const section = input.section ?? "summary"
    let value: unknown
    if (section === "summary") {
      value = (await getDiagnosticRecordSummaries([record.id]))[0] as DiagnosticRecordSummary | undefined
    } else {
      value = readSection(record, section)
    }
    const text = JSON.stringify(value ?? null, null, 2)
    const offset = boundedOffset(input.offset)
    const limit = boundedPositive(input.limit, MAX_SECTION_CHARS, MAX_SECTION_CHARS)
    const content = text.slice(offset, offset + limit)
    const nextOffset = offset + content.length
    return {
      operation: "read",
      id: record.id,
      section,
      content,
      totalChars: text.length,
      offset,
      returnedChars: content.length,
      truncated: nextOffset < text.length,
      ...(nextOffset < text.length ? { nextOffset } : {}),
      anchors: [record.id],
    }
  }
}
