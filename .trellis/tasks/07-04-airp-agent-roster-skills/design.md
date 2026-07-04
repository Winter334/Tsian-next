# AIRP Agent 阵容、Agent-local Skill 与前端编排设计

## 1. 设计定位

本设计服务默认 novel AIRP 的后台剧组架构。它不是在现有模板上追加提示词，而是重新确定：

- 默认 Agent 阵容与职责边界；
- 前端默认渲染结构与真正玩法系统的边界；
- 哪些能力按需放入 Agent-local Skill；
- 玩法启用状态如何被少数相关 Agent 感知；
- 前端如何编排说书人、场记、世界架构师、导演；
- schema / runtime / entity 的规范如何靠示例和脚本维持，而不是靠长提示词反复提醒。

核心目标：玩家前台保持沉浸式剧情、选项、输入与 UI 操作；后台由 Agent 团队和按需 Skill 支撑 runtime 状态栏、entity 可渲染字段、schema 演进、行动裁定、回合后维护与剧情指导。

## 2. 顶层原则

1. **现有模板是参考，不是约束**  
   当前 master / retrieval / post-processing / world-architect / studio-assistant 只用于了解已有事实和迁移成本。项目未上线，无需兼容旧卡或旧 `master` 入口。

2. **Agent 小，Skill 专，脚本稳**  
   `AGENT.md` 写岗位身份和少量常驻原则；Agent-local `SKILL.md` 写该岗位视角下的具体能力流程；确定性或批量操作交给脚本/工具。

3. **Skill 默认归属 Agent**  
   不默认把玩法 Skill 放进卡级共享 `skills/`。同一玩法名可以在多个 Agent 下有同名 Skill，但内容按岗位定制。

4. **mode 不是全员上下文**  
   `save/playthrough/mode.json` 只注入给需要根据玩法启用状态决策的 Agent。没有相关职责的 Agent 不读 mode，`AGENT.md` 里也不写 mode 规则。

5. **前端渲染结构不是玩法**  
   状态栏、人物卡、容器/背包、物品详情、场景面板、关系展示是默认前端渲染结构：有相关 schema 数据就渲染，没有就不渲染。它们不进入 `mode.json`，不需要启用/禁用。

6. **玩法是会改变剧情裁定逻辑的系统**  
   例如行动裁定、严格资源结算、回合制战斗。第一版聚焦“行动裁定”，整合随机判定、数值修正、双方对抗和脚本运算，不硬拆随机与数值。

7. **平台不硬编码卡专属 pipeline**  
   说书人正文完成后调用场记是默认 novel 前端的编排，不是平台核心固定流程。平台只提供通用 Agent 调用、流式事件、workspace 写入、提交/checkpoint 策略。

8. **保留 Agent 内部 `agent_call`**  
   前端发起的通用 Agent 调用解决“UI/卡流程指定哪个 Agent 作为入口”；`agent_call` 解决“一次 Agent 调用内部由 Agent 自主编排同事完成任务”。两者互补，不互相替代。

9. **示例即契约，脚本即护栏**  
   schema 风格优先通过默认文件、示例、Skill 初始化产物和脚本生成结构体现。不要依赖长提示词说明“字段名英文、内容中文”这类规范。

10. **正式游玩不前台打断**  
    说书人不在剧情中询问玩家是否启用玩法或更新 schema。暂未启用玩法的建议由场记或世界架构师在后台维护阶段提出，具体 UI/审批形态保持轻量，后续实现时再定。

## 3. 默认 Agent 阵容

### 3.1 说书人

对应旧 `master`，但应解除 `master` 硬绑定。

职责：

- 根据当前上下文和玩家输入续写剧情。
- 输出沉浸式正文和选项。
- 信息不足时，可以自己读取少量文件，或 call 资料员。
- 已启用玩法需要时，多走对应玩法步骤，例如“行动裁定”。
- 汇总资料、玩法结果和当前局面，写出最终正文。

不负责：

- 维护 runtime/entity/schema/status bar。
- 判断 `deferred` 玩法是否应启用。
- 在剧情中询问玩家是否启用玩法。
- 每轮末尾自行 call 场记。
- 手写数值运算或状态维护。

说书人可只接收已启用玩法摘要，不需要看到完整 `mode.json`。

### 3.2 资料员

对应旧 `retrieval`。

职责：

- 读取 source、entity、scene、relationship、schema、brief 等资料。
- 按调用方问题返回精炼事实。
- 不写存档，不判断玩法启用，不讲故事。

通常不注入 `mode.json`。

### 3.3 场记

对应旧 `post-processing`，是回合后维护核心。

职责：

- 在说书人正文回合完成后，由默认 novel 前端发起通用 Agent 调用。
- 读取刚完成的 turn、runtime、active scene、相关 entity。
- 更新 `save/playthrough/runtime.json`。
- 更新涉及的 entities、scenes、relationships、memory。
- 维护可渲染 `extensions` 与状态栏数据面。
- 清理接触到的过期临时字段。
- 对已启用玩法，按自己的本地 Skill 更新状态。
- 发现新概念、schema 空缺或潜在玩法时，call 世界架构师。
- 对 `deferred` 玩法，在剧情明显需要时提出轻量待启用建议；不直接启用。

