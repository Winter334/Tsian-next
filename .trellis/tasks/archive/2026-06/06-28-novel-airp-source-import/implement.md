# 小说 AIRP 整本导入与 source normalization — Implementation Plan

## Checklist

1. Locate development frontend import point
   - Implement in `apps/play-frontend-dev`, not `apps/platform-web/src/storage/default-frontend-files.ts`.
   - Keep default packaged frontend untouched until the development frontend is ready to replace it.

2. Add source processing helpers
   - Add deterministic normalization, title detection, chapter splitting, pseudo-chapter fallback, id formatting, and manifest creation.
   - Implement conservative strong/medium/weak chapter detection; weak numeric-heading rules require continuity validation.
   - Use about 15k Chinese characters as the pseudo chapter target size, preferring paragraph boundaries.
   - Use stable sequence ids for chapter paths; keep detected titles in `chapters.index.json` and chapter Markdown headings only.
   - Build `chapters.index.json` as a minimal table of contents with `{ path, title }` entries only.
   - Prefer pure functions so they can be unit tested outside DOM code if a nearby test harness exists.

3. Add import UI
   - Add first-run setup shell, paste textarea, `.txt` / `.md` file picker, import button, status text, and summary display.
   - Load existing `save/source/manifest.json` on startup and show imported summary when ready.
   - Do not expose a normal player re-import/replace action after a ready manifest exists.
   - After successful import, show a next-step placeholder for opening setup; do not implement architect dialogue in this task.

4. Write workspace files
   - Use `tsian.workspace.write` only through `@tsian/play-bridge` API.
   - Write chapter-level source files, then `save/source/chapters.index.json`, then `save/source/manifest.json` last with `status: "ready"`.
   - Do not write physical chunk files by default during import.
   - Include `importMode`, `recommendedExtractionMode`, `chapterDetectionConfidence`, and `originalFileName` when available.
   - On failure, show error and avoid presenting import as complete.

5. Handle existing source
   - When manifest exists and is ready, show imported summary and next-step placeholder rather than import controls.
   - Use platform save management as the supported way to retry import: create a new save.

6. Validate behavior
   - Import sample Chinese chaptered text.
   - Import sample text without chapter headings.
   - Import sample Markdown with headings.
   - Verify workspace contains manifest, `chapters.index.json`, and chapter-level source files.
   - Verify chapter index entries contain only required `path` and `title` fields.
   - Verify no-heading text produces pseudo chapter files with fallback metadata.
   - Verify ready saves do not show a normal player re-import action.

7. Keep Agent implementation out of scope
   - Do not implement the novel Agent roster in this source-import task.
   - Ensure source outputs are documented enough for later `master`, `architect`, `lorekeeper`, and `post-processing` Agents and their Skills.

## Likely Files

```text
apps/play-frontend-dev/src/main.ts
apps/play-frontend-dev/src/style.css
apps/play-frontend-dev/src/source-import.ts
packages/play-bridge/src/tsian-api.ts
```

The exact modified files should stay minimal. If implementation remains in packaged frontend only, do not touch the play-frontend-dev build chain.

## Validation Commands

Run targeted checks first, then broader checks if feasible:

```bash
pnpm --filter @tsian/play-bridge typecheck
pnpm --filter platform-web typecheck
pnpm lint
```

If package scripts differ, inspect `package.json` and run the closest available type/lint command.

## Rollback

Reverting the frontend import UI and source processing helper changes should return the default card to the previous state. Workspace files written into individual saves are user data and should not require migration rollback.

## Pre-Start Review Notes

Before `task.py start`, review the final PRD/design/implementation plan with the user. No blocking open question is currently recorded.
