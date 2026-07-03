# 修复 play frontend vue-tsc 错误

## Goal

让 `apps/play-frontend-dev` 的 TypeScript/Vue 类型检查恢复通过，消除 setup 流程中已暴露的类型错误，避免 Vite build 通过但 `vue-tsc` 失败的隐藏风险。

## Background / Confirmed Facts

- 复现命令：`npx vue-tsc --noEmit -p apps/play-frontend-dev/tsconfig.json --skipLibCheck`。
- 当前错误集中在 setup 流程，不属于刚完成的 StoryView 长历史窗口化改动。
- `apps/play-frontend-dev/src/components/setup/SetupWizard.vue:96`：`ActionConfig.onPrimary` 定义为无参 `() => void`，但原创角色分支绑定了需要 `OriginalCharacterFormData` 参数的 `onConfirmOriginal`。
- `apps/play-frontend-dev/src/components/setup/SetupWizard.vue:332`、`:340`、`:363`：`useSetupState()` 用 `readonly(...)` 暴露状态，传给子组件时数组成为 readonly，但 `SplitReview`、`UnderstandingReady`、`CanonCharacterSelect` 的 props/types 仍要求 mutable 数组。
- `apps/play-frontend-dev/src/composables/useSetupState.ts:435`：`tsian.workspace.list()` 返回 `WorkspaceEntry[]`，现代码误按 `{ files: [...] }` 读取。
- `apps/play-frontend-dev/src/composables/useSetupState.ts:615`：重复索引访问 `msgs[i]!` 导致 TypeScript 无法稳定收窄，报 possibly undefined。

## Requirements

- R1. 修复当前 `vue-tsc` 报出的 task 范围内 setup 类型错误，不扩大到功能重构或 UI 改版。
- R2. 修复必须保持现有 setup flow 语义：导入、理解、角色选择、原创角色表单、游玩设定对话入口不因类型修复改变用户路径。
- R3. readonly/mutable 类型修复应贴合实际数据流：展示型子组件不应要求修改父级传入数组。
- R4. `workspace.list()` 调用应按 `@tsian/play-bridge` 领域 API 的真实返回值 `WorkspaceEntry[]` 使用。
- R5. 不修改 bridge/contracts/platform-host API；除非发现类型错误源于共享契约本身并需要回到规划说明。

## Acceptance Criteria

- [ ] AC1. `npx vue-tsc --noEmit -p apps/play-frontend-dev/tsconfig.json --skipLibCheck` 通过，或只剩第三方依赖声明问题且本仓源码无错误。
- [ ] AC2. `npm run build --workspace play-frontend-dev` 通过。
- [ ] AC3. 修复不引入新的 UI/UX 行为变化；如必须改变原创角色提交流程，应记录原因并保持现有可用路径。
- [ ] AC4. 工作区无未说明的额外代码改动。

## Out of Scope

- setup 流程交互重设计。
- 增加新的类型检查 npm script。
- 修复与本次 `vue-tsc` 输出无关的潜在类型债务。
