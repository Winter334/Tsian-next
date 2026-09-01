# 长篇小说导入性能优化 Design

## 1. Problem Restatement

开局向导目前把每一章写成一个 workspace 文件，并在确认页全量渲染章节列表。5000 章 / 2000 万字级别导入会触发几千次串行 bridge 写入、主线程大文本同步处理、几千个 DOM 节点与长 stagger 动画，导致导入像卡死。

目标不是改变“按章节阅读/建模”的玩法语义，而是改变底层 source corpus 存储与读取实现：新导入按 shard 存储，读取入口继续提供章节文本。

## 2. Scope and Affected Surfaces

### Frontend source import

- `apps/play-frontend-dev/src/lib/source.ts`
- `apps/play-frontend-dev/src/composables/useSetupState.ts`
- `apps/play-frontend-dev/src/components/setup/SetupWizard.vue`
- `apps/play-frontend-dev/src/components/setup/step1/SplitReview.vue`
- New worker/helper files under `apps/play-frontend-dev/src/lib/` or `apps/play-frontend-dev/src/workers/`.

### Runtime template scripts

- `apps/platform-web/src/storage/workspace-templates/scripts/opening.ts`
- `apps/platform-web/src/storage/workspace-templates/scripts/frontier.ts`
- `apps/platform-web/src/storage/workspace-templates/agents/world-architect.ts`
- `apps/platform-web/src/storage/workspace-templates/agents/researcher.ts`
- Source corpus docs in `apps/platform-web/src/storage/workspace-templates/docs/airp.ts` and `files.ts` if embedded text references old layout.

### Checked-in card mirror

The repository also contains a packaged/example card under `cards/沉浸阅读器.tsian-card/` with mirrored frontend and workspace scripts. Implementation should keep this mirror consistent when source changes are intended to ship with the card package.

## 3. Source Storage Contract

### 3.1 New file layout

New imports write shard files instead of one file per chapter:

```text
save/source/manifest.json
save/source/chapters.index.json
save/source/shards/source-shard-0001.md
save/source/shards/source-shard-0002.md
...
```

`save/source/chapters/` remains a legacy path only. New imports do not write `save/source/chapters/chapter-*.md`.

### 3.2 Manifest additions

Keep the existing manifest fields used by the frontend and `buildOpeningInitializationPrompt`, and add storage metadata:

```json
{
  "version": 1,
  "status": "ready",
  "title": "...",
  "sourceFormat": "txt",
  "importMode": "file",
  "recommendedExtractionMode": "frontier",
  "chapterDetection": "heuristic",
  "chapterDetectionConfidence": "strong",
  "normalizationVersion": "novel-source-sharded-v1",
  "totalCharacters": 20000000,
  "chapterCount": 5000,
  "files": {
    "chaptersIndex": "save/source/chapters.index.json",
    "shardsRoot": "save/source/shards/"
  },
  "storage": {
    "kind": "sharded",
    "targetShardCharacters": 1000000
  }
}
```

`files.chaptersRoot` can stay optional for legacy compatibility, but new code should prefer `files.shardsRoot`.

### 3.3 Chapter index v2

Use a new index `version: 2` for sharded imports. Offsets are JavaScript string offsets inside the shard file content, not byte offsets.

```json
{
  "version": 2,
  "storage": {
    "kind": "sharded",
    "targetShardCharacters": 1000000,
    "shardsRoot": "save/source/shards/"
  },
  "shards": [
    {
      "id": "source-shard-0001",
      "path": "save/source/shards/source-shard-0001.md",
      "startChapter": 1,
      "endChapter": 47,
      "characters": 998120
    }
  ],
  "chapters": [
    {
      "index": 1,
      "ref": "source:chapter-0001",
      "title": "第一章 ...",
      "characters": 18234,
      "source": {
        "kind": "shard",
        "shardId": "source-shard-0001",
        "path": "save/source/shards/source-shard-0001.md",
        "start": 0,
        "end": 18301
      }
    }
  ]
}
```

Legacy index remains:

```json
{
  "version": 1,
  "chapters": [
    { "title": "第一章 ...", "path": "save/source/chapters/chapter-0001.md", "characters": 18234 }
  ]
}
```

### 3.4 Chapter reference semantics

New code should distinguish:

