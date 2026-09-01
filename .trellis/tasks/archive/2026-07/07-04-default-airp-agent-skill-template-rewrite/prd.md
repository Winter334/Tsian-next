# 默认 AIRP Agent 与 Agent-local Skill 模板重写

## Goal

重写默认 Game Card 的 AIRP 后台剧组模板，落地新的 Agent 阵容、Agent-local Skill 结构、最小 `mode.json` 玩法状态表，以及配套 AI-facing 文档。新建默认卡应以 `storyteller` 作为正式玩家回合入口，显示名为“说书人”，并包含资料员、场记、世界架构师、导演等后台同事。

该任务是默认 novel 前端回合后场记编排、开局多 Agent 编排、行动裁定玩法系统的前置模板任务。

## Background / Confirmed Facts

- 项目未上线，不需要旧卡兼容 fallback；新默认模板可以直接替换旧 `master` / `retrieval` / `post-processing` 叙事入口概念。
- Agent 入口/id 解耦已完成：`send` / `interaction.sendMessage` 从 Game Card manifest 的 `runtime.entrypoints.playerTurn` 解析正式回合入口，缺失时 fail loud。
- `invokeAgent` 流式已完成：默认前端后续可以通过 `invokeAgent(stage-manager, ...)` 编排回合后维护。
- 平台已支持 Agent-local Skill：registry 会识别 `agents/<agent>/skills/<skill>/SKILL.md`，并按 `agent.json.skills`、local/shared 优先级过滤。
- 旧默认模板主要集中在 `apps/platform-web/src/storage/workspace-templates.ts`：现有 Agent 为 `master`、`retrieval`、`post-processing`、`world-architect`，共享 Skill 在 `skills/*` 下。
- 当前默认内置卡 manifest 仍显式配置 `runtime.entrypoints.playerTurn = "master"`；本任务应迁移为 `storyteller`。

## Requirements

- R1: 默认 Agent 阵容改为：
  - `storyteller` / 说书人
  - `researcher` / 资料员
  - `stage-manager` / 场记
  - `world-architect` / 世界架构师
  - `director` / 导演
- R2: 新默认模板不再以 `master` 作为 AI-facing 主入口名称；正式回合入口配置为 `runtime.entrypoints.playerTurn = "storyteller"`。
- R3: 删除或迁移旧 `master` / `retrieval` / `post-processing` 的模板职责；不保留旧卡兼容 fallback。
- R4: `AGENT.md` 保持岗位说明与少量常驻原则，不塞长流程或广泛路由表。
- R5: Skill 默认 Agent-local，放在对应 Agent 自己的 `skills/` 目录下；同名玩法 Skill 可按 Agent 职责定制。
- R6: 共享 `skills/` 只保留真正跨 Agent 完全一致的底层能力；如没有明确共享价值，则迁移到 Agent-local 或删除引用。
- R7: 新建默认存档包含 `save/playthrough/mode.json`，默认内容只记录真正玩法系统，例如：

  ```json
  {
    "行动裁定": "deferred"
  }
  ```

- R8: `mode.json` 不包含人物卡、容器/背包、物品详情、状态栏、场景面板等前端默认渲染结构。
- R9: 只给需要玩法状态的 Agent 注入或说明 `mode.json`；不要让所有 Agent 都承担 mode 规则。
- R10: 模板文档和默认示例体现 schema 中英混用边界：机器字段/枚举/render preset 用英文，玩家可见文本、显示名、动态扩展 key 用中文。
- R11: 说书人不在 `AGENT.md` 中每轮 call 场记；回合后场记是后续默认 novel 前端编排任务负责的前端流程。
- R12: `agent_call` 保留给 Agent 内部协作：说书人可 call 资料员，场记可 call 世界架构师/资料员，导演可 call 资料员。
- R13: 不在本任务实现行动裁定的完整脚本/数值系统；只建立默认 mode 与 Agent-local Skill 占位/职责边界，完整机制留给 `07-04-action-resolution-system`。
- R14: 更新默认文档、AI-facing 文本和相关 specs，避免仍把 `master` 描述为平台唯一主入口。
- R15: 修改默认 save runtime 文件时，按现有工作区版本机制更新默认文件列表 / workspace version；不新增 Dexie 表或 DB 迁移。

## Acceptance Criteria

- [ ] 新建默认卡包含 `storyteller`、`researcher`、`stage-manager`、`world-architect`、`director` 的 `agent.json`、`AGENT.md`、`SOUL.md`。
- [ ] 默认内置卡 manifest 明确配置 `runtime.entrypoints.playerTurn = "storyteller"`，且 staleness 检查同步更新。
- [ ] 默认模板不再生成 `agents/master`、`agents/retrieval`、`agents/post-processing` 作为新卡核心 Agent。
- [ ] 新建默认存档包含对应 `save/agents/<agent>/notes.md`，不再生成旧 `save/agents/master` 等默认 notes。
- [ ] Agent-local Skill 文件位于 `agents/<agent>/skills/<skill>/SKILL.md`，并能被现有 registry/agent-context 识别。
- [ ] `agent.json.skills.enabled` 使用新 Agent-local Skill 路径或留空依赖默认 local Skill 可见规则；不存在指向已删除共享 Skill 的引用。
- [ ] 默认 `save/playthrough/mode.json` 只包含真正玩法系统（首个为“行动裁定”），状态值使用 `enabled` / `disabled` / `deferred`。
- [ ] 文档和模板说明不把状态栏、人物卡、容器背包等 UI 渲染结构写成玩法启用项。
- [ ] 旧 `master` / `retrieval` / `post-processing` 在 active 默认模板和 AI-facing 当前文档中已迁移或有明确保留理由。
- [ ] 不实现平台硬编码“说书人 → 场记”pipeline。
- [ ] `npm run build:web` 通过；如触及 contracts 类型则补跑 `npm run build:contracts`。

## Out of Scope

- 不实现默认 novel 前端的回合后场记调用 UI/状态同步/重试逻辑。
- 不实现开局向导多 Agent 编排。
- 不实现行动裁定完整随机/数值脚本。
- 不实现审批 UI 或非阻塞待审批系统。
- 不做旧本地卡/旧存档迁移；项目未上线，默认模板面向新卡/刷新内置模板。
- 不改平台核心为 novel AIRP 专属 pipeline。
