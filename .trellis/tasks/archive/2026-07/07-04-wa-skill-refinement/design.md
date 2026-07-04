# world-architect Skill 体系完善与 use_skill 优化 — 技术设计

## Scope

5 个改动点：AGENT.md 精简、新增 Skill《游玩设定》+ commit_setup_summary、玩法启用 commit_mode 脚本、合并 commit 脚本（7→5）、use_skill 当轮返回 SKILL.md。

## D1: AGENT.md 精简

### 现状（world-architect AGENT.md）

```
# 世界架构师
你负责...设计世界资料结构...
常驻原则：
- 从最小可用模型开始...
- 玩法启用只处理真正改变裁定逻辑的系统...
- 安全小改可直接维护；有风险或需要决策的变更写 pending patch。
- 需要源文本或实体事实时 call 资料员。
- 不写开局正文；通过 agent_call 说书人生成开局正文，你负责把结果落盘...
- 不维护每回合 runtime。
- 开局建模后通过 agent_call 导演写初始 brief；不自己代写...
```

### 精简后

```
# 世界架构师

你负责为当前小说和本次游玩设计世界资料结构：schema、实体、场景、关系、runtime 指针、mode 状态。

常驻原则：
- 从最小可用模型开始，只在当前游玩确实需要时增加字段或结构。
- 安全小改可直接维护；有风险或需要决策的变更写 pending patch。
- 需要源文本或实体事实时 call 资料员。
- 不维护每回合 runtime。
```

移入 Skill 的内容：
- "不写开局正文；通过 agent_call 说书人..." → Skill《开局建模》已有
- "开局建模后通过 agent_call 导演写 brief" → Skill《开局建模》已有
- "玩法启用只处理真正改变裁定逻辑的系统" → Skill《玩法启用》已有

## D2: 新增 Skill《游玩设定》+ commit_setup_summary

### Skill《游玩设定》

```yaml
name: 游玩设定
title: 游玩设定
description: 引导玩家补齐进入故事的方式、金手指、世界因子和玩法三态选择，确认后提交设定摘要。
triggers:
  - 玩家完成角色设定后进入游玩设定对话
  - 需要确定本次游玩的方向和特殊设定
```

正文要点：
- 引导补齐：怎么进入故事、金手指/特殊设定、世界因子、是否启用玩法系统。
- 玩家只表达"想要什么"，world-architect 负责"怎么实现"。
- 用 `[[选项]]` 提供常见模板但允许自由输入。
- 玩法三态选择：启用 / 不启用 / 暂时不启用。
- 所有项补齐后展示设定汇总，用 `[[选项]]` 请求玩家确认。
- 确认后调 `commit_setup_summary` 提交。
- 收尾时 agent_call 说书人拿开局正文，调 `commit_opening_narrative` 落盘。

`tsian-actions` 声明 `commit_setup_summary`。

### commit_setup_summary 脚本

- **input**: `{summary: string}`
- **校验**: summary 非空字符串（≤2000）
- **写入**: `save/playthrough/setup-summary.json`，结构 `{status: "complete", summary, committedAt: ISOString}`
- **共享工具**: 复用 `OPENING_SCRIPT_COMMON`（normalizeString / fail / tsian.trace）

### prompt 改动

`buildPlaySetupPrompt` 改为指示 agent 用 Skill《游玩设定》引导对话 + `commit_setup_summary` 提交 + `commit_opening_narrative` 落盘。删除格式细节（脚本保证）。

## D3: 玩法启用 Skill 补 commit_mode

### commit_mode 脚本

- **input**: `{mode: Record<string, "enabled"|"disabled"|"deferred">}`
- **校验**: 每个 value 必须是三态之一；key 非空字符串
- **写入**: 读取现有 mode.json → 合并传入的键（不覆盖未传入的键）→ 写回 `save/playthrough/mode.json`
- **共享工具**: 复用 `OPENING_SCRIPT_COMMON`

### Skill《玩法启用》改写

正文指示用 `commit_mode` 脚本开关玩法。`tsian-actions` 声明 `commit_mode`。

## D4: 合并 commit 脚本（7→5）

### 合并方案

| 旧脚本 | → | 新脚本 | 理由 |
|---|---|---|---|
| commit_entities | → | commit_entities（不变） | 独立基础产物 |
| commit_scenes + commit_relationships | → | commit_scenes_and_relationships | 都是 ref 校验，共享 loadExistingEntityIds |
| commit_runtime + commit_frontier | → | commit_runtime_and_frontier | 都是开局状态，可一次写入 |
| commit_understanding_summary | → | commit_understanding_summary（不变） | 独立 |
| commit_opening_narrative | → | commit_opening_narrative（不变） | 独立 |

### commit_scenes_and_relationships API