- `chapter.index` — numeric chapter number, player/Agent-visible ordering.
- `chapter.ref` — stable logical chapter reference for runtime state, e.g. `source:chapter-0001`.
- `chapter.source.path` — shard file path for storage only.
- `chapter.path` — legacy single-chapter file path; may be absent in v2.

`frontier.sourceWindow.chapters[*]` should store only small metadata needed by UI and future validation:

```json
{ "index": 1, "title": "第一章 ...", "ref": "source:chapter-0001" }
```

For legacy saves, existing `{ index, title, path }` entries remain valid.

`frontier.extractedThrough` remains a string but should be interpreted as a source reference. New writes use `chapter.ref`; legacy values may be chapter file paths.

## 4. Shard Building Algorithm

### 4.1 Worker ownership

Move expensive pure text processing to a Web Worker:

1. Normalize text.
2. Detect chapter candidates.
3. Split source chapters or fallback pseudo chapters.
4. Format each chapter as the existing markdown body (`# title\n\n...`) for reader compatibility.
5. Build shard strings and index metadata.
6. Post progress and final corpus metadata to the main thread.

Workspace writes stay in the main thread because only the play bridge can write workspace files.

### 4.2 Shard boundaries

- Target shard size: about `1_000_000` characters.
- Prefer chapter boundaries: add whole chapters until the next chapter would exceed the target, then flush.
- If one chapter exceeds the target, put that chapter in its own shard.
- Use deterministic shard ids: `source-shard-0001`, `source-shard-0002`, ...
- Use deterministic chapter refs: `source:chapter-0001`, `source:chapter-0002`, ...

### 4.3 Memory shape

Worker returns:

```ts
interface BuiltShardedSourceCorpus {
  manifest: SourceManifest
  chapterIndex: ChapterIndexFile
  shards: Array<{ path: string; content: string; characters: number }>
}
```

It should not return per-chapter full `content` arrays. This removes the largest duplicated structure from main-thread state.

## 5. Frontend Import Flow

### 5.1 `startImport`

Replace the synchronous `buildSourceCorpus()` call in `useSetupState.ts` with a worker-backed builder:

1. `statusText = "读取文本…"`
2. `statusText = "整理章节…"` while worker normalizes/detects/splits.
3. Worker progress updates `statusText`, for example:
   - `整理文本…`
   - `识别章节…`
   - `构建分片 12/38…`
4. Main thread writes shards sequentially or with small bounded concurrency if safe, updating:
   - `写入源文本 12/38…`
5. Write `chapters.index.json` and `manifest.json` last.
6. Set `manifest`, `chapterIndex`, `selectedChapter`, and show review.

Writing manifest last preserves a simple ready signal: if import fails mid-shard, `manifest.status === "ready"` is not written for the partial import.

### 5.2 Status display

`statusText` is currently returned by `useSetupState()` but `SetupWizard.vue` does not render it. Add a subtle status line in the setup stage or action bar while `busy` is true so long imports show live progress instead of a disabled “导入中…” button only.

## 6. Frontend Chapter Reader

Add a shared frontend reader helper, for example in `lib/source-reader.ts`:

```ts
async function readSourceChapter(tsian, chapter, cache): Promise<string> {
  if (chapter.source?.kind === "shard") {
    const shard = await cachedRead(chapter.source.path)
    return shard.slice(chapter.source.start, chapter.source.end)
  }
  if (chapter.path) {
    const file = await tsian.workspace.read(chapter.path)
    return file?.content ?? ""
  }
  throw new Error("章节索引缺少可读取的 source 引用")
}
```

Use this for:

- `loadChapterPreview(chapter)` in `useSetupState.ts`.
- Any future frontend source preview logic.

`SplitReview.vue` should pass the whole chapter object rather than only `ch.path`.

## 7. Runtime Template Source Reader

### 7.1 Common helper functions

Update `OPENING_COMMON_JS` in `apps/platform-web/src/storage/workspace-templates/scripts/opening.ts` to normalize both v1 and v2 chapter entries.

Recommended helper shape inside `_common.js`:

