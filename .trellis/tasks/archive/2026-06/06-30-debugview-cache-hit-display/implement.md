# Implement — AI 调用诊断数据完善

## 实现检查清单（有序）

### Step 1: contracts 扩展 AiDebugRecord

**文件**：`packages/contracts/src/debug.ts`

- [ ] `AiDebugRecord` 加 `providerKind?: BrowserAiProviderKind`（import from config/ai 或 contracts 内定义）。注意：`BrowserAiProviderKind` 当前在 `apps/platform-web/src/config/ai.ts`，不在 contracts——需决定是移到 contracts 还是在 debug.ts 内联定义联合类型。倾向内联（避免跨包 import 循环）。
- [ ] `AiDebugRecord.usage` 加 `cached?: number` / `cacheCreation?: number`。
- [ ] `npm run build --workspace @tsian/contracts` 验证。

### Step 2: extractUsageFromPayload 扩展四 provider 缓存字段

**文件**：`apps/platform-web/src/runtime-host/ai.ts:341`

- [ ] 加 `kind?: BrowserAiProviderKind` 参数。
- [ ] 入口先判断 `payload.usageMetadata`（Gemini）vs `payload.usage`（其他），分别走不同提取分支。
- [ ] OpenAI: 从 `usage.prompt_tokens_details.cached_tokens` 取 cached。
- [ ] DeepSeek: 从 `usage.prompt_cache_hit_tokens` 取 cached。
- [ ] Claude: 从 `usage.cache_read_input_tokens` 取 cached，`usage.cache_creation_input_tokens` 取 cacheCreation。
- [ ] Gemini: 从 `usageMetadata.cachedContentTokenCount` 取 cached，`promptTokenCount`/`candidatesTokenCount`/`totalTokenCount` 取 input/output/total。
- [ ] 返回类型加 `cached?: number` / `cacheCreation?: number`。
- [ ] 所有 `extractUsageFromPayload` 调用点传入 `config.kind`（`ai.ts:1253/1379/1536/1608/1812/1880`）。

### Step 3: ModelCallResult.usage + pushAiDebugRecord 记录 providerKind

**文件**：`apps/platform-web/src/runtime-host/ai.ts`

- [ ] `ModelCallResult.usage`（`ai.ts:147`）加 `cached?: number` / `cacheCreation?: number`。
- [ ] 所有 `pushAiDebugRecord` 调用点（`ai.ts:1199/1314/1463/1747`）传入 `providerKind: config.kind`。

### Step 4: Dexie 持久化模块

**文件**：`apps/platform-web/src/storage/ai-debug-records.ts`（新）

- [ ] `readAiDebugRecords(): Promise<AiDebugRecord[]>` — 读 meta 键 `ai-debug-records`，过滤 7 天前记录，写回过滤结果，返回剩余。
- [ ] `appendAiDebugRecord(record): Promise<void>` — 读现有 → 过滤 7 天前 → unshift 新 record → 写回。
- [ ] `clearAiDebugRecords(): Promise<void>` — 删 meta 键。
- [ ] `AI_DEBUG_TTL_MS = 7 * 24 * 60 * 60 * 1000`。
- [ ] `createdAt` 是 ISO 字符串，比较时 `Date.parse`。
- [ ] 在 `storage/index.ts` 导出。
- [ ] 不改 `db.ts`（meta 表已存在）。

### Step 5: 换卡清空

**文件**：`apps/platform-web/src/storage/game-cards.ts:369`

- [ ] `setActiveGameCardId` 内调 `clearAiDebugRecords()`（import from `./ai-debug-records`）。所有换卡路径经过此单点入口。

### Step 6: pushAiDebugRecord 改持久化 + 内存缓存

**文件**：`apps/platform-web/src/runtime-host/ai.ts`

- [ ] 保留 `aiDebugRecords` 内存数组作读缓存。
- [ ] `pushAiDebugRecord` 同步更新内存缓存 + 异步调 `appendAiDebugRecord`（fire-and-forget，错误 catch 忽略——诊断数据非关键路径）。
- [ ] `updateAiDebugRecord` 同步更新内存缓存（不变）。
- [ ] `getAiDebugRecords` 改为 async：优先返回内存缓存，缓存空时读 Dexie 填充。注意：bridge 签名 `getAiDebugRecords(): Promise<AiDebugRecord[]>` 已是 async，调用方已 await。

### Step 7: platform-host getAiDebugRecords 读 Dexie

