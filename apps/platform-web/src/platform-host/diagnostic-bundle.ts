import type {
  DiagnosticBundleExportRequest,
  DiagnosticBundleExportResult,
  DiagnosticRecord,
  DiagnosticRecordPage,
  DiagnosticRecordQuery,
} from "@tsian/contracts"
import { strToU8, zipSync } from "fflate"
import platformPackage from "../../package.json"
import {
  getDiagnosticRecord,
  getDiagnosticRelationClosure,
  prepareDiagnosticRecord,
  queryDiagnosticRecords,
  sanitizeDiagnosticValue,
} from "../storage/diagnostic-records"

export const DIAGNOSTIC_BUNDLE_SCHEMA = "tsian.diagnostic.bundle.v1"
export const DIAGNOSTIC_BUNDLE_RECORD_LIMIT = 50

export interface DiagnosticBundlePlatformInfo {
  appVersion: string
  buildMode: string
  userAgent: string
  platform: string
  locale: string
  timezone: string
}

interface DiagnosticBundleSelectionDependencies {
  getRecord(id: string): Promise<DiagnosticRecord | undefined>
  query(query: DiagnosticRecordQuery): Promise<DiagnosticRecordPage>
  relationClosure(anchorId: string): Promise<DiagnosticRecord[]>
}

export interface DiagnosticBundleSelection {
  anchor: DiagnosticRecord
  records: DiagnosticRecord[]
}

export interface BuildDiagnosticBundleFilesInput extends DiagnosticBundleSelection {
  generatedAt: number
  reproductionSteps: string
  platform: DiagnosticBundlePlatformInfo
}

const defaultSelectionDependencies: DiagnosticBundleSelectionDependencies = {
  getRecord: getDiagnosticRecord,
  query: queryDiagnosticRecords,
  relationClosure: getDiagnosticRelationClosure,
}

export function isDiagnosticFailure(record: DiagnosticRecord): boolean {
  return record.recordType === "frontend-error"
    || record.status === "failed"
    || record.status === "interrupted"
}

async function findLatestFailure(
  dependencies: DiagnosticBundleSelectionDependencies,
): Promise<DiagnosticRecord | undefined> {
  const candidates = await Promise.all([
    dependencies.query({ recordType: "frontend-error", limit: 1 }),
    dependencies.query({ recordType: "ai-request", status: "failed", limit: 1 }),
    dependencies.query({ recordType: "ai-request", status: "interrupted", limit: 1 }),
  ])
  return candidates
    .flatMap((page) => page.items)
    .sort((left, right) => right.timestamp - left.timestamp || left.id.localeCompare(right.id))[0]
}

export async function selectDiagnosticBundleRecords(
  selectedFailureId?: string,
  dependencies: DiagnosticBundleSelectionDependencies = defaultSelectionDependencies,
): Promise<DiagnosticBundleSelection> {
  const selected = selectedFailureId
    ? await dependencies.getRecord(selectedFailureId)
    : undefined
  const anchor = selected && isDiagnosticFailure(selected)
    ? selected
    : await findLatestFailure(dependencies)
  if (!anchor) {
    throw new Error("没有可作为诊断包锚点的失败记录。")
  }

  const page = await dependencies.query({
    toTimestamp: anchor.timestamp,
    offset: 0,
    limit: DIAGNOSTIC_BUNDLE_RECORD_LIMIT,
  })
  const regularRecords = [anchor, ...page.items.filter((record) => record.id !== anchor.id)]
    .filter((record) => record.timestamp <= anchor.timestamp)
    .slice(0, DIAGNOSTIC_BUNDLE_RECORD_LIMIT)
  const relationRecords = await dependencies.relationClosure(anchor.id)
  const recordsById = new Map<string, DiagnosticRecord>()
  for (const record of [...regularRecords, ...relationRecords]) recordsById.set(record.id, record)
  const records = [...recordsById.values()].sort((left, right) =>
    right.timestamp - left.timestamp || left.id.localeCompare(right.id))
  return { anchor, records }
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue)
  if (typeof value !== "object" || value === null) return value
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, stableValue(item)]),
  )
}

function json(value: unknown): string {
  return `${JSON.stringify(stableValue(value), null, 2)}\n`
}

function jsonLine(value: unknown): string {
  return JSON.stringify(stableValue(value))
}

