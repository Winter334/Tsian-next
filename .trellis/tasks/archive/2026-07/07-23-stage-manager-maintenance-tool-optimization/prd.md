# 场记维护工具效率优化

## Goal

降低沉浸阅读器场记（stage-manager）在正式玩家回合后维护存档时的工具调用次数、上下文消耗、补读次数和失败重试率，同时保持 runtime、entity、scene、relationship、memory、timeline、turn recall 的维护覆盖完整、事实准确且可审计。

## Background and Evidence

- 场记职责是维护 runtime、entities、scenes、relationships、memory 与可渲染 extensions；entity 是权威，scene/relationship 是派生导航视图：`cards/沉浸阅读器.tsian-card/workspace/agents/stage-manager/AGENT.md:2`、`cards/沉浸阅读器.tsian-card/workspace/agents/stage-manager/AGENT.md:7`-`cards/沉浸阅读器.tsian-card/workspace/agents/stage-manager/AGENT.md:9`。
- 当前回合后维护流程要求第一步调用 `read_maintenance_context({ turn, includeTimeline: true })`，随后维护 runtime/entity/scene/relationship/memory/timeline，并用 `commit_turn_recall` 写入召回元数据：`cards/沉浸阅读器.tsian-card/workspace/agents/stage-manager/skills/回合后维护/SKILL.md:16`-`cards/沉浸阅读器.tsian-card/workspace/agents/stage-manager/skills/回合后维护/SKILL.md:19`。
- 现有回退流程要求仅在聚合上下文缺必要事实、正文为空、目标文件不存在或写入前确需确认全文时，才定向补读；不得枚举实体/场景/关系目录或读取源文本：`cards/沉浸阅读器.tsian-card/workspace/agents/stage-manager/skills/回合后维护/SKILL.md:21`-`cards/沉浸阅读器.tsian-card/workspace/agents/stage-manager/skills/回合后维护/SKILL.md:23`。
- 当前 `stage-manager` 常驻注入 schema guide、current schema、runtime、frontier、scene/relationship README、seeds 等长/动态上下文：`cards/沉浸阅读器.tsian-card/workspace/agents/stage-manager/agent.json:7`-`cards/沉浸阅读器.tsian-card/workspace/agents/stage-manager/agent.json:42`。
- 当前 `stage-manager` 工具包含 `read_maintenance_context`、`commit_turn_recall`、`update_entity`，平台工具包含 `workspace_read`、`workspace_write`、`agent_call`：`cards/沉浸阅读器.tsian-card/workspace/agents/stage-manager/agent.json:51`-`cards/沉浸阅读器.tsian-card/workspace/agents/stage-manager/agent.json:67`。
- `read_maintenance_context` 当前只返回 entity `ref/name/brief`、relationship `to/type/note`、scene `ref/name/location/present/status` 等摘要，导致普通维护仍可能补读 runtime/entity/scene/relationship：`cards/沉浸阅读器.tsian-card/workspace/agents/stage-manager/tools/read_maintenance_context/run.js:60`-`cards/沉浸阅读器.tsian-card/workspace/agents/stage-manager/tools/read_maintenance_context/run.js:85`、`cards/沉浸阅读器.tsian-card/workspace/agents/stage-manager/tools/read_maintenance_context/run.js:183`-`cards/沉浸阅读器.tsian-card/workspace/agents/stage-manager/tools/read_maintenance_context/run.js:194`。
- `update_entity` 已要求 `ref` 和 `patch`，但运行时仍可能因缺失/错误 `ref` 抛 `UPDATE_ENTITY_INVALID_REF`；最近维护日志显示这会造成失败重试和长 stack 上下文污染：`cards/沉浸阅读器.tsian-card/workspace/tools/update_entity/tool.json:4`-`cards/沉浸阅读器.tsian-card/workspace/tools/update_entity/tool.json:21`、`cards/沉浸阅读器.tsian-card/workspace/tools/update_entity/run.js:319`-`cards/沉浸阅读器.tsian-card/workspace/tools/update_entity/run.js:340`。
- `commit_turn_recall` 的职责合理：只覆盖目标 turn 的 `meta.recall`，并校验 schema、剧情坐标、实体 ref、事件类型、标签和摘要：`cards/沉浸阅读器.tsian-card/workspace/agents/stage-manager/tools/commit_turn_recall/tool.json:1`-`cards/沉浸阅读器.tsian-card/workspace/agents/stage-manager/tools/commit_turn_recall/tool.json:18`。
- 附件日志显示最终维护覆盖面完整，效率问题主要来自：过重常驻上下文、错误 stack、重复/补充读取、同一实体多次更新，而不是单个 save 分片过大。

