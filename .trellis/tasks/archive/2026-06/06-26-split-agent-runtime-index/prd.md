# 拆分 agent-runtime/index.ts

> 父任务：`06-26-large-file-split-refactor`。共享拆分约定见父任务 `design.md`。**本子任务风险最高，须最保守执行。**

## Goal

将 `apps/platform-web/src/agent-runtime/index.ts`（2292 行，48 次提交，8 export + 49 内部函数，turn 主循环）按 turn 阶段/职责聚类拆为同目录子模块，原文件降为 barrel re-export。**纯结构重构，不改变运行时行为。**

## Confirmed Facts

- 2292 行 / **48 次提交（全场最高 churn）** / 8 public export + 49 内部函数 / 3 个消费方（platform-host/assistant-chat、frontend-inspector、index）。
- spec 将此文件列为 Source Reference（重要文件），拆分须格外保守。
- 现有 import 较多：`./context`（assembleAgentContext）、`./registry`（buildAgentRegistry）、`./trace`、`../config/ai`（type）、`./workspace-operations`（type）等。
- 软依赖：从此文件 import `workspace-operations` 的一个 type；父任务编排中排在 #3（workspace-operations 拆分）之后，barrel 保持稳定即可。

## Requirements

- 49 个内部函数按 turn 阶段/职责聚类（如 context 组装 / registry / trace / turn 循环 / 工具调度等）找 seam。
- 原文件降为 barrel，re-export 符号集与拆分前 8 个 public export 等价；3 个消费方导入路径零改动。
- **严格一 seam 一 commit + green build**，因 churn 最高、风险最大，seam 粒度宜更小。
- module-level shared state（若有）用 accessor 模式，避免循环导入。

## Acceptance Criteria

- [ ] `npm run build:web` green。
- [ ] barrel re-export 符号集与拆分前 8 个 public export 等价。
- [ ] 3 个消费方导入路径未改动。
- [ ] assistant 对话 turn 循环 / 工具调度 / context 组装手动冒烟通过。
- [ ] 无死 import；实现真正移出原文件；无循环导入。

## Notes

- 详细 seam 分组在子任务 `design.md`（brainstorm 阶段以 call graph 复核，49 函数聚类）。复杂任务，`task.py start` 前需 `design.md` + `implement.md`。
- 风险最高，建议排在父任务编排第 5（基础层与中等风险子任务完成后）。
