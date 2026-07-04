# Agent 入口与内部 id 解耦

## Goal

解除正式玩家回合入口与 `master` 的平台硬绑定，分离“程序内部 id / 中文显示名 / 运行时入口配置”。本任务只实现入口机制解耦：平台不再把某个固定 agent id 视为唯一主入口，但当前默认卡可以暂时继续把正式回合入口配置为 `master`。默认 AIRP 阵容迁移到 `storyteller` / 说书人等，留给后续 `07-04-default-airp-agent-skill-template-rewrite`。

项目未上线，无需为旧卡保留兼容 fallback；但为控制任务边界，本任务不提前重写默认 Agent 阵容。

## Requirements

- R1: 盘点当前代码和文档中对 `master` 作为正式玩家回合入口的硬编码与 AI-facing 残留。
- R2: 设计并实现 Agent 内部 id、显示名、运行时入口的分离：内部 id 稳定用于路径/调用/trace，显示名可中文，正式回合入口由卡/模板配置指定。
- R3: 正式玩家回合 `sendMessage` 不再硬编码 `agentId: "master"`、`resolveAgentModelConfig("master")`、`entryAgentId: "master"` 等；这些值应来自解析出的 player-turn entry agent id。
- R4: 当前默认卡可以先配置 player-turn entry 为 `master`，避免本任务提前进入默认 Agent 模板重写；后续模板任务再把默认入口改为 `storyteller`。
- R5: 前端自检 / ephemeral turn 应使用同一入口解析逻辑，避免真实回合与自检回合走不同入口。
- R6: agent context 读写、token budget、trace、turn history source.entryAgentId 应使用实际入口 agent id。
- R7: 更新 SDK / docs 中“send 走 master / master 是唯一主入口”等旧表述，改为“send 走卡配置的玩家回合入口”。
- R8: 不做旧卡 fallback；如果发现旧 fallback 逻辑只为兼容 master，应删除或替换为显式默认配置。
- R9: 不在本任务重写默认 Agent 阵容、contacts、AGENT.md/SOUL.md、Agent-local Skills；这些属于后续模板重写任务。

## Acceptance Criteria

- [ ] 正式玩家回合入口不再在平台代码中硬编码为 `master`。
- [ ] 入口 agent id 可从卡/模板配置解析；当前默认卡可暂时显式配置为 `master`。
- [ ] agent 内部 id 与中文显示名概念分离，后续默认模板可安全迁移到“说书人”等显示名。
- [ ] turn history / trace / context 中 entry agent id 来自实际入口配置，不固定为 `master`。
- [ ] 前端自检 / ephemeral turn 与正式回合使用同一入口解析路径。
- [ ] 默认模板和 AI-facing 文档不再把 `master` 描述为平台唯一入口。
- [ ] 不提前改默认 AIRP 阵容为 storyteller/stage-manager/director；该迁移留给后续任务。
- [ ] 相关代码搜索确认旧硬绑定已迁移或有明确理由保留。
- [ ] 通过必要构建/类型检查。

## Notes

该任务是默认 Agent 阵容重写和通用 AgentInvocation 的前置任务。实现目标是“入口可配置”，不是“一次性完成新 Agent 阵容迁移”。
