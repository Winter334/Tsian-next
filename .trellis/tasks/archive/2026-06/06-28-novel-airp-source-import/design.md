# 小说 AIRP 整本导入与 source normalization — Design

## 1. Scope

This child task creates the source corpus pipeline for the default novel AIRP card. It should produce stable workspace files under `save/source/` so later child tasks can extract entities, design schema, assemble openings, and refresh source frontier.

It does not perform semantic extraction or model-driven understanding.

## 2. Workspace Output Contract

Recommended first-version output:

```text
save/source/
  manifest.json
  chapters.index.json
  chapters/
    chapter-0001.md
    chapter-0002.md
```

Chapter files are the canonical source text for v0. The importer should not also write a full `normalized.md` copy by default, because long novels would duplicate large text inside the save workspace.

Chapter file paths should use stable sequence ids rather than chapter titles:

```text
save/source/chapters/chapter-0001.md
save/source/chapters/chapter-0002.md
```

Detected chapter titles belong in `chapters.index.json` and may be written as the Markdown heading inside the chapter file. They should not be used as primary file names because titles may be long, duplicated, malformed, localized, or contain path-hostile characters.

If chapter headings are not reliable, the importer should generate chapter-like files with stable pseudo ids:

```text
save/source/chapters/pseudo-chapter-0001.md
save/source/chapters/pseudo-chapter-0002.md
```

These pseudo chapters should be close to normal chapter granularity so later frontier extraction can still advance by meaningful source units.

## 3. Manifest Contract

`save/source/manifest.json` should stay small. It is the whole-book summary and points to the chapter index; it is not a chapter database. Minimum shape:

```json
{
  "version": 1,
  "status": "ready",
  "title": "Imported Novel",
  "sourceFormat": "txt",
  "importMode": "file",
  "recommendedExtractionMode": "frontier",
  "chapterDetection": "heuristic",
  "chapterDetectionConfidence": "strong",
  "originalFileName": "qinghuanie.txt",
  "importedAt": "2026-06-28T00:00:00.000Z",
  "normalizationVersion": "novel-source-v1",
  "totalCharacters": 123456,
  "chapterCount": 42,
  "files": {
    "chaptersIndex": "save/source/chapters.index.json",
    "chaptersRoot": "save/source/chapters/"
  }
}
```

`save/source/chapters.index.json` is a minimal table of contents. Keep entries simple unless a later task proves more fields are needed:

```json
{
  "version": 1,
  "chapters": [
    {
      "title": "第一章 ...",
      "path": "save/source/chapters/chapter-0001.md"
    }
  ]
}
```

Array order is chapter order. Do not add `id`, `index`, `kind`, or `characterCount` by default in v0. Later semantic tasks should cite `path` strings directly in `sourceRefs`.

## 4. Normalization

Normalization should be conservative:

- normalize CRLF/CR to LF;
- remove UTF-8 BOM and obvious NUL/control characters except tabs/newlines;
- trim trailing whitespace per line;
- collapse excessive blank lines to a small bounded count;
- preserve paragraph order and original wording;
- do not rewrite prose, summarize, translate, or remove content based on meaning.

The implementation should keep the algorithm deterministic and versioned via `normalizationVersion`.

## 5. Chapter Detection

Use a conservative heuristic chapter splitter, not model calls. The goal is to cover common novel chapter formats without aggressively guessing arbitrary short lines.

Use three confidence groups.

Strong patterns can be accepted directly when they appear as independent short lines:

- `第1章` / `第一章` / `第十二回` / `第 3 节`;
- title-less chapter markers such as `第三章` on their own line;
- `Chapter 1` / `CHAPTER I`;
- Markdown headings like `# 第一章 ...` or `## Chapter 1`.

Medium patterns are accepted when they appear as independent short lines and do not look like prose:

- `序章`, `序幕`, `楔子`, `引子`;
- `番外`, `番外一`, `后记`, `尾声`;
- `第一卷 ...`, `卷一 ...`, `正文 第一章 ...`.

Weak patterns require continuity/context validation before use:

- `1. ...`, `01 ...`, `001、...`;
- bare numeric or numbered-list-looking headings.

Weak matches should only be adopted when multiple candidates form a plausible increasing sequence and chapter-like spacing. Otherwise ignore them and use pseudo chapters if no stronger structure exists.

General anti-false-positive guards:

- candidate line should be short, roughly no more than 40-60 Chinese characters after trimming;
- candidate line should be on a paragraph boundary, ideally with blank lines nearby;
- avoid lines ending with prose punctuation such as `。`, `？`, `！`, or closing dialogue quotes unless the pattern is strong;
- if detected chapters are too sparse, too dense, or mostly tiny, prefer fallback pseudo chapters.

Fallback behavior:

- If no reliable heading is found, create `chapter-0001.md` for the whole text or use length-based pseudo chapters if the text is too large for one chapter file.
- Do not fail import only because chapter headings are absent.
- When headings are detected, preserve the detected heading text as `chapters[].title` in `chapters.index.json`. The file path remains a stable numbered path such as `save/source/chapters/chapter-0007.md`.

## 6. Chapter-Like Fallback

Do not default to writing many physical chunk files during import.

The v0 importer's physical output unit should be chapter-level files:

- real chapters when headings are clear;
- pseudo chapters when headings are absent, ambiguous, or too sparse.

Pseudo chapter sizing should approximate ordinary chapters rather than tiny chunks. Use a target of about 15k Chinese characters, split preferentially at paragraph boundaries, and hard-split only when a single paragraph is too long. The goal is to produce meaningful source units rather than thousands of fragments.

If later semantic indexing needs smaller chunks, that child task can generate derived chunk ranges or materialized chunk files from these chapter-level source files. For v0 source import, manifest may include range metadata later, but physical chunk files are out of default scope.

