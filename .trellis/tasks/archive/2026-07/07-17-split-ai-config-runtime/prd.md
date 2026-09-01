# 拆分 AI config 与 runtime

## Goal

将 `apps/platform-web/src/config/ai.ts` 与 `apps/platform-web/src/runtime-host/ai.ts` 按类型、默认值、provider、请求构建、stream 解析、debug/probe/tool-call 等职责拆分，保持现有模型调用行为兼容。

## Background / Evidence

- `runtime-host/ai.ts` 当前约 2691 行 / 96.8 KiB。
- `config/ai.ts` 当前约 1601 行 / 54.2 KiB。
- 近期模型参数、native tool-call probe、Text Tool Protocol 等变更都集中在该区域，继续膨胀概率高。

## Requirements

- R1. 拆分配置层：types、defaults、normalizers、provider metadata、model fetch/preset helpers。
- R2. 拆分 runtime 层：content conversion、request builders、provider calls、stream parsers、debug records、probe/tool-call helpers。
- R3. 保持现有 exported types/functions 的 import path 兼容，除非子任务明确列出消费者迁移。
- R4. 不改变 provider 默认参数、URL 拼接、request body shape、stream chunk handling、debug record shape 或错误处理语义。
- R5. 备份：实现前记录 baseline commit 并创建 `backup/split-ai-config-runtime-pre-split` 本地备份 ref；provider seam 逐个移动，每个 seam 后验证 build。

## Acceptance Criteria

- [x] `config/ai.ts` 和 `runtime-host/ai.ts` 均拆成可描述单一职责的模块。
- [x] Provider-specific 逻辑不再全部堆在一个 runtime 文件中。
- [x] 现有模型参数 UI 与 runtime host import 继续编译通过。
- [x] `npm run build:web` 通过。
- [x] 对 request/debug/tool-call 行为的兼容检查结果记录在子任务中。

## Out of Scope

- 不新增 provider。
- 不调整模型参数 UI 设计。
- 不改变 native/text tool-call mode 的产品语义。
