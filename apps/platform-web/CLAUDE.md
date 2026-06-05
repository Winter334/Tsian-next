# platform-web — 模块 CLAUDE.md

[根目录](../../CLAUDE.md) > [apps](../) > **platform-web**

---

## 1. 模块职责

平台 WebUI，承载 Tsian 在浏览器侧的全部本地运行时职责：

- 启动 Vue 3 应用与平台壳 UI（大厅 / 模组页 / 设置 / 游戏视图）
- 装载内置模组与游玩前端（通过 `package-loader` 与 `builtin/*` 直链）
- 通过工作流引擎执行 AI 主链（retrieval → chat → maintenance 等节点由 default-workflow 编排）
- 持久化存档到 IndexedDB（Dexie）
- 通过 `PlayFrontendBridge` 把运行时能力暴露给游玩前端

---

## 2. 入口与启动

| 入口 | 路径 | 说明 |
|------|------|------|
| 应用入口 | `src/main.ts` | `createApp(App).mount("#app")` |
| 根组件 | `src/App.vue` | 平台壳 UI（大厅 / 模组页 / 设置 / 游戏视图） |
| 平台壳调度 | `src/platform-host/index.ts` | 持有 `LocalRuntimeEngine` 与扩展版 Bridge |
| 运行时引擎 | `src/runtime-host/engine.ts` | 实现 `RuntimeEngine`（来自 `@tsian/runtime-core`） |
| 桥工厂 | `src/bridge/play-frontend-bridge.ts` | 创建 `PlayFrontendBridge` 基础实现 |

启动命令：

```bash
npm run dev --workspace platform-web   # 等价于根目录 npm run dev:web
npm run build --workspace platform-web # 等价于根目录 npm run build:web
```

---

## 3. 内部子系统

```
src/
├── main.ts                 # Vue 入口（注册 vue-router）
├── App.vue                 # 平台壳骨架（导航 + <router-view>，B4 拆分后 ~235 行）
├── style.css
├── design-tokens.css       # B2：羊皮纸 Design System CSS 变量（57 个令牌）
├── debug-events.ts         # B3：subscribeTurnDebugReady / emitTurnDebugReady（平台 → 调试视图事件总线）
├── narrative-time.ts       # 叙事时间格式工具（YYYY-MM-DD HH:mm）
├── config/
│   └── ai.ts               # 浏览器 AI 配置（chat / retrieval / embedding）
├── router/
│   └── index.ts            # B4：vue-router 5 路由（home/play/mod/settings/debug）
├── views/                  # B4：5 个顶层视图（懒加载）
│   ├── HomeView.vue        # 大厅 / 存档管理
│   ├── PlayView.vue        # 游玩视图（装载内置前端）
│   ├── ModView.vue         # 模组页（builtin mod 元数据）
│   ├── SettingsView.vue    # AI 配置与检索调参
│   └── DebugView.vue       # B5：调试兜底面板（消费 bridge.debug 等三条路径渲染 6 类数据）
├── platform-host/
│   └── index.ts            # 平台主调度器；扩展 PlayFrontendBridge（注入 debug 命名空间）
├── runtime-host/
│   ├── index.ts            # 导出 engine
│   ├── engine.ts           # LocalRuntimeEngine（实现 RuntimeEngine）
│   ├── ai.ts               # OpenAI 兼容 chat / embedding 客户端 + 调试记录 + token usage（B3）
│   ├── patch-applier.ts    # applyMaintenancePatch（HC-14 统一收口）
│   └── retrieval.ts        # 结构检索 + 可选 AI 增强 + 向量重排
├── storage/
│   ├── index.ts            # 重导出
│   ├── db.ts               # Dexie schema (meta/saves/events/archives/...)
│   ├── saves.ts            # 存档 CRUD + 初始化种子
│   ├── events.ts           # 事件 patch 应用
│   ├── archives.ts         # 档案 patch 应用 + ID 生成
│   ├── checkpoints.ts      # 完整状态切片 / 恢复
│   ├── embeddings.ts       # 向量缓存与相似度
│   ├── runtime-write.ts    # write-runtime 入口（前端写入运行时）
│   └── status.ts           # 存储健康探针
├── bridge/
│   ├── index.ts                 # 重导出（含 createDebugBridge）
│   ├── debug.ts                 # B3：createDebugBridge（subscribeWorkflow / getRetrievalDebug / getAiDebugRecords / onTurnDebugReady）
│   └── play-frontend-bridge.ts  # 基础桥工厂（platform-host 会扩展）
├── workflow-host/             # H4-H7：工作流节点 executor 注册 + 内置 preset + 默认工作流 + outputs store（H8 接主链）
│   ├── index.ts               # createWorkflowExecutionContext 工厂
│   ├── types.ts               # PlatformWorkflowContext
│   ├── default-workflow.ts    # H6：平台默认工作流（design.md §8）
│   ├── outputs-store.ts       # H7：套娃 shallowRef 输出仓（per-turn ref + 模块级 currentTurnOutputsRef + OutputsStoreWriter 实现）
│   ├── executors/             # ai-call / result / switch / apply-patch / compute
│   └── builtin-presets/       # H5：retrieval / chat / maintenance PresetInfo + index Map
└── package-loader/
    └── official-default.ts # 直接 import 内置默认前端
```

