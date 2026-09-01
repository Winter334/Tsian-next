# AIRP Agent 阵容与 Skill 化

## Goal

从第一性原理重新设计默认 novel AIRP 的 Agent 阵容、Skill 组织、玩法启用机制与前端编排边界，支撑状态栏数据面、可渲染 runtime/entity、schema 演进、行动裁定玩法、回合后状态维护与阶段性导演指导，同时避免把大量流程塞进 `AGENT.md`、共享巨型 Skill 或平台硬编码 pipeline 中。

本任务不是在现有 master / retrieval / post-processing / world-architect 模板上缝补几句提示词；现有模板只作为事实参考和迁移输入。项目尚未上线，无需兼容旧卡，可直接更新默认 Agent id、入口配置、模板与文档。

## Requirements

- R1: 盘点当前默认阵容：master、retrieval、post-processing、world-architect、studio-assistant 的职责与边界，仅作为参考，不作为设计约束。
- R2: 产出新的默认 AIRP Agent 阵容方案：说书人、资料员、场记、世界架构师、导演，并说明旧 Agent 的改名、删除、职责迁移与原因。
- R3: 明确说书人职责保持简单：根据上下文和玩家输入续写剧情、给出选项；信息不足时自己读取或 call 资料员；已启用玩法需要时多走对应玩法步骤；最终汇总为正文。
- R4: 明确说书人不负责维护 runtime/entity/schema/status bar，不处理 `deferred` 玩法启用建议，不在剧情中询问玩家是否启用玩法。
- R5: 明确场记是关键回合后维护 Agent，但不是平台硬编码 pipeline。默认 novel 前端在正文回合完成后通过通用 Agent 调用发起场记维护；平台只提供通用调用、流式事件、workspace 写入与提交策略。
- R6: 明确世界架构师负责开局建模、schema/world model/玩法初始化；后续主要由场记在发现新概念、schema 空缺或潜在玩法时调用。
- R7: 明确导演是低频 Agent，维护剧情指导文档（如 `save/director/current-brief.md`），负责节奏、伏笔、原著/分支平衡；它不是“局面整理员”。前端结构化整理 runtime/scene/entity 后交给说书人，不需要额外导演助理/局面整理 Agent。
- R8: 修正 `mode.json` 定位：它只记录真正会改变剧情裁定逻辑的玩法系统，不记录前端默认渲染结构。人物卡、容器/背包、物品详情、状态栏、场景面板是“有数据就渲染”的默认 UI 结构，不属于玩法启用项。
- R9: 第一版玩法系统聚焦“行动裁定”，整合随机判定、数值修正、双方对抗与脚本运算；不要把随机判定和数值系统硬拆成多个 mode 项。
- R10: `save/playthrough/mode.json` 作为轻量玩法启用状态表：键名直接对应玩法 Skill 名，值只使用 `enabled` / `disabled` / `deferred`。
- R11: `mode.json` 不是所有 Agent 的必读上下文；只注入给需要根据玩法状态决策的 Agent。`AGENT.md` 也不要求人人写 mode 说明，只写本岗位实际需要的处理方式。
- R12: 开局向导保持极简。对可选玩法提供“启用 / 不启用 / 暂时不启用”三类选择；选择启用时由对应 Skill/脚本初始化必要 schema/rules/runtime 骨架，选择暂时不启用时只记录 `deferred`。
- R13: 开局编排职责重分配：世界架构师负责初始建模；导演负责初始剧情指导文档；说书人负责开局正文，不再由世界架构师包揽开局文本和 director brief。
- R14: 复杂能力默认 Agent-local Skill 化：Agent 专用 Skill 放在该 Agent 自己的 `skills/` 目录下；同一玩法名可在不同 Agent 下有同名 Skill，但内容按岗位职责定制。
- R15: 保留 `agent_call`：它是一次 Agent 调用内部由 Agent 自主编排同事完成任务的机制；前端发起的通用 Agent 调用与 Agent 内部 `agent_call` 是两层互补能力，不互相替代。
- R16: 全局共享 Skill 不再作为默认归宿；共享层只放真正跨 Agent 完全一致的底层脚本、工具或 helper。不要写同时服务说书人 / 场记 / 世界架构师 / 导演的巨型 `SKILL.md`。
- R17: Skill 按需加载。`AGENT.md` 保持岗位说明与少量状态处理原则；玩法触发条件、流程、脚本调用、schema/runtime 更新细节放入对应 Agent-local `SKILL.md`。
- R18: Agent/Skill 名称和描述可以中文化，默认 AIRP 可采用中文岗位名与中文玩法名；底层程序内部 id 应与显示名称解耦，入口不再绑定 `master`。
- R19: schema 语言采用有边界的中英混用：结构字段、枚举、render preset、entity type 等机器可判定值保持英文；玩家可见内容、`name`/`brief`、字段标签、扩展槽 key、Agent/Skill 显示名可使用中文。
- R20: 不依赖长提示词解释 schema 规范。默认示例、Skill 产物和脚本生成结果应体现规范，让 Agent 通过已有结构学习并续写。
- R21: 将当前大任务拆成子任务：Agent 入口/id 解耦、通用 AgentInvocation/流式事件、开局多 Agent 编排、默认 Agent/Skill 模板重写、行动裁定玩法系统、前端回合后场记维护编排等。

