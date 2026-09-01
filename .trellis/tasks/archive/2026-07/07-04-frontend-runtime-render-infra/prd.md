# 前端 runtime 读取与渲染基础设施

## Goal

在 `apps/play-frontend-dev` 中建立读取 `save/playthrough/runtime.json`、解析固定字段与动态扩展字段、并提供预设渲染分类输出的前端基础设施，供左侧状态栏、角色卡、容器/物品详情和 runtime injection 复用。本任务只交付**数据层**（读取、解析、归一分类、响应式刷新），不做 UI 视觉设计与 renderer 组件。

## Background

依赖任务 `07-04-renderable-runtime-entity-schema` 已归档并落地：

- `runtime.json` 默认模板已在 `apps/platform-web/src/storage/workspace-templates.ts:1387` 落地，结构为 `{turn, activeSceneIds, activeScene, player:{character,location}, inventory, status, extensions, updatedAtTurn, updatedBy}`。
- `save/schema/current.md`（模板内嵌 `workspace-templates.ts:1371`）明确前端可读字段：`name/brief/gender/tags/status/fields/sections/extensions`；扩展项公共形状 `{render, value, label?, tone?, description?, visibility?, group?, order?, priority?}`；预设 render（9 种）：`text/number/progress/tag/tags/list/section/ref/cards`；实体引用 `{ref, name}`，显示优先级 `entity.name → ref.name → id localId`。
- 实体/场景文件路径：`save/entities/<type>/<localId>.json`、`save/scenes/<localId>.json`。

前端现状：

- `useTsian` 是模块级单例，提供 `ready` ref 与 `turnCount`、`onTurnEnd`。
- `useSyncAfterTurn` 已编排回合后同步，留有 `setOnSynced(cb)` 钩子（注释"待状态栏 composable 接入"）和 `resetSyncPhase()`。
- App.vue / StoryView.vue 已管理 checkpoint restore 流程（`StoryView.vue:205` 的 `restore(id)`）。
- `composables/` 现无任何 runtime 解析/renderer 代码。

## Requirements

- R1: 通过 `@tsian/play-bridge` / `useTsian` 提供的 `tsian.workspace.read(path, "save-runtime")` 读取 runtime 和必要实体文件，不直接使用裸桥协议或 RPC method 字符串。
- R2: 提供 runtime 状态读取 composable `useRuntime()`，支持 ready 后初次加载、turn 结束后刷新、回合后同步完成后刷新、检查点恢复后刷新、`runtimeStale` 事件触发刷新。
- R3: 解析固定基础字段与 `extensions` 字段，把扩展项归一为按 `category: "metric" | "tag" | "ref" | "section"` 分类的 display item 结构；render→category 映射固定写在数据层。
- R4: 数据层只输出 display item 数据与 TypeScript 类型，覆盖 9 种预设 render；**不提供 renderer 组件**，UI 子任务按 category 取自己关心的项自行渲染。
- R5: 未知 render 走错误通道（`itemErrors`，`error: "unknown-render"`），不降级展示；读取失败返回 `{runtime: null, error: "load-failed" | "not-found"}` 不抛错；字段缺失/类型不符按 render 类型降级展示并打 `fallback: true` 标记。
- R6: 基础设施不硬编码动态玩法字段含义，只硬编码固定基础 schema、render→category 映射、9 种 render 的字段缺失降级规则。
- R7: `extensions` 解析逻辑（render→category、fallback、未知 render 判定）在 runtime 与 entity/scene 间共享同一套纯函数；后续 UI 组件可复用同一套解析结果，避免状态栏、角色卡、injection 各自重复实现解析逻辑。
- R8: 实体/场景读取提供 `parseEntity/parseScene` 纯函数与 `useEntity(ref)/useScene(id)` 薄封装；不预加载所有实体，由 UI 子任务按需读取。

## Acceptance Criteria

- [ ] 能通过 `tsian.workspace.read("save/playthrough/runtime.json", "save-runtime")` 读取并 `JSON.parse` 解析 runtime。
- [ ] 能识别固定字段与扩展字段，扩展项按 render 归一到 4 个 category 桶。
- [ ] 提供 `DisplayItem` / `DisplayItems` / `RuntimeData` 等 TypeScript 类型与 `parseRuntime`/`parseEntity`/`parseScene` 纯函数，供 UI 任务使用。
- [ ] `useRuntime()` 在 ready、turn 完成、sync 完成、`runtimeStale` 事件时自动刷新；暴露 `refresh()` 供 checkpoint restore 后显式调用。
- [ ] checkpoint restore 流程成功后调用 `refresh()` 刷新 runtime。
- [ ] 未知 render 进入 `itemErrors`（不降级）；读取失败返回 `error` 字段（不抛错）；字段缺失项打 `fallback: true`。
- [ ] `useEntity(ref)` / `useScene(id)` 能按需读取并解析实体/场景文件。
- [ ] 通过 `npm run build --workspace play-frontend-dev`。

## Dependencies

- 依赖 `.trellis/tasks/07-04-renderable-runtime-entity-schema` 明确数据约定（**已归档，已满足**）。

## Out of Scope

- UI 视觉设计、布局、样式、具体 UI 组件（状态栏/角色卡/容器面板/物品卡）。
- 通用 `<DisplayItem>` renderer 组件。
- 预加载所有实体文件。
- 全局包装 `runAction/invokeAgent` 自动 emit stale。
- 修改 schema 约定、runtime.json 模板、Agent/Skill 指导（归已归档的 schema 任务）。
- runtime 摘要 injection 实现（归 `07-04-runtime-summary-injection`）。

## Open Questions

无。技术决策已写入 `design.md`（D1-D8），可进入实施。
