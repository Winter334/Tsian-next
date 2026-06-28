# 小说 AIRP 开局向导 UI 范式 — Implementation Plan

## 1. Files

Primary implementation files:

- `apps/play-frontend-dev/src/source-import.ts`
- `apps/play-frontend-dev/src/style.css`

Potentially touched only if needed:

- `apps/play-frontend-dev/src/main.ts`

Do not modify packaged default frontend files.

## 2. Data Changes

Update `ChapterIndexFile` entries to include `characters`.

When building the source corpus:

- compute character count from the final written chapter content or the cleaned chapter body, consistently enough for player-facing scale judgement;
- write `characters` into `save/source/chapters.index.json`;
- keep existing manifest fields for compatibility.

When reading existing corpora:

- load `manifest.json`;
- load `chapters.index.json` if present;
- render split review from index metadata;
- load preview text from the selected chapter path on demand.

## 3. Component / Function Refactor

Refactor `source-import.ts` around small render helpers:

- `renderSetupShell(...)`
- `renderStepRail(...)`
- `renderSetupActionBar(...)`
- `renderImportStep(...)`
- `renderMethodChoice(...)`
- `renderPasteInput(...)`
- `renderFileInput(...)`
- `renderSplitReview(...)`
- `renderChapterPreview(...)`

Keep these as plain DOM helpers consistent with the current frontend style.

## 4. Import Step Behavior

Implement local import UI state:

```text
type ImportStepView = "choose" | "paste" | "file" | "review"
```

Behavior:

- no existing source: start at `choose`;
- existing source: start at `review`;
- choosing a card moves to `paste` or `file`;
- `更换导入方式` returns to `choose`;
- import success writes source files, index, manifest, then moves to `review`;
- `重新导入` warns about overwrite, then moves to `choose`.

## 5. Split Review Behavior

Render:

- top overview: title, chapter count, total characters;
- left chapter list with ordinal, title, character count;
- right inline preview panel;
- first chapter selected by default;
- clicking chapters updates selected state and preview;
- preview displays a capped opening excerpt.

## 6. Styling

Replace the narrow setup card style with:

- full-screen `.setup-shell`;
- `.setup-header`;
- `.setup-body`;
- `.setup-step-rail`;
- `.setup-stage`;
- `.setup-action-bar`;
- method cards;
- split review overview/list/preview classes.

Maintain responsive behavior for narrower screens by stacking rail/stage or list/preview where needed.

## 7. Validation

Run:

```bash
npm run build --workspace play-frontend-dev
```

Manual verification with dev platform/frontend:

- new save shows full-screen setup shell and no composer;
- method choice shows only two import cards;
- each method enters its own input UI and can return;
- import success shows split review;
- chapter list and preview work;
- re-import path returns to method choice with overwrite warning;
- existing imported save opens directly to split review.
