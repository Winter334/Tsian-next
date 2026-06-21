# Code Reuse Thinking Guide

> **Purpose**: Stop and think before creating new code - does it already exist?

---

## The Problem

**Duplicated code is the #1 source of inconsistency bugs.**

When you copy-paste or rewrite existing logic:
- Bug fixes don't propagate
- Behavior diverges over time
- Codebase becomes harder to understand

---

## Before Writing New Code

### Step 1: Search First

```bash
# Search for similar function names
grep -r "functionName" .

# Search for similar logic
grep -r "keyword" .
```

### Step 2: Ask These Questions

| Question | If Yes... |
|----------|-----------|
| Does a similar function exist? | Use or extend it |
| Is this pattern used elsewhere? | Follow the existing pattern |
| Could this be a shared utility? | Create it in the right place |
| Am I copying code from another file? | **STOP** - extract to shared |

---

## Common Duplication Patterns

### Pattern 1: Copy-Paste Functions

**Bad**: Copying a validation function to another file

**Good**: Extract to shared utilities, import where needed

### Pattern 2: Similar Components

**Bad**: Creating a new component that's 80% similar to existing

**Good**: Extend existing component with props/variants

### Pattern 3: Repeated Constants

**Bad**: Defining the same constant in multiple files

**Good**: Single source of truth, import everywhere

---

## When to Abstract

**Abstract when**:
- Same code appears 3+ times
- Logic is complex enough to have bugs
- Multiple people might need this

**Don't abstract when**:
- Only used once
- Trivial one-liner
- Abstraction would be more complex than duplication

---

## Prefer the Simplest Solution That Works (but only for simple needs)

**Principle**: When a need is simple enough to see end-to-end at a glance, pick the simplest effective solution. Complex needs deserve real engineering — applying "simplest" there produces a pile of inefficient patches instead of a clean design.

**Case — floating-window outside-click interception**:
- Need: a floating window must refuse to lose focus when the user clicks outside it (Windows modal behavior), including double-clicks.
- First attempt: capture-phase `pointerdown`/`mousedown` listeners on `document` with `stopPropagation()` + portal-aware `isInsideWindowOrPortal()` checks. Worked for single clicks; **double-clicks still leaked through** because browser event dispatch is subtle.
- Final solution: one transparent `<div class="fixed inset-0 z-[55]" @pointerdown="shake">` placed before the window (z-60) in the same Teleport. The browser's own hit-testing physically isolates outside clicks — no event-model reasoning needed. Three functions + two global listeners + portal predicate → one div + one handler.

**Why the simplest won**: the need was "block outside clicks, shake the window." A real DOM barrier satisfies that directly. The capture-phase approach was solving a harder problem (intercept without a barrier) that the need never asked for.

**When NOT to apply this principle**:
- The need spans multiple layers, has edge cases you can't enumerate, or will grow. "Simplest" then means "patch over patch" — that's how a codebase becomes a swamp.
- You can't see the full requirement at a glance. If you discover new cases mid-implementation, stop and redesign rather than bolt on another simple patch.

**Rule of thumb**: simplest-solution-first is a privilege of well-understood, bounded needs. For anything else, invest in the design up front.

---

## After Batch Modifications

When you've made similar changes to multiple files:

1. **Review**: Did you catch all instances?
2. **Search**: Run grep to find any missed
3. **Consider**: Should this be abstracted?

---

## Gotcha: Asymmetric Mechanisms Producing Same Output

**Problem**: When two different mechanisms must produce the same file set (e.g., recursive directory copy for init vs. manual `files.set()` for update), structural changes (renaming, moving, adding subdirectories) only propagate through the automatic mechanism. The manual one silently drifts.

**Symptom**: Init works perfectly, but update creates files at wrong paths or misses files entirely.

**Prevention checklist**:
- [ ] When migrating directory structures, search for ALL code paths that reference the old structure
- [ ] If one path is auto-derived (glob/copy) and another is manually listed, the manual one needs updating
- [ ] Add a regression test that compares outputs from both mechanisms

---

## Checklist Before Commit

- [ ] Searched for existing similar code
- [ ] No copy-pasted logic that should be shared
- [ ] Constants defined in one place
- [ ] Similar patterns follow same structure
