# Module Structure Guide

> **Purpose**: Keep source files focused on one responsibility. Prevent god files where unrelated concerns pile up in a single module.

---

## The Principle

**One file, one responsibility. When a file accumulates unrelated concerns, split it along the natural seams.**

This is a structural principle, not a line-count rule. A 1000-line file that is cohesively about one thing is fine; a 500-line file mixing four unrelated domains is not. The signal to split is **unrelated concerns in the same file**, not file length.

---

## Why This Matters

God files (files packing multiple unrelated responsibilities) carry real, measurable costs:

- **Change localization breaks**: a task touching one concern produces a diff flooded with unrelated code, drowning review and `git blame` signal.
- **Testability drops**: pure helpers trapped inside a god file can only be tested through the file's full surface; extracted, they're directly unit-testable.
- **Dependencies become opaque**: a file importing 30+ symbols across 6 packages usually signals it's doing 6 things. Splitting reveals each sub-module's true, smaller dependency fan-out.
- **Tooling degrades**: language servers slow down on very large files; symbol search, go-to-definition, and rename results get noisy.

History: `platform-host/index.ts` grew to 3722 lines packing 7 unrelated concerns (assistant chat, covers, studio agents, local assistant config, workspace operations, game-card management, bridge assembly). Task `06-22-split-platform-host-index` split it incrementally.

---

## Thinking Triggers — When to Split

Use this guide when:

- [ ] You're about to add a new function and realize it has nothing to do with the file's other contents.
- [ ] A file's imports span 4+ unrelated domains (e.g. storage + agent-runtime + bridge + AI + streaming + config in one file).
- [ ] Multiple helpers in a file are only ever called from one small region of that file — they "belong" to that region, not the file.
- [ ] You can describe a file's contents as "X and Y and Z" (conjunction of unrelated things) rather than "X, which involves Y and Z" (one thing with collaborators).
- [ ] A file has clear line-segment boundaries where each segment is self-contained and could be moved out without touching the others.
- [ ] `git log` shows changes to a file are always in one region — other regions exist but never change in the same commit.

---

## How to Split

### Find the seams

A seam is a boundary where one responsibility ends and another begins. Seams are found by **call graph and data flow**, not by line count:

1. List the file's functions/types. Group them by which external modules they talk to.
2. Find functions that only call each other (clusters) — those are candidate sub-modules.
3. Identify shared state (module-level variables touched by multiple clusters) — it needs a home (shared core module or accessor).
4. Check for exported functions that consumers depend on — the original file must re-export them to preserve the public API.

### Split incrementally

- **One seam per commit**, each followed by a green build. A failed commit is `git revert`-ed; prior seams stay.
- **Keep the original file as a barrel** (re-export) so consumer import paths don't change. Internal restructuring should be invisible to the public API.
- **Watch for circular imports**: if sub-module A needs a helper that stays in the original file, extract that helper to a shared internal module rather than importing the barrel. Circular `index ↔ sub-module` imports work in ESM but are fragile, hurt tree-shaking, and break HMR.
- **Anchor extractions on markers, not line numbers**: when moving a block out of the original file with a script or tool, insert unique comment markers (e.g. `// SPLIT-MOVE: <name> START` / `// SPLIT-MOVE: <name> END`) at the block boundaries and extract by marker. Line numbers drift as each earlier extraction shrinks the file — the `06-22-split-platform-host-index` split proved this causes mis-extraction. Remove the markers after the move.

### Handle shared state

When multiple sub-modules share module-level state (singletons, ready flags):

- **Prefer a dedicated state module** with accessor functions (`markReady()`, `waitForPlatformHostReady()`). Sub-modules import accessors; the state module imports nothing from sub-modules → no cycle.
- Avoid passing shared state as function parameters across many call sites — that's dependency injection noise. Accessors are cleaner when the state is a true singleton.

---

## Anti-Patterns

- **Bad**: splitting a file by line count ("cut at line 500") instead of by responsibility — produces two files that each still mix concerns.
- **Bad**: extracting a barrel that re-exports everything but leaving the implementation in the original file — the file isn't actually smaller, just has an alias.
- **Bad**: letting `internal.ts`-style transitional modules grow without a plan to dissolve them — a transition debt that's never repaid becomes a new god file.
- **Bad**: moving functions to a sub-module but leaving their imports in the original file — dead imports accumulate.
- **Bad**: splitting without a green build between seams — one regression invalidates the whole refactor.

---

## Relationship To Other Guides

- This is a **horizontal structure principle**. It applies to any package.
- It interacts with the [Code Reuse Thinking Guide](./code-reuse-thinking-guide.md): the "extract when duplicated 3+ times" rule is about *when to abstract*; this guide is about *when to physically separate into files*. A function can be worth extracting (reuse) without its file being a god file, and vice versa.
- It interacts with the [Data Fileification Principle](./data-fileification-principle.md): that principle governs data shape (file vs DB field); this governs source file shape. Both ask "does this belong here, or somewhere else?"

---

**Core Principle**: If a file's contents can be described with "and", it's probably two files.