---

## 4. 对外接口

### 4.1 暴露给游玩前端的桥（`PlayFrontendBridge`）

来自 `@tsian/contracts` 的 `bridge.ts`：

- `runtime.getRuntimeSnapshot()` → `RuntimeSnapshotShell`
- `runtime.applyPatch(patch)` → `ApplyPatchOutput`（I4：走 `runtime-host/patch-applier.ts` 的 `applyMaintenancePatch`，HC-14 同源；不创建 checkpoint）
- `runtime.updateGlobals(path, value)` → `void`（I4：dot-path → 嵌套对象 → 转 maintenance patch 走 applier）
- `runtime.appendUserMessage(content)` / `runtime.appendAssistantMessage(content)` → `void`（I4：append 例外，直调 engine 同步方法，不递增 `state.turn`，§13.6）
- `interaction.sendMessage({ content, narrativeTimeText })`
- `query.query<T>({ resource, params })` — 资源类型见下表
- `platform.getPlatformContext()`
- `platform.runAction({ action, params })`
- `debug.subscribeWorkflow(cb)` → unsubscribe（B3：每轮 `WorkflowOutputsSnapshot` 推送）
- `debug.getRetrievalDebug()` → `RetrievalDebugRecord | null`
- `debug.getAiDebugRecords()` → `AiDebugRecord[]`
- `debug.onTurnDebugReady(cb)` → unsubscribe（B3：每轮主链结束触发调试视图刷新）

**资源 (`DeepQueryRequest.resource`)**：`history` / `events` / `archives` / `mod-static` / `ai-debug` / `retrieval-debug` / `checkpoints` / `workflow-debug`。

**Action (`runAction`)**：`restore-checkpoint`（由 `platform-host` 实现，基础桥不支持）。

### 4.2 启动期对外可见入口

- `runtimeEngine` (`platform-host/index.ts`) — 全局唯一引擎实例
- 平台壳 UI 通过 `package-loader/official-default` 装载内置前端

---

## 5. 关键依赖与配置

| 依赖 | 版本 | 用途 |
|------|------|------|
| `vue` | ^3.5.13 | UI 框架 |
| `dexie` | ^4.0.11 | IndexedDB 包装 |
| `@tsian/contracts` | 0.0.0 (workspace) | 类型契约 |
| `@tsian/runtime-core` | 0.0.0 (workspace) | RuntimeEngine 接口 |
| `vite` | ^6.0.5 | 开发与构建 |
| `vue-tsc` | ^2.2.0 | 类型检查 |

AI 配置存放在浏览器 `localStorage`，键由 `config/ai.ts` 管理（chat / retrieval / embedding 三套 baseUrl/apiKey/model + retrievalSettings 阈值）。

---

## 6. 数据模型（Dexie）

来自 `storage/db.ts`：

- `meta` — KV 元数据（如 active-save-id）
- `saves` — 存档列表 (`id, name, modId, createdAt, updatedAt`)
- `saveSnapshots` — 单存档当前快照
- `saveHistories` — 对话历史
- `events` — 事件记录（`saveId / time / status / entityTags / entityArchiveIds / content`）
- `archives` — 档案（扁平对象 + 动态扩展字段）
- `checkpoints` — 整轮完整切片（snapshot + history + events + archives）
- `embeddings` — 向量缓存（`targetType / targetId / embeddingModel / contentHash / vector`）

---

## 7. 测试与质量

无自动化测试。当前验证手段：

