# 拆分 agent-runtime/workspace-operations.ts

> 父任务：`06-26-large-file-split-refactor`。共享拆分约定见父任务 `design.md`。

## Goal

将 `apps/platform-web/src/agent-runtime/workspace-operations.ts`（1386 行，13 次提交）按内聚职责拆为同目录子模块，原文件降为 barrel re-export。**纯结构重构，不改变运行时行为。**

## Confirmed Facts

- 1386 行 / 13 次提交 / 3 个消费方（platform-host/browser-skill-script-executor、index、workspace-ops）。
- 现有 import：`@/lib/workspace-path`（normalizeWorkspacePath）、`./semantic-index/search`（semanticSearch）。
- quality-guidelines Known Tech Debt：search helpers（`createPreview`/`normalizeSearchLimit`/`fileName`）是单一 live caller，**勿为单一消费者强行抽象**；除非拆分中暴露第二消费者，否则留在原内聚模块。
- 父任务软依赖：`agent-runtime/index.ts` 从此文件 import 一个 type（`WorkspaceOperationMutationAdapter`），barrel 保持稳定即可不阻塞 #5。

## Requirements

- 按 call graph 找 seam 拆子模块（search / 操作执行 / 适配器等）。
- 原文件降为 barrel，re-export 符号集等价；3 个消费方导入路径零改动。
- 严格一 seam 一 commit，每 seam 后 `npm run build:web` green。

## Acceptance Criteria

- [ ] `npm run build:web` green。
- [ ] barrel re-export 符号集等价。
- [ ] 3 个消费方导入路径未改动。
- [ ] workspace 操作执行/语义搜索功能手动冒烟通过。
- [ ] 无死 import；实现真正移出原文件。

## Notes

- 详细 seam 分组在子任务 `design.md`。复杂任务，`task.py start` 前需 `design.md` + `implement.md`。
