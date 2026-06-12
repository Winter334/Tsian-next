# Tsian Current State Handoff

## 1. 文档目的

本文档用于新会话快速接手当前项目状态。

它记录：

- 当前代码大致落地到什么程度。
- 哪些实现属于旧原型遗留。
- 当前项目方向应看哪里。
- 下一步最适合从哪里继续。

## 2. 当前项目方向

当前项目方向已经转为 Agent-Orchestrated AIRP Runtime。

权威方向文档：

- `docs/active/airp-workflow-platform-direction.md`

旧 workflow-as-system、可视 DAG workflow editor、SillyTavern prompt-engine 和 workflow preset 不再作为长期主线。

## 3. 当前代码状态

当前代码仍是可运行原型，包含不少旧方向实现：

- 平台 WebUI 位于 `apps/platform-web`。
- 官方默认游玩前端包位于 `builtin/play-frontends/official-default`。
- 前端包通过 `PlayFrontendBridge` 与平台宿主通信。
- `platform-host` 当前仍通过 workflow 路径处理 `interaction.sendMessage`。
- `workflow-engine`、`workflow-host`、workflow editor、stateModel、prompt-engine 仍存在。
- 本地存储仍使用 Dexie / IndexedDB。
- 当前默认 AIRP 原型仍包含事件、档案、globals、stateRecords、checkpoint 和调试视图。

这些说明当前实现是什么，不代表未来架构必须继续沿用。

## 4. 当前有效边界

即使旧 workflow 主线退场，下列边界仍然有效：

- 平台负责包加载、沙箱、桥 API、模型调用、权限、通用存储和存档实例生命周期。
- Runtime 负责 AIRP 系统逻辑和运行时数据产出。
- Frontend Package 负责游戏 UI、交互和渲染。
- 存档是 AIRP 会话 / 世界实例的数据容器，平台不理解内部玩法语义。
- 前端包不能直接接触平台内部存储、模型 key 或未授权能力。

## 5. 关键代码入口

- `README.md`
- `docs/active/airp-workflow-platform-direction.md`
- `apps/platform-web/src/platform-host/index.ts`
- `apps/platform-web/src/bridge/play-frontend-bridge.ts`
- `apps/platform-web/src/views/PlayView.vue`
- `packages/contracts/src/bridge.ts`
- `packages/contracts/src/runtime.ts`
- `builtin/play-frontends/official-default/src/index.ts`

旧 workflow 相关入口仍可用于理解当前原型：

- `packages/workflow-engine`
- `apps/platform-web/src/workflow-host`
- `apps/platform-web/src/components/workflow`
- `packages/prompt-engine`

## 6. 下一步建议

当前最适合继续的方向：

1. 先完成 Agent Runtime 平台方向文档和旧文档清理。
2. 之后规划 Agent Runtime MVP，而不是继续扩展 workflow editor 或 prompt-engine。
3. 规划时优先定义平台 / runtime / frontend package / content / save instance 边界。
4. 代码迁移应另开任务，不在方向文档任务中实现。

## 7. 历史来源

旧开发历史优先查：

- `.trellis/tasks/archive/`
- `.trellis/workspace/`
- git history

不要把已清理的旧 reference/archive 文档当作当前规划依据。
