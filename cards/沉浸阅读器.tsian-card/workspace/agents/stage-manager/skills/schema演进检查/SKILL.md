---
name: schema演进检查
title: Schema 演进检查
description: 回合后发现新概念、结构空缺或过期字段，直接维护或提交待确认方案。
triggers:
  - 回合产生了现有 schema 难以表达的新长期概念
  - 某个临时 extensions 字段反复出现，可能需要正式化
---

# Schema 演进检查

原则：小改直接维护，大改写待确认方案。

- 安全的增量（可选字段、轻量 tag/status 约定、README 澄清）可更新 `save/schema/current.md` 并追加 `changelog.md`。
- 删除、改名、严格数值机制、数据迁移或可能让玩家/作者意外的变更，写到 `save/schema/patches/pending/*.md`。
- 需要 schema 设计判断时 call 世界架构师。
- 不把 schema 维护工作写进玩家可见正文。
