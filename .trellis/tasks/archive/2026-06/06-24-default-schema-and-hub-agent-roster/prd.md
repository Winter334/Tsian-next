# 默认 AIRP schema 与 hub-and-spoke Agent 阵容

## Goal

为默认 Game Card 设计一套默认 AIRP schema，它同时充当（1）模板卡的内容、（2）新作者/玩家的范式参考、（3）检索 agent 与后处理 agent 的工作对象。在此基础上把默认 Agent 阵容从「master/narrative/memory 对等团队」重构为「master 为核 + retrieval/post-processing 两个工具型 agent」的 hub-and-spoke 模型，并将该哲学位移写回方向文档。

## What I Already Know

- 当前默认 Game Card 模板定义在 `apps/platform-web/src/storage/workspace.ts`：`DEFAULT_WORKSPACE_FILES`（卡内容）与 `DEFAULT_SAVE_RUNTIME_FILES`（存档运行时）。
- 当前 Agent 阵容是三角：`master`（编排+决策，contacts=`["memory","narrative"]`）→ `narrative`（写正文）→ `memory`（记忆治理），外加 `studio-assistant`。master 的 AGENT.md/SOUL.md 已写「directly produce the player-facing reply」，但 SOUL 仍建议「contact the narrative agent when you want help drafting」。
- `agent_call` 机制现状：contacts-gated、maxCallsPerTurn=4、maxDepth=2、root turn 共享预算。master 调 retrieval/post-processing 都是 depth-1，完全够用，不需要平台改代码。
- 方向文档 `docs/active/agent-framework-runtime-workspace-direction.md` 第 4 节描述「对等团队」心智模型；第 5 节「工具原则」明写「检索不被某个 Agent 垄断」。
- 旧固定工作流时期（2026-05 ~ 2026-06-05）有大量可继承的 schema 思想，但旧的 `stateRecords` 表 + namespace/collection/recordId 存储模型**已被退役**，现在全部是纯 workspace 文件。`save/state/README.md` 明确写「不要镜像已退役的 namespace/collection/id 记录模型」。
- 旧设计可继承的是**数据模型思想**，不是存储机制：字段元数据关系（`relation:{targetCollection,targetField,cardinality}`）、primaryKey、`additionalFields` opt-in、schema 版本字段、轻量字段描述（非完整 JSON Schema）、durable vs dataflow schema 的概念切分。
- 当前 workspace 已有的运行时数据约定：`save/history/turns/turn-*.json` 一回合一文件、`save/memory/summaries/{current,long-term}.md`、`save/history/timeline.md`、`save/world/`、`save/state/data/`、`save/frontend/view-state.json`。
- `memory-maintenance` 共享 Skill 已存在，通过 `browser_script` + staged write 落盘 notes/timeline/summaries；允许 target 限定在 `save/agents/<agent>/notes.md`、`save/history/timeline.md`、`save/memory/summaries/current.md`、`save/memory/summaries/long-term.md`。

## Assumptions

- 本任务是内容层任务：主要改动 `workspace.ts` 中的默认模板文件 + 方向文档；不硬编码新玩法语义到平台，不新增平台 runtime primitive。
- 旧 IndexedDB 原型数据不做迁移；schema 形状变化允许通过 workspace version bump 或清库重建。
- schema 是「默认范式」，不是平台强制；作者可以替换、删除或改造。
- retrieval/post-processing 是普通 workspace Agent，用现有 `agent_call` + `workspace_read/search` + `memory-maintenance` Skill 即可，不需要新平台能力。
- master 仍可自己 `workspace_read/search`（检索不垄断）；retrieval 只是一个省 context 的封装。

## Requirements

### Agent 阵容重构（hub-and-spoke）

- 默认 Agent 阵容改为：`master`（唯一对话 agent，既决策又执笔写正文）+ `retrieval`（工具型，精炼回灌创作资料）+ `post-processing`（工具型，按规范格式落盘 + 维护状态数据 + 记忆治理）。
- 移除或降级 `narrative` agent：master 自己写正文。是否保留 narrative 作为可选「润色」联系人，由 brainstorm 决定。
- master 的 contacts 改为 `["retrieval","post-processing"]`。
- retrieval 的定位：类比 Explore 子代理——一次 `agent_call` 给意图，它在自己的上下文里做多步 `workspace.search/read`，只把精炼结论回灌 master。调用频率稀疏按需。
- post-processing 的定位：按规范格式落盘本回合产出 + 维护运行时状态数据 + 记忆治理（摘要/压缩/归档/建索引）。调用频率近乎每回合。
- 不违反「检索不垄断」原则：平台不把检索锁在 retrieval 后面，master 仍可直搜，retrieval 只是省 context 的封装。
- `studio-assistant` 保留，但其 AGENT.md 中关于默认阵容的描述需同步更新。

