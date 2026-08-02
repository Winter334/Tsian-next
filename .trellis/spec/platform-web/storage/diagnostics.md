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

interface WorkspaceOperationVirtualReadAdapter {
  readonlyPathPrefixes?: readonly string[]
  list(input: VirtualListInput): VirtualListResult | undefined | Promise<VirtualListResult | undefined>
  read(input: VirtualReadInput): WorkspaceReadResult | undefined | Promise<WorkspaceReadResult | undefined>
  search(input: VirtualSearchInput): WorkspaceSearchResult[] | undefined | Promise<WorkspaceSearchResult[] | undefined>
}

interface WorkspaceEntry {
  readOnly?: boolean
}

interface WorkspaceListResult {
  readOnly?: boolean
}

interface WorkspaceReadResult extends WorkspaceFile {
  readOnly?: boolean
}

interface WorkspaceSearchResult {
  readOnly?: boolean
}

queryDiagnosticRecords(query: DiagnosticRecordQuery): Promise<DiagnosticRecordPage>
queryDiagnosticRecordSummaries(query: DiagnosticRecordQuery): Promise<DiagnosticRecordSummaryPage>
getDiagnosticRecord(id: string): Promise<DiagnosticRecord | undefined>
getDiagnosticRelationClosure(anchorId: string): Promise<DiagnosticRecord[]>
onDiagnosticRecordsChanged(cb: (change: DiagnosticRecordsChange) => void): () => void
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
- The monitor list calls only `queryDiagnosticRecordSummaries`; selecting a row fetches its full body with `getDiagnosticRecord(id)`. Facets and Overview derive from the same summary projection. Build their lightweight summary cache once, then apply `upsert`/`delete` IDs from `DiagnosticRecordsChange`; a subscription must not re-page the full retained corpus after every attempt update.
- Relation closure includes every request sharing an included `operationId`, then recursively follows indexed `parentRequestId`/`previousRequestId` links in both directions, including links that cross operation IDs. This preserves a complete chain even when retained records have a missing intermediate link.
- Diagnostic export starts at the selected failed/interrupted/frontend-error record, or the latest such record when none is selected. Take at most 50 ordinary records from the anchor toward older timestamps, then add relation closure; unrelated newer records are excluded. Export sanitization runs again over structured fields **and credential-like text** (headers, bearer/basic values, token/key/password assignments, URL credentials) while preserving ordinary request/response text.
- The platform-owner resource manager mounts `createDiagnosticsWorkspaceAdapter()` for browse/copy/export. Agent Runtime never mounts it: the desktop assistant receives the controlled `query_diagnostics` runner, while runtime and delegated Agents receive neither surface. The adapter projects `.tsian/local/diagnostics/index.jsonl`, `requests/<id>.json`, and `frontend-errors/<id>.json` directly from IndexedDB; it never inserts records into the eager workspace snapshot or creates a second persisted copy.
- `query_diagnostics` is summary-first and bounded: list/search return at most 20 records, search returns at most three 320-character snippets per record, aggregate output is capped, and read requires record id + explicit section with 16 KiB character paging for request/response bodies.
- Root list calls for `.tsian/`, `.tsian/local/`, and `.tsian/local/diagnostics/` are static. An explicit list of `requests/` or `frontend-errors/` enumerates the currently retained summary projection, newest first, and emits one file entry per record. Index reads page summaries, ID reads call `getDiagnosticRecord(id)`, and search stops its IndexedDB cursor when `limit` matching records have been collected.
- `WorkspaceEntry`, `WorkspaceListResult`, `WorkspaceReadResult`, and `WorkspaceSearchResult` carry optional generic `readOnly` view metadata. Diagnostics directory, file, read, and search projections set it to `true`; this metadata is never persisted in ordinary workspace file records.
- `.tsian/local/diagnostics` is a built-in read-only namespace even when no adapter is mounted. Normalize source and destination paths before routing. Copying a diagnostic file or directory out to an ordinary writable path is allowed and creates a complete, editable snapshot. Copying into diagnostics and every source-mutating operation (`write`, `edit`, `delete`, `move`, cut, or rename) remain blocked at every actor level, including level 4.
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
| Record update subscription fires | refresh the current summary page and selected ID; update Overview/facets from changed summary IDs, not a full-body reload |
| No failed/interrupted/frontend-error anchor exists | disable export in UI and reject bundle construction with a clear error |
| Runtime or delegated Agent requests diagnostics | no virtual adapter is mounted; diagnostics are not visible or serialized |
| Desktop assistant asks for diagnostics | use bounded `query_diagnostics`; ordinary workspace retrieval never mounts/scans diagnostics |
| Resource manager lists diagnostics root | return static directory/index entries without touching IndexedDB records |
| Explicit list of `requests/` or `frontend-errors/` | enumerate current retained summaries as read-only file entries without loading full record bodies |
| Copy diagnostics source to an ordinary writable target | recursively read complete virtual files and write an editable ordinary snapshot after all target collisions are preflighted |
| Diagnostics write/edit/delete/move or copy-in, including normalized traversal paths | reject with the read-only workspace error before mutation routing |
| Error/rejection/resource event is prevented | no frontend-error record |
| Retention over limit with only running records | keep running records and report remaining bytes above cap; prune after completion |