场记不是说书人的下属工具，也不是平台硬编码后处理；它是默认 novel 前端编排的一次 Agent 调用。

### 3.4 世界架构师

对应旧 `world-architect`，但职责收敛为建模与 schema/world model 设计。

职责：

- 开局理解小说与玩家设定。
- 建立初始 schema、entities、scenes、relationships、runtime、mode。
- 玩家选择启用真正玩法时，读取自己的本地 Skill，并调用脚本生成标准 schema/rules/runtime 骨架。
- 后续场记发现 schema 空缺、新长期概念或潜在玩法时，设计增量 schema、pending patch 或玩法启用方案。

不再包揽：

- 开局正文演出。
- 初始 director brief 写作。

### 3.5 导演

新增低频 Agent，不是“导演助理/局面整理员”。

职责：

- 维护剧情指导文档，例如 `save/director/current-brief.md`。
- 管理近期剧情方向、节奏、伏笔、张力、原著主线与玩家分支平衡。
- 开局时在世界架构师完成建模后写初始 director brief。
- 后续可由前端固定轮数调用，或由场记标记 brief 过期后调用。

不负责：

- 展开 runtime/entity 给说书人。
- 维护 runtime/entity/schema。
- 直接面向玩家。

前端可结构化整理 runtime、active scenes、present entities 后交给说书人；这些内容多为自然语言和结构化字段，不需要额外 LLM 摘要。

## 4. `mode.json` 最小契约

`mode.json` 是玩法启用状态表，不是规则书，也不是前端 UI 模块表。

第一版建议：

```json
{
  "行动裁定": "deferred"
}
```

约定：

- key：真正玩法 / Skill 名，优先使用中文显示名；与 Agent-local Skill 目录名一眼对应。
- value：固定英文枚举，只允许：
  - `enabled`：已启用。相关 Agent 在需要时可读取同名本地 Skill。
  - `disabled`：明确不启用。后台不主动建议，除非玩家之后主动改设置。
  - `deferred`：暂时不启用。不开局初始化，不前台打断；后台在剧情明显需要时可提出简短启用建议。
- 不放嵌套规则、不放触发条件、不放 UI 配置、不放完整玩法说明。
- 不记录人物卡、容器/背包、物品详情、状态栏、场景面板、关系面板。

“行动裁定”内部可以逐步支持：

- 纯随机判定；
- 骰子 + 修正；
- 读取双方数值进行对抗；
- 数值与随机联动；
- 资源/状态变化由场记落盘。

Agent 不直接计算，确定性运算交给脚本。

## 5. Agent-local Skill 组织

目标结构示例（内部 id/路径是否中文化需由平台能力评估决定；显示名可中文）：

```text
agents/
  storyteller/
    agent.json        # title: 说书人
    AGENT.md
    SOUL.md
    skills/
      行动裁定/
        SKILL.md

  researcher/
    agent.json        # title: 资料员
    AGENT.md
    SOUL.md
    skills/
      实体读取/
        SKILL.md
      资料检索/
        SKILL.md

  stage-manager/
    agent.json        # title: 场记
    AGENT.md
    SOUL.md
    skills/
      状态栏维护/
        SKILL.md
      行动裁定/
        SKILL.md
      schema演进检查/
        SKILL.md

  world-architect/
    agent.json        # title: 世界架构师
    AGENT.md
    SOUL.md
    skills/
      开局建模/
        SKILL.md
      玩法启用/
        SKILL.md
      行动裁定/
        SKILL.md

  director/
    agent.json        # title: 导演
    AGENT.md
    SOUL.md
    skills/
      剧情指导维护/
        SKILL.md
```

同名 Skill 的内容不同：

- `说书人/skills/行动裁定`：何时在叙事中进行裁定、如何调用脚本、如何把结果融入正文。
- `场记/skills/行动裁定`：如何把裁定结果更新到 runtime/entity/status/extensions。
- `世界架构师/skills/行动裁定`：启用玩法时如何初始化规则、schema 和默认示例。

共享层只放真正跨 Agent 一致的底层脚本/工具，例如：

```text
scripts/
  roll-dice.ts
  calculate-expression.ts
  resolve-entities.ts
  init-feature.ts
```

这些脚本服务多个 Agent-local Skill，但不替代 Skill 文档。

## 6. 前端编排与通用 Agent 调用

平台层不分主路/旁路的产品概念，目标统一为“指定 Agent 为入口的一次 Agent 调用”。但卡流程由前端编排，不由平台硬编码。

默认 novel 正式回合：

