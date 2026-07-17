# 拆分 Agent Runtime workspace tools

## Goal

将 `apps/platform-web/src/agent-runtime/workspace-tools.ts` 的解析、trace、observation、agent-call、skill/action executor 等职责拆分为 focused modules，保持 Runtime workspace tool 行为不变。

## Background / Evidence

- 当前文件约 2593 行 / 83.3 KiB。
- 同时承载 tool call parsing、trace emit、tool observation formatting、controlled executor policy、agent call 等多个职责。
- 该文件是 Agent Runtime 执行链路的一部分，拆分必须保持 tool observation 和 trace metadata 稳定。

## Requirements

- R1. 按职责拆出 parsing/normalization、tracing、observations、action executors、agent-call、skill-action helpers。
- R2. 保持 `workspace-tools.ts` 对外导出兼容，优先将其降为 barrel/facade。
- R3. 不改变 runtime workspace tool names、argument validation、error codes、trace event type、observation shape。
- R4. 避免 submodule import barrel；共享 helper 下沉到内部 shared/types 模块。
- R5. 备份：实现前记录 baseline commit 并创建 `backup/split-agent-runtime-workspace-tools-pre-split` 本地备份 ref；每个 executor/trace seam 后保留 green build 或 patch 检查点。

## Acceptance Criteria

- [x] `workspace-tools.ts` 不再混放所有 tool runtime 逻辑。
- [x] 工具名、参数校验、trace metadata、agent-call metadata 与拆分前兼容。
- [x] `npm run build:web` 通过。
- [x] 没有 barrel ↔ submodule 循环依赖。
- [x] 回滚点可定位到具体 seam。

## Out of Scope

- 不新增 workspace tool。
- 不改变 Agent 调用策略。
- 不调整 trace 内容策略。