### 默认 schema 设计

- 设计默认 AIRP schema 覆盖三类数据：记忆条目、运行时状态数据（涌现 NPC/设定/角色属性/功法/技能/关系图谱等）、回合产出落盘格式。
- schema 形状与检索耦合：数据组织形式要服务于 retrieval agent 的查找方式。
- schema 以 workspace 文件形式存在（README + schema 文件 + 示例），不是平台表，不是旧 `stateRecords` 模型复活。
- 借鉴旧设计可继承思想：字段元数据关系、primaryKey、additionalFields opt-in、schema 版本字段、轻量字段描述。
- schema 同时充当模板卡内容和范式：新作者照着它就能理解「一个 AIRP 世界的数据应该怎么组织」。
- schema 不要求全：根据世界设定不同形式各异，关键是找到便于组织、检索的形式。

### 方向文档更新

- `docs/active/agent-framework-runtime-workspace-direction.md` 第 4 节的「对等团队」默认描述替换为「hub-and-spoke 工具 agent」心智模型。
- 明确 master 为核、其余为工具型 agent 的定位，以及 retrieval/post-processing 的职责边界与调用频率不对称。
- 保留「检索不垄断」原则，但澄清 retrieval 是省 context 的封装而非垄断。

### 模板卡内容

- 默认 Game Card 的 workspace 模板（`DEFAULT_WORKSPACE_FILES`）按新阵容 + 新 schema 重写。
- 默认存档运行时文件（`DEFAULT_SAVE_RUNTIME_FILES`）按新 schema 的运行时数据区重写。
- retrieval/post-processing 的 `agent.json`/`AGENT.md`/`SOUL.md` 写清楚工具型定位与 master 调用约定。
- memory-maintenance Skill 的 allowed targets 可能需要扩展（若新 schema 引入新的状态数据文件路径）。

## Acceptance Criteria

- [ ] 默认 Agent 阵容为 master + retrieval + post-processing（+ studio-assistant），master 自己写正文，narrative 按 brainstorm 决议处理。
- [ ] master 的 contacts 指向 retrieval 和 post-processing。
- [ ] retrieval 的 AGENT.md/SOUL.md 清楚描述「精炼回灌、省 context、稀疏按需」定位。
- [ ] post-processing 的 AGENT.md/SOUL.md 清楚描述「落盘 + 状态维护 + 记忆治理、近乎每回合」定位。
- [ ] 默认 schema 以 workspace 文件形式落地，覆盖记忆条目、运行时状态数据、回合产出三类，形状与检索耦合。
- [ ] schema 借鉴了旧设计的可继承思想（字段元数据关系、primaryKey、additionalFields、版本字段、轻量字段描述中的适用部分）。
- [ ] schema 兼作模板卡内容与范式参考。
- [ ] `docs/active/agent-framework-runtime-workspace-direction.md` 第 4 节更新为 hub-and-spoke 心智模型。
- [ ] 「检索不垄断」原则保留并澄清。
- [ ] `npm run build:web` 通过。
- [ ] 默认存档初始化路径（新建 save）产出新阵容 + 新 schema 的 workspace 文件。

## Out of Scope

- 不新增平台 runtime primitive 或 action executor。
- 不复活旧 `stateRecords` 表 / namespace-collection-recordId 存储模型。
- 不实现原生向量检索（仍可由 Skill + browser_script 扩展）。
- 不做首次启动世界创建流程（仍属后续内容层任务）。
- 不做 schema 可视化编辑器 UI。
- 不做应用市场/账号系统相关内容。

## Notes

- 旧固定工作流时期可继承思想来源：
  - `.trellis/tasks/archive/2026-06/06-04-generic-memory-model-first/prd.md`（字段元数据关系、primaryKey、additionalFields、版本字段、轻量字段描述）
  - `.trellis/tasks/archive/2026-06/06-05-schema-resources-mvp/prd.md`（durable vs dataflow schema 切分、persistence node-carried contract）
  - `.trellis/tasks/archive/2026-06/06-05-airp-retrieval-workflow-boundary/prd.md`（retrieval 分解为 query/extract/filter/rank/relate/merge/compose 原语）
  - `.trellis/tasks/archive/2026-06/06-06-workflow-carried-state-contract-authoring/prd.md`（collection/field/relation/index 元数据 authoring）
- 这些旧实现的存储机制已退役，只继承数据模型思想，落到纯 workspace 文件。
