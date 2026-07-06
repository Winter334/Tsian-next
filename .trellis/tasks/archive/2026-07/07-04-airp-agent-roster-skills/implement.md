# AIRP Agent 阵容与 Skill 化实施计划

## Scope

本子任务先完成设计与任务拆分，再实施默认卡模板更新。当前设计要求避免“提示词补丁式”修改，应以新 Agent/Skill 组织、通用 Agent 调用能力、前端编排边界为目标。

项目未上线，无需兼容旧卡；可以直接替换旧 `master` 等入口概念，但实施时仍需搜索并清理 AI-facing 文本和代码中的残留硬绑定。

## Implementation Steps

### 1. 现状盘点

- 检查默认卡模板中现有 Agent：master、retrieval、post-processing、world-architect、studio-assistant。
- 检查现有共享 Skills、agent.json 的 `skills.enabled`、contextPaths、platformTools。
- 检查当前平台是否已经支持 Agent-local skill path；如果只支持卡级共享路径，确定需要的平台改造点。
- 检查 `sendMessage` / `invokeAgent` / `runAgentRuntimeTurn` 的当前关系：两者已共用底层 runtime，但 host/bridge 层事件、commit 语义不同。
- 搜索 `master`、`post-processing`、`world-architect`、`retrieval` 等硬编码入口和 AI-facing 文本。

### 2. 确定新默认结构

默认 Agent 阵容：

```text
storyteller       # title: 说书人
researcher        # title: 资料员
stage-manager     # title: 场记
world-architect   # title: 世界架构师
director          # title: 导演
```

需要解耦：

- 程序内部 id：稳定、ASCII 优先，用于路径/调用/trace。
- 显示名称：中文，例如说书人、场记。
- 运行时入口：由卡/前端配置，不再硬编码 `master`。

新增默认 `save/playthrough/mode.json`，采用最小结构：

```json
{
  "行动裁定": "deferred"
}
```

不写入：人物卡、容器与背包、物品详情、状态栏、场景面板。这些是前端默认渲染结构，有数据就渲染，没有就不渲染。

### 3. 拆分 Agent-local Skills

按岗位创建本地 skills 目录。示例目标：

```text
agents/<agent>/skills/<能力名>/SKILL.md
```

首批建议：

- 说书人
  - `行动裁定`：叙事中何时使用裁定、如何调用脚本、如何把结果写进正文。
- 资料员
  - `实体读取` / `资料检索`：按需读取并压缩资料。
- 场记
  - `状态栏维护`：维护 runtime/entity 可渲染状态。
  - `行动裁定`：根据裁定结果维护状态。
  - `schema演进检查`：发现新概念、schema 空缺、过期临时字段。
- 世界架构师
  - `开局建模`：导入小说后的基础 schema/entities/scenes/runtime/mode。
  - `玩法启用`：把三态访谈结果写入 mode，并调度具体玩法初始化。
  - `行动裁定`：启用时生成基础 rules/schema 示例。
- 导演
  - `剧情指导维护`：维护 director brief、节奏、伏笔、原著/分支平衡。

现有共享 Skill 若仍有价值，迁移策略：

- 跨 Agent 说明不同 → 拆成多个 Agent-local Skill。
- 完全相同且是确定性能力 → 考虑转为脚本/helper。
- 只是旧模板残留 → 删除或不再引用。

保留 `agent_call` 能力：它用于一次 Agent 调用内部的自主协作，例如说书人 call 资料员、场记 call 世界架构师。

### 4. 通用 Agent 调用与前端编排

当前评估：

- `sendMessage` 和 `invokeAgent` 已共用 `runAgentRuntimeTurn`，不应重写模型调用和工具循环。
- `sendMessage` 流式成熟，但强绑定完整剧情回合、`master`、history、checkpoint。
- `invokeAgent` 已支持任意 agentId，但目前只发不含文本的 activity 事件。

实施路线建议拆成子任务：

1. 先给 `invokeAgent` 补 `invocationId` 与真正文本/工具/完成/失败事件流。
2. 抽出公共 `AgentInvocation` host 编排层，减少 send/invoke 重复逻辑。
3. 将 `send` 视为通用 Agent 调用的一种用途，而不是平台唯一“主路”。
4. 默认 novel 前端自行编排：正文完成后调用场记；平台不硬编码“说书人 → 场记”pipeline。

场记调用策略：

```text
send / invokeAgent(storyteller) 完成正文
→ 前端显示正文并进入状态同步中
→ invokeAgent(stage-manager) 维护刚完成 turn
→ 成功后刷新状态栏并解锁下一轮
→ 失败时显示同步失败并提供重试
```