### 5. Good/Base/Bad Cases

- Good: a formal turn calls a tool, delegates to another Agent, and retries one HTTP 429; one operation closure contains each provider request while the retry remains inside its request.
- Good: a running row receives attempt updates; the current page and selected detail refresh, while Overview updates through the summary cache.
- Good: the desktop assistant searches bounded summaries, reads one selected request section by ID/range, then edits a real project file; diagnostics never enter ordinary workspace search.
- Good: the resource manager explicitly opens `requests/`, copies the directory to a normal workspace path, and then edits the independent snapshot; diagnostics remain unchanged.
- Base: a future caller omits trace context; the recorder creates an operation and still writes the same schema.
- Bad: write `.tsian/save/traces/**`, append an AI Debug meta array, expose `runtime-trace`/`runtime-diagnostics`/`ai-debug`, or add a channel discriminator to the unified record.
- Bad: call `.toArray()` on all diagnostic records and then slice a page.
- Bad: call `getDiagnosticOverview()` by repeatedly loading every full record on each record-change event, or export persisted text without the second credential scrub.
- Bad: append diagnostics to `workspaceFiles`, mount the adapter for runtime/delegated Agents, enumerate records while listing a diagnostics ancestor/root, copy ordinary files into diagnostics, or let level 4 mutate the reserved prefix.

### 6. Tests Required

- `npm run build:contracts` and `npm run build:web`.
- Run storage, recorder, provider-boundary, and frontend-diagnostics tests.
- Assert Dexie v1→v2 retains existing tables/data and adds `diagnosticRecords`.
- Assert recursive persisted sanitization, binary metadata, cursor-bounded pagination, relation closure, 7-day/100-MiB oldest-first deletion, running exemption/completion eligibility, and interrupted recovery.
- Assert a relation closure includes detached same-operation records and recursively linked cross-operation children.
- Assert the bundle contains the fixed manifest/summary/reproduction/platform/configuration/index/per-record layout, exactly the ordinary anchor window plus closure, complete ordinary text, and no credentials from structured fields or embedded text.
- Assert resource-manager virtual discovery/copy, bounded desktop `query_diagnostics`, ordinary-search exclusion, static ancestor/root lists, summary pagination, ID-scoped reads, cursor-bounded search, copy-in/source-mutation rejection, delegated-Agent stripping, and zero eager snapshot enumeration.
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

```ts
// Wrong: a record update triggers another retained-corpus page loop.
onDiagnosticRecordsChanged(() => loadAllDiagnosticSummaries())

// Correct: update summary aggregates by changed IDs; body reads stay ID-scoped.
onDiagnosticRecordsChanged((change) => applySummaryChange(change.ids))
const detail = await getDiagnosticRecord(selectedId)
```

```ts
// Wrong: diagnostics become ordinary files or a broadly inherited capability.
workspaceFiles.push(...allDiagnosticRecords)
runAgent({ virtualReads: diagnosticsAdapter })

// Correct: Agent and owner-UI surfaces are explicit and separate.
const queryDiagnostics = desktopAssistant ? createDiagnosticsQueryRunner() : undefined
const virtualReads = resourceManager ? createDiagnosticsWorkspaceAdapter() : undefined
```
