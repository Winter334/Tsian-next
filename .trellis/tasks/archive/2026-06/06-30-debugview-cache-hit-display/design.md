# Design — AI 调用诊断数据完善

## 1. 架构与边界

### 1.1 改动范围

| 层 | 文件 | 改动 |
|---|---|---|
| contracts | `packages/contracts/src/debug.ts` | `AiDebugRecord` 加 `providerKind` + `usage` 加 `cached`/`cacheCreation` |
| runtime-host | `apps/platform-web/src/runtime-host/ai.ts` | `extractUsageFromPayload` 扩展四 provider 缓存字段 + Gemini usageMetadata 路径；`pushAiDebugRecord` 改写持久化 |
| storage | `apps/platform-web/src/storage/ai-debug-records.ts`（新） | Dexie meta 键持久化 + 上限滚动 |
| storage | `apps/platform-web/src/storage/db.ts` | meta 键注册（meta 表已存在，无需 schema bump） |
| storage | `apps/platform-web/src/storage/index.ts` | 导出新模块 |
| platform-host | `apps/platform-web/src/platform-host/index.ts` | `getAiDebugRecords` 改为读 Dexie |
| view | `apps/platform-web/src/views/DebugView.vue` | 删本地估算、加真实命中率 + 手写 SVG 折线图 + token 构成条 + provider 分组 |

### 1.2 不改动

- `AiDebugMessageSegment` 保持不变（断点定位删除后，segment 仍作为折叠明细保留——它记录 role/label/chars 供调试，只是不再用于估算缓存）。
- bridge 接口 `getAiDebugRecords` / `onTurnDebugReady` 签名不变（实现改持久化，调用方无感）。
- 远程 bridge 拒绝 `ai-debug` 的策略不变。
- 不加助手 agent 的 query 权限（Out of Scope）。

## 2. R1 提取四 provider 真实缓存字段

### 2.1 extractUsageFromPayload 扩展

现状（`ai.ts:341`）只从 `payload.usage` 取 `prompt_tokens`/`completion_tokens`/`total_tokens`。

新设计：加 provider kind 参数，按 kind 提取缓存字段 + 修 Gemini 路径。

```ts
function extractUsageFromPayload(
  payload: unknown,
  kind?: BrowserAiProviderKind,
): { input?: number; output?: number; total?: number; cached?: number; cacheCreation?: number } | undefined
```

提取逻辑：
- **OpenAI** (`usage.prompt_tokens_details.cached_tokens`)：从 `usage.prompt_tokens_details` 嵌套对象取 `cached_tokens`。
- **DeepSeek** (`usage.prompt_cache_hit_tokens` / `usage.prompt_cache_miss_tokens`)：直接从 `usage` 顶层取。`cacheCreation` 不适用（DeepSeek miss 不是 creation）。
- **Claude** (`usage.cache_read_input_tokens` / `usage.cache_creation_input_tokens`)：直接从 `usage` 顶层取。
- **Gemini** (`usageMetadata.cachedContentTokenCount`)：**路径不同**——Gemini usage 在 `payload.usageMetadata`（不是 `payload.usage`）。需先检查 `payload.usageMetadata`，从中取 `promptTokenCount`/`candidatesTokenCount`/`totalTokenCount`/`cachedContentTokenCount`。

**Gemini 路径修复**：`extractUsageFromPayload` 入口先判断 `payload.usageMetadata`（Gemini）vs `payload.usage`（其他），分别走不同提取分支。这是既有缺陷的修复——当前 Gemini 原生 API 的 usage 整个没提取到。

### 2.2 usage schema 扩展

`ModelCallResult.usage`（`ai.ts:147`）加 `cached?: number` / `cacheCreation?: number`。
`AiDebugRecord.usage`（`debug.ts:34`）同步扩展。

### 2.3 providerKind 记录

`pushAiDebugRecord` 调用点（`generateAssistantReply`/`generateAssistantReplyNative`/`streamAssistantReplyNative`/`streamAssistantReplyText`）已有 `config.kind`，写入 record 的 `providerKind` 字段。

## 3. R2 持久化

### 3.1 存储形态：Dexie meta 键

全局单键 `ai-debug-records`，存序列化 `AiDebugRecord[]`。理由：
- meta 表已存在（`db.ts:191` `meta: "&key"`），无需 schema bump / DB name bump（符合 storage spec"不加迁移"规则）。
- 全局共享、不区分来源——单键 JSON 数组最简单。

### 3.2 过期与清理策略

- **7 天过期**：`readAiDebugRecords` / `appendAiDebugRecord` 时过滤 `createdAt` 早于 7 天的记录。`AiDebugRecord.createdAt` 是 ISO 字符串（`debug.ts:25`），比较时 `Date.parse`。过期记录在读写时静默剔除并写回，不需独立定时器。
- **换卡清空**：在 `setActiveGameCardId`（`storage/game-cards.ts:369`）里调 `clearAiDebugRecords()`。这是换卡的单点入口，所有换卡路径（选卡/建存档/删卡后自动切）都经过它。不同卡的 agent/workspace/contextPaths 不同，命中率不可比。

### 3.3 新模块 storage/ai-debug-records.ts