- **input**: `{scenes: [...], relationships: [...]}`
- **校验**: normalizeScene + normalizeRelationships（复用现有逻辑，共享 loadExistingEntityIds 调用）
- **写入**: scene 文件 + relationship 文件
- **output**: `{writes: [...], sceneCount, relationshipCount}`

### commit_runtime_and_frontier API

- **input**: `{runtime: {turn, activeSceneIds, player, status?, extensions?}, frontier: {sourceWindow, extractedThrough?, notes?}}`
- **校验**: runtime 的 activeSceneIds → workspace.list("save/scenes") 校验 + player → loadExistingEntityIds 校验；frontier 的 chapter path → loadSource knownPaths 校验
- **写入**: runtime.json + frontier.json
- **output**: `{writes: [...]}`

### Skill《开局建模》同步更新

tsian-actions 声明从 9 action 变为 7 action（inspect + read + commit_entities + commit_scenes_and_relationships + commit_runtime_and_frontier + commit_understanding_summary + commit_opening_narrative）。执行步骤从 10 步减为 8 步。

### 旧脚本文件清理

删除 `commit-scenes.js` / `commit-relationships.js` / `commit-runtime.js` / `commit-frontier.js` 的 DEFAULT_WORKSPACE_FILES 条目和脚本常量。新增 `commit-scenes-and-relationships.js` / `commit-runtime-and-frontier.js`。

## D5: use_skill 当轮返回 SKILL.md

### 改动点

**文件**：`apps/platform-web/src/agent-runtime/workspace-tools.ts` — `activateSkillByName`（1700-1752）

现状：observation 返回 `{skill, activated, actions: [{name, description, executorType, executable}]}`，SKILL.md 全文由下一轮 `injectActivatedSkillMessages` 注入。

改动：
1. observation 新增 `content` 字段（SKILL.md 全文）。
2. `actions` 每项新增 `inputSchema` 字段（从 `parseActionDeclarations` 的结果取）。
3. `registerLoadedSkill` 后立即标记 `injectedSkillPaths.push(skill.path)`，跳过下一轮注入。

```ts
return {
  skill: { name, title, scope, ... },
  activated: true,
  content: file.content,  // 新增：SKILL.md 全文
  actions: actions.map((action) => ({
    name: action.name,
    description: action.description,
    inputSchema: action.inputSchema,  // 新增
    executorType: action.executor.type,
    executable: action.executor.type === BROWSER_SCRIPT_EXECUTOR_TYPE,
  })),
  ...
}
// 标记已注入，跳过下一轮 injectActivatedSkillMessages
context.sessionState.injectedSkillPaths.push(skill.path)
```

### 兼容性

`collectActivatedSkillContents` 仍保留——如果 `injectedSkillPaths` 未标记（旧路径或边缘情况），它仍会注入。新路径下因已标记，`collectActivatedSkillContents` 跳过。

### SkillActionSummary 类型

`SkillActionSummary`（contracts/runtime.ts:495）目前无 `inputSchema` 字段。但 `activateSkillByName` 的 observation 返回值不直接用 `SkillActionSummary` 类型——它是 `Record<string, unknown>`。所以 observation 加 `inputSchema` 不需要改 contracts。

但 `parseActionDeclarations` 返回的 action 声明里需确认有 `inputSchema`。查 `ParsedSkillAction` 类型——它应含 `inputSchema`（从 tsian-actions JSON 块解析）。

## D6: prompt 并行引导

Skill《开局建模》执行步骤里，提示 agent 无依赖的 commit 可在一轮内并行调用。例如：
- commit_entities 必须先于其它（ref 依赖）
- commit_scenes_and_relationships 依赖 commit_entities
- commit_runtime_and_frontier 依赖 commit_scenes_and_relationships（activeSceneIds → scene）
- commit_understanding_summary 可与 commit_runtime_and_frontier 并行（无互相依赖）

但工具执行层 `write` 组是串行的——agent 一轮内发出多个 `test_skill_script` 调用，框架串行执行后一并返回 observations。这减少的是 model call round 数（一轮发多个工具调用 vs 多轮各发一个）。

Skill 正文用正面引导："无依赖的 commit 脚本可在一轮内同时调用。"

## Compatibility & Rollback

- **向后兼容**：合并后的脚本 API 是新的，旧存档不涉及（脚本不读旧产物）。use_skill observation 新增字段不破坏旧消费者（前端不消费 observation）。
- **回滚**：5 个改动点独立。合并脚本可回退到 7 个；use_skill 改动可回退到下一轮注入；Skill《游玩设定》可移除。

## Out of Scope

- 不实现行动裁定数值系统脚本（等 `action-resolution-system`）。
- 不改 platform-host 脚本执行机制。
- 不改 contracts（SkillActionSummary 不加 inputSchema 字段，observation 用 Record<string, unknown>）。
- 不改前端 setup-summary 校验逻辑（现有 isSetupSummary 不变，脚本保证格式）。