## Requirements

### R1 — 通用结构化编辑工具

新增一组面向 AIRP JSON/Markdown 文档形态的通用编辑工具，而不是继续围绕 entity 专用工具扩展。

- 新增 `json_edit`：用于 JSON 文档结构化局部编辑。
- 新增 `text_edit`：用于 Markdown/文本行表追加、替换和删除。
- 下线旧 `update_entity`，避免旧入口干扰 Agent 工具选择。
- 不新增大一统 `apply_maintenance_delta`。
- 不按 runtime/entity/scene/relationship/memory/seeds/timeline 机械拆成一领域一专用工具。
- 不做 schema-template 创建工具。

### R2 — `json_edit` 简短浅层 API

`json_edit` 必须优先简短、易理解、嵌套浅：

- 使用单字符串 `target`，自动识别 ref 或 `save/...json` path。
- 支持单操作 `{ target, ... }` 与多操作 `{ ops: [...] }`。
- 支持 `create`、`set`、`append`、`upsert`、`remove`、`unset`。
- `set`/`append`/`upsert`/`remove`/`unset` key 使用点路径。
- 不为点号字段名设计复杂转义；只防空路径段、路径穿越和危险原型 key。
- `set` 可设置任意 JSON 值，包括对象、数组和 `null`。
- `null` 是值；删除字段用 `unset`，删除数组项用 `remove`。
- `set` 自动创建缺失中间对象；若中间路径已存在但不是对象则报错。
- `append`/`upsert` 目标数组不存在时自动创建，存在但不是数组时报错。
- `append` 默认按深度相等去重；重复项跳过、不报错，以支持幂等重试。
- `upsert` 条目形态为 `{ match, set?, unset? }`；`match` 非空；0 匹配新增 `{...match, ...set}`，1 匹配浅合并并删除 `unset` 顶层字段，多匹配报错。
- `remove` 严格：目标数组不存在、0 匹配、多匹配都报错；恰好 1 匹配才删除。
- `ops` 顺序执行，遇错停止，不回滚已成功 op；单个 op 内使用 expectedContent 保证单文件读改写原子性。

### R3 — `json_edit` 轻量 AIRP 底层不变量校验

`json_edit` 不做完整 schema 校验，但必须守住稳定底层不变量：

- entity 文件 `id` 与 path/ref 一致。
- scene 文件 `id` 与 path/ref 一致。
- relationship 文件 `subject` 与文件名一致。
- relationship `edges[].to` 必须是 `character:<localId>`。
- 校验路径安全、危险 key、JSON/操作语法。
- 不限制 turn JSON 正文 timeline；默认不改 turn 正文由 Skill/提示词约束。
- 不校验未知字段，不做完整 character/item/runtime/frontier schema validator。

### R4 — `text_edit` 行级文本工具

`text_edit` 用于高频 Markdown/文本行表编辑：

- 使用 `target` 指向 `save/` 下文本路径。
- 支持 `create`、`append`、`replace`、`remove`、`ops`。
- `append` 追加行并确保换行。
- `replace` 的 `{ find, line }` 必须恰好命中一行，替换整行。
- `remove` 的 `find` 必须恰好命中一行，删除整行。
- 0 匹配或多匹配均视为错误。
- 不支持 regex、Markdown AST、业务格式自动维护。
- 不自动维护 records 序号；序号由 Skill 引导 Agent 根据 records tail lines 自行判断。
- 返回 changedLines 短摘要。

### R5 — 增强 `read_maintenance_context`

保留 `read_maintenance_context` 名称并增强，不改名为泛化 `read_context`。

- 它是 stage-manager 私有 AIRP 导航聚合工具，不是字段级 schema 投影器。
- 只耦合稳定路径与引用导航规则：turn、runtime、activeSceneRefs、scene.present、相关 entity、relationship、memory 文本、timeline、scene cleanup candidates。
- 相关 JSON 默认全文返回；当前 save 已细粒度拆分，初版不做复杂 compact/截断。
- records 返回 tail lines；seeds 按当前规模返回相关/完整行。
- 不计算 `recordsNextIndex`。
- 若后续真实出现单文件过大，再补简单 size guard 或按需 compact。

### R6 — 保留并轻量优化 `commit_turn_recall`