- `npm run build:web` 通过 `vue-tsc` 做类型检查
- 浏览器手动跑通"创建存档 → 输入 → 维护 → 检查面板"主链
- 通过 official-default 前端的 6 个面板观察中间状态

---

## 8. 常见问题 (FAQ)

> 注：下文 §9 已补充 `platform-host/index.ts` 的分区导览与不变量说明。



**Q：为什么 `bridge/play-frontend-bridge.ts` 的 `runAction` 永远返回 `PLATFORM_ACTION_UNAVAILABLE`？**
A：基础桥工厂只覆盖核心运行时；`platform-host/index.ts` 在装载前端前会再包一层带平台动作（如 `restore-checkpoint`）的实现。

**Q：为什么 `builtin/mods` 直接被 `import`？**
A：原型期内置模组与平台 WebUI 同仓库直链，不走分发；后续模组分发能力交给 `platform-server`。

**Q：本地数据格式变了怎么办？**
A：原型期默认清本地 IndexedDB 重建，不补迁移。

---

## 9. `platform-host/index.ts` 分区导览（≈1046 行）

平台主调度器是单文件聚合，按「工具 → 校验 → 写入处理 → 持久化 → 桥实现 → 启动入口」的顺序排布。下表给出按行号定位的快速索引（行号基于当前 master，重构后会偏移，定位以函数名为准）：

| 区域 | 行号 | 关键符号 | 职责 |
|------|------|---------|------|
| **顶部 setup** | `1–61` | `runtimeEngine`、`baseBridge`、`retrievalDebugBySave` | 实例化 `LocalRuntimeEngine`、构造基础桥、按 saveId 缓存检索调试快照 |
| **名称归一 / 强引用挂载** | `63–174` | `normalizeName`、`archiveNameKeys`、`resolveArchiveIdsByNames`、`attachArchiveStrongRefs`、`attachEventStrongRefs`、`mergeArchiveRefsById` | 把维护 AI 输出的 patch 中以"名字 / 别名"指向的实体替换为强引用 ID，并合并入档案 `linkedArchiveIds`；事件 patch 同理 |
| **快照 / 时间字段读取** | `175–225` | `getSnapshotMessages`、`getSnapshotCurrentTime`、`formatDefaultNarrativeTime`、`getNarrativeTimeText`、`getSnapshotGlobals`、`actionError` | 从 `RuntimeSnapshotShell` 安全读取消息 / 当前叙事时间 / globals；统一构造 `PlatformActionError` |
| **JSON / 输入校验** | `227–425` | `isPlainObject`、`isJsonValue`、`normalizeStringList`、`duplicateIds`、`normalizeHistoryRecord`、`normalizeEventInput`、`normalizeArchiveInput` | `write-runtime` 入口的输入清洗：限制类型、收敛字段、检测重复 ID |
| **`write-runtime` 校验主流程** | `428–622` | `validateRuntimeWriteRequest` | 把前端传入的 `{ turn, currentTime, globals, history, events, archives, checkpointLabel }` 整体校验为一个可写入对象，失败时返回结构化 `PlatformActionError` |
| **`write-runtime` 执行** | `624–699` | `handleWriteRuntimeAction` | 拉当前切片 → 用请求覆盖未提供的分组 → `replaceRuntimeForSave` 一次性替换 → 重新加载 engine → 失败时归零 `retrievalDebugBySave`；写入成功后自动建一个 `manual` checkpoint |
| **扩展版桥（默认导出）** | `769–977` | `playFrontendBridge` | 在 `baseBridge` 之上覆盖 `platform.runAction` 与 `query.query`、`interaction.sendMessage`；B3 起追加 `debug` 命名空间（`createDebugBridge` 注入，`sendMessage` 末尾 `emitTurnDebugReady(turn)`） |
| └ `platform.getPlatformContext` | `771–778` | — | 返回 `{ version, activeModId }` |
| └ `platform.runAction` | `779–835` | — | 实现 `restore-checkpoint`（恢复到指定 checkpoint，重置检索缓存）与 `write-runtime`（委托给 `handleWriteRuntimeAction`）；其它动作返回 `UNSUPPORTED_PLATFORM_ACTION` |
| └ `query.query` | `837–924` | — | 路由 `history / events / checkpoints / archives / retrieval-debug / mod-static / builtin-mods / ai-debug`，未命中时回退 `baseBridge` |
| └ `interaction.sendMessage` | `925–976` | — | **一轮主链**：装载上下文 → `assembleRetrievalContext`（host 侧旁路）→ turn++ / outputsStore 创建 → `appendUserMessage` → buildMacros → `executeWorkflow`（default-workflow）→ `appendAssistantMessage` → saveSnapshot/History |
| └ `query.query` (`workflow-debug`) | `837–924` | — | 路由 `workflow-debug` 返回当前轮 `WorkflowOutputsSnapshot` JSON；未命中回退 `baseBridge` |
| **启动 / 存档管理** | `979–1046` | `initializePlatformHost`、`listPlatformSaves`、`createPlatformSave`、`selectPlatformSave`、`deletePlatformSave`、`getPlatformActiveSaveId` | 启动期把 active save 的 snapshot 装回 engine；提供平台壳 UI 调用的存档 CRUD |