```text
1. 玩家输入。
2. 前端整理 runtime / active scene / relevant entity refs，调用说书人。
3. 说书人流式输出正文和选项。
4. 正文完成后，前端立刻展示；UI 进入“状态同步中”。
5. 前端调用场记 Agent 维护刚完成回合。
6. 场记更新 workspace，必要时 call 世界架构师。
7. 场记完成后刷新状态栏，允许下一轮输入。
```

这里的第 5 步不是平台固定 pipeline，而是默认 novel 前端的卡流程。未来其它游戏卡可以编排不同流程。

场记失败时：

- 正文已展示，不因场记失败隐藏。
- 前端显示状态同步失败。
- 下一轮输入应暂时禁用或要求先重试维护。
- 需要通用调用支持合适的写入提交/checkpoint 策略，确保回合正文与场记维护后的状态可恢复。

## 7. 前端 Agent 调用与内部 `agent_call`

两层能力需要同时存在：

### 前端发起的通用 Agent 调用

由 UI/卡流程指定入口 Agent，例如：

```text
send / invokeAgent(storyteller)  # 正式剧情正文
invokeAgent(stage-manager)       # 回合后维护
invokeAgent(world-architect)     # 开局建模或 schema 设计
invokeAgent(director)            # 开局或阶段性剧情指导
```

它需要支持：

- 指定 agentId / purpose；
- 流式文本或事件；
- workspace 写入；
- 是否持久化 context；
- 合适的 commit/checkpoint 策略；
- invocationId 区分并发调用。

### Agent 内部 `agent_call`

由正在运行的 Agent 自主调度同事完成子任务，例如：

```text
说书人信息不足 → call 资料员。
场记发现 schema 空缺 → call 世界架构师。
导演需要源文本事实 → call 资料员。
```

它保持在一次 Agent 调用内部，不替代前端编排。保留 `agent_call` 可以让单次调用内部自动协作完成任务，减少前端需要知道的后台细节。

## 8. 开局向导多 Agent 编排

开局向导不做大问卷。对真正玩法只问少量三态选择：

```text
是否从开局启用“行动裁定”？
- 启用：写入 "行动裁定": "enabled"，并运行世界架构师的本地 Skill/脚本初始化基础结构。
- 不启用：写入 "行动裁定": "disabled"，后续后台不主动建议。
- 暂时不启用：写入 "行动裁定": "deferred"，不初始化；后续剧情明显需要时可由后台提出建议。
```

开局职责分配：

```text
世界架构师：理解小说，建立初始 schema/entities/scenes/relationships/runtime/mode。
导演：基于初始世界状态和玩家设定写初始 director brief。
说书人：基于 director brief、runtime 和初始场景写开局正文。
```

## 9. schema 语言边界

采用有边界的中英混用：

- 英文：JSON 结构字段、机器枚举、render preset、tone、visibility、lifecycle、entity type、mode 状态值。
- 中文：Agent/Skill 显示名、玩法名、entity `name`/`brief`、字段 label、section title/body、extension key、玩家可见描述。

示例：

```json
{
  "id": "character:萧玄",
  "name": "萧玄",
  "brief": "青玄门外门弟子，当前卷入山门冲突。",
  "status": [
    { "id": "injury:右臂轻伤", "level": "minor", "description": "挥剑时略有迟滞。" }
  ],
  "extensions": {
    "腐化值": {
      "render": "progress",
      "value": 37,
      "max": 100,
      "tone": "danger"
    }
  }
}
```

文档应通过这类默认示例固定风格，避免在常驻 Agent 提示中堆叠规则解释。

## 10. 后续子任务建议

当前范围已超过单一文档/模板任务，建议拆出：

1. **Agent 入口与内部 id 解耦**  
   去掉 `master` 硬绑定，分离内部 id、显示名、运行时入口配置。

2. **通用 AgentInvocation 与流式事件**  
   基于现有 `invokeAgent` 与 `runAgentRuntimeTurn`，补 invocationId、文本/工具/完成事件流、提交策略；避免重写模型工具循环。

3. **默认 novel 前端回合后场记编排**  
   正文完成后前端发起场记调用，处理状态同步中/失败/重试/下一轮锁定。

4. **开局向导多 Agent 编排**  
   世界架构师建模、导演写 brief、说书人写开局正文。

5. **默认 AIRP Agent/Skill 模板重写**  
   新阵容、Agent-local Skills、mode 默认文件、docs、workspace template。

6. **行动裁定玩法系统**  
   设计并实现行动裁定 Skill 和脚本，整合随机判定、数值修正、双方对抗与结果维护。

## 11. 与状态栏任务的关系

状态栏不是单个 UI 小组件，而是 runtime/entity 可见状态的前端投影。后台职责：

- 世界架构师建立初始 schema 与真正玩法骨架。
- 说书人消费已启用玩法与当前状态，不维护。
- 场记维护 runtime/entity/scene/relationship 和 `extensions`，让前端可以渲染状态栏、人物卡、背包、物品详情。
- 导演维护剧情指导，不整理结构化状态。
- 资料员按需提供实体、源文本、场景和关系资料。
