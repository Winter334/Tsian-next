# Tsian 此间

Tsian 此间是一个 AIRP 专精框架。

当前项目方向已经转为：

`Agent-Orchestrated AIRP Runtime`

Tsian 的核心不再是可视 DAG 工作流或 SillyTavern 风格提示词预设，而是一套由主控 Agent、专业 Agent、通用工具、运行时数据和可替换前端包组成的 AIRP 平台。

## 当前边界

- 平台负责包加载、沙箱、桥 API、模型调用、权限、通用存储、存档实例生命周期、导入导出。
- Agent Runtime 负责 AIRP 回合组织、主控 Agent 调度、专业 Agent 协作、工具使用和运行时数据产出。
- 前端包负责游戏界面、交互和渲染。运行时产出的数据如何展示，由 runtime 与前端包自行约定。
- 存档是一次 AIRP 会话 / 世界实例的数据容器，类似网页 AI 聊天的会话记录。平台托管生命周期，但不理解内部玩法语义。

## 当前仓库骨架

- `apps/platform-web` - 平台 WebUI、本地运行时宿主、存储、桥接和包加载。
- `packages/contracts` - 跨应用稳定契约。
- `packages/runtime-core` - 与运行环境弱耦合的核心接口和运行时骨架。
- `builtin/play-frontends/official-default` - 官方默认游玩前端包。
- `builtin/mods` - 官方内置内容包。
- `docs` - 当前方向和接手文档。

旧 workflow / prompt-engine / workflow editor 代码仍可能存在于原型实现中，但不代表当前长期方向。

## 文档入口

- [docs/README.md](docs/README.md)
- [docs/active/current-state-handoff.md](docs/active/current-state-handoff.md)
- [docs/active/airp-workflow-platform-direction.md](docs/active/airp-workflow-platform-direction.md)
- [docs/active/deferred-work.md](docs/active/deferred-work.md)
