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
| [AI-Facing Content Changes](./ai-facing-content-changes.md) | Avoid leaving residual concept traces when removing/auto-inferring a concept from tool schemas, prompts, or descriptions | When removing a parameter from a tool schema, auto-inferring a concept the agent used to pass, or rewriting tool/prompt descriptions |
| [Module Structure Guide](./module-structure-guide.md) | Keep source files focused on one responsibility; split god files along seams | When a file accumulates unrelated concerns, before adding a function that doesn't fit the file's theme |
| [AIRP 数据与能力设计原则](./airp-data-capability-design-principles.md) | 泛用方法论：能力供给分级、归属决策、skill 封装判据、数据权威、分片、产物落点、写入策略、文档分层、字段消费者验证 | 涉及 agent/skill/tool 能力设计、schema 字段设计、写入策略、数据权威与派生、聚合层、文档分层、审查过度设计时 |
| [提示词自包含与口吻指南](./prompt-self-contained-and-tone.md) | 写 Skill / AGENT.md / 工具 description 时避免两类错误：开发侧因果解释污染；默认 Agent 知道本上下文之外的概念 | 写或改 AI-facing 提示词、引用跨 Skill 概念、发现 Agent 行为偏差疑似来自提示词时 |

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

### When to Think About AI-Facing Content Changes

- [ ] You're removing a parameter from a tool schema (or moving it from required to optional)
- [ ] You're auto-inferring a concept the agent used to pass explicitly (scope, owner, mode, …)
- [ ] You're rewriting a tool `description` or a prompt string that teaches the model a framework concept
- [ ] You're **adding** a prohibition / restriction / guardrail to an AGENT.md, SOUL.md, Skill, or tool `description` (run the "would it happen anyway?" test first)
- [ ] The user says a concept is "not the agent's concern" / "徒增麻烦" / "noise" / "auto-infer"

→ Read [AI-Facing Content Changes](./ai-facing-content-changes.md)

### When to Think About Module Structure

- [ ] You're adding a function that has nothing to do with the file's other contents
- [ ] A file's imports span 4+ unrelated domains
- [ ] Helpers in a file are only called from one small region of that file
- [ ] A file's contents can be described as "X and Y and Z" rather than "X, involving Y and Z"

→ Read [Module Structure Guide](./module-structure-guide.md)

### When to Think About AIRP Data & Capability Design

- [ ] You're designing a new agent, skill, or tool capability
- [ ] You're deciding whether a capability belongs in platform code or skill/workspace
- [ ] You're adding or removing a schema field and wondering if it has a real consumer
- [ ] You're adding a data file and wondering whether it's a second copy of existing data
- [ ] You're deciding replace vs edit, or whether to batch operations into a skill
- [ ] You're placing a one-time/generated product and unsure where it should land
- [ ] You're organizing docs and unsure what should be 常驻 context vs 按需
- [ ] You're reviewing a design that feels over-engineered and need to verify field/capability necessity

→ Read [AIRP 数据与能力设计原则](./airp-data-capability-design-principles.md)

### When to Think About Prompt Self-Containedness & Tone

- [ ] You're writing or editing a SKILL.md / AGENT.md / tool `description`
- [ ] You're about to reference a concept from another Skill or doc inside a prompt
- [ ] You're explaining "why" a step exists or "what happens later" inside a prompt
- [ ] Agent behavior deviates from intent and you suspect the prompt leaked dev-side framing or assumed outside knowledge

→ Read [提示词自包含与口吻指南](./prompt-self-contained-and-tone.md)

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