function redactCredentialText(value: string): string {
  return value
    .replace(
      /\b(cookie|set-cookie)\b(\s*[:=]\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\r\n]+)/gi,
      (_match, name: string, separator: string) => `${name}${separator}[redacted]`,
    )
    .replace(
      /\b(authorization|proxy-authorization)\b(\s*[:=]\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|(?:Bearer|Basic)\s+[^\s,;&]+|[^\s,;&]+)/gi,
      (_match, name: string, separator: string) => `${name}${separator}[redacted]`,
    )
    .replace(
      /\b(authorization|proxy-authorization|cookie|set-cookie|x-api-key|x-auth-token)\s*:\s*[^\r\n]+/gi,
      (_match, name: string) => `${name}: [redacted]`,
    )
    .replace(
      /\b(api[_-]?key|access[_-]?token|refresh[_-]?token|id[_-]?token|client[_-]?secret|password|credential|secret)\b(\s*[:=]\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;&]+)/gi,
      (_match, name: string, separator: string) => `${name}${separator}[redacted]`,
    )
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, "$1 [redacted]")
    .replace(/\b(?:sk-(?:ant-|proj-)?[A-Za-z0-9_-]{12,}|AIza[A-Za-z0-9_-]{20,})\b/g, "[redacted]")
    .replace(/https?:\/\/[^\s"'<>]+/gi, (url) => String(sanitizeDiagnosticValue(url)))
}

function sanitizeDiagnosticExportValue(value: unknown): unknown {
  const sanitized = sanitizeDiagnosticValue(value)
  function redactStrings(item: unknown): unknown {
    if (typeof item === "string") return redactCredentialText(item)
    if (Array.isArray(item)) return item.map(redactStrings)
    if (typeof item !== "object" || item === null) return item
    return Object.fromEntries(
      Object.entries(item).map(([key, child]) => [key, redactStrings(child)]),
    )
  }
  return redactStrings(sanitized)
}

function safeFilePart(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_")
}

function recordPath(record: DiagnosticRecord): string {
  const directory = record.recordType === "ai-request" ? "requests" : "frontend-errors"
  return `records/${directory}/${safeFilePart(record.id)}.json`
}

function recordIndexEntry(record: DiagnosticRecord) {
  if (record.recordType === "frontend-error") {
    return {
      id: record.id,
      recordType: record.recordType,
      kind: record.kind,
      timestamp: record.timestamp,
      message: record.message,
      path: recordPath(record),
    }
  }
  return {
    id: record.id,
    recordType: record.recordType,
    timestamp: record.timestamp,
    status: record.status,
    provider: record.provider,
    model: record.model,
    operationId: record.operationId,
    parentRequestId: record.parentRequestId,
    previousRequestId: record.previousRequestId,
    durationMs: record.durationMs,
    retryCount: record.attempts.filter((attempt) => attempt.willRetry).length,
    path: recordPath(record),
  }
}

function markdownCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/[\r\n]+/g, " ")
}

function buildSummary(
  anchor: DiagnosticRecord,
  records: DiagnosticRecord[],
  generatedAt: number,
): string {
  const aiRecords = records.filter((record) => record.recordType === "ai-request")
  const frontendErrors = records.length - aiRecords.length
  const failed = aiRecords.filter((record) => record.status === "failed").length
  const interrupted = aiRecords.filter((record) => record.status === "interrupted").length
  const providers = new Set(aiRecords.map((record) => `${record.provider} / ${record.model}`))
  return [
    "# Tsian 诊断摘要",
    "",
    `- 生成时间：${new Date(generatedAt).toISOString()}`,
    `- 锚点：${anchor.id}（${anchor.recordType}）`,
    `- 记录总数：${records.length}`,
    `- AI 请求：${aiRecords.length}（失败 ${failed}，中断 ${interrupted}）`,
    `- 前端错误：${frontendErrors}`,
    `- Provider / Model：${providers.size > 0 ? [...providers].sort().join("、") : "无"}`,
    "",
    "## 记录索引",
    "",
    "| 时间 | 类型 | 状态/类别 | 标识 |",
    "| --- | --- | --- | --- |",
    ...records.map((record) => `| ${new Date(record.timestamp).toISOString()} | ${record.recordType} | ${
      record.recordType === "ai-request" ? record.status : record.kind
    } | ${markdownCell(record.id)} |`),
    "",
  ].join("\n")
}

