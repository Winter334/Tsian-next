import type { JsonValue } from "./runtime"

export const DIAGNOSTIC_RECORD_SCHEMA_VERSION = 1

export type DiagnosticRecordType = "ai-request" | "frontend-error"
export type DiagnosticAiRequestStatus =
  | "running"
  | "succeeded"
  | "failed"
  | "aborted"
  | "interrupted"

export interface DiagnosticRecordBase {
  id: string
  recordType: DiagnosticRecordType
  timestamp: number
  updatedAt: number
  schemaVersion: number
  /** UTF-8 byte length of the complete JSON-serialized record. */
  sizeBytes: number
}

export interface DiagnosticError {
  type: "http" | "timeout" | "abort" | "parse" | "stream" | "network" | "error" | "unknown" | "interrupted"
  message: string
  name?: string
  code?: string
  status?: number
  stack?: string
  details?: JsonValue
}

export interface DiagnosticAiUsage {
  input?: number
  output?: number
  total?: number
  cached?: number
  cacheCreation?: number
}

export interface DiagnosticAiAttempt {
  attempt: number
  maxAttempts: number
  startedAt: number
  endedAt?: number
  status: "running" | "succeeded" | "failed" | "aborted"
  retryable?: boolean
  willRetry?: boolean
  retryDelayMs?: number
  error?: DiagnosticError
}

export interface DiagnosticAiRequestRecord extends DiagnosticRecordBase {
  recordType: "ai-request"
  requestId: string
  operationId: string
  parentRequestId?: string
  previousRequestId?: string
  sequence: number
  status: DiagnosticAiRequestStatus
  provider: string
  model: string
  endpoint: string
  streaming: boolean
  parameters?: JsonValue
  request: {
    messages: JsonValue
    tools?: JsonValue
    headers?: JsonValue
    body?: JsonValue
  }
  response?: {
    text: string
    toolCalls?: JsonValue
    finishReason?: string
    usage?: DiagnosticAiUsage
    /** Non-stream provider payload. Streaming stores assembled semantics only. */
    providerPayload?: JsonValue
  }
  attempts: DiagnosticAiAttempt[]
  durationMs?: number
  error?: DiagnosticError
}

export type DiagnosticFrontendErrorKind =
  | "runtime-error"
  | "unhandled-rejection"
  | "vue-error"
  | "resource-error"

export interface DiagnosticFrontendErrorRecord extends DiagnosticRecordBase {
  recordType: "frontend-error"
  errorId: string
  kind: DiagnosticFrontendErrorKind
  message: string
  name?: string
  stack?: string
  sourceUrl?: string
  line?: number
  column?: number
  resourceUrl?: string
  componentName?: string
}

export type DiagnosticRecord = DiagnosticAiRequestRecord | DiagnosticFrontendErrorRecord

export interface DiagnosticRecordQuery {
  offset?: number
  limit?: number
  recordType?: DiagnosticRecordType
  status?: DiagnosticAiRequestStatus
  provider?: string
  model?: string
  operationId?: string
  fromTimestamp?: number
  toTimestamp?: number
  text?: string
}

export interface DiagnosticRecordPage {
  items: DiagnosticRecord[]
  offset: number
  limit: number
  hasMore: boolean
}

export interface DiagnosticRecordSummary {
  id: string
  recordType: DiagnosticRecordType
  timestamp: number
  updatedAt: number
  sizeBytes: number
  status?: DiagnosticAiRequestStatus
  provider?: string
  model?: string
  operationId?: string
  durationMs?: number
  retryCount?: number
  message?: string
}

export interface DiagnosticRecordSummaryPage {
  items: DiagnosticRecordSummary[]
  offset: number
  limit: number
  hasMore: boolean
}

export interface DiagnosticStoreHealth {
  lostRecordCount: number
  lastFailureAt?: number
  lastError?: string
}
