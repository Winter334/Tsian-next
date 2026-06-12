# Tsian Documentation Guide

## 当前维护口径

`docs/` 只维护当前仍能指导项目开发的文档。

项目方向已经从早期 workflow-as-system 原型转为：

`Agent-Orchestrated AIRP Runtime`

旧的可视 DAG workflow、workflow preset、SillyTavern prompt-engine、schema resource、generic renderer adapter 等设计材料不再作为当前规划依据。历史开发内容由 Trellis task 记录和 git history 承载；不再为了保存历史而保留会污染检索的旧文档全文。

## Active 文档

当前只建议阅读和维护：

1. [active/current-state-handoff.md](active/current-state-handoff.md)
2. [active/airp-workflow-platform-direction.md](active/airp-workflow-platform-direction.md)
3. [active/deferred-work.md](active/deferred-work.md)

如果 active 文档、`.trellis/spec/`、当前代码和旧任务记录冲突：

- 当前代码说明“现在实现是什么”。
- active 文档说明“未来方向是什么”。
- Trellis task 记录说明“过去为什么那样做”。

## 当前稳定主干

Tsian 是一个面向 AIRP 的 Agent Runtime 平台。

平台负责运行条件和边界：包加载、沙箱、桥 API、模型调用、权限、通用存储、存档实例生命周期、导入导出。

Agent Runtime 负责玩法系统：主控 Agent、专业 Agent、通用工具、AIRP 回合组织、运行时数据产出。

Frontend Package 负责体验呈现：游戏界面、交互和渲染。运行时产出的数据如何展示，是 runtime 与前端包之间的约定，平台不定义通用 UI DSL 或玩法字段语义。

存档是一次 AIRP 会话 / 世界实例的数据容器。平台托管存档生命周期，但不要求里面一定有事件、档案、globals 或某个固定状态表。

## Historical Docs

早期 reference 和 archive 文档已经清理，以减少语义检索中的旧方向噪音。

需要追踪历史时，优先查看：

- `.trellis/tasks/archive/`
- `.trellis/workspace/`
- git history
