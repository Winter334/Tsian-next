# 拆分 views/AssistantView.vue

> 父任务：`06-26-large-file-split-refactor`。共享拆分约定见父任务 `design.md`。本子任务为 Vue 组件拆分，方法遵循 hook-guidelines / component-guidelines。

## Goal

将 `apps/platform-web/src/views/AssistantView.vue`（1801 行，script 993 行 / template 614 / style 193，25 次提交）拆为 composables + 子组件，降低单文件认知负担。**纯结构重构，不改变运行时行为与 UI 表现。**

## Confirmed Facts

- 1801 行 / 25 次提交 / script 993 行 / template 614 / style 193（含 scoped + 全局）。
- 路由组件，**无外部消费方**（无 import 引用），故不保留 barrel，直接内部拆分。
- hook-guidelines：composable 用于可复用 Vue state + UI 协调，不藏 persistence/runtime 副作用；mutation 用显式 command；Dexie 写在 storage helper；model 调用在 platform-host/runtime-host；`onBeforeUnmount` 清理 timer/subscription。
- component-guidelines：route view 可 own screen-local state + 调 platform API；shared logic 移到 small helpers/composables；不在 template 放长运行 runtime 逻辑；用现有 `components/ui/` primitives；不通过 contracts/bridge 暴露 Vue refs。

## Requirements

- 993 行 `<script setup>` 拆为 composables（按内聚 state/逻辑域）+ 子组件（按 UI 区块）。
- screen-local state 可留 view；shared/可复用 logic 移出。
- template 614 行按 UI 区块拆子组件，用现有 `components/ui/` primitives。
- **不保留 barrel**（路由组件，无外部 import）；路由注册不变。
- 严格增量：每拆一个 composable/子组件后 `npm run build:web` green。
- UI 表现不变（样式、交互、scroll 行为等）。

## Acceptance Criteria

- [ ] `npm run build:web` green。
- [ ] 路由注册未变；AssistantView 仍正常渲染。
- [ ] assistant 对话 UI（消息流、输入、工具卡片、scroll 行为）手动冒烟与拆分前一致。
- [ ] composables 遵守 hook-guidelines（不藏 persistence/runtime 副作用，mutation 显式 command）。
- [ ] 无死 import；无通过 contracts/bridge 暴露 Vue refs。

## Notes

- 详细 composable/子组件拆分清单在子任务 `design.md`。复杂任务，`task.py start` 前需 `design.md` + `implement.md`。
- UI 独立，可与后端拆分子任务并行。
