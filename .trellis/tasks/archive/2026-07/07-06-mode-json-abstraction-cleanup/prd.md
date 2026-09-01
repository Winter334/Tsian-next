# mode.json 抽象清理

## Goal

彻底废弃默认 novel AIRP 中面向 Agent 的 `save/playthrough/mode.json` 软玩法开关抽象，删除默认种子、`commit_mode` 写入脚本以及 Agent-facing 文档引用，为后续按玩家流程重构 Agent / Skill / Tool 分层清理历史包袱。

## Background

当前 `mode.json` 的原始设计是让 Agent 读取 `"行动裁定": "enabled" | "disabled" | "deferred"` 之类的玩法状态，再决定是否启用对应玩法。但讨论后确认：

- 玩法开关是主观 / 产品配置，不适合让 Agent 通过软文件自行判断。
- “Agent 自然衍生玩法”在 AIRP 中效果不稳定，容易造成越位、忽略或滥用。
- 未来若需要玩法开关，应作为卡预制 / UI 机制另行设计，而不是继续使用面向 Agent 的 `mode.json`。
- 当前不应在 AI-facing 文档中提及尚不存在的 UI 或未来能力。
- `roll_dice` 已作为基础 Tool 能力存在；行动裁定不再依赖 `mode.json` 授权。

已知引用集中在 `apps/platform-web/src/storage/workspace-templates.ts`：

- 默认 save 路径 / 种子：`save/playthrough/mode.json`。
- Agent / Skill 文本中关于 `mode.json` 和 `行动裁定: enabled/disabled/deferred` 的说明。
- 世界架构师的 `commit_mode` 脚本及其声明。
- Agent `contextPaths` 中包含 `save/playthrough/mode.json` 的条目。
- schema guide 中的 Gameplay Modes 说明。

## Requirements

- R1: 删除默认 `save/playthrough/mode.json` 种子与默认路径登记。
- R2: 删除世界架构师用于写入 `mode.json` 的 `commit_mode` 脚本与 action 声明。
- R3: 删除所有默认 Agent / Skill / schema guide 中面向 Agent 的 `mode.json` 说明，尤其是“只在 enabled 时使用行动裁定”“deferred 时提出建议”等软开关语义。
- R4: 从默认 Agent `contextPaths` 中移除 `save/playthrough/mode.json`。
- R5: 不新增替代 UI 文案、未来玩法开关承诺或占位字段；只描述当前实际存在的机制。
- R6: 不主动迁移 / 删除已有用户存档中的 `save/playthrough/mode.json` 残留文件；本任务只影响默认模板和新建 workspace。
- R7: 清理后默认剧情仍可运行；行动裁定 / `roll_dice` 的后续使用由后续 Agent 重构任务处理，不在本任务引入。

## Acceptance Criteria

- [ ] `workspace-templates.ts` 中默认 `mode.json` 种子和默认路径登记被删除。
- [ ] `commit_mode` 脚本及其 action 声明被删除。
- [ ] 默认 Agent / Skill / schema guide 中不再出现面向 Agent 的 `mode.json` 玩法开关指导。
- [ ] 默认 Agent `contextPaths` 不再包含 `save/playthrough/mode.json`。
- [ ] 仓库内 AI-facing 默认模板中不再出现 `行动裁定: deferred/enabled/disabled` 软开关语义。
- [ ] 不新增对尚不存在 UI 的说明。
- [ ] 必要构建 / 检查通过。

## Out of Scope

- 不设计新的玩法开关 UI。
- 不迁移历史存档。
- 不重写世界架构师 / 导演 / 说书人职责；这属于后续流程步骤子任务。
- 不改变 `roll_dice`。
- 不添加 `save/rules/action-resolution.md` 规则手册；该内容属于后续玩家流程重构任务。

## Notes

清理 AI-facing 文本时遵守“描述当前事实，不描述未来计划”原则。删除软开关引用时目标是零表面痕迹，而不是改写成“以后通过 UI 控制”。
