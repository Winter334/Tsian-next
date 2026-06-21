# Thinking Guides

> **Purpose**: Expand your thinking to catch things you might not have considered.

---

## Why Thinking Guides?

**Most bugs and tech debt come from "didn't think of that"**, not from lack of skill:

- Didn't think about what happens at layer boundaries → cross-layer bugs
- Didn't think about code patterns repeating → duplicated code everywhere
- Didn't think about edge cases → runtime errors
- Didn't think about future maintainers → unreadable code

These guides help you **ask the right questions before coding**.

---

## Available Guides

| Guide | Purpose | When to Use |
|-------|---------|-------------|
| [Code Reuse Thinking Guide](./code-reuse-thinking-guide.md) | Identify patterns and reduce duplication | When you notice repeated patterns |
| [Cross-Layer Thinking Guide](./cross-layer-thinking-guide.md) | Think through data flow across layers | Features spanning multiple layers |
| [Data Fileification Principle](./data-fileification-principle.md) | Decide where configurable data lives — file system vs private DB field | When adding new configurable data, new storage tables/keys, or new agent-managed data |
| [Module Structure Guide](./module-structure-guide.md) | Keep source files focused on one responsibility; split god files along seams | When a file accumulates unrelated concerns, before adding a function that doesn't fit the file's theme |

---

## Quick Reference: Thinking Triggers

### When to Think About Cross-Layer Issues

- [ ] Feature touches 3+ layers (API, Service, Component, Database)
- [ ] Data format changes between layers
- [ ] Multiple consumers need the same data
- [ ] You're not sure where to put some logic

→ Read [Cross-Layer Thinking Guide](./cross-layer-thinking-guide.md)

### When to Think About Code Reuse

- [ ] You're writing similar code to something that exists
- [ ] You see the same pattern repeated 3+ times
- [ ] You're adding a new field to multiple places
- [ ] **You're modifying any constant or config**
- [ ] **You're creating a new utility/helper function** ← Search first!

→ Read [Code Reuse Thinking Guide](./code-reuse-thinking-guide.md)

### When to Think About Data Fileification

- [ ] You're adding a new field to a game card, agent, or save record
- [ ] You're about to create a new Dexie table or key
- [ ] You're adding a new tool to let the agent manage something
- [ ] A feature implies the assistant should read/edit some platform data

→ Read [Data Fileification Principle](./data-fileification-principle.md)

### When to Think About Module Structure

- [ ] You're adding a function that has nothing to do with the file's other contents
- [ ] A file's imports span 4+ unrelated domains
- [ ] Helpers in a file are only called from one small region of that file
- [ ] A file's contents can be described as "X and Y and Z" rather than "X, involving Y and Z"

→ Read [Module Structure Guide](./module-structure-guide.md)

---

## Pre-Modification Rule (CRITICAL)

> **Before changing ANY value, ALWAYS search first!**

```bash
# Search for the value you're about to change
grep -r "value_to_change" .
```

This single habit prevents most "forgot to update X" bugs.

---

## How to Use This Directory

1. **Before coding**: Skim the relevant thinking guide
2. **During coding**: If something feels repetitive or complex, check the guides
3. **After bugs**: Add new insights to the relevant guide (learn from mistakes)

---

## Contributing

Found a new "didn't think of that" moment? Add it to the relevant guide.

---

**Core Principle**: 30 minutes of thinking saves 3 hours of debugging.
