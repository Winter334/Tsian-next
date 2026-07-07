# entity schema 精简：移除无消费者字段

## Parent

`07-06-agent-roster-progressive-refactor`（schema 演进，跨步骤影响）。

## Goal

按"每个字段必须有一个真实消费者"原则（`agent-skill-design-principles.md` 原则 9），移除 entity schema 中无真实消费者的三个字段：`updatedAt`/`updatedBy`、`sourceRefs`、`origin`。同时修复 `commit-entities` 脚本与 schema guide 的字段名不一致（`updatedAt` vs `updatedAtTurn`）。

## Background

### 发现过程

`07-06-understanding-step-world-architect-director` 子任务完成后，浏览器验证 Understanding 步产出的角色实体（如飞星）时发现三个字段问题。用"谁读它？读了做什么决策？删掉会怎样？"三步追问验证，三者均无真实消费者。

### 三个字段的消费者验证

**`updatedAt` / `updatedBy`（审计字段）**：
- 谁读：无。Agent 决策不读它，前端不展示它，调试有 runtime trace 更精确。
- 读了做什么决策：无。AIRP 单写入者、turn 顺序执行，无并发冲突，无审计消费者。
- 删掉会怎样：无任何行为变化。
- 额外问题：`commit-entities` 脚本（L361）写的是 `updatedAt`（ISO 时间戳），但 schema guide 所有示例和字段清单用 `updatedAtTurn`（回合号）——脚本与 guide 字段名不一致。

**`sourceRefs`（冗余索引）**：
- 谁读：无明确消费者。researcher 溯源用 semantic_search 更精准；world-architect 抽取进度靠 frontier；前端不展示 sourceRefs。
- 读了做什么决策：无。entity 里存源文本指针的边际价值低于维护成本。
- 删掉会怎样：溯源完全靠 source 本身 + semantic_search + frontier，无功能损失。
- 对主角类贯穿全本的角色，sourceRefs 列"所有出场章节"会无限膨胀；列"关键事件出处"需要维护 Agent 持续阅读原文判断"关键"——维护成本高且标准模糊。

**`origin`（约束标记）**：
- 谁读：无。前端用 localId 命名约定（`original-` 前缀）判断分支，不读 entity.origin（`apps/play-frontend-dev/src` grep 零命中）。Agent 用 spoiler-safe 等方法论约束，不读 origin。
- 读了做什么决策：无。约束已隐含在方法论里。
- 删掉会怎样：无任何行为变化。

### 偏离原著不记在 entity 里

讨论确认：偏离原著是叙事判断（记在 director brief 里），不是实体属性。origin 的 canon/branch 语义混淆了"角色来源"和"是否偏离原著"两个维度。移除 origin 后，"角色来自原著还是玩家创建"靠 localId 命名约定（前端已用），"剧情是否偏离原著"靠 brief 内容。

### 影响范围

这三个字段不是 Understanding 步独有的，是跨步骤的 entity schema 契约。影响：
- `commit-entities` 脚本：强制写 `updatedAt`/`updatedBy`，校验 `sourceRefs`，不碰 `origin`。
- schema guide（`NOVEL_AIRP_SCHEMA_GUIDE_MD`）：字段清单、示例、语言边界提及。
- schema reference（`NOVEL_AIRP_SCHEMA_REFERENCE_MD`）：详尽字段说明、origin 枚举、sourceRefs 说明。
- entity README 示例。
- 可能的 Skill 正文引用（researcher 实体读取、stage-manager 维护）。

## Requirements

- R1：移除 entity 的 `updatedAt`/`updatedBy` 字段。`commit-entities` 脚本不再强制写入这两个字段（删除 L361 的 `updatedBy`/`updatedAt` 覆盖）。
- R2：移除 entity 的 `sourceRefs` 字段。`commit-entities` 脚本的 `ensureSourceRefsKnown` 校验一并删除；`normalizeEntity` 不再处理 sourceRefs。
- R3：移除 entity 的 `origin` 字段。schema guide/reference 的 origin 枚举段落删除。
- R4：schema guide 字段清单（L848 区域）移除这三者；entity 示例移除这三者；语言边界如提及 sourceRefs/origin 对应调整。
- R5：schema reference 的 origin 段落、sourceRefs 说明、updatedAt/updatedBy 示例移除。
- R6：entity README 示例移除这三者。
- R7：审视 researcher 实体读取 Skill、stage-manager 状态栏维护 Skill 等是否引用这三个字段，如有则移除对应指导。
- R8：不改动前端（前端不读这三个字段，无需改动）。
- R9：不迁移已有存档（本任务只影响默认模板和新建 workspace）。
- R10：AI-facing 文本零未来承诺——不描述"未来可能重新加入"。

## Acceptance Criteria

- [ ] `commit-entities` 脚本不再写入 `updatedAt`/`updatedBy`，不再校验/处理 `sourceRefs`。
- [ ] schema guide 字段清单、示例、语言边界无 `updatedAt`/`updatedBy`/`sourceRefs`/`origin`。
- [ ] schema reference 无 origin 枚举段落、无 sourceRefs 说明、无 updatedAt/updatedBy 示例。
- [ ] entity README 示例无这三者。
- [ ] 其他 Skill 正文无这三个字段引用。
- [ ] `npm run build:web` 通过。
- [ ] 浏览器验证：导入小说 → Understanding 步 → 产出的实体 JSON 无这三个字段。
- [ ] 父任务 PRD 更新。

## Out of Scope

- 不改动前端代码（前端不读这三个字段）。
- 不迁移已有存档。
- 不重新设计 entity schema 的其他字段（identity/appearance/attributes/gauges/status/goals/containers/extensions/portrait 保留）。
- 不处理 runtime/scene/relationship 的 `updatedAtTurn`/`updatedBy`——这些是回合后维护产物，有 stage-manager 作为消费者，不属于本任务范围。
- 不引入"偏离原著"的替代记录机制（记在 brief 里是 director 职责，属于后续玩家流程子任务）。

## Notes

- 本子任务源于 `07-06-understanding-step-world-architect-director` 验证发现，思维方法已沉淀为 `agent-skill-design-principles.md` 原则 9。
- runtime/scene/relationship 的 `updatedAtTurn`/`updatedBy` 保留——它们有 stage-manager 回合后维护作为消费者，且与 entity 的审计字段语义不同（回合号是 runtime 状态的一部分）。
- 设计遵循"发现无消费者字段时直接删，不要降级保留"——降级保留是最差状态，既不消费又要维护。
