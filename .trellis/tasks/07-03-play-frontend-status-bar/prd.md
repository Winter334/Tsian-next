# 游戏前端状态栏与可渲染运行时状态体系

## Goal

建立一套可扩展的玩家状态信息体系：默认前端能在主游玩态展示当前局面、角色、世界变量、背包/容器、物品、在场人物等状态信息；同时让 runtime/entity/scene/container/item 等 workspace 数据支持前端 UI 渲染与后续动态 schema 扩展。

本任务是父任务，负责整体需求、设计原则、子任务地图与最终集成验收；具体实现拆到子任务中完成。

## User Value

- 降低玩家记忆负担：关键状态不再只能从长对话历史里回忆。
- 提升行动决策质量：位置、时间、角色状态、物品和容器信息可即时参考。
- 支持长线游玩：状态栏随存档演进、检查点恢复、世界状态维护而更新。
- 支持动态 AIRP：剧情过程中新增的临时机制/字段可以自然进入 UI，而不要求前端理解玩法 schema。
- 保持默认前端的可 fork 性：默认实现既是玩家 UI，也是助手改造前端时的可读样例。

## Confirmed Facts

- Tsian 的玩法语义不由平台硬编码；事件、角色、记忆、状态等以 workspace 文件约定存在，游戏前端负责界面呈现（`README.md:9`）。
- 游戏前端通过 `@tsian/play-bridge` 领域 API 与平台交互；布局、主题、状态栏属于前端/助手地盘（`docs/active/play-frontend-sdk-direction.md:20`, `docs/active/play-frontend-sdk-direction.md:40`, `docs/active/play-frontend-sdk-direction.md:45`）。
- SDK 已提供 `tsian.workspace.read/list/search/write`，前端可读写 workspace；需要跨轮保持的状态应落盘到 workspace，并可在发送行动时通过 injection 注入给 agent（`docs/sdk/play-frontend-api.md:409`, `docs/sdk/play-frontend-api.md:477`）。
- 默认前端主游玩态目前由顶部 `AppHeader`、右侧 `AppNav`、中间 `StoryView` 组成；`StoryView` 已为右侧导航预留 180px，顶部预留 52px（`apps/play-frontend-dev/src/App.vue:90`, `apps/play-frontend-dev/src/components/story/StoryView.vue:456`）。
- 当前 schema 已有 `name`、`brief`、`tags`、`status`、`fields`、`sections`、结构化 ref、container `contents`、scene `present`、`save/playthrough/runtime.json` 等可作为前端渲染基础（`docs/active/novel-airp-workspace-schema-direction.md:132`）。
- Schema 演进是默认存在的；`save/schema/current.md` 是当前 schema 权威，安全增量可更新 current/changelog，有风险变更进入 pending patches（`docs/active/novel-airp-workspace-schema-direction.md:146`）。
- `save/playthrough/runtime.json` 适合存放高频访问、玩家面向或前端管理的运行时变量，例如活跃场景、玩家角色/位置、主背包摘要、装备引用、队伍成员、高优先级状态摘要（`docs/active/novel-airp-workspace-schema-direction.md:192`）。

## Core Principles

### P1. Runtime as Current Context Index

`save/playthrough/runtime.json` 不再作为“所有状态摘要的大杂烩”。它是当前上下文索引与世界变量载体：记录剧情内时间/纪年、天气/环境、当前位置/地点引用、当前场景引用、主角/当前视角角色引用，以及少量确实属于世界层的运行时变量。

runtime 可以服务左侧状态栏和 storyteller injection，但它不复制 scene/entity 的摘要。状态栏、角色卡和 injection 需要人物/场景详情时，应沿 runtime 中的 ref 读取权威文件并生成各自的派生投影。

### P2. Fixed UI + Dynamic Extension Slots

不是所有 schema 都走通用渲染。预设固定 schema 可以由前端硬编码契约并做精致 UI：角色卡、在场人物、背包/容器、物品卡、场景面板等。

通用渲染只服务后续新增字段/临时机制。新增字段通过 `extensions` / `扩展` 和预设 `render` / `渲染` 方案自然进入对应 UI 槽位，而不是堆到一个“其它”区域。

### P3. Extension Slots by Render Type

UI 设计应按实体类型和渲染类型预留槽位：

- `progress` / `number` → 数值区。
- `tag` / `status` → 状态区。
- `ref` / `list` / `cards` → 关联、背包、装备、在场对象等入口区。
- `section` / `text` → 详情区。

是否需要更细的 `group` / `order` / `priority` 由具体 UI 子任务按实际需要决定。

### P4. Runtime, Scene, and Entity Authority

`runtime.json` 是当前上下文索引和世界变量权威；scene 文件是场景结构权威；entity 文件是实体档案权威。三者不互相复制摘要：

- runtime 存当前世界变量与入口 refs，例如 `activeSceneRefs`、`protagonistRef`。
- scene 存场景结构与在场 refs，不复制人物 `name` / `brief` / `status`。
- entity 存人物/物品/容器自身档案，例如 `name`、`brief`、`appearance`、`status`、`fields`、`sections`、`goals`。

UI 和 injection 都是派生投影：需要显示或注入时读取权威文件并格式化。漂移问题不靠复制摘要解决，而靠避免双源。

### P5. Name / Alias Semantics