### 几个值得记住的不变量

1. **engine 是单例**：`runtimeEngine` 在模块顶层 `new` 一次，`restore-checkpoint` / `write-runtime` / 启动期都通过 `loadSnapshot` 重置它，不会重新构造。
2. **`retrievalDebugBySave` 必须随 engine 状态同步失效**：任何"换一个 snapshot"的入口（restore-checkpoint、write-runtime）都要 `retrievalDebugBySave.delete(activeSaveId)`，否则调试面板会看到上一个时间线的检索结果。
3. **维护逻辑已进 `apply-patch` 工作流节点，函数 `persistActiveSnapshot` 不再存在；fail loud 由节点异常冒泡保证**（design §13.1 / §13.9）。**这是 H8/H9 重构后的有意变更**：原型期暴露问题优于静默吞错。如未来需要保护主链，应在 `interaction.sendMessage` 外层挂顶层错误边界，而不是在 applier 里 catch。
4. **patch 强引用挂载必须在落盘前完成**：`attachArchiveStrongRefs` / `attachEventStrongRefs` 把维护 AI 输出的"名字"替换为档案 ID 后再调用 `applyArchivePatchesForSave / applyEventPatchForSave`，避免把生成式名称漏到存储层。
5. **DebugView 用 `nodeId` 模式过滤维护写入节点**：B5 视图按 `nodeId.includes("maintenance") || .includes("memorywrite") || .includes("memory-write") || .includes("apply-patch") || .includes("applypatch")` 从 `WorkflowOutputsSnapshot` 中挑维护写入节点。**未来 `default-workflow.ts` 改节点名时需同步本视图的过滤规则**（`views/DebugView.vue` 内的 `maintenanceWriteNodeEntries` 计算属性），否则调试面板的维护写入段会显示空。

### 何时需要拆分这个文件

当前刻意保留单文件，原因是平台主调度器 = 桥实现 + 主链编排 + 校验，三者耦合很高，分散后追问题反而要跨文件跳。出现以下信号再考虑拆分：

- `validateRuntimeWriteRequest` 等校验逻辑被 ≥2 个 action 复用
- 出现第 3 类平台 action（除 `restore-checkpoint` / `write-runtime` 外），可把 action handlers 抽成 `platform-host/actions/*.ts`
- `persistActiveSnapshot` 被非 `sendMessage` 路径复用（如纯维护回放）

---

## 10. 相关文件清单

主要源码：

- `src/main.ts`、`src/App.vue`
- `src/platform-host/index.ts`（1046 行，分区导览见 §9）
- `src/runtime-host/engine.ts`、`src/runtime-host/ai.ts`、`src/runtime-host/retrieval.ts`、`src/runtime-host/patch-applier.ts`
- `src/storage/db.ts`（Dexie schema 真源）
- `src/storage/saves.ts`、`events.ts`、`archives.ts`、`checkpoints.ts`、`embeddings.ts`、`runtime-write.ts`

配置：

- `package.json`、`tsconfig.json`、`vite.config.ts`、`index.html`

---

## 11. `runtime-host/retrieval.ts` 分区导览（≈1149 行）

整个 AI 主链最复杂的单文件，把"玩家输入 → 实体识别 → 候选事件评分 → 可选 AI 增强 → 向量重排 → memory prompt 拼装"压成一个文件。结构按**"对外类型 → 工具 → 实体识别 → 评分排序 → 时间链 → AI 增强 → 预设事件触发 → prompt 拼装 → 主入口"**的顺序排布：

