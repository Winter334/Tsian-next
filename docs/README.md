# Tsian Documentation Guide

## 1. 当前维护口径

`docs/` 里曾经沉淀了大量正式开发前的设计骨架。当前项目已经进入可运行原型阶段，并且方向已收敛为 workflow-as-system 平台，因此后续不再维护多份阶段性设计文档。

当前文档维护原则：

- 以当前代码状态为准。
- 以 `.trellis/spec/` 中的项目规范为准。
- 以 `docs/active/` 中的精简入口文档为准。
- 归档文档只作为历史背景，不作为当前任务规划的权威来源。
- 如果 active 文档、spec、当前代码和归档文档冲突，优先相信 active 文档、spec 和当前代码。

## 2. Active 文档

当前只建议把以下文档作为日常维护入口。

### 2.1 当前状态

- `active/current-state-handoff.md`

用途：

- 新会话接手
- 查看当前已经实现什么
- 查看关键代码入口
- 查看仍需注意的实现边界

### 2.2 平台方向

- `active/airp-workflow-platform-direction.md`

用途：

- 查看 Tsian 的 workflow-as-system 平台定位
- 判断新任务是否符合长期方向
- 约束节点类型、schema、资源、renderer、platform capability 的边界
- 避免把默认 AIRP 事件/档案系统误当成平台本体

## 3. Archive 文档

`archive/` 保存曾经 active 但已不再持续维护的历史材料。

它们的价值是：

- 保留早期设计背景
- 帮助追踪某些实现为什么曾经这样做
- 在需要时提供决策历史

它们的限制是：

- 不保证描述当前代码
- 不保证符合最新 workflow-as-system 方向
- 不应作为新任务的唯一依据

## 4. Reference 文档

`reference/` 保存更早期的骨架文档和技术背景材料。

如果后续需要重新讨论某个方向，应把新结论收敛回 `active/airp-workflow-platform-direction.md`，而不是继续维护所有历史骨架文档。

## 5. 当前稳定主干

当前项目的稳定主干可以压缩为：

`Tsian 是一个面向 AIRP 的 workflow-as-system 平台。系统由 workflow preset、schema/state、resources、platform capabilities 和 frontend renderer 组合而成。默认事件/档案记忆是参考系统，不是平台本体。平台负责存储、schema 校验、checkpoint、回滚、AI 调用和调试追踪等安全边界，玩家和作者通过配置工作流与资源来构建自己的 AIRP 系统。`

阅读顺序：

1. `docs/active/current-state-handoff.md`
2. `docs/active/airp-workflow-platform-direction.md`
3. 需要历史背景时，再查 `docs/archive/` 或 `docs/reference/`