## Acceptance Criteria

- [ ] 产出默认 AIRP Agent 阵容调整方案：说书人、资料员、场记、世界架构师、导演的职责、频率、调用关系清楚。
- [ ] 明确不需要导演助理/局面整理员：前端处理结构化 runtime/scene/entity 展开，不额外增加 Agent 调用。
- [ ] 明确前端默认渲染结构与玩法系统的边界：人物卡/背包/物品详情/status bar 不进 `mode.json`；“行动裁定”这类会改变剧情结果的系统才进 `mode.json`。
- [ ] 产出 Agent-local Skill 组织方案，明确共享 Skill、Agent-local Skill、底层脚本/工具的边界。
- [ ] 明确 `mode.json` 的最小结构、状态枚举、注入策略，以及不同 Agent 如何差异化处理。
- [ ] 明确开局访谈如何用“启用 / 不启用 / 暂时不启用”设置真正玩法，而不是让玩家设计一大堆系统细节。
- [ ] 明确开局向导多 Agent 编排：世界架构师建模、导演写指导、说书人写开场。
- [ ] 明确场记由默认 novel 前端在正文回合结束后发起通用 Agent 调用，而不是平台核心硬编码 pipeline，也不是说书人 `AGENT.md` 里每轮末尾自行 call。
- [ ] 明确前端发起的通用 Agent 调用与 Agent 内部 `agent_call` 的双层编排关系：前者供 UI/卡流程指定入口，后者供 Agent 在一次调用中自主协作。
- [ ] 明确 Agent 内部 id、显示名称、运行时入口解耦，不需要兼容旧 `master` 硬绑定。
- [ ] 明确 schema 中英混用边界，并通过默认示例和脚本产物维持规范，而不是靠常驻长提示词。
- [ ] 拆出后续实施子任务，并在各子任务中记录范围与验收标准。
- [ ] 若实施模板变更，更新 `apps/platform-web/src/storage/workspace-templates.ts` 及相关文档。
- [ ] 运行必要构建/检查命令；若仅更新任务文档，至少执行 diff/check 级验证。

## Notes

该子任务是状态栏/可渲染 runtime 体系的后台支撑任务。核心目标是让 AIRP 更像“后台剧组”：玩家前台只看到剧情、选项、输入和 UI 操作；状态栏维护、schema 演化、玩法初始化、实体/场景/关系维护、剧情指导由 Agent 团队与按需 Skill 在背后运转。

平台层只应沉淀通用 Agent 调用能力，不应硬编码 novel AIRP 的说书人/场记 pipeline。默认 novel 前端可以把 `send` 与 `invokeAgent("场记")` 串成自己的卡流程，未来其它游戏卡可自由编排其它 Agent 流程。
