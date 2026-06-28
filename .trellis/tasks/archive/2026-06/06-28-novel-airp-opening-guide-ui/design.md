# 小说 AIRP 开局向导 UI 范式 — Design

## 1. Positioning

This task turns the current source import form in `apps/play-frontend-dev` into a reusable opening setup shell.

The shell is a pre-play mode, not an overlay on the normal game UI. It should feel like preparing a book before entering the story: clear, calm, and focused on the next setup decision.

## 2. Layout Model

### 2.1 Full-screen setup shell

```text
setup-shell
  setup-header
  setup-body
    step-rail
    setup-stage
  setup-action-bar
```

Responsibilities:

- hide the normal composer while setup is active;
- prevent the normal game interface from visually leaking behind the guide;
- keep the step preview and bottom actions stable while step content changes;
- provide enough layout room for future Agent dialogue and character selection steps.

### 2.2 Step rail

Initial step list:

1. 导入小说
2. 初始理解
3. 角色设定
4. 游玩倾向
5. 开局确认

For this task, only the first step is interactive. Later steps are shown as upcoming/locked so the player understands the process without being able to enter unimplemented steps.

### 2.3 Stage

The stage hosts the active setup step. It should not know about every future step, but it should accept a title area, content area, optional status/result area, and bottom action state.

## 3. Import Step State Flow

The import step has its own subflow:

```text
choose-method -> paste-input -> split-review
              -> file-input  -> split-review
```

Rules:

- `choose-method` shows only two card buttons: `粘贴文本` and `导入文件`.
- Method cards use player-facing copy only. They should describe fit, not implementation decisions.
- `paste-input` contains text paste and optional title input.
- `file-input` contains file picker and optional title input.
- Both input states provide a low-emphasis `更换导入方式` affordance back to `choose-method`.
- Successful import always transitions to `split-review` instead of only updating status text.
- If a source corpus already exists and setup is still active, the guide starts at `split-review`.

## 4. Split Review

### 4.1 Overview

The top of split review shows only the information players need to judge whether the import looks right:

- book title;
- chapter count;
- total text size.

Do not show import mode, detection confidence, algorithm names, or verbose guidance.

### 4.2 Chapter list

The chapter list is the primary diagnostic surface. Each item shows:

- ordinal number;
- chapter title;
- character count.

No separate abnormality labels are needed. Players can judge odd titles and unusually short/long chapters from the list itself.

### 4.3 Preview panel

The split review body uses a two-pane layout:

```text
[chapter list] [inline preview panel]
```

Interaction:

- default-select the first chapter when available;
- clicking a chapter updates the preview panel;
- preview displays only the chapter opening excerpt, not the full chapter;
- preview is inline inside the setup shell, not a modal;
- narrow screens may stack the preview below the list.

The preview can read from in-memory chapter content immediately after import or from `save/source/chapters/*` when rendering an existing corpus.

## 5. Re-import Boundary

Re-import is allowed while the opening setup is not complete.

In split review, provide a clear but secondary `重新导入` / `换源` action. It should warn that the current source corpus and chapter index will be overwritten. The task does not keep import history, perform manual chapter editing, or support formal post-opening re-import.

## 6. Source Index Shape

The existing chapter index is intentionally lightweight. To support split review without loading every chapter just to draw the list, add only a character count field:

```json
{
  "title": "第一章",
  "path": "save/source/chapters/chapter-0001.md",
  "characters": 6812
}
```

The preview panel can load chapter text on demand by `path`.

## 7. Visual Direction

Use the existing dark parchment / ember tone, but shift the guide away from a backend form:

- large calm shell, not a centered utility card;
- keep the background full-screen but keep the operable workspace compact; leave negative space for later decorative/animated elements;
- keep the process rail slim and quiet; it is orientation, not the main content;
- avoid a large hero title at the top of the setup shell; use a small top bar and let the current step title lead the interface;
- method cards feel like choosing how to place a book on the desk;
- split review feels like a table of contents with a reading pane;
- bottom actions stay persistent and predictable.
