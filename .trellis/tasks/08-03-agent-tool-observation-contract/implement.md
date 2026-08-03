# Agent Tool Observation 契约治理 — Implementation Plan

## 1. Establish failing contract tests

- [x] 重写 `workspace-tools/observations.test.ts`：正常 JSON-safe observation 原样通过；超限返回 `TOOL_OBSERVATION_TOO_LARGE`；无效序列化返回 `TOOL_OBSERVATION_INVALID`；错误不泄露违规正文；UI `agent_call` 8-KiB projection 保持独立。
- [x] 新增 native/text 协议回归：accepted observation 不被二次 compact，每个 call 对应一个 result，id/name/content 保持。
- [x] 覆盖 parse-error/missing-call early path，保证也通过统一 acceptance gate。

## 2. Replace generic projection with strict acceptance

- [x] 在 `workspace-tools/observations.ts` 删除 `jsonSafeValue`、`boundedValue`、`previewEnvelope`、read/search projector 和即时结果对 `compactLargeValueForModel` 的依赖。
- [x] 实现固定安全上限的 acceptance helper 与稳定错误 envelope；保留 `buildToolPresentation`。
- [x] 在 `tool-execution.ts` 让所有正常/异常/early observation 通过同一 Gate，再进入 trace、协议和 memory。
- [x] 删除 `observationCharBudget` 在 `turn-types.ts`、`workspace-tools-types.ts`、Environment、host callers 与 fixtures 中的可调传递；最终 request token budget 保持不变。

Rollback point: 此阶段结束时正常小结果必须与旧值相同；若 call 对齐回归，停止后续 producer 改造并先修统一出口。

## 3. Move workspace result sizing into Agent-facing producers

- [x] 新增 workspace Tool delivery helper/adapter；不要改变 Resource Manager/SDK 使用的通用 operation 返回形状。
- [x] Read：24-KiB producer cap，覆盖 no-range、line range、char range、单行超大文件，提供 exact `nextCharOffset`。
- [x] Search：producer 自己限制 files/matches/snippets，输出 truthful returned/omitted/hasMore/continuation，不再声称未知 total。
- [x] List：Agent schema 增加 offset/limit，返回 total/nextOffset；底层 list 完整结果不变。
- [x] Glob：保留并验证 limit/truncated/narrowing。
- [x] Diff：避免回显两个完整正文；大结果返回 summary + read continuation。
- [x] Write/edit：移除 observation 中完整 file content/binary；copy/move/delete：exact count + bounded path sample + target root。

Rollback point: 每个 producer 单独落测试；任何 shared workspace contract 改动都必须证明直接调用兼容，否则退回 Agent adapter。

## 4. Remove duplicated Skill payloads and bound specialized producers

- [x] `use_skill` observation 仅返回 activation metadata/action counts；native/text 下一轮各注入完整 SKILL 正文一次。
- [x] `run_script`、custom Tool、test script 按 conservative inline contract 原样通过或 fail loud；错误提示 summary/cursor/workspace path 方案。
- [x] 验证 diagnostics 结果无需 Runtime 改写即可通过 Gate。
- [x] 为 inspector aggregate 增加 producer-owned bound/narrowing；保持字段级现有上限。
- [x] 为 `agent_call` 超限结果加入明确契约失败与 artifact/简洁输出 remediation，不自动摘要或伪造正文。

## 5. Align protocol, trace, memory, and comments

- [x] `text-tool-protocol.ts` 直接序列化 accepted observation，删除二次 `compactLargeValueForModel`。
- [x] Native provider mapping 保持不变；扩展 correlation test 验证 content 原样。
- [x] `index.ts` 与 `tool-memory.ts` 更新命名/注释：即时结果已 accepted，memory compaction 仅服务跨 turn retention。
- [x] Trace 记录 raw/accepted 状态与大小，但 UI/session persistence 仍只接收封闭 presentation。

## 6. Verification

- [ ] 定向测试：
  - `npx vitest run apps/platform-web/src/agent-runtime/workspace-tools/observations.test.ts apps/platform-web/src/agent-runtime/workspace-operations-retrieval.test.ts`
  - `npx vitest run apps/platform-web/src/platform-host/diagnostics-query.test.ts apps/platform-web/src/agent-runtime/environment.test.ts apps/platform-web/src/platform-host/assistant-chat.frontend-action-isolation.test.ts`
  - `npx vitest run apps/platform-web/src/runtime-host/ai/providers/native-tool-correlation.test.ts apps/platform-web/src/storage/assistant-conversations.test.ts`
- [x] 搜索回归：`rg -n "truncatedForModel|previewEnvelope|projectToolObservationForAgent|observationCharBudget" apps/platform-web/src`
- [x] 构建：`npm run build:contracts`（若 shared contract 改动）与 `npm run build:web`。
- [x] 根据改动面运行完整 `npm test`；若仓库已有无关失败，记录精确命令和失败归属。
- [ ] 手工/集成场景：超大单行 read 连续分页、宽泛 search、巨大 custom Tool output、use_skill 一次注入、native 30+ tool calls 逐 id 对齐。

## 7. Finish gates

- [x] 运行 `trellis-check`，修复 spec、类型、测试与跨层漂移。
- [x] 用 `trellis-update-spec` 更新 platform-web/contracts/diagnostics 规范，删除“统一 projector 截断”旧规则。
- [ ] 部署更新后的前端包，再用之前生产请求复测；将旧 bundle correlation 与新 observation 契约分别判定。

## Verification Results (2026-08-03)

- 定向回归：15 files / 46 tests passed。
- `npm run build:web`：passed（仅既存 Rollup annotation/chunk-size warnings）。
- `git diff --check`：passed。
- 残留搜索：`previewEnvelope`、`projectToolObservationForAgent`、`observationCharBudget` 均为 0；`truncatedForModel` 只保留在跨 turn Tool memory compactor 与反向断言中。
- 全仓 `npm test`：80/83 files、745/750 tests passed；5 个失败全部位于并行 Spatial 任务的 `renderer.test.ts`、`spatial-window-style.test.ts`、`window-layout.test.ts`，本任务未修改这些文件。
- 尚未执行：部署新前端包后的生产请求复测。