## 7. Frontend Flow

The default game card should not implement save management. Platform save management already decides whether the player is in a new or existing save. The game card frontend should treat the currently mounted workspace as the active save.

Long-term, the first screen can play an opening animation before entering setup. This child task does not implement that animation, but the UI should be structured as a setup shell rather than a hidden settings action.

Minimal first-run flow inside the default frontend:

1. Detect whether `save/source/manifest.json` exists and has `status: "ready"`.
2. If absent, show the first step of the opening setup guide: import novel.
3. Let the player choose paste text or select `.txt` / `.md`.
4. Treat paste as short text / fragment oriented input and file import as long novel oriented input.
5. Normalize and split into chapter-level files client-side in the frontend bundle for v0.
6. Write chapter files, `chapters.index.json`, and manifest through `tsian.workspace.write`.
7. Show import summary and allow proceeding to later setup tasks.

Import status should expose coarse phases: read text, normalize, detect chapters, write workspace, completed or failed. On failure, do not write a ready manifest.

This task may implement the UI in the current packaged frontend to keep scope limited. A later task may migrate the default frontend source of truth to `apps/play-frontend-dev`.

The import mode should be persisted in manifest:

- paste text -> `importMode: "paste"`, `recommendedExtractionMode: "full"`;
- file import -> `importMode: "file"`, `recommendedExtractionMode: "frontier"`.

This preserves the player's import intent for later extraction. Paste mode is intended for short novels, fragments, and small corpora where full extraction may be practical. File mode is intended for long or very long novels where scripts only prepare chapter-level source units and Agents later decide how many early chapters are enough for opening setup.

After import, later child tasks continue the setup flow:

```text
source import
  -> initial extraction
  -> player chooses original character or creates original character through Agent-guided dialogue
  -> Agent writes player setup to workspace
  -> Agent assembles opening prose and options
  -> normal play begins
```

Those later steps should be visually connected through animation/transition work, but this source import task should only create the import step and the source files needed by the next step.

Opening setup after source import should use a hybrid guide form in a later task:

- UI handles structured choices such as original-vs-canon character, play mode, candidate card confirmation, and step transitions.
- `architect` handles open-ended dialogue such as original character background, cheat/power constraints, relationships to canon, and opening preferences.
- Setup dialogue should write draft files first, then commit official player/mode/entity/director-brief files only after player confirmation.

This source-import task should stop at an import summary and next-step placeholder. It should not reuse the normal play composer for setup dialogue yet, and it should not implement the full setup draft/commit flow.

## 8. Agent And Skill Boundary

Novel AIRP should prefer a small Agent roster extended by focused Skills, but the default roster should be novel-specific enough that responsibilities are clear.

Recommended v0 roster:

```text
master
architect
lorekeeper
post-processing
```

Responsibilities:

- `master`: the only normal play-facing narration Agent. It handles player actions, reads current brief/player-visible runtime data, and writes final player-visible prose and options.
- `architect`: the setup and world-construction Agent. The frontend may call it directly during opening setup through `tsian.invokeAgent`. It handles opening guide steps, schema/world setup, original-character interview flow, opening assembly, and later schema/director brief maintenance when requested.
- `lorekeeper`: the source/canon/spoiler-safety Agent. It reads source manifest, chapter index, chapter files, entities, and schema; returns concise canon findings and spoiler-safe material. It should not own narrative pacing.
- `post-processing`: the after-turn maintenance Agent. It writes runtime/entity/frontier/branch updates and checks whether schema, source frontier, or director brief is stale. It may call `architect` or `lorekeeper` when maintenance requires design or source reasoning.

Director capability should not be a separate always-on Agent in v0. It should first live as a `director-brief` Skill loaded by `architect`. The flow is:

```text
lorekeeper -> canon/source facts and spoiler boundaries
architect + director-brief Skill -> current creative direction brief
post-processing -> staleness detection and refresh trigger
master -> final player-visible narration
```

This keeps `lorekeeper` factual and `architect` creative/structural. Split a dedicated `director` Agent only if later playtesting shows that narrative direction needs long-lived independent context or frequent direct calls.

Potential Skills are better first homes for:

- source chapter selection and source hygiene checks;
- canon-safe summarization and spoiler filtering;
- original-character setup interview;
- original-canon-character selection guidance;
- opening assembly and director brief drafting.

This source-import child task does not implement those Agents or Skills. It only ensures the source files and indexes are easy for later Skills/Agents to consume.

## 9. Single Import Strategy

First version should use one active source corpus per save and should not expose a normal player re-import action.

Rationale:

- `sourceRefs`, `frontier`, extracted entities, branch summaries, and opening setup all depend on one coherent source corpus;
- replacing source in-place would require invalidating or migrating many later files;
- platform save management already gives the player a safe path: create a new save if the source import is wrong.

If developer/debug tooling later needs re-import, it should be clearly separate from the player setup flow and should not be part of v0 acceptance.

## 10. Compatibility

- Existing saves without source manifest should continue to open and show the import prompt.
- Existing workspace schema guide files remain valid.
- Other game cards are not affected unless they reuse the default packaged frontend.
- The source contract is additive to the save workspace and does not require platform database migrations.

## 11. Risks

- Very large files may make client-side splitting slow; v0 should provide progress/status and may set a documented soft size warning rather than solving background jobs.
- Existing imported source should not be mutated in-place through normal player UI; downstream code should rely on manifest as the active corpus index.
- Chapter heuristics will be imperfect; fallback must preserve import success.
- Implementing in current inline packaged frontend increases edit friction, but keeps this task independent from the larger frontend build-chain migration.