```ts
const AI_DEBUG_RECORDS_KEY = "ai-debug-records"
const AI_DEBUG_TTL_MS = 7 * 24 * 60 * 60 * 1000  // 7 天

async function readAiDebugRecords(): Promise<AiDebugRecord[]>  // 读 + 过滤 7 天前 + 写回过滤结果
async function appendAiDebugRecord(record: AiDebugRecord): Promise<void>  // 读 + 过滤 + unshift + 写回
async function clearAiDebugRecords(): Promise<void>  // 删 meta 键
```

`appendAiDebugRecord`：读现有 → 过滤 7 天前 → unshift 新 record → 写回。无数量上限（7 天过期已防无限增长），但可加软上限（如 1000 条）防御异常情况。

### 3.3 pushAiDebugRecord 改异步

现状 `pushAiDebugRecord`（`ai.ts:164`）是同步内存 unshift。改为异步 `appendAiDebugRecord`（写 Dexie）。
`updateAiDebugRecord`（`ai.ts:169`）现状是同步内存查找更新——持久化后改为读-改-写回，或保留内存缓存 + 定期 flush。

**实现选择**：保留内存缓存（`aiDebugRecords` 数组）作为读缓存，`pushAiDebugRecord` 同步更新缓存 + 异步写 Dexie（fire-and-forget）。`getAiDebugRecords` 优先读内存缓存，缓存 miss 时读 Dexie。这样：
- 调用方无需 await（保持现有同步签名）。
- 刷新页面后内存缓存空，首次 `getAiDebugRecords` 读 Dexie 填充缓存。

## 4. R3 实时更新

保留现有 `onTurnDebugReady` 订阅（`DebugView.vue:815`），turn 完成时 `refreshAll()` → `refreshAiDebug()`。
`refreshAiDebug` 改为读 Dexie（通过 bridge `getAiDebugRecords`），拿到最新 200 条。
turn 内中间 model 调用的实时性暂不做（粒度太细、收益小）。

## 5. R4 provider/model 分组统计

`AiDebugRecord` 加 `providerKind: BrowserAiProviderKind`。
DebugView 新增 `providerStats` computed：按 `providerKind` + `model` 分组，每组算调用量、平均 `cached/input` 命中率、input/output token 总量。
图表可切换/筛选 provider（UI 用 reka-ui Tab 或简单按钮）。

## 6. R5 DebugView 显示重写

### 6.1 删除

- `stablePrefixChars`（`DebugView.vue:459`）
- `stablePrefixRatio`（`DebugView.vue:470`）
- `cacheBreakpointLabel`（`DebugView.vue:478`）
- 模板里对应显示（`DebugView.vue:139-160` 稳定前缀区 + 缓存断点行）

### 6.2 新增

**主数字区**：
```
缓存命中
  85%   ← cached/prompt_tokens，大字号 neon
  12,345 / 14,520 tokens   ← cached/prompt 明细
```
降级：`cached` 为 undefined 时显示"无缓存数据"。

**趋势折线图**（手写 SVG）：
- 横轴：最近 N 次调用（按时间序）
- 纵轴：命中率 0-100%
- `<polyline points="x1,y1 x2,y2 ...">` stroke=`var(--neon)`
- 无缓存数据的点跳过或标灰
- ~50 行 SVG，响应式用 viewBox

**token 构成条**（扩展现有 `DebugView.vue:102-147` 涂色条）：
- 每次调用一行：`cached`(绿 bg-neon) + `cacheCreation`(蓝) + `miss`(黄 bg-warning) 按 token 比例涂色
- 无 cacheCreation 的 provider（OpenAI/Gemini）只显 cached + miss

**provider/model 分组统计**：
- 按 provider 汇总：调用量、平均命中率、token 总量
- 可折叠/可筛选

### 6.3 保留

- `tokenStats`（`DebugView.vue:384`）总调用量/token 汇总——保留，可能加 cached 汇总
- `messageSegmentSummary` + 折叠明细——保留（调试用，不删）
- 现有 token 构成条（input/output）——保留或整合进新构成条

## 7. tradeoffs

| 决策 | 选择 | 理由 | 放弃选项 |
|---|---|---|---|
| 持久化形态 | Dexie meta 键单键 | 无需 schema bump，全局共享简单 | 独立表：需 schema bump，收益不抵成本 |
| 作用域 | 全局不区分来源 | 用户明确只要 provider/model 统计 | 按 save/session 隔离：需额外字段，用户不需要 |
| 图表 | 手写 SVG/div | 需求轻 + 天然继承 CSS 变量 + 未来主题零适配 | Unovis/Chart.js：主题系统来了要建映射层 |
| 实时粒度 | turn 完成级 | 现有订阅机制，收益足够 | 每次 model 调用：粒度太细、收益小 |
| 内存缓存 | 保留作读缓存 | 调用方保持同步签名，刷新后从 Dexie 填充 | 全异步：调用方全改 await，改动大 |

## 8. 兼容性与回滚

- **contracts 改动**：`AiDebugRecord` 加可选字段（`providerKind` / `usage.cached` / `usage.cacheCreation`），解析层宽容处理旧记录（无这些字段时降级显示）。需 `npm run build --workspace @tsian/contracts` 先行。
- **Dexie**：meta 键新增，无 schema bump。旧数据无 `ai-debug-records` 键时返回空数组。
- **回滚**：跨多文件但无数据迁移。`git revert` 恢复，Dexie 里的 `ai-debug-records` 键残留但无害（可手动清）。