| 区域 | 行号 | 关键符号 | 职责 |
|------|------|---------|------|
| **对外类型 / 调试契约** | `24–88` | `RetrievalCandidateDebugRecord`、`RetrievalArchiveDebugRecord`、`RetrievalCatalogEventDebugRecord`、`RetrievalSemanticDebugRecord`、`RetrievalDebugRecord`、`RetrievalAssemblyResult` | 与 `official-default` 调试面板对齐的对外结构；`RankedEventRecord` / `SemanticRetrievalResult` 为内部专用 |
| **基础工具** | `90–151` | `mergeRetrievalSettings`、`normalizeToken`、`buildRecentMessages`、`archiveNameMap`、`uniqueArchives`、`uniqueEvents` | 配置合并、中文/英文 token 归一（剥标点 + 小写）、最近 N 条消息切片、`name + aliases` → 档案映射 |
| **实体识别（三类）** | `153–238` | `selectDirectArchives`（用户输入 + 最近消息）、`selectPresentArchives`（活动事件 entityTags 在场）、`selectBridgeArchives`（通过 `linkedArchiveIds` 桥接拓展） | 把"显式提到 / 在场 / 关联"三种来源的档案切开；`bridgeArchives` 受 `bridgeArchiveLimit` 节流 |
| **稀有度 + 评分排序** | `239–380` | `entityFrequency`、`rarityScore`、`buildPlayerEntityTagSet`、`narrativeGapHours`、`rankEventsByEntityGraph` | AIRP 优化版：互斥分组（direct/present/active/bridge 不双计）；玩家白名单 rarity=1.0；无强命中淘汰；长度归一化 `score / sqrt(tags.length)`；ongoing × 1.6；叙事时间衰减 `exp(-Δh / halfLife)`，ongoing 半衰期 × 4，保留 40% 基础分；共现 ≥2 强 tag 加 1~2 |
| **种子数 + 时间链扩展** | `328–433` | `getSeedLimit`、`parseNarrativeTime`、`eventChain`、`selectEventChains`、`eventChainForRecord` | 实体≥`complexEntityThreshold` 则用 `complexSeedEventLimit`；每个种子按叙事时间向前后各扩 `maxChainNeighborsPerSeed` 条事件作为上下文 |
| **AI 增强（语义检索）** | `435–695` | `recentContextText`、`parseKeywordResponse`、`generateSemanticKeywords`、`buildEmbeddingSources`、`ensureEmbeddingCache`、`runSemanticRetrieval` | AIRP 优化版：直接 embed `recentContextText` 完整上下文（消除"上下文 → 关键词 → 向量"双层信息损失），keywords 仅作 debug 锚点。把查询向量与事件/档案向量做余弦相似度，分别取 `semanticEventLimit / semanticArchiveLimit` 条且分数 ≥ `semanticScoreThreshold` |
| **预设事件触发（catalog）** | `623–773` | `formatGlobalValue`、`normalizeJsonValue`、`triggerGlobalMatches`、`catalogTriggerPassed`、`selectCatalogEventCandidates` | 内置 mod 提供的"剧情钩子事件"。检查 `notBefore / notAfter` 时间窗、`requiredEntityNames`、`requiredGlobals`（递归 JSON 等值匹配）；通过的事件再按是否命中当前实体池打分 |
| **memory prompt 拼装** | `775–945` | `formatDefaultNarrativeTime`、`archiveLine`、`pushArchiveSection`、`computeHintEntities`、`buildMemoryPrompt`、`eventArchives`、`archiveDebugRecord`、`eventDebugRecordFromEvent` | 把"当前时间 + globals + 选中的事件钩子 + 活动事件 + 选中事件 + 五类档案分组 + L4 防幻觉提示位"拼成给正文 AI 的 system 上下文文本 |
| **结构 / 语义结果合并** | `928–986` | `mergeSelectedEvents`、`semanticArchives` | 把结构检索得到的事件链与语义检索的事件做去重并集；档案分组的优先级：`direct > present > event > semantic > bridge`，互斥不重复 |
| **主入口** | `987–1146` | **`assembleRetrievalContext`** | 串起以上所有阶段，返回 `{ prompt, debug }`；`prompt` 喂给正文 AI，`debug` 喂给 `official-default` 调试面板 |

### 主入口 `assembleRetrievalContext` 的执行顺序

