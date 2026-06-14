# Runtime Workspace Completeness Design

## Architecture Boundary

Runtime Workspace remains a save-scoped virtual filesystem stored by `apps/platform-web/src/storage/workspace.ts` and surfaced through platform-host bridge queries, Agent Runtime tools, and browser-script SDK workspace operations.

This task strengthens the filesystem contract; it does not introduce final UI, gameplay schemas, or a second storage model.

## Data Flow

```text
Dexie workspaceFiles
  -> storage helpers normalize paths, media types, visibility, mutation ownership
  -> platform-host bridge queries/actions adapt unknown params and return contract shapes
  -> Agent Runtime tools and browser-script SDK expose ordinary workspace read/list/search/write/delete
  -> internal platform paths use raw file access or explicit platform-only writes
  -> checkpoints store/restore the full file set
```

## Visibility Contract

Path classes:

- Ordinary workspace data: every path outside `.tsian/*`.
- Platform metadata: `.tsian` and every path below `.tsian/`.
- Platform trace metadata: `.tsian/traces/*`, a subset of platform metadata.
- Generated platform index/cache data: `.tsian/indexes/*` and `.tsian/cache/*`, platform-owned and replaceable.

Default ordinary surfaces:

- `workspace-list`
- `workspace-search`
- `workspace-read`
- live Agent `workspace_list`
- live Agent `workspace_search`
- live Agent `workspace_read`
- browser-script SDK `workspace.list`
- browser-script SDK `workspace.search`
- browser-script SDK `workspace.read`

All default ordinary surfaces hide or reject `.tsian/*`.

Platform-owned access:

- checkpoint create/restore reads and writes full workspace snapshots;
- runtime trace persistence writes `.tsian/traces/...` through `writePlatformFile`;
- runtime diagnostics reads raw workspace files internally and produces bounded facts-only summaries;
- future management/debug UI should get a dedicated resource if raw metadata browsing becomes necessary.

Ordinary bridge workspace queries do not get a hidden opt-in parameter for `.tsian/*` in this child. This avoids making platform internals part of the normal workspace API surface.

## Mutation Contract

Ordinary mutation paths must reject `.tsian/*`:

- staged transaction `write` / `delete`;
- browser-script SDK `workspace.write` / `workspace.delete`, because they use staged ordinary mutation methods;
- Agent Runtime platform action runner for `workspace-write` / `workspace-delete`;
- direct bridge `platform.runAction` for `workspace-write` / `workspace-delete`;
- storage-level public `writeWorkspaceFileForSave` / `deleteWorkspacePathForSave` unless explicitly made platform-only by a separate helper.

Platform-owned mutation paths must stay explicit:

- existing staged `writePlatformFile` for trace writes;
- checkpoint restore and workspace replacement paths that materialize full saved snapshots;
- future import/migration helpers may use a clearly named platform metadata mode.

## Contract Shapes

Existing `WorkspaceEntry`, `WorkspaceFile`, and `WorkspaceSearchResult` remain sufficient. If shared query param types are added, they should live in `packages/contracts/src/runtime.ts` and keep framework-neutral names.

Recommended optional param shape if needed:

```ts
interface WorkspaceQueryParams {
  path?: string
  query?: string
  limit?: number
}
```

Do not add gameplay-specific fields or platform implementation details to `WorkspaceFile`.

## Compatibility

- Keep seeded default workspace files and workspace version compatible unless content wording changes require a manifest version bump.
- Remove ordinary-query reliance on `includePlatformTraces`; do not make trace-specific visibility flags the public future model.
- Existing bridge consumers that list/search ordinary files should see fewer platform entries, not shape changes.
- `runtime-diagnostics` must not depend on ordinary workspace visibility filters.
- Registry/context/Skill parsing should continue scanning full file sets internally where needed, but should naturally ignore `.tsian/*` because Agent and Skill paths live outside `.tsian`.

## Import / Export / Migration Implications

This child does not build file picker import/export. It establishes the rules future tasks should follow:

- Full save/checkpoint export includes the full workspace file set, including `.tsian/*`, because restore needs platform metadata.
- Ordinary author-facing workspace export should omit `.tsian/*` unless a future debug/management mode explicitly chooses otherwise.
- `.tsian/indexes/*` and `.tsian/cache/*` are derived platform data and may be dropped or rebuilt by future import/migration tasks.
- Workspace manifest should remain platform-owned and not become an ordinary gameplay schema file.

## Rollback / Operational Notes

- If metadata visibility changes break a consumer, restore ordinary reads/list/search to trace-only filtering while keeping mutation protection.
- If direct bridge action protection breaks an intentional platform path, add a separate explicitly named platform helper instead of loosening ordinary write/delete.
- Failed runtime turns must continue to discard ordinary staged mutations and best-effort persist failed trace facts.

## Validation Strategy

- Build contracts if shared types change.
- Build platform web.
- Run a focused probe against pure storage/Agent Runtime helper behavior:
  - list/search/read hide `.tsian/*`;
  - ordinary write/delete rejects `.tsian/*`;
  - platform trace write path can still stage `.tsian/traces/...`;
  - diagnostics builder still consumes traces internally;
  - checkpoint replacement helpers preserve `.tsian/*`.
