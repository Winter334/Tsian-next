# 收敛 Agent Runtime 主编排文件

## Goal

在 `workspace-tools.ts` 拆分后，收敛 `apps/platform-web/src/agent-runtime/index.ts`，将可独立验证的辅助逻辑移出，让该文件聚焦 Agent Runtime 主编排/门面边界。

## Background / Evidence

- 当前文件约 2418 行 / 101.1 KiB。
- 文件位于 Agent Runtime 核心路径，包含 context injection、history formatting、tool loop、turn orchestration 等多类逻辑。
- 风险高于普通 helper 文件，必须在 workspace tools 拆分稳定后小步进行。

## Requirements

- R1. 只移动自然 seam：history span helpers、message/content formatting、context injection formatting、skill activation formatting、loop utilities 等。
- R2. 核心 turn orchestration 留在主编排文件或明确 facade 中，避免拆散状态机导致语义漂移。
- R3. 保持 Runtime message skeleton、context injection position、tool-memory tag、turn-runtime tag 等语义不变。
- R4. 保持当前对外导出/API 兼容。
- R5. 备份：实现前记录 baseline commit 并创建 `backup/split-agent-runtime-index-pre-split` 本地备份 ref；每个 helper seam 后验证 build。

## Acceptance Criteria

- [x] `agent-runtime/index.ts` 行数和职责明显下降，但主流程仍可读。
- [x] Runtime turn skeleton 和 context injection 行为不变。
- [x] `npm run build:web` 通过。
- [x] 无循环依赖、无死 import。
- [x] 变更记录中说明哪些逻辑被移动到哪些模块。

## Out of Scope

- 不重写 Agent Runtime 状态机。
- 不改 context compression 策略。
- 不改 tool protocol 或 message schema。
