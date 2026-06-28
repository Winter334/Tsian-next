# 小说 AIRP workspace 契约与 schema 设计规范

Parent: `06-27-default-card-novel-reader-airp`

## Goal

为默认小说阅读器 AIRP 建立第一版 workspace 契约与 Agent 可执行的 Schema Design Guide。该子任务不实现完整导入、前端阅读器或 Agent 闭环，而是先定义后续子任务共同遵循的数据落点、schema 演进规则、实体核心字段和前端可直接读取的简单状态字段。

## Context

父任务方向：玩家导入整本小说，但不一次性抽取全书；系统按 source frontier 渐进抽取设定、实体和事件。默认卡不内置某个题材 schema，而是让专门 Agent 根据当前小说设计并维护 living schema。

本子任务已确认的关键方向：

- 不建立独立 `save/render/` 层。
- 不把旧默认 workspace 规范和新小说规范并行分发；新模板替换旧模板。
- Entity core metadata 和 schema patch 机制必须简单、可读、利于人类与 Agent 维护。
- 前端第一版直接读取 entity/runtime 中的普通稳定字段，例如 `name`、`brief`、`tags`、`status`、`fields`、`sections`，而不是读取单独 render projection。

仓库已有原则：

- Runtime Workspace 是存档级虚拟文件系统。
- 结构化状态、前端需要共享的玩法数据和 Agent 语义资料都应存在 workspace 文件中。
- 平台不理解玩法字段语义；契约由游戏卡、Agent、Skill 和前端共同约定。

## Requirements

- 定义小说 AIRP 的推荐目录结构，包括但不限于：
  - source corpus
  - schema 文档与 patch
  - semantic entities
  - playthrough / branch / frontier 状态
  - director/current brief
- 编写 Agent-facing Schema Design Guide，说明 Agent 如何根据导入小说设计 schema。
- 明确 living schema 规则：新增、弃用、迁移、changelog、玩家确认边界。
- 定义简单前端可读字段约定，使前端可展示大部分题材的通用实体/状态数据，但不建立独立 render 层。
- 定义 sourceRefs / visibility / lifecycle / origin 等基础概念，但避免写成覆盖所有题材的巨型 schema。
- 明确哪些内容是灵活语义资料，哪些字段是前端/Agent 共同依赖的稳定玩法字段。
- 给 post-processing 与 world-architect/schema-curator 的职责边界提供规范依据。
- 保持规范可逐步落入默认 workspace 模板，且不破坏现有 Tsian 架构方向。

## Acceptance Criteria

- [ ] 有一份设计文档说明小说 AIRP workspace 目录契约。
- [ ] 有一份 Agent 可执行的 Schema Design Guide 草案。
- [ ] 有一份简单 entity core metadata 草案，至少覆盖 `id` / `name` / `brief` / `sourceRefs` / `visibility` / `lifecycle` / `origin` / `status`。
- [ ] 有一份前端可读普通字段草案，至少覆盖 `tags` / `status` / `fields` / `sections` / runtime summaries。
- [ ] 有 schema changelog / deprecated / pending patch 的演进规范。
- [ ] schema patch 采用人类和 Agent 易读的 Markdown 格式，不引入 JSON Patch / 迁移引擎。
- [ ] 明确 post-processing 何时 call world-architect 更新 schema。
- [ ] 明确哪些 schema 变更可自动应用，哪些需要玩家确认。
- [ ] 明确新小说模板替换旧默认模板主规范；不在新默认卡中同时分发旧 `save/world` / `_ref` / `_dir` 指南。
- [ ] 本子任务不要求实现完整导入 UI、source 分章、Agent 调用链或前端渲染代码。

## Out of Scope

- 完整整本小说导入 UI。
- 长文本 chunk / semantic index 实现。
- world-architect Agent 的完整 prompt 和 tool 实现。
- 默认前端完整重写。
- 特定题材 schema，例如修仙、悬疑、科幻的完整专用字段。
- 独立 `save/render/` 层、render projection cache、JSON Patch 或迁移引擎。

## Decisions

- Schema Design Guide 第一版采用双落点：
  1. 项目级方向文档，例如 `docs/active/novel-airp-workspace-schema-direction.md`，作为开发和架构权威依据。
  2. 默认 workspace 精简执行手册，例如 `docs/novel-airp-schema-guide.md`、`save/schema/README.md`、`save/source/README.md`、`save/playthrough/README.md`、`save/director/README.md`，让游戏内 Agent 能读到并执行。
- 项目文档记录完整方向、边界、设计理由和后续演进；workspace 版面向 Agent，强调具体流程、目录、写入规则和禁忌。
- 新小说 AIRP 模板替换旧默认 workspace 规范；旧存档和其他卡可以继续用旧规范，但新默认卡不同时分发两套互相冲突的指南。
- `save/entities/<type>/<localId>.json` 是小说 AIRP v0 的主实体落点。
- `save/schema/current.md` 是 schema 权威；`current.json` 不默认创建，除非后续工具/前端确实需要可重建索引。
- 安全的 schema additive change 直接更新 `current.md` + `changelog.md`；需要玩家/作者决策的变更写入 `save/schema/patches/pending/*.md`。

## V0 Decisions

- 前端第一版只承诺读取 `name` / `brief` / `tags` / `status` / `fields` / `sections` / runtime summaries。后续需要更复杂表现时，优先扩展普通字段或专用前端，不在 v0 引入 render layer。
- schema 变更玩家确认机制第一版只落实为 `save/schema/patches/pending/*.md`；暂不实现 UI 确认流。后续 UI 可读取 pending patch 列表并引导玩家确认。
