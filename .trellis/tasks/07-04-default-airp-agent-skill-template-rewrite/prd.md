# 默认 AIRP Agent 与 Agent-local Skill 模板重写

## Goal

重写默认卡 Agent 阵容、Agent-local Skills、`mode.json` 默认文件与相关文档，落地新的后台剧组架构：说书人、资料员、场记、世界架构师、导演。

## Requirements

- R1: 默认 Agent 阵容改为：说书人、资料员、场记、世界架构师、导演。
- R2: 删除或迁移旧 master / retrieval / post-processing / world-architect / studio-assistant 的模板职责，不保留旧卡兼容 fallback。
- R3: `AGENT.md` 保持岗位说明与少量常驻原则，不塞长流程。
- R4: Skill 默认 Agent-local：放在对应 Agent 自己的 `skills/` 目录下。同名玩法 Skill 可按 Agent 职责定制。
- R5: 全局共享 Skill 只保留真正跨 Agent 完全一致的底层能力；复杂流程拆到 Agent-local Skill 或脚本。
- R6: 默认 `mode.json` 只包含真正玩法系统，例如 `"行动裁定": "deferred"`。
- R7: 不把人物卡、容器/背包、物品详情、状态栏、场景面板写成玩法启用项；这些属于前端默认渲染结构，有数据就渲染。
- R8: 模板文档通过示例体现 schema 中英混用边界：结构字段/枚举英文，玩家可见文本和扩展槽 key 中文。
- R9: 默认 docs 说明前端编排：正文完成后可调用场记，但这是默认 novel 前端流程，不是平台硬编码。
- R10: agent.json 的 contacts、contextPaths、platformTools、skills.enabled 与新职责一致。

## Acceptance Criteria

- [ ] 默认模板创建的新卡包含说书人、资料员、场记、世界架构师、导演。
- [ ] 默认模板不再以 `master` 作为 AI-facing 主入口名称。
- [ ] Agent-local Skill 文件结构可被平台解析或已有明确平台改造支持。
- [ ] `mode.json` 默认只记录真正玩法系统，不包含 UI 渲染模块。
- [ ] 默认 docs 与 schema 示例体现中英混用边界。
- [ ] 旧共享 Skill 引用已迁移、删除或保留理由明确。
- [ ] `npm run build:web` 通过。

## Notes

该任务依赖 Agent 入口/id 解耦，以及可能的 Agent-local Skill resolver 支持。若平台暂不支持 Agent-local Skill，应先实现或在本任务中显式拆出前置工作。
