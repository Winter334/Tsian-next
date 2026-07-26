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

## 什么时候读取参考

普通回合维护不默认读取 schema 文档。触发本 Skill 后，按需读取：

- `save/schema/current.md`：当前存档 living schema 约定。
- `save/schema/changelog.md`：已应用变更记录。
- `docs/novel-airp-schema-guide.md`：默认卡 schema 速查。
- `docs/novel-airp-schema-reference.md`：详尽字段参考。

## 处理规则

- 安全的增量（可选字段、轻量 tag/status 约定、装备槽位小补充、README 澄清）可更新 `save/schema/current.md` 并追加 `changelog.md`。
- 删除、改名、严格数值机制、装备栏容量或类型定义变化、复杂战斗规则或可能让玩家/作者意外的变更，写到 `save/schema/patches/pending/*.md`。
- JSON 文档局部维护优先用 `json_edit`；Markdown/text 行级维护优先用 `text_edit`。
- 需要 schema 设计判断时 call 世界架构师。
- 不把 schema 维护工作写进玩家可见正文。
