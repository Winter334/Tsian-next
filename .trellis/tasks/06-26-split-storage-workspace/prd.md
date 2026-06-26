# 拆分 storage/workspace.ts

> 父任务：`06-26-large-file-split-refactor`。共享拆分约定见父任务 `design.md`（barrel re-export、seam-based、一 seam 一 commit + green build、防循环导入、accessor 模式）。

## Goal

将 `apps/platform-web/src/storage/workspace.ts`（2284 行，31 export，纯函数为主）按内聚职责拆为同目录子模块集合，原文件降为 barrel re-export。**纯结构重构，不改变运行时行为。**

## Confirmed Facts

- 2284 行 / 28 次提交 / 31 个 public export / 6 个消费方（agent-runtime/index、context-lifecycle、bridge/debug、platform-host/assistant-chat、frontend-inspector、platform-host/index）。
- 纯函数为主，无 module-level shared state，拆分风险最低 → 父任务编排中排第 1（基础层打底）。
- quality-guidelines Known Tech Debt：曾存在 dead storage-side search copy（已删）；`lib/workspace-path.ts` 已是共享 path 核心，**勿重新复制 path 算法**。

## Requirements

- 按 31 个 export 的内聚域分组（路径判定 / 模板 / CRUD / 事务 / checkpoint 等）拆子模块。
- 原文件降为 barrel，re-export 符号集与拆分前 31 个 public export 完全等价。
- 6 个消费方导入路径零改动。
- 严格一 seam 一 commit，每 seam 后 `npm run build:web` green。

## Acceptance Criteria

- [ ] `npm run build:web` green。
- [ ] barrel re-export 符号集与拆分前 public export 等价。
- [ ] 6 个消费方导入路径未改动。
- [ ] workspace CRUD/路径/模板/checkpoint 功能手动冒烟通过。
- [ ] 无死 import 残留；实现真正移出原文件（非 barrel-only 反模式）。

## Notes

- 详细 seam 分组在子任务 `design.md`（brainstorm 阶段以 call graph 复核）。
- 本子任务为复杂任务，`task.py start` 前需 `design.md` + `implement.md`。
