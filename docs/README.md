# Tsian Documentation Guide

`docs/` 只维护当前仍能指导项目理解、开发和维护的文档。

项目方向已经从早期 workflow-as-system 原型转为：

`Agent-Orchestrated AIRP Runtime`

旧的可视 DAG workflow、workflow preset、SillyTavern prompt-engine、schema resource、generic renderer adapter 等设计材料不再作为当前规划依据。历史开发内容由 Trellis task 记录和 git history 承载；不再为了保存历史而保留会污染检索的旧文档全文。

## 推荐阅读顺序

1. [active/documentation-map.md](active/documentation-map.md) — 文档分层、维护边界、桌面助手知识与游戏卡 `docs/` 的关系
2. [active/current-state-handoff.md](active/current-state-handoff.md) — 当前实现状态
3. [active/airp-workflow-platform-direction.md](active/airp-workflow-platform-direction.md) — 平台产品与架构方向
4. [active/agent-framework-runtime-workspace-direction.md](active/agent-framework-runtime-workspace-direction.md) — Agent Framework、Skill、Runtime Workspace 方向
5. [active/play-frontend-sdk-direction.md](active/play-frontend-sdk-direction.md) — 游戏前端与 Bridge SDK 方向
6. [active/assistant-frontend-inspection-direction.md](active/assistant-frontend-inspection-direction.md) — 桌面助手检查真实 `/play` 前端的方向
7. [active/deferred-work.md](active/deferred-work.md) — 已退役、暂缓或不再推进的方向

## 当前稳定主干

Tsian 是一个面向 AIRP 的 Agent Runtime 平台。

平台负责运行条件和边界：包加载、沙箱、桥 API、模型调用、权限、通用存储、存档实例生命周期、导入导出。

Agent Runtime 负责玩法系统：主控 Agent、专业 Agent、Skill、Action、AIRP 回合组织、运行时数据产出。

Frontend Package 负责体验呈现：游戏界面、交互和渲染。运行时产出的数据如何展示，是 runtime 与前端包之间的约定，平台不定义通用 UI DSL 或玩法字段语义。

Save Instance 是一次 AIRP 会话 / 世界实例的数据容器。Runtime Workspace 是虚拟文件系统式工作区，承载 Agent 定义、Skill、对话、世界数据、记忆、前端数据和平台 metadata。结构化游戏状态应作为工作区文件/目录约定存在，而不是平台硬编码的玩法模型。

## 维护口径

如果 active 文档、`.trellis/spec/`、当前代码和旧任务记录冲突：

- 当前代码说明“现在实现是什么”。
- active 文档说明“当前方向和维护口径是什么”。
- Trellis task 记录说明“过去为什么那样做”。

平台内置桌面助手知识和游戏卡随卡 `docs/` 的边界见 [active/documentation-map.md](active/documentation-map.md)。

## Historical Docs

早期 reference 和 archive 文档已经清理，以减少语义检索中的旧方向噪音。

需要追踪历史时，优先查看：

- `.trellis/tasks/archive/`
- `.trellis/workspace/`
- git history
