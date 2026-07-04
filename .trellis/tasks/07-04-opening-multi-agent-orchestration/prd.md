# 开局向导多 Agent 编排

## Goal

将默认 novel AIRP 开局向导从单一 world-architect 包揽，重构为世界架构师建模、导演写剧情指导、说书人写开局正文的多 Agent 编排，并保持玩法访谈极简。

## Requirements

- R1: 世界架构师负责开局理解小说与玩家设定，建立初始 schema/entities/scenes/relationships/runtime/mode。
- R2: 世界架构师不再负责最终开局正文演出，也不包揽初始 director brief。
- R3: 导演在世界架构师完成建模后写入初始 `save/director/current-brief.md`，负责近期剧情方向、节奏、伏笔、原著/分支边界。
- R4: 说书人在 director brief、runtime、初始场景和玩家设定基础上生成开局正文。
- R5: 开局访谈不做大问卷；只对真正玩法系统提供少量三态选择，例如“行动裁定”：启用 / 不启用 / 暂时不启用。
- R6: 选择启用玩法时，由世界架构师读取对应 Agent-local Skill 并调用脚本生成基础 rules/schema/runtime 骨架；选择暂时不启用时只写入 `deferred`。
- R7: 开局正文最好可流式展示；若依赖通用 AgentInvocation 流式能力，需记录依赖关系。
- R8: 开局产物必须落到后续常态流程能读取的位置，避免孤儿路径。

## Acceptance Criteria

- [ ] 开局流程职责分离：世界架构师建模、导演写 brief、说书人写正文。
- [ ] 默认开局向导不再让玩家逐项设计系统，只设置少量高层体验/玩法三态。
- [ ] `mode.json` 默认只包含真正玩法项，例如 `"行动裁定": "deferred"`。
- [ ] 初始 director brief 由导演 Agent 生成或维护。
- [ ] opening narrative 由说书人 Agent 生成。
- [ ] 世界架构师生成的 schema/entities/runtime 可被场记和说书人后续读取。
- [ ] 必要构建/类型检查通过。

## Notes

当前默认前端已有 setup dialog 使用 `invokeAgent("world-architect")` 的路径。实施时应结合通用 AgentInvocation 流式能力，避免再为开局单独做一套调用机制。