```
mergeRetrievalSettings(settings)
  └─ buildRecentMessages         （切最近 N 条消息）
  └─ selectDirectArchives        （用户输入命中的档案）
  └─ selectPresentArchives       （活动事件 entityTags 在场的档案）
  └─ selectCatalogEventCandidates（预设事件触发，独立打分）
  └─ selectBridgeArchives        （通过 linkedArchiveIds 桥接拓展）
  └─ rankEventsByEntityGraph     （事件按实体图打分排序）
  └─ selectEventChains           （按叙事时间扩展邻近事件链）
  └─ runSemanticRetrieval        （AI 增强：关键词 → embedding → 相似度）
  └─ mergeSelectedEvents         （结构 ∪ 语义 去重）
  └─ eventArchives               （从选中事件反向召回档案，互斥 baseArchiveIds）
  └─ semanticArchives            （从语义档案匹配结果筛选，互斥前两组）
  └─ buildMemoryPrompt           （拼装最终 prompt）
  └─ 同步生成 RetrievalDebugRecord
```

### 几个值得记住的不变量

1. **AI 增强是可选项，且必须降级安全** — `runSemanticRetrieval` 在 embedding 配置缺失或调用失败时返回 `{ keywords: [], events: [], archives: [], error }`，不抛异常；主入口仍可只用结构检索完成 prompt 拼装。
2. **档案分组互斥优先级** — 在 §11 表里固定为 `direct > present > event > semantic > bridge`。如果改顺序，UI 上同一档案会跨组重复。
3. **`activeEvents` 永远从 ranked 中剔除** — `rankEventsByEntityGraph` 用 `activeIds` 过滤，避免活动事件占用候选位（活动事件单独以"当前进行中"段落进 prompt）。
4. **`entityTags` 是检索唯一锚点** — 排序、桥接、catalog 触发都建立在 `entityTags` 上。事件 patch 写入时若漏了 entityTags，这条事件就检索不到。
5. **`debug.candidates` 既包含结构候选也包含纯语义候选** — 主入口在 ranked 之外又把"仅语义命中、未进入结构 ranked 的事件"补进 candidates，这是为了让调试面板能看到"为什么这条事件被选中是因为语义分而不是结构分"。

### 调参指引（`BrowserRetrievalSettings`）

| 设置 | 影响 | 何时调 |
|------|------|--------|
| `recentMessageLimit` | direct 命中范围 | 长对话场景觉得当前实体识别太短视 |
| `maxCandidates` | 进入排序结果的事件数上限 | 事件库变大之后 |
| `bridgeArchiveLimit` | 桥接档案条数 | 档案关系图过于密集导致 prompt 膨胀 |
| `baseSeedEventLimit` / `complexSeedEventLimit` / `complexEntityThreshold` | 简单/复杂场景的种子事件数切换阈值 | 想区分日常与多人多线场景 |
| `maxChainNeighborsPerSeed` | 每个种子向前后扩多少条邻近事件 | 想要更长/更短的时间上下文 |
| `aiEnhanced` | 是否启用语义增强 | 模型/embedding 不可用时关掉降级 |
| `semanticEventLimit` / `semanticArchiveLimit` / `semanticScoreThreshold` | 语义检索数量与质量阈值 | embedding 维度/分布变化后 |
| `timeDecayHalfLifeHours` | 叙事时间衰减半衰期（小时）。设 0 关闭时间衰减 | 想让远古事件更/更不容易被召回 |
| `ongoingDecayMultiplier` | ongoing 状态事件半衰期放大倍数。默认 4，进行中剧情线几乎不衰减 | 进行中剧情过于强势 / 太弱时调 |
| `noStrongHitFilter` | 无 direct/present 强命中则淘汰事件。AIRP 关键防噪声开关 | 召回噪声过多 / 想看到更多弱相关时切换 |
| `hintEntityRecencyTurns` | L4 防幻觉提示位回望窗口（最近 N 轮消息提到但本轮未召回的实体） | 想加大/收紧防幻觉提示范围 |

### AIRP 评分函数核心要点（`rankEventsByEntityGraph`）