需要额外评估通用调用的 commit/checkpoint 策略，确保正文回合与场记维护后的 workspace 状态可恢复。

### 5. 开局向导多 Agent 编排

当前开局向导由 world-architect 负责过多内容，需要改为：

```text
世界架构师：理解小说，建立初始 schema/entities/scenes/relationships/runtime/mode。
导演：基于初始世界状态和玩家设定写初始 director brief。
说书人：基于 director brief、runtime 和初始场景写开局正文。
```

开局访谈仅对真正玩法做少量三态选择：

```text
行动裁定：启用 / 不启用 / 暂时不启用
```

选择启用时，世界架构师读取本地 Skill 并调用脚本生成标准 schema/rules/runtime 骨架。

### 6. 脚本/工具辅助

为容易写偏、需要批量处理或确定性结果的能力准备脚本/helper，而不是让 Agent 手写复杂结构：

- 初始化玩法：更新 mode、追加 schema 段落、创建 rules 示例。
- 行动裁定：投骰、表达式计算、DC 对比、双方对抗、随机表。
- 实体展开：批量读取 ref、容器 contents、人物卡关联信息。
- 状态更新辅助：生成标准 `extensions` 或 status 更新片段。

脚本产物应体现 schema 风格，减少提示词说明。

### 7. 更新默认模板与 docs

如果进入实施阶段，更新：

- `apps/platform-web/src/storage/workspace-templates.ts`
  - 默认 Agent 定义、SOUL/AGENT 文本、agent.json skills/contextPaths。
  - 默认 `save/playthrough/mode.json`。
  - Agent-local Skill 文件。
  - 需要的脚本/helper 文件。
- 默认 `docs/novel-airp-schema-guide.md` / reference 模板
  - mode 最小契约。
  - 前端渲染结构不是玩法系统。
  - 中英混用示例。
  - Agent-local Skill 与前端编排的简短说明。
- `docs/active/novel-airp-workspace-schema-direction.md`
  - 如确认 mode/Agent-local Skill/AgentInvocation 属于项目方向，追加对应设计说明。
- `docs/sdk/play-frontend-api.md` 与 play-bridge 类型
  - 若实现通用 AgentInvocation 或 invokeAgent 流式，需要更新 SDK 文档和类型。

### 8. 拆分子任务

建议从当前任务拆出：

1. **Agent 入口与内部 id 解耦**
   - 去掉 `master` 硬绑定。
   - 内部 id / 显示名 / 运行时入口配置分离。

2. **通用 AgentInvocation 与 invokeAgent 流式**
   - 基于现有 `invokeAgent` 补 invocationId、文本 delta、tool、round、completed、failed 事件。
   - 评估并抽取公共 host 编排层。

3. **默认 novel 前端回合后场记编排**
   - 正文完成后调用 stage-manager。
   - 状态同步中/失败/重试/下一轮锁定。
   - commit/checkpoint 策略。

4. **开局向导多 Agent 编排**
   - 世界架构师建模、导演写 brief、说书人写开局正文。

5. **默认 AIRP Agent/Skill 模板重写**
   - 新阵容、Agent-local Skills、mode 默认文件、docs、workspace template。

6. **行动裁定玩法系统**
   - 行动裁定 Skill 和脚本。
   - 随机判定、数值修正、双方对抗、结果维护。

### 9. 验证

文档阶段：

- 检查 PRD/design/implement 三份文档术语一致：说书人、资料员、场记、世界架构师、导演；行动裁定；`enabled` / `disabled` / `deferred`；Agent-local Skill；mode 非全员注入。
- 检查不再把人物卡、容器/背包、物品详情、状态栏写成玩法启用项。
- 运行 diff/check 级验证，确认没有格式错误。

模板/代码实施阶段：

- 搜索旧 `master` / `post-processing` 等入口硬绑定和 AI-facing 文本，确认迁移或删除。
- 搜索旧共享 Skill 引用，确认没有残留不一致路径。
- 如果修改 `workspace-templates.ts`，运行：

```bash
npm run build:web
```

- 如果平台 skill resolver、agent config、bridge contract 或 play-bridge 类型发生变化，补充对应测试或最小验证。

## Non-goals

- 不在本子任务实现完整状态栏 UI。
- 不设计复杂审批系统；只保留 deferred 玩法可由后台提出轻量待启用建议的接口空间。
- 不把 `mode.json` 做成规则书或嵌套配置中心。
- 不把所有 Agent 都强制接入 mode。
- 不把人物卡、背包、状态栏等前端默认渲染结构写成玩法系统。
- 不创建一个服务所有 Agent 的巨型共享玩法 Skill。
- 不把默认 novel AIRP 的说书人/场记流程硬编码进平台核心。