- 保留 `commit_turn_recall` 名称与职责，不并入 `json_edit`。
- 继续负责只写 `meta.recall`、补 schema、校验事件类型/实体 ref/摘要。
- 同步新工具组短错误风格，避免长 stack 污染上下文。
- 成功返回保持简洁，可继续返回 normalized recall。

### R7 — Stage Manager 上下文与 Skill 分层

- 瘦身 `stage-manager` 常驻 contextPaths：移除 `docs/novel-airp-schema-guide.md`、`save/schema/current.md`、runtime、frontier、seeds、scene README、relationship README 等常驻注入。
- 普通回合必需规则写入 `回合后维护` Skill。
- `docs/novel-airp-schema-guide.md` 与 `save/schema/current.md` 作为按需参考文档，不废弃。
- `save/schema/current.md` 保持当前存档 living schema 权威定位。
- `schema演进检查` Skill 负责说明何时读取 current schema / guide / changelog，以及何时 call world-architect。
- `回合后维护` Skill 要求最终回复按维护域汇总，允许无变化域简写，但需说明变化或无变化原因。

### R8 — Agent 工具启用边界

- `json_edit`/`text_edit` 启用给 stage-manager 与 world-architect。
- `json_edit`/`text_edit` 不启用给 storyteller。
- `read_maintenance_context`/`commit_turn_recall` 作为 stage-manager 私有工具。
- world-architect 的开局建模/frontier 推进仍以现有专门 commit 脚本作为主路径；AI-facing 引导采用正向表述：“优先使用专门脚本以获得跨文件校验，通用编辑工具用于局部修正与文档维护”。
- 测试阶段 stage-manager 保留 `workspace_read`/`workspace_write`/`agent_call` 作为兜底；Skill 引导常规维护优先使用新工具组。

## Out of Scope

- 不新增大一统 `apply_maintenance_delta`。
- 不做一领域一专用工具。
- 不做 schema-template 创建工具。
- 不做 `check_save` / `validate_save` 工具。
- 不实现前端维护变化展示；后续可考虑正则/前端提取最终回复，或写专门变化文件。
- 不改变 world-architect 的 frontier source 锚点推进职责。
- 不让 stage-manager 读取未读源章节。
- 不把 relationship 扩展成泛实体图谱；relationship 仍只维护人物关系。
- 不削弱正文落定事实优先原则。

## Acceptance Criteria

- [ ] `json_edit` 可对 runtime/entity/scene/relationship/frontier/turn 等 JSON 文件执行 `create`、`set`、`append`、`upsert`、`remove`、`unset` 与简单 `ops`。
- [ ] `json_edit` 返回每个 op 的 `opIndex`、`target`、实际 `path`、`changed`、`changedPaths`；失败返回短错误和 `opIndex`，不出现长 stack。
- [ ] `json_edit` 能以一次 `ops` 更新同一回合涉及的多个 JSON 文件，避免同一 entity history/status 分多次工具调用。
- [ ] `json_edit` 对 entity/scene/relationship 底层不变量进行轻量校验，不阻止未知字段和合法 schema 演进。
- [ ] `text_edit` 可追加 records 行、替换 seeds 行、删除文本行，并在 0 匹配或多匹配时给出短错误。
- [ ] `read_maintenance_context` 返回普通回合维护所需的相关 JSON 全文、records tail、seeds 行、timeline 和 scene cleanup candidates；普通回合无特殊缺失事实时不需要补读 runtime/entity/scene/relationship 全文。
- [ ] `commit_turn_recall` 保持 recall contract 校验，并采用短错误风格。
- [ ] `stage-manager/agent.json` 常驻 contextPaths 瘦身，普通回合动态状态改由 `read_maintenance_context` 提供。
- [ ] `回合后维护` Skill 指导优先使用 `read_maintenance_context`、`json_edit`、`text_edit`、`commit_turn_recall`，并按维护域输出最终汇总。
- [ ] `schema演进检查` Skill 指导按需读取 `save/schema/current.md` / guide / changelog。
- [ ] world-architect 可使用 `json_edit`/`text_edit` 做局部修正和文档维护，但开局建模/frontier 推进 Skill 正向引导优先使用现有 commit 脚本。
- [ ] `tools/update_entity` 不再暴露给 stage-manager，最终工具列表与文档不再推荐它。
- [ ] 用一次回合维护日志验证：无 `UPDATE_ENTITY_INVALID_REF`，无长错误 stack，补读减少，工具结果短，最终 summary 按域稳定。
