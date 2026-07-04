# 可渲染运行时与实体 schema 约定

## Goal

定义一套轻量的可渲染 workspace 数据约定，让 `runtime.json`、entity、scene、container、item 等既能被 Agent/Skill 维护，也能被前端渲染为状态栏、角色卡、在场人物、背包/容器、物品详情等 UI。

## Background

父任务已确认：状态栏不是单一左侧组件，而是玩家查看当前可交互世界状态的一整套体验。左侧常驻栏、在场人物、角色卡、背包、容器、物品详情、未来装备槽都属于这个体系。

核心方向是“固定基础 schema 精致渲染 + 动态字段扩展槽”：预设的 runtime/character/scene/container/item 等基础结构可以由前端硬编码契约并做精致 UI；游玩过程中发展出的新字段/临时机制通过 `extensions` / `扩展` 与有限预设渲染方案自然插入这些 UI。

## Requirements

- R1: 明确 `save/playthrough/runtime.json` 是当前局面/状态栏数据面，可承载高频、玩家面向、前端可渲染的运行时变量。
- R2: 明确固定基础 schema 与动态扩展字段的关系：前端可硬编码固定类型 UI；新字段走 `extensions` / `扩展` + 预设渲染方案。
- R3: 定义扩展字段的最小显示约定，包括显示名（中文 key 或 label）、渲染方案（render/渲染）、值、色调、排序/分组的可选性。
- R4: 预设渲染方案必须是有限集合，例如文本、数字、进度、标签、列表、段落、引用、卡片组；Agent 不应在 runtime/entity 中发明任意 UI 组件。
- R5: 明确 `name`、`id` localId、`aliases` 的职责：`name` 是主显示名；aliases 仅用于替代称呼。
- R6: 明确 runtime/entity/scene/container/item 如何承载前端可渲染信息，同时避免把维护 SOP 写入运行时文件。
- R7: 更新默认卡相关 schema 文档、必要的 default template 文本、Agent/Skill 指导，使后续 Agent 维护 runtime/entity 时知道如何写可渲染字段。
- R8: 保持约定轻量，不引入完整 UI DSL、独立 `save/render/` 层、平台级 renderer 或 JSON Patch/migration engine。
- R9: 默认 `save/playthrough/runtime.json` 应包含空 `extensions: {}`，明确 runtime 可扩展；读取旧存档或缺省时仍按空对象处理。

## Acceptance Criteria

- [ ] 文档明确 runtime-as-status-surface 的定位。
- [ ] 文档明确 fixed UI + dynamic extension slots 的混合模式。
- [ ] 文档给出 runtime、character entity、container entity、item entity、scene 的示例。
- [ ] 文档明确扩展字段推荐落点（如 `extensions` / `扩展`）及预设渲染类型。
- [ ] 文档明确 `name` / `aliases` / id localId 的显示语义。
- [ ] Agent/Skill 指导中不要求把维护规则写入 runtime/entity 数据本身。
- [ ] 现有“不要做通用卡片/仪表/数值/看板引擎”的方向被重新表述为“不做万能 renderer；只做固定 UI 内扩展槽”，避免概念冲突。
- [ ] 若修改 default template 或 docs，运行对应构建/检查命令。

## Out of Scope

- 不实现前端状态栏、角色卡、容器/物品详情 UI。
- 不实现 runtime 摘要 injection。
- 不重构 Agent 阵容；本任务只写必要指导，深度 Skill 化由子任务 `.trellis/tasks/07-04-airp-agent-roster-skills` 处理。
- 不为所有动态字段建立严格 JSON Schema 校验器。
