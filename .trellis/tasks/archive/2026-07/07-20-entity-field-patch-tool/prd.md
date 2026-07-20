# 实体字段局部更新工具

## Goal

为沉浸阅读器当前卡提供一个安全、低 token 的实体局部更新能力，使场记和世界架构师只描述本次确认发生的字段变化，也能精确完成新增、修改和删除，而无需重新生成整份实体 JSON。

## Background

当前实体以 `save/entities/<type>/<localId>.json` 为权威。Agent 使用通用写入能力更新实体时，需要读取并重新提交完整文件；即使只改一个目标、状态或履历项，也可能因漏写旧字段而丢失数据，并产生不必要的上下文与输出成本。

现有 workspace browser script 已支持读取文件并以 `expectedContent` 作为乐观并发保护写回完整内容，因此本需求不需要新增平台存储原语。局部更新的领域规则会随卡片实体结构演进，应作为当前卡内可编辑 Tool 提供。

## Requirements

### R1. Scope and ownership

- 本任务只修改 `cards/沉浸阅读器.tsian-card/**`。
- 新能力以当前卡共享 Tool `update_entity` 提供。
- Tool 只更新已存在的 `save/entities/<type>/<localId>.json`；新实体仍由现有开局建模、frontier 素材提交等创建流程负责。
- Tool 对场记和世界架构师可用，不对正文 Agent 开放。
- 本任务不修改 `apps/platform-web/src/storage/workspace-templates/**`。

### R2. Field-oriented patch contract

Tool 接收实体 `ref` 和一个嵌套字段 `patch`。字段操作必须具备明确的增删改语义：

- 普通 JSON 叶子值表示设置该字段；`null` 是合法值，不表示删除。
- `$set` 显式设置任意 JSON 值，用于替换整个对象或数组，也可用于普通字段。
- `$unset: true` 删除字段；字段不存在时视为无变化。
- `$append: [...]` 向数组追加不存在的值；完全相同的值不重复追加。
- `$upsert: [{ match, value }]` 对对象数组按非空 `match` 精确匹配：
  - 无匹配时追加 `{ ...match, ...value }`；
  - 恰好一个匹配时将 `value` 浅合并进该项；
  - 匹配多项时报错，不猜测目标。
- `$remove: [...]` 从数组删除精确匹配项：
  - JSON 标量按值匹配；
  - 非空对象条件要求数组项同时满足条件中的全部字段。

### R3. Unambiguous behavior

- 普通对象表示继续递归修改内部字段；若需替换整个对象，调用方必须使用 `$set`。
- 裸数组不作为隐式 patch 接受；数组必须通过 `$set`、`$append`、`$upsert` 或 `$remove` 操作。
- 一个操作符对象只能包含一个操作符，不能混入普通字段。
- 对缺失字段执行嵌套对象 patch 时可创建中间对象；若已有值不是对象，则报错并要求显式 `$set`。
- `$append` 和 `$upsert` 可在目标数组缺失时从空数组开始；目标已存在但不是数组时报错。
- `$remove` 作用于缺失数组时视为无变化；目标已存在但不是数组时报错。
- 一次调用中的所有操作必须先完整校验并在内存应用；任一操作失败时不得写入半成品。

### R4. Entity and path safety

- `ref` 必须严格符合 `<type>:<localId>`，且不能包含空段、空白、路径分隔符、空字节或路径穿越片段。
- Tool 只能访问由 `ref` 推导出的实体文件路径。
- 目标文件必须存在、是合法 JSON object，且其 `id` 必须等于请求 `ref`。
- 根字段 `id` 不允许通过 patch 修改或删除。
- patch、操作值和匹配条件中的 `__proto__`、`prototype`、`constructor` 必须被拒绝。

### R5. Preservation and write safety

- 未被 patch 命中的实体字段和数组项必须原样保留。
- 完全相同值的判断使用结构化深比较，不依赖对象属性顺序。
- 没有实际变化时不写文件，并返回 `changed: false`。
- 有变化时写回格式化 JSON，并使用读取到的原始内容作为 `expectedContent`，避免基于过期内容覆盖较新修改。
- Tool 返回精简的变更结果和路径摘要，不返回整份实体内容。

### R6. Agent guidance

- 场记和世界架构师的 AI-facing 指引应明确：已有实体的少量字段变化优先使用 `update_entity`。
- 指引应直接说明何时使用 Tool，不加入开发侧实现动机或跨阶段兜底解释。
- 新实体创建、开局批量建模、frontier 新素材批量落盘和 schema 迁移继续使用现有流程。

## Acceptance Criteria

- [ ] AC1: 当前卡包含可发现、可执行的共享 `update_entity` Tool，并被正确打入 `game-card.json`。
- [ ] AC2: 场记和世界架构师能够调用 Tool，正文 Agent 看不到该写入 Tool。
- [ ] AC3: 普通字段设置、嵌套字段设置、整对象/数组 `$set` 和 `$unset` 均按 R2-R3 工作。
- [ ] AC4: `$append` 能追加并对完全相同值保持幂等，且不覆盖旧数组项。
- [ ] AC5: `$upsert` 能新增或更新一个对象数组项；多匹配时失败且不写文件。
- [ ] AC6: `$remove` 能按标量或对象条件精确删除数组项，不依赖数组下标。
- [ ] AC7: 未涉及字段完整保留；无变化不写；实际写入携带 `expectedContent`。
- [ ] AC8: 非法 ref、缺失/非法实体、id 不一致、修改根 id、危险 key、裸数组和冲突操作均被拒绝且不产生写入。
- [ ] AC9: 场记和世界架构师指引建立了清晰的新建实体与局部更新边界。
- [ ] AC10: 本任务没有改动平台默认工作区模板或平台存储/契约源码。

## Out of Scope

- 将 Tool 同步到 `apps/platform-web/src/storage/workspace-templates/**`。
- 创建新实体。
- 修改 scene、relationship、runtime、memory 或 frontier 文件。
- 支持 RFC 6902 JSON Patch 路径与数组下标操作。
- 自动进行 schema 迁移或对任意实体类型硬编码完整字段 schema。
