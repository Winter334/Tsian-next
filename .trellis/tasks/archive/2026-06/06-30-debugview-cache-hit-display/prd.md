# AI 调用诊断数据完善（缓存命中/持久化/实时/provider 区分）

## Goal

把 DebugView 的 AI 调用诊断从"内存 20 条 + 本地字符估算 + 不区分 provider + 刷新即丢"升级为：
provider 真实缓存命中率 + 持久化 + 实时更新 + 按 provider/model 区分统计，用图表直观呈现。
让人类一眼看到真实缓存命中率与 token 成本，不再依赖不准的本地估算。

## Background

### 现状缺陷（代码确认）

**`aiDebugRecords` 存储（`runtime-host/ai.ts:157`）**：
- 纯内存数组，`MAX_AI_DEBUG_RECORDS = 20`，`splice` 掉旧的
- 零持久化——刷新页面全丢，不进 Dexie、不进文件
- 不实时——DebugView 虽有 `onTurnDebugReady` 订阅（turn 完成时刷新），但内存 20 条上限丢失旧记录，且 turn 内中间 model 调用不实时

**缓存命中字段全部未提取（`extractUsageFromPayload` `ai.ts:341`）**：
- 只取 `prompt_tokens`/`completion_tokens`/`total_tokens`
- 四个 provider 的缓存命中字段全部丢弃（详见下表）
- DebugView 显示的 `stablePrefixChars`/`stablePrefixRatio`（`DebugView.vue:459`）是本地按字符估算的近似，不是 provider 真实数据

**Gemini usage 路径既有缺陷**：
- `extractUsageFromPayload` 只从 `payload.usage` 取值
- Gemini 的 usage 在 `payload.usageMetadata`（不同路径）——Gemini 原生 API 的 usage 可能整个没被提取到

**不区分 provider/model**：
- `AiDebugRecord` 只存 `model` 字段，没有 `providerKind`
- DebugView `tokenStats`（`DebugView.vue:384`）汇总所有调用，不按 provider 分组

### 四 provider 缓存字段位置（已查证）

| Provider | 缓存命中字段 | JSON 路径 | 缓存写入字段（首次创建缓存） |
|---|---|---|---|
| OpenAI | `cached_tokens` | `usage.prompt_tokens_details.cached_tokens` | — |
| DeepSeek | `prompt_cache_hit_tokens` | `usage.prompt_cache_hit_tokens` | `usage.prompt_cache_miss_tokens` |
| Claude | `cache_read_input_tokens` | `usage.cache_read_input_tokens` | `usage.cache_creation_input_tokens` |
| Gemini | `cachedContentTokenCount` | `usageMetadata.cachedContentTokenCount` | — |

注意：Claude/DeepSeek 的 cache_creation/miss 不是"坏"——是首次写入缓存的投资，下一轮才能命中。图表需区分"命中"与"写入"。

### 用户决策（已确认）

- **断点定位不保留**：本地估算的 `cacheBreakpointLabel`/`stablePrefixChars` 删掉，玩家看了也没法调整消息序列，调试直接看源码。
- **不做估算，直接显示 provider 数据**：用图表呈现真实数据，不本地猜缓存友好度。
- **合并范围**：缓存命中 + 持久化 + 实时 + provider 区分同属"AI 调用诊断数据完善"，一个任务做不割裂。

## Requirements

### R1 提取四 provider 真实缓存命中字段

`extractUsageFromPayload`（`ai.ts:341`）扩展，按 provider kind 提取缓存字段：
- OpenAI: `usage.prompt_tokens_details.cached_tokens`
- DeepSeek: `usage.prompt_cache_hit_tokens`（+ miss）
- Claude: `usage.cache_read_input_tokens`（+ cache_creation_input_tokens）
- Gemini: `usageMetadata.cachedContentTokenCount`（+ 修 usageMetadata 路径提取）

`ModelCallResult.usage`（`ai.ts:147`）扩展加 `cached?: number` / `cacheCreation?: number`。
`AiDebugRecord.usage`（contracts）同步扩展。

provider 不返回缓存字段时（兼容代理不支持），优雅降级——显示"无缓存数据"而非 0%。

### R2 持久化 AI 调用诊断记录

