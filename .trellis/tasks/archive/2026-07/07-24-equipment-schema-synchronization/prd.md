# 装备 Schema 与 Stage Manager 同步

## Goal

把已用于开发前端只读展示的装备数据结构同步到默认 Workspace 权威 Schema、AIRP 文档、内部 Stage Manager 模板和正式卡实际 Stage Manager，消除“文档已定义、living schema 与正式卡维护流程未跟上”的分叉，并修复正式卡 workspace 文件清单。

## Background

- 开发前端已消费动态 `character.equipment`、装备物品 `equipment` 与槽位 `applied`。
- 内部与正式卡 AIRP 文档已有未提交装备草稿，但默认 `save/schema/current.md` 尚未包含装备字段。
- 内部 Stage Manager 模板已有装备维护草稿，正式卡实际 `回合后维护` Skill 尚未同步。
- 正式卡 `game-card.json.workspaceFiles` 仍列出已删除的 `update_entity`，未完整列出 `json_edit` / `text_edit`，并存在 size 漂移。

## Requirements

### R1. 统一数据结构

- character 可选装备栏：`equipment?: Record<string, { ref: string | null; applied?: Record<string, number> }>`。
- 槽位名由游戏数据动态定义，顺序按 JSON key 顺序；不得硬编码通用人体槽位。
- item 可选装备描述：`equipment?: { slot?: string; mods?: Record<string, string>; effects?: string[] }`。
- `slot` 是建议槽位；`mods` 是 Stage Manager 可解释的 Agent-facing 运算符字符串；`effects` 是叙事效果。
- 已装备 item 仍必须能从角色 `containers` 递归找到，不建立虚拟装备容器。
- `character.attributes` 保存当前有效属性；`applied` 保存对应槽位上次实际贡献，用于后续维护时还原。

### R2. 维护语义

- `mods` 支持现有 `+=`、`-=`、`*=`、`=` 运算符字符串和文档列出的有限函数/属性引用约定。
- 装备投影由 Stage Manager 根据明确上下文维护；本任务不增加平台运行时求值器、数据库事务或前端写入能力。
- 当装备、装备规则、角色属性或持有关系明确变化时，Stage Manager 在一次角色实体维护中先撤销旧 `applied`，再按槽位顺序解释合法规则，写回有效 attributes 与新 applied。
- 装备 ref 不再可达时，撤销该槽旧贡献并清空槽位。
- 任一规则、基础状态或持有关系无法确定时，不猜测、不写部分结算结果。
- 现有存档不自动迁移；本任务只更新新 Workspace 默认种子和正式卡模板内容。

### R3. 内部模板同步

- `apps/platform-web` 的 AIRP guide/reference、`save/schema/current.md`、`save/entities/README.md` 和 Stage Manager 模板使用同一装备结构与维护语义。
- 新存档权威 Schema 明确列出装备字段、前端可读投影和 Agent 维护边界。
- 不提升默认 Workspace 版本，不宣称会覆盖已有 living schema。

### R4. 正式卡同步

- 正式卡 AIRP guide/reference 与内部模板保持同一装备契约。
- 正式卡实际 Stage Manager 的 AGENT/回合后维护 Skill 接入装备维护域。
- 适配正式卡现有 `read_maintenance_context`、`json_edit`、`text_edit`、`commit_turn_recall` 流程，不复制内部旧工具架构，不恢复 `update_entity`。
- 不修改正式卡 packaged frontend；后续通过前端导入更新。

### R5. extensions render 契约

- 所有相关 Schema 表面恢复并保留：`extensions.render` 只接受已知 preset；未知值必须警告并隐藏该字段，不得静默降级为 text 或其他默认展示。

### R6. 正式卡 workspace 清单

- 根据磁盘完整重建 `game-card.json.workspaceFiles`，路径唯一、稳定排序、mediaType 与字节 size 正确。
- 删除不存在的 `workspace/tools/update_entity/*` 条目。
- 加入 `workspace/tools/json_edit/*` 与 `workspace/tools/text_edit/*` 四个文件。
- 只替换 `workspaceFiles`；`manifest`、`frontendFiles`、`coverFiles`、`exportedAt`、`exporter` 保持当前 working-tree 值。

### R7. 范围保护

- 不实现平台 modifier 求值器、玩家换装/卸装/移动物品、存档迁移或正式卡前端打包。
- 不修改 `apps/play-frontend-dev`、正式卡 `frontend/**` 或 07-21 插图任务规划。
- 基于当前未提交装备草稿精确收敛，不 reset、checkout 或覆盖并行工作。

## Acceptance Criteria

- [ ] 内部 AIRP 文档、living schema、实体示例、Stage Manager 与正式卡文档/Agent 使用同一装备字段结构。
- [ ] 默认 `save/schema/current.md` 明确包含 character/item equipment、applied 与前端可读投影。
- [ ] 装备必须仍由角色容器图持有，空槽、动态槽位与原始顺序语义明确。
- [ ] Stage Manager 能在明确上下文下维护旧 applied 撤销、按槽位重算、不可达 ref 清理，并在不确定时拒绝部分结算。
- [ ] 文档不声称平台存在自动 modifier 求值器、事务或现有存档迁移。
- [ ] 正式卡 Stage Manager 保留 generic edit、maintenance context、recall 和 scene 清理流程。
- [ ] 未知 `extensions.render` 在所有相关 Schema 表面明确 warn-and-hide，禁止静默 fallback。
- [ ] `game-card.json.workspaceFiles` 与磁盘 workspace 一一对应，已删除工具和新增通用编辑工具清单正确。
- [ ] `frontendFiles`、`coverFiles` 和包元数据未因本任务改变，两套 frontend 目录无修改。
- [ ] `npm run build:web`、JSON/脚本语法、manifest 一致性和 `git diff --check` 均通过。

## Out of Scope

- 确定性 modifier 解析器或运行时结算服务。
- 玩家主动换装、卸装、拖放或移动物品。
- 已有存档 Schema 迁移与 Workspace 版本升级。
- 正式卡 packaged frontend 更新。
- 07-21 内嵌插图任务树的实现或归档。
