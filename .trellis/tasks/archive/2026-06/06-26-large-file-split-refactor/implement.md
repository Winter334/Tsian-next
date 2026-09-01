# Implement — 大文件拆分重构（父任务编排）

> 本文件是父任务的执行编排。各子任务的详细 checklist 在各自 `implement.md`（子任务 brainstorm 阶段产出）。父任务不直接做实现。

## 子任务编排（建议执行顺序：基础层优先、风险递增）

| 序 | 子任务 slug | 目标文件 | 风险 | 依赖 |
|----|------------|----------|------|------|
| 1 | `split-storage-workspace` | `storage/workspace.ts` | 低 | 无（基础层，先打底） |
| 2 | `split-agent-runtime-workspace-tools` | `agent-runtime/workspace-tools.ts` | 中 | 无 |
| 3 | `split-agent-runtime-workspace-operations` | `agent-runtime/workspace-operations.ts` | 中 | 无 |
| 4 | `split-runtime-host-ai` | `runtime-host/ai.ts` | 中 | 无（仅 1 消费方，相对独立，可与 2/3 并行） |
| 5 | `split-agent-runtime-index` | `agent-runtime/index.ts` | 高 | 软依赖 #3（import 其一个 type，barrel 保持稳定即可） |
| 6 | `split-views-assistant-view` | `views/AssistantView.vue` | 中 | 无（UI 独立，可与后端拆分并行） |

> 顺序非依赖强制（6 文件几乎相互独立，仅 #5→#3 一个 type 软依赖）。"基础层优先"是为了让后续 agent-runtime 拆分时，基础 storage 层已稳定。#4 / #6 可与 #2/#3 并行。

## 每个子任务的标准入口

每个子任务在自身 brainstorm 阶段完成：
1. 读父任务 `design.md` 的共享约定（barrel、seam、green build、防循环、accessor）。
2. 对目标文件做 call graph 分析，确定 seam 分组，写子任务 `design.md`。
3. 写子任务 `implement.md`：ordered seam checklist + 每 seam 验证。
4. `task.py start` 后按 seam 增量实现。

## 验证命令（全子任务通用）

- 每 seam 后：`npm run build:web`（必须 green 才进下一 seam）。
- 若意外触及 contract shape：补 `npm run build:contracts`。
- 若意外触及 RuntimeEngine：补 `npm run build:runtime-core`。
- 子任务结束：导出面等价对照 + 相关功能手动冒烟。

## Rollback 点

- seam 级：单 commit `git revert`。
- 子任务级：该子任务全 commit revert；barrel 保证消费方未动，不影响其他子任务。

## 父任务最终集成评审（全部子任务归档后）

- [ ] 全仓 `npm run build:web` 一次 green。
- [ ] 6 个原大文件状态确认：5 个降为 barrel re-export，AssistantView 内部拆分完成。
- [ ] 抽查 git log：每个子任务的 seam commit 序列清晰、各有 green build。
- [ ] `.trellis/spec/platform-web/frontend/directory-structure.md` 同步更新（若拆分引入新子模块目录约定）。
- [ ] 无回归冒烟：assistant 对话 + workspace CRUD + AI 调用 + AssistantView UI 全通过。

## Review Gate（本父任务 task.py start 前）

- [ ] 用户审阅父任务 `prd.md` + `design.md` + `implement.md`。
- [ ] 用户确认 6 子任务地图与执行顺序。
- [ ] 父任务 `task.py start` 后，子任务各自独立进入 brainstorm → start → 实现。