实体 `name` 保持为必填主显示名/当前 UI 标签；`id` 后半段是稳定 localId，可与 `name` 相同但不承担显示语义。`aliases` 是可选替代名称，只在存在昵称、称号、旧名、伪装名、不同称呼等时维护。前端优先显示 `name`，缺失时 fallback 到 ref/localId。

### P6. Frontend Current Context Injection

前端可以在玩家发送行动前，把当前上下文编译成 storyteller 友好的 injection。该 injection 不应是一条巨大的 runtime 摘要消息，而应按缓存粒度拆成多条 injection message，例如：

1. runtime/world block：剧情时间、天气、地点、当前 scene refs、protagonist ref。
2. active scene block：当前场景文件的一跳去结构化投影，只列出场景结构和在场 refs，不递归展开人物。
3. protagonist block：主角/当前视角角色实体的一跳去结构化投影。

拆成多条 message 是为了减少 prompt cache 失效范围：scene 变化不应导致 protagonist block 失效，主角状态变化也不应导致 runtime/world block 失效。storyteller 如果还缺信息，应使用 workspace 工具或 call 资料员补充。

### P7. Agent / Skill Responsibility

运行时文件不承载维护 SOP、清理策略或 Agent 行为说明；这些规则属于 Agent / Skill / schema 指导文件。后续需要调整 AIRP Agent 阵容，并把复杂能力 Skill 化，避免把所有流程塞进 `AGENT.md`。

## Child Task Map

| Order | Task | Purpose | Notes |
|---:|---|---|---|
| 1 | `.trellis/tasks/07-04-renderable-runtime-entity-schema` | 定义 runtime/entity/scene/container/item 的可渲染 schema 约定 | 后续所有 UI 的数据契约基础 |
| 2 | `.trellis/tasks/07-04-frontend-runtime-render-infra` | 前端读取 runtime、解析固定字段与 extensions、提供通用渲染基础设施 | 供状态栏、角色卡、注入复用 |
| 3 | `.trellis/tasks/07-04-left-status-bar-mvp` | 左侧状态栏 MVP | 第一块玩家可见 UI |
| 4 | `.trellis/tasks/07-04-present-characters-character-cards` | 在场人物列表与角色卡 | 验证固定 UI + 动态扩展槽 |
| 5 | `.trellis/tasks/07-04-containers-inventory-item-details` | 容器/背包/物品详情 | 支持逐层查看物品与容器 |
| 6 | `.trellis/tasks/07-04-runtime-summary-injection` | 前端编译 runtime 当前局面摘要并 injection 给 master | 降低 master 自行读取 ref 的成本 |
| 7 | `.trellis/tasks/07-04-airp-agent-roster-skills` | AIRP Agent 阵容调整与 Skill 化 | 核心能力组织，避免 Agent.md 膨胀 |
| 8 | `.trellis/tasks/07-05-runtime-world-time-field` | 将当前世界/剧情时间提升为 `runtime.worldTime` 固定字段 | 支撑状态栏与 runtime 摘要 injection 的稳定时间入口；不做完整日历系统 |

## Cross-Child Acceptance Criteria

- [ ] 父任务中的 runtime-as-status-surface、fixed UI + dynamic extension slots、Agent/Skill 责任边界被各子任务遵守。
- [ ] 子任务 1 产出的 schema 约定足以支持后续状态栏、角色卡、容器/物品详情和 injection。
- [ ] 子任务 2 的前端渲染基础设施不硬编码动态玩法字段，只硬编码固定基础 schema 和预设渲染类型。
- [ ] 玩家可见 UI 不直接使用裸桥协议、原始事件名或 RPC method 字符串；通过 `useTsian` / `tsian.workspace.*` 等领域 API 访问数据。
- [ ] 检查点恢复、历史重载后，状态栏相关 UI 能重新读取当前 workspace 状态，避免显示被回滚后的旧状态。
- [ ] Agent/Skill 相关变更保持“Agent.md 职责简洁、Skill 按需加载”的方向。

## Out of Scope for Parent Task

- 父任务不直接实现具体 UI 或代码改动；实现由子任务承担。
- 不在本父任务中一次性完成所有背包、装备、关系、任务、数值系统。
- 不新增平台内置黑盒渲染层或 SDK 状态栏 API。
- 不把纯前端瞬时 view state（折叠、滚动、hover、临时过滤）持久化到 workspace。

## Next Step

从子任务 1：`.trellis/tasks/07-04-renderable-runtime-entity-schema` 开始，先把可渲染 runtime/entity schema 约定规划清楚，再进入前端基础设施与 UI 实现。

## Open Questions (集成阶段讨论)

> 2026-07-05 设计评审提出，留待子任务集成阶段讨论。

### OQ-1: 集成验证

当前子任务完成 ≠ 系统体验成立。最后仍需集成验证。接缝问题（事件时序、状态刷新一致性、检查点恢复后 UI 重读 workspace）无人管。

集成阶段需决定：由父任务保留集成验证职责（所有子任务完成后跑一次完整流程：开局 → 几轮剧情 → 状态栏刷新 → injection → 场记维护，检查 cross-child acceptance criteria），或新增一个轻量子任务 `07-04-status-bar-integration-verify`。

注：`runtime-summary-injection` 的实际效果验证也归此处。用户 2026-07-05 判断：injection 排最后可接受，整个大系统必然经历返工调整，留到集成验证时一起调整。