function buildConfiguration(records: DiagnosticRecord[]) {
  const groups = new Map<string, {
    provider: string
    model: string
    parameters: unknown[]
  }>()
  for (const record of records) {
    if (record.recordType !== "ai-request") continue
    const key = `${record.provider}\u0000${record.model}`
    const group = groups.get(key) ?? {
      provider: record.provider,
      model: record.model,
      parameters: [],
    }
    if (record.parameters !== undefined) {
      const sanitized = sanitizeDiagnosticExportValue(record.parameters)
      const serialized = jsonLine(sanitized)
      if (!group.parameters.some((item) => jsonLine(item) === serialized)) {
        group.parameters.push(sanitized)
      }
    }
    groups.set(key, group)
  }
  return {
    providers: [...groups.values()].sort((left, right) =>
      left.provider.localeCompare(right.provider) || left.model.localeCompare(right.model)),
  }
}

export function buildDiagnosticBundleFiles(
  input: BuildDiagnosticBundleFilesInput,
): Record<string, string> {
  const records = input.records.map((record) =>
    prepareDiagnosticRecord(sanitizeDiagnosticExportValue(record) as DiagnosticRecord))
  const anchor = records.find((record) => record.id === input.anchor.id)
    ?? prepareDiagnosticRecord(sanitizeDiagnosticExportValue(input.anchor) as DiagnosticRecord)
  const dynamicPaths = records.map(recordPath)
  const fileNames = [
    "manifest.json",
    "summary.md",
    "reproduction.md",
    "platform.json",
    "configuration.json",
    "records/index.jsonl",
    ...dynamicPaths,
  ].sort()
  const files: Record<string, string> = {
    "manifest.json": json({
      schema: DIAGNOSTIC_BUNDLE_SCHEMA,
      generatedAt: new Date(input.generatedAt).toISOString(),
      anchor: recordIndexEntry(anchor),
      selection: {
        direction: "older-from-anchor",
        ordinaryRecordLimit: DIAGNOSTIC_BUNDLE_RECORD_LIMIT,
        relationClosureIncluded: true,
      },
      recordCount: records.length,
      files: fileNames,
    }),
    "summary.md": buildSummary(anchor, records, input.generatedAt),
    "reproduction.md": `# 复现步骤\n\n${redactCredentialText(input.reproductionSteps.trim()) || "（未填写）"}\n`,
    "platform.json": json({
      schema: DIAGNOSTIC_BUNDLE_SCHEMA,
      ...sanitizeDiagnosticExportValue(input.platform) as Record<string, unknown>,
    }),
    "configuration.json": json(buildConfiguration(records)),
    "records/index.jsonl": `${records.map((record) => jsonLine(recordIndexEntry(record))).join("\n")}\n`,
  }
  for (const record of records) files[recordPath(record)] = json(record)
  return Object.fromEntries(Object.entries(files).sort(([left], [right]) => left.localeCompare(right)))
}

export function zipDiagnosticBundleFiles(files: Record<string, string>): Blob {
  const zipInput: Record<string, Uint8Array> = {}
  for (const [path, content] of Object.entries(files).sort(([left], [right]) => left.localeCompare(right))) {
    zipInput[path] = strToU8(content)
  }
  return new Blob([zipSync(zipInput, { level: 6 })], { type: "application/zip" })
}

function currentPlatformInfo(): DiagnosticBundlePlatformInfo {
  const browser = typeof navigator === "undefined" ? undefined : navigator
  return {
    appVersion: platformPackage.version,
    buildMode: import.meta.env.MODE ?? "unknown",
    userAgent: browser?.userAgent ?? "unknown",
    platform: browser?.platform ?? "unknown",
    locale: browser?.language ?? "unknown",
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "unknown",
  }
}

export async function exportDiagnosticBundle(
  request: DiagnosticBundleExportRequest,
): Promise<DiagnosticBundleExportResult> {
  const selection = await selectDiagnosticBundleRecords(request.selectedFailureId)
  const generatedAt = Date.now()
  const files = buildDiagnosticBundleFiles({
    ...selection,
    generatedAt,
    reproductionSteps: request.reproductionSteps,
    platform: currentPlatformInfo(),
  })
  const date = new Date(generatedAt).toISOString().replace(/[:.]/g, "-")
  return {
    blob: zipDiagnosticBundleFiles(files),
    fileName: `tsian-diagnostics-${date}-${safeFilePart(selection.anchor.id).slice(0, 24)}.zip`,
    anchorId: selection.anchor.id,
    recordCount: selection.records.length,
  }
}
