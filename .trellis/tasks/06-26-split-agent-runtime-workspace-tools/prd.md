# 拆分 agent-runtime/workspace-tools.ts

> 父任务：`06-26-large-file-split-refactor`。共享拆分约定见父任务 `design.md`。

## Goal

将 `apps/platform-web/src/agent-runtime/workspace-tools.ts`（2461 行，30 次提交，类型定义与执行逻辑混装）按"类型 schema 层 / 解析层 / 执行层"切分为同目录子模块，原文件降为 barrel re-export。**纯结构重构，不改变运行时行为。**

## Confirmed Facts

- 2461 行 / 30 次提交 / 3 个消费方（platform-host/browser-skill-script-executor、frontend-inspector、index）。
- 现有 import：`./trace`（summarizeTraceValue）、`@/lib/workspace-path`（normalizeWorkspacePath）。
- quality-guidelines：`lib/workspace-path.ts` 已是共享 path 核心，**勿重新复制 path 算法**，统一走该模块。

## Requirements

- 类型定义层与执行逻辑层分离，按 call graph 找 seam（非按行数）。
- 原文件降为 barrel，re-export 符号集与拆分前 public export 等价。
- 3 个消费方导入路径零改动。
- 严格一 seam 一 commit，每 seam 后 `npm run build:web` green。

## Acceptance Criteria

- [ ] `npm run build:web` green。
- [ ] barrel re-export 符号集等价。
- [ ] 3 个消费方导入路径未改动。
- [ ] workspace 工具执行相关功能手动冒烟通过。
- [ ] 无死 import；实现真正移出原文件。

## Notes

- 详细 seam 分组在子任务 `design.md`。复杂任务，`task.py start` 前需 `design.md` + `implement.md`。
