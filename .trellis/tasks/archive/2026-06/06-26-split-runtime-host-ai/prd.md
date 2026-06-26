# 拆分 runtime-host/ai.ts

> 父任务：`06-26-large-file-split-refactor`。共享拆分约定见父任务 `design.md`。

## Goal

将 `apps/platform-web/src/runtime-host/ai.ts`（1605 行，13 次提交，45 声明）按 provider / 能力切分为同目录子模块，原文件降为 barrel re-export。**纯结构重构，不改变运行时行为。**

## Confirmed Facts

- 1605 行 / 13 次提交 / 45 个声明 / 仅 1 个消费方（platform-host/index）。
- 现有 import：`@tsian/contracts`（type-only）、`../agent-runtime/tool-schemas`（type-only ToolSchema）。
- 仅 1 消费方，barrel 兼容压力小，但仍保留 barrel 以统一策略。

## Requirements

- 按 provider / 能力（如 chat 调用、debug 记录、streaming、content 构造等）找 seam 拆子模块。
- 原文件降为 barrel，re-export 符号集等价；1 个消费方导入路径零改动。
- 严格一 seam 一 commit，每 seam 后 `npm run build:web` green。
- contract shape 不变 → 无需 `build:contracts`（除非意外触及）。

## Acceptance Criteria

- [ ] `npm run build:web` green。
- [ ] barrel re-export 符号集等价。
- [ ] 消费方导入路径未改动。
- [ ] AI 调用/debug 记录功能手动冒烟通过。
- [ ] 无死 import；实现真正移出原文件。

## Notes

- 详细 seam 分组在子任务 `design.md`。复杂任务，`task.py start` 前需 `design.md` + `implement.md`。
- 相对独立，可与 agent-runtime 拆分子任务并行。