**文件**：`apps/platform-web/src/platform-host/index.ts:647`

- [ ] `ai-debug` resource 改为调 `getAiDebugRecords()`（现在已 async 读 Dexie）。
- [ ] 确认 bridge 链路：`getAiDebugRecords` → platform-host → Dexie。

### Step 8: DebugView 删本地估算 + 加真实命中率

**文件**：`apps/platform-web/src/views/DebugView.vue`

- [ ] 删 `stablePrefixChars`（459）、`stablePrefixRatio`（470）、`cacheBreakpointLabel`（478）。
- [ ] 删模板里稳定前缀区 + 缓存断点行（139-160）。
- [ ] 加主数字区：最近调用 `cached/prompt_tokens` 命中率大百分比 + token 明细。降级显示"无缓存数据"。
- [ ] 加 `providerStats` computed：按 providerKind + model 分组统计。

### Step 9: 手写 SVG 折线图（命中率趋势）

**文件**：`apps/platform-web/src/views/DebugView.vue`

- [ ] 新增组件或内联 SVG：`<polyline>` 连接最近 N 次调用命中率点。
- [ ] 横轴调用序号、纵轴 0-100%，`stroke="var(--neon)"` 或 Tailwind text-neon 对应色。
- [ ] 无缓存数据的点跳过或标灰。
- [ ] viewBox 响应式。

### Step 10: token 构成条扩展

**文件**：`apps/platform-web/src/views/DebugView.vue`

- [ ] 扩展现有涂色条（102-147）：每次调用一行，cached(绿) + cacheCreation(蓝) + miss(黄) 按 token 比例。
- [ ] 无 cacheCreation 的 provider（OpenAI/Gemini）只显 cached + miss。
- [ ] 无 cached 数据时整条标灰 + "无缓存数据"。

### Step 11: provider/model 分组统计 UI

**文件**：`apps/platform-web/src/views/DebugView.vue`

- [ ] 按 provider 汇总：调用量、平均命中率、token 总量。
- [ ] 可折叠或简单筛选（reka-ui Tab 或按钮）。

### Step 12: 类型检查与构建

- [ ] `npm run build --workspace @tsian/contracts`（contracts 改了先行）。
- [ ] `npm run build --workspace platform-web`（含 vue-tsc + vite build）。

### Step 13: 手动验证

- [ ] 用 OpenAI 系 provider 跑一轮，DebugView 显示真实 `cached/prompt_tokens` 命中率。
- [ ] 刷新页面，DebugView 仍显示之前调用记录（持久化生效）。
- [ ] 连续跑多轮，`onTurnDebugReady` 触发实时更新。
- [ ] 切 provider（若有多个配置），统计按 provider 分组。
- [ ] provider 不返回缓存字段时显示"无缓存数据"。
- [ ] 折线图正确渲染、token 构成条比例正确。
- [ ] 换卡后 DebugView 诊断记录清空（换卡清空生效）。
- [ ] 7 天前的记录不显示（可手动构造旧 createdAt 验证，或代码 review 确认过滤逻辑）。

## 验证命令汇总

```bash
# contracts 改动先行
npm run build --workspace @tsian/contracts

# 主验证（类型检查 + 构建）
npm run build --workspace platform-web

# 确认 extractUsageFromPayload 所有调用点传 kind
rg -n "extractUsageFromPayload" apps/platform-web/src/runtime-host/ai.ts

# 确认本地估算已删除
rg -n "stablePrefixChars|stablePrefixRatio|cacheBreakpointLabel" apps/platform-web/src/views/DebugView.vue
# 期望: 无命中
```

## 风险文件与回滚点

- **contracts 改动**：`AiDebugRecord` 加可选字段，解析层需宽容旧记录。先 build contracts 再 build platform-web。
- **Gemini usageMetadata 修复**：可能影响现有 Gemini 用户的 usage 显示（从无到有）——是修复不是回归。
- **持久化异步化**：`pushAiDebugRecord` 改 fire-and-forget 异步写，若 Dexie 写失败静默忽略（诊断数据非关键路径）。
- **回滚**：`git revert`，Dexie `ai-debug-records` 键残留无害。

## review gates

- Step 1-3 完成后：contracts build 通过 + extractUsage 覆盖四 provider。
- Step 4-6 完成后：持久化链路通（刷新后数据存活）。
- Step 7-10 完成后：DebugView 显示真实数据、本地估算删除。
- Step 11 必须通过才能进 Step 12。