```js
function normalizeChapter(raw, index) {
  const title = ...
  if (isRecord(raw.source) && raw.source.kind === 'shard') {
    return {
      index: index + 1,
      ref: typeof raw.ref === 'string' ? raw.ref : 'source:chapter-' + pad4(index + 1),
      title,
      characters,
      source: { kind: 'shard', path, start, end }
    }
  }
  if (typeof raw.path === 'string') {
    return { index: index + 1, ref: raw.path, title, path: raw.path, characters }
  }
  fail(...)
}

async function readSourceChapter(tsian, chapter, cache) { ... }
async function readSourceChapterWindow(tsian, chapters) { ... }
function sourceRefForChapter(chapter) { return chapter.ref || chapter.path }
```

`readSourceChapterWindow` should cache shard contents within a single script invocation so reading 15 adjacent chapters usually reads one shard file once.

### 7.2 Opening scripts

Update:

- `inspect_source_opening`
- `read_opening_slice`
- `commit_runtime_and_frontier`
- `normalizeWindow`

They should accept and emit `ref` for v2, while continuing to accept `path` for legacy.

`read_opening_slice` should return selected chapters with compact metadata:

```js
{ index, title, ref, characters, charactersRead, truncated }
```

Avoid returning shard offsets to the model unless needed; storage details are not useful for Agent reasoning.

### 7.3 Frontier scripts

Update:

- `read_frontier_window`
- `commit_frontier_state`

`read_frontier_window` should read chapter contents via the shared source reader and return `window.chapters` with `ref` metadata. `commit_frontier_state` should validate `sourceWindow.chapters[*].ref` against known refs, with legacy `path` fallback.

### 7.4 AI-facing content

Update descriptions that currently teach Agents to use `sourceWindow.chapters[*].path` or `save/source/chapters/` directly:

- Opening/frontier Skill markdown in `world-architect.ts`.
- Researcher `AGENT.md` / `资料检索` skill guidance.
- Source corpus README / AIRP docs that list old chapter-file layout.

Avoid exposing shard internals as a decision the model needs to make. Prefer wording such as “use the source reading action / chapter index; source storage may be sharded”.

## 8. Review UI Virtualization

`SplitReview.vue` should not render `chapters.length` buttons directly.

Implement a local fixed-height virtual list:

- Keep `.review-panes` height at 380px.
- Define a fixed row height matching `.chapter-card` visual height.
- Track `scrollTop` on `.chapter-list`.
- Compute visible range plus overscan.
- Render only visible rows inside a spacer with total height.
- Preserve selection and preview loading.
- When `selectedChapterWritable` changes programmatically, scroll selected row into view if needed.

Disable or limit GSAP stagger:

- Animate only the first visible batch, or skip list animation when `chapters.length > 200`.
- Never query and animate all `.chapter-card` nodes for a large import.

## 9. Compatibility / Migration

### New imports

- Always produce v2 sharded index.
- Do not write one file per chapter.
- Do not delete old source files; reimport only happens in the opening wizard and the new index/manifest become the source of truth.

### Existing formal-play saves

- Runtime source readers keep legacy `chapter.path` support.
- No automatic migration.
- No requirement to make old v1 sources re-enter the opening wizard flow.

### Workspace template upgrades

If template script/helper files are modified, bump the default workspace template version or add the relevant paths to the save-runtime upgrade set only when existing saves need the new runtime scripts. This task does need existing formal-play saves to keep frontier compatible, so runtime template upgrade behavior must be considered for changed `agents/*/skills/**` script files.

## 10. Rollback Considerations

- If worker build/import has issues, main-thread builder can be temporarily reintroduced behind the same `buildSourceCorpusAsync` function, but not as the final target for this task.
- Sharded imports are durable once `manifest.json` is written; partial failed imports without manifest ready should be ignored by initialization.
- If shard reader fails, error messages should identify the missing shard path and chapter ref.

## 11. Validation Strategy

- Unit-like manual check with a synthetic generated novel around the target shape: 5000 chapters / large text. Verify shard count is tens, not thousands.
- Verify `chapters.index.json` v2 reads in the review UI.
- Verify `inspect_source_opening` and `read_opening_slice` return readable text from shards.
- Verify `read_frontier_window` reads adjacent shard-backed chapters and still respects 15-chapter / 120000-character limits.
- Verify a legacy v1 `chapters.index.json` with `chapter.path` still reads through runtime source scripts.
- Build checks: `npm run build --workspace play-frontend-dev`; `npm run build:web`; `npm run build:contracts` only if shared contract files are edited.
