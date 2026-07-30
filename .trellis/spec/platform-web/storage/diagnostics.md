# Unified Diagnostics Storage and Collection

## Scenario: Unified AI Trace and Frontend Errors

### 1. Scope / Trigger

- Trigger: adding or changing provider calls, retry behavior, global frontend error capture, diagnostic queries, retention, or the `diagnosticRecords` Dexie table.
- The unified store is global platform bookkeeping. It is not owned by a card, save, assistant session, turn, or Agent.

### 2. Signatures

```ts
type DiagnosticRecord = DiagnosticAiRequestRecord | DiagnosticFrontendErrorRecord

interface AiTraceOperationContext {
  operationId: string
  parentRequestId?: string
  previousRequestId?: string
  sequenceState: { value: number }
}

queryDiagnosticRecords(query: DiagnosticRecordQuery): Promise<DiagnosticRecordPage>
queryDiagnosticRecordSummaries(query: DiagnosticRecordQuery): Promise<DiagnosticRecordSummaryPage>
getDiagnosticRelationClosure(anchorId: string): Promise<DiagnosticRecord[]>
```

- Dexie table: `diagnosticRecords: "&id, recordType, timestamp, updatedAt, status, provider, model, operationId, parentRequestId, previousRequestId"`.
- AI record `id === requestId`; frontend-error record `id === errorId`.

### 3. Contracts

- All real chat-provider functions call `beginAiRequestTrace` at the provider boundary. Hosts only create/pass `AiTraceOperationContext`; they do not persist channel fields.
- AI records must not add turn, saveId, sessionId, agentId, debugLabel, purpose, or entry/channel names. Tool rounds use `previousRequestId`; delegated calls use `parentRequestId`; network retries stay in `attempts[]` on one request.
- Persisted values pass through `prepareDiagnosticRecord`: recursively remove credential keys and URL credentials/query secrets, and replace Blob/ArrayBuffer/base64 binary bodies with metadata. Full ordinary text remains intact.
- Write failures are swallowed at the diagnostic boundary and increment session-local `DiagnosticStoreHealth`; they never replace an AI result/error.
- Capture only unhandled runtime errors, unhandled rejections, Vue global errors, and resource-load errors. Defer window events one microtask and skip events whose `defaultPrevented` became true. Do not capture console output.
- Query collections apply filter/offset/limit on the IndexedDB cursor before `toArray`; never load the retained full-body corpus and paginate in JavaScript.
- Retain at most 7 days and 100 MiB, oldest first. Running requests count toward bytes but are not deleted; completion re-measures and makes them eligible. Startup marks abandoned running records `interrupted` before pruning.
- Legacy Runtime Trace JSONL and AI Debug data are not migrated, queried, displayed, or exported. Do not restore writer/parser/query/bridge/UI compatibility. Save/checkpoint lifecycle code may still recognize old save trace paths only to preserve existing cleanup/restore behavior.

### 4. Validation & Error Matrix

| Condition | Required result |
|---|---|
| Successful provider response | `succeeded`, full assembled response, finish reason/usage, succeeded attempt |
| HTTP failure | `failed`, `error.type = "http"`, status/payload after sanitization |
| Invalid successful JSON/provider shape | `failed`, `error.type = "parse"`, failed attempt |
| Provider SSE error | `failed`, `error.type = "stream"`; preserve already assembled response text/tool calls |
| User abort | `aborted`, `error.type = "abort"`; string abort reasons still classify as abort |
| Timeout, including `"task-timeout"` abort reason | `failed`, `error.type = "timeout"` |
| Retryable transport/HTTP failure | one failed attempt with retry metadata, followed by the next attempt in the same request |
| Diagnostic write fails | original AI behavior unchanged; health lost count increases |
| Error/rejection/resource event is prevented | no frontend-error record |
| Retention over limit with only running records | keep running records and report remaining bytes above cap; prune after completion |

### 5. Good/Base/Bad Cases

- Good: a formal turn calls a tool, delegates to another Agent, and retries one HTTP 429; one operation closure contains each provider request while the retry remains inside its request.
- Base: a future caller omits trace context; the recorder creates an operation and still writes the same schema.
- Bad: write `.tsian/save/traces/**`, append an AI Debug meta array, expose `runtime-trace`/`runtime-diagnostics`/`ai-debug`, or add a channel discriminator to the unified record.
- Bad: call `.toArray()` on all diagnostic records and then slice a page.

### 6. Tests Required

- `npm run build:contracts` and `npm run build:web`.
- Run storage, recorder, provider-boundary, and frontend-diagnostics tests.
- Assert Dexie v1→v2 retains existing tables/data and adds `diagnosticRecords`.
- Assert recursive persisted sanitization, binary metadata, cursor-bounded pagination, relation closure, 7-day/100-MiB oldest-first deletion, running exemption/completion eligibility, and interrupted recovery.
- Assert success, HTTP, parse, SSE/provider-stream, partial stream, cancellation, timeout classification, retries, unique concurrent request IDs, and write-failure health.
- Reverse-search both writer and reader symbols for retired Runtime Trace/AI Debug surfaces; only legacy save lifecycle path recognition may remain.

### 7. Wrong vs Correct

#### Wrong

```ts
const records = await localDb.diagnosticRecords.toArray()
return records.filter(matches).slice(offset, offset + limit)
```

```ts
await writeRuntimeTraceFileForSave(saveId, files, tracePath, events)
```

#### Correct

```ts
const items = await localDb.diagnosticRecords
  .orderBy("timestamp")
  .reverse()
  .filter(matches)
  .offset(offset)
  .limit(limit + 1)
  .toArray()

const trace = await beginAiRequestTrace({ context, provider, model, endpoint, messages, body })
```