- **互斥分组**：同一 tag 只在最高优先级桶里计分（direct > present > active > bridge），避免 direct + bridge 双计
- **玩家自身白名单**：由桥 API `markArchiveAsPlayer / unmarkArchiveAsPlayer` 写入存档（`SaveRecord.playerArchiveIds`），主调用处从存档读出后透传给 `assembleRetrievalContext`；玩家 archive 的 name+aliases normalized 后作为 tag，命中时 rarity 强制为 1.0
- **无强命中淘汰**：`noStrongHitFilter` 为 true 时，无 direct/present 命中的事件直接 return null
- **共现 bonus**：≥2 个 direct/present 强命中再 `raw += min(2, strongHitCount - 1)`
- **长度归一化**：`raw / sqrt(max(1, tags.length))`，长事件不再因为 tag 多被天然拉高
- **status 加成**：`event.status === "ongoing"` 时 `score *= 1.6`
- **叙事时间衰减**：`gap = narrativeGapHours(currentTime, event.time)`，`decay = exp(-gap / halfLife)`，ongoing 半衰期 × `ongoingDecayMultiplier`，最终 `score *= 0.4 + 0.6 * decay`（保留 40% 基础分，避免远古事件分数清零）
- **设计哲学**：AIRP 噪声 → 正文 AI 编错事，因此宁可少召回也不要噪声

### L4 防幻觉提示位（`computeHintEntities` + `buildMemoryPrompt`）

- 扫描最近 `hintEntityRecencyTurns` 轮消息文本，挑出**被提到但本轮未在 L1-L3 召回**的 archive
- 排除：已选档案（direct/present/event/semantic/bridge）、`presence === "retired"`、token 长度 < 2 的 alias
- prompt 中以"最近提及但本轮未展开的实体"段落出现，附上"如不确定别展开"的引导文本
- 解决"AI 看到当前态档案 + 玩家提及历史时编造未确认事实"的核心 AIRP 风险

---

## 12. 变更记录 (Changelog)

| 时间 | 变更 |
|------|------|
| 2026-05-05 17:52:53 | 初始化架构师首次生成模块文档 |
| 2026-05-05 18:10:00 | 补扫 `platform-host/index.ts`：新增 §9 分区导览（按行号定位 8 大区域 + 不变量 + 拆分时机） |
| 2026-05-05 18:18:00 | 补扫 `official-default/src/index.ts`：（在 official-default 模块文档中补 §8） |
| 2026-05-05 18:35:00 | 补扫 `runtime-host/retrieval.ts`：新增 §11 分区导览（10 大区域 + 主入口执行顺序 + 5 条不变量 + 调参指引） |
| 2026-05-07 | Phase 1 AIRP 优化落地：`rankEventsByEntityGraph` 6 处优化（玩家白名单 / 长度归一化 / status × 1.6 / 叙事时间衰减 / 共现 bonus / 无强命中淘汰）；`runSemanticRetrieval` 改为 contextText 直 embed；新增 L4 防幻觉提示位 `computeHintEntities`；`BrowserRetrievalSettings` 扩展 5 个字段 |
| 2026-05-09 | Phase 1.5：玩家身份从 settings 兜底重构为桥 API + 存档字段。`RuntimeBridge` 新增 `markArchiveAsPlayer / unmarkArchiveAsPlayer / listPlayerArchiveIds`，`SaveRecord` 加 `playerArchiveIds: string[]`（DB v6→v7 破坏性升级）。`assembleRetrievalContext` 与 `rankEventsByEntityGraph` 入参改为必填 `playerArchiveIds`，`BrowserRetrievalSettings` 删除 `playerEntityIds` 字段及对应 env / localStorage 兜底 |
| 2026-05-11 | I4：`bridge/play-frontend-bridge.ts` 实现 `runtime.applyPatch / updateGlobals / appendUserMessage / appendAssistantMessage` 4 个写方法；patch 类走 `runtime-host/patch-applier.ts` 的 `applyMaintenancePatch`（HC-14 同源），append 类直调 `runtimeEngine.appendUserMessage / appendAssistantMessage`（append 例外，§13.6 不递增 turn） |
| 2026-05-14 | UI 重构（路径 C）B1-B5：调试类型契约迁到 contracts（`debug.ts` 11 个类型 + `DebugBridge` 接口）；platform-web 落地羊皮纸 Design System 57 个令牌（`design-tokens.css`）；`bridge.debug` 命名空间 + token usage + `debug-events.ts`；vue-router 5 路由 + `views/` 5 视图（`App.vue` 1259→235 行）；`DebugView` 接入 `bridge.debug` / `bridge.query` / `bridge.runtime` 三条桥路径渲染 6 类调试数据 |

---

_文档生成时间：2026-05-05 17:52:53_