`aiDebugRecords` 从内存 20 条改为 Dexie 持久化。
- **全局共享，不区分来源**：所有 AI 调用记录存一份，不按 save/session 隔离，也不分助手 vs 运行时 agent。只按 provider/model 统计消耗。
- **换卡清空**：切换激活游戏卡时清空诊断记录。不同卡的 agent/workspace/contextPaths 不同，命中率不可比，混在一起会误导。这与既有惯例一致（master trace 是 per-save 的，诊断数据跟作用域走）。
- **7 天过期**：读取/写入时过滤掉 7 天前的记录（按 `createdAt` 时间戳）。老数据自动过期，不需手动清理。
- 存储形态：Dexie meta 键单键存 `AiDebugRecord[]`（序列化 JSON，键 `ai-debug-records`）。meta 表已存在，无需 schema bump。
- 跨刷新存活（7 天内）。

### R3 实时更新

保留现有 `onTurnDebugReady` 订阅机制（`DebugView.vue:815`），turn 完成时刷新。
改为读持久化的最新 N 条（替代内存 20 条上限）。
turn 内中间 model 调用的实时性暂不做（粒度太细、收益小）。

### R4 按 provider/model 区分统计

- `AiDebugRecord` 加 `providerKind: BrowserAiProviderKind` 字段
- DebugView 统计按 provider/model 分组：每个 provider 的调用量、平均命中率、token 总量
- **不区分来源**（助手 vs 运行时 agent）——只按 provider/model 聚合
- 图表能切换/筛选 provider

### R5 DebugView 显示重写

删掉本地估算（`stablePrefixChars`/`stablePrefixRatio`/`cacheBreakpointLabel`），改为：
- **主数字**：最近一次调用的真实缓存命中率 `cached/prompt_tokens`，大百分比
- **趋势图**：命中率随调用序号变化的折线图（手写 SVG `<polyline>`，`stroke="var(--neon)"`）
- **token 构成图**：每次调用一条横向条，cached(绿)+cacheCreation(蓝)+miss(黄) 按 token 比例涂色（扩展现有 div 涂色条 `DebugView.vue:102-147`）
- **provider/model 分组统计**：按 provider 汇总调用量、平均命中率、token 总量
- 降级：无缓存数据时显示"无缓存数据"而非 0%

**图表实现：手写 SVG/div，不引第三方图表库。** 理由：
1. 需求轻（折线图 + 横向条），不需要图表库复杂能力。
2. 天然继承项目 Tailwind/CSS 变量体系（`bg-neon`/`var(--neon)`/`glow-text`），未来主题系统改 CSS 变量即全局生效，零图表库适配成本。
3. 0 依赖、0 体积，与现有 DebugView 手写涂色条风格一致。

## Acceptance Criteria

- AC1：用 OpenAI 系 provider 跑一轮，DebugView 显示真实 `cached_tokens / prompt_tokens` 命中率（非本地估算）。
- AC2：刷新页面后 DebugView 仍显示之前的 AI 调用记录（持久化生效）。
- AC3：连续跑多轮，DebugView 实时更新统计（不需手动刷新）。
- AC4：切换/筛选 provider 时，统计按 provider 分组显示。
- AC5：provider 不返回缓存字段时，显示"无缓存数据"而非 0% 或报错。
- AC6：本地估算相关代码（stablePrefixChars 等）已删除。
- AC7：切换激活游戏卡后，DebugView 诊断记录清空（换卡清空生效）。
- AC8：7 天前的记录不显示（过期过滤生效）。
- AC9：`npm run build --workspace platform-web` 通过。

## Out of Scope

- 助手 agent 读 ai-debug 数据（需加 query 工具权限，独立任务）。
- 远程游戏前端读 ai-debug（spec 明确拒绝，不在此改）。
- 缓存命中率优化本身（本任务只显示数据，不优化命中率——优化是已归档的 split 任务）。

## Open Questions

（无——全部已收敛：
- 持久化作用域：全局共享，不区分来源（不分助手 vs 运行时 agent，只按 provider/model 聚合）。
- 实时机制：保留现有 `onTurnDebugReady` 订阅，改增量更新。
- 图表实现：手写 SVG/div，不引第三方库（未来主题系统零适配）。
- Gemini usageMetadata：R1 一并修。design.md 记录实现细节。））
