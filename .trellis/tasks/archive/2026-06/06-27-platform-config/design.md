# Design — 平台配置体系

> 前置任务 `06-26-checkpoint-storage-dedup` 已留 `getCheckpointPruneConfig()` 接缝；`06-27-tsian-layout-refactor` 已把 `.tsian/` 规整为 `.tsian/save/`（per-save，进 checkpoint）+ `.tsian/local/`（platform 级，不进 checkpoint）两层，并在 `workspace-paths.ts:54` 注释点名"未来平台配置"为本任务预留。本任务建配置体系并把 provider + 8 tunables 接入。

## 架构与边界

改动跨 `config/`（新建 + 改 `ai.ts`）、`storage/`（配置文件存储层）、`agent-runtime/`（tunables 消费点）、`platform-host/`（workspace 路由让助手可读配置）、`views/` + `components/settings/`（控制面板 UI）。纯 platform-web 内部，不影响 contracts/bridge。

## 配置文件存储机制（关键设计）

**问题**：配置要放 `.tsian/local/platform-config.json` 且助手 agent 能 `workspace_read` 它。但 `.tsian/local/` 没有统一的"local files"层——`local-assistant-files.ts` 只管 `.tsian/local/assistant/` 子树（Dexie `meta` 表单 KV `assistant-local-files`，整个子树序列化成 path→content map）。

**方案**：仿 `local-assistant-files` 模式，新建 `storage/local-platform-config.ts`，用 Dexie `meta` 表单 KV `platform-local-config` 存 `{ ".tsian/local/platform-config.json": { content } }` map。配置文件作为"虚拟 workspace 文件"存在 platform-meta scope，actorLevel 4 助手经 workspace 路由可读。

> 取舍：不把 `platform-config.json` 塞进 `assistant-local-files` 的 map（语义上配置不属于 assistant 目录）。独立 KV 让配置自成一体，未来 `.tsian/local/` 下加别的平台文件也可复用此模式或各自独立。

**workspace 路由**：`isPlatformMetadataPath`（`workspace-paths.ts:42`）已把 `.tsian/` 归 platform-meta scope。需确认 platform-meta scope 的 read 路由会把 `.tsian/local/platform-config.json` 从 `local-platform-config` KV 取出（目前 read 路由可能只认 `local-assistant-files`）。`workspace-ops` 的 platform-meta read 分支要加 config 文件的取数。

## 配置读写层（`config/platform-config.ts`）

**内存缓存 + 同步读**（核心约束：46 个现有同步调用点不改 async）：
```
let cache: PlatformConfig | null = null   // null = 未预热
let preheatPromise: Promise<void> | null  // 防重复预热

getPlatformConfig(): PlatformConfig
  → cache ?? DEFAULT_CONFIG（未预热时返默认值，不阻塞）

async preheatPlatformConfig(): Promise<void>
  → 读 .tsian/local/platform-config.json → merge DEFAULT → cache = merged
  → 启动时调一次（app init）

async savePlatformConfig(input): Promise<void>
  → 写 .tsian/local/platform-config.json → cache = input（写后立即更新 cache）
  → 控制面板各屏保存时调；input 是全量，调用方负责"读全量 → merge 本屏 section"（见 UI 段方案 A）
```

- 热路径（embed-queue/assistant-chat 每次读 config）走 `getPlatformConfig()` 同步取 cache，不读 Dexie。
- 启动到预热完成前用 DEFAULT_CONFIG（短暂窗口，可接受——provider 未配时本来就走 env/默认）。
- 写后 cache 立即更新（不需要失效-重读，写入方就是权威）。

**schema**：
```ts
interface PlatformConfig {
  provider: BrowserPlatformConfigDraft      // 从 localStorage 迁入
  embedding: BrowserEmbeddingConfig         // 从 localStorage 迁入
  checkpointPrune: { keepRecent: number; sparseEvery: number }   // 默认 50/20
  contextCompression: { triggerRatio: number; keepRecentTurns: number }  // 默认 0.85/5
  rag: { defaultLimit: number; maxLimit: number }  // 默认 5/8
  ai: { chatTimeoutMs: number }             // 默认 600_000
  assistant: { maxStoredMessages: number }  // 默认 200
}
```

**env 兜底**：`resolveEmbeddingConfig()` / provider resolve 时，`VITE_AI_*` 仍优先于配置文件（部署场景）。env 有值 → 用 env；否则用配置文件值；都无 → 默认/空。

**schema 变更（open question 定案）**：破坏性重置。读配置时若 JSON parse 失败或 schema 不符（缺字段/类型错）→ 删文件 + 返 DEFAULT_CONFIG + toast 告警"配置已重置"。带版本字段不做（prototype，schema 变 = 重置可接受，key 丢了用户重设）。

## provider 迁移（localStorage → 配置文件）

`config/ai.ts` 的存储后端切换：
- `getBrowserAiConfig()` / `resolveBrowserAiConfigForModel()` / `getBrowserPlatformConfigDraft()` 等读函数：从 `localStorage[tsian-platform-config]` 改读 `getPlatformConfig().provider`（同步，走 cache）。
- `saveBrowserPlatformConfigDraft()` / `saveEmbeddingConfig()` 等写函数：从 `localStorage.setItem` 改 `await savePlatformConfig(...)`（签名变 async，但只有 SettingsView 几个保存按钮调，改动可控）。
- 删 `PLATFORM_CONFIG_STORAGE_KEY` + localStorage 读写路径。
- 类型定义（`BrowserPlatformConfigDraft` 等）保留不动，只是存储后端换。
- **破坏性**：不读旧 localStorage 数据，首次启动 `preheatPlatformConfig` 发现 `.tsian/local/platform-config.json` 不存在 → 建 DEFAULT_CONFIG（无 provider，用户重设）。

> 写函数变 async 的波及面：SettingsView 的保存 handler 改 await。`saveBrowserPlatformConfigDraftLenient` 等 lenient 版本同样。调用点少（都是 UI 保存动作），非热路径。

## tunables 接入

每个消费点从"读硬编码常量"改"读 `getPlatformConfig().xxx`"：
- `checkpoints.ts:194` `getCheckpointPruneConfig()` → 读 `getPlatformConfig().checkpointPrune`（接缝已就位，只换实现）。
- `context-lifecycle.ts` `CONTEXT_COMPRESS_TRIGGER_RATIO`/`CONTEXT_KEEP_RECENT_TURNS` → 读 `getPlatformConfig().contextCompression`。这两个是 `export const`，消费点（`index.ts:1371,1755,2111` 等）直接引常量——改成引一个 `getContextCompressionConfig()` 函数（同步读 cache）。
- `search.ts:29-30` `DEFAULT_SEMANTIC_LIMIT`/`MAX_SEMANTIC_LIMIT` → 读 `getPlatformConfig().rag`。
- `ai.ts:108` `DEFAULT_CHAT_TIMEOUT_MS` → 读 `getPlatformConfig().ai.chatTimeoutMs`。
- `assistant-conversations.ts:26` `MAX_STORED_MESSAGES` → 读 `getPlatformConfig().assistant.maxStoredMessages`。

> 取舍：`context-lifecycle.ts` 的常量是 `export const`，多处 import。改成函数后所有 import 点改函数调用。这些是同步读 cache，不引入 async。

## 控制面板 UI

### 结构：hub 加第三个入口"运行参数"

SettingsView 现是 hub-and-spoke 状态机（hub 卡片网格 → 子屏）。hub 现有 2 个入口（AI 提供商、语义检索），新增第 3 个"运行参数"。8 项 tunables 按"配置归属"分进三屏，不为 tunables 单开一屏全塞：

| 屏 | 字段 | 保存模式 |
|---|---|---|
| AI 提供商（现有 `ProviderManagementScreen`/`ModelConfigScreen`） | provider + embedding（经 `config/ai.ts`，后端换 platform-config 后 UI 不变） | 自动保存（现有 deep watch + debounce，保持） |
| 语义检索（现有 `SemanticSearchScreen` 扩） | embedding baseUrl/apiKey/model/dimensions + `rag.defaultLimit`/`rag.maxLimit` | 显式保存（submit） |
| 运行参数（新 `PlatformTunablesScreen`） | `checkpointPrune`/`contextCompression`/`ai.chatTimeoutMs`/`assistant.maxStoredMessages` | 显式保存（submit） |

> 取舍：`rag.defaultLimit/maxLimit` 是"检索召回条数"，与 embedding 同属"检索行为"，归语义检索屏心智连续，不与平台调参混放。`chatTimeoutMs` 是全局参数（非 per-preset），放运行参数屏而非 provider 屏，避免误以为能 per-preset 配。运行参数屏仅 6 字段（3 组 + chatTimeout），轻量。

### 保存语义：整体写 + merge（方案 A）

所有屏保存统一走"读全量 → merge 本屏 section → `savePlatformConfig(merged)`"：
- `savePlatformConfig(input: PlatformConfig)` 仍是全量写（写文件成功 → cache = input），语义不变。
- 各屏保存 handler / `config/ai.ts` 的 `saveEmbeddingConfig`、`saveBrowserPlatformConfigDraftLenient` 内部做 spread merge：`await savePlatformConfig({ ...getPlatformConfig(), rag: newRag })`。
- 不暴露 `savePlatformConfigSection` 写函数——一个全量写 + 调用方 merge，cache 天然一致，无部分更新竞态。（`getPlatformConfigSection(key)` 仅作读辅助保留。）

### 三个屏的具体改动

- **ProviderManagementScreen / ModelConfigScreen**：模板与交互不动；底层 `config/ai.ts` 换 platform-config 后端后，`getBrowserPlatformConfigDraft`（同步读 cache）+ `saveBrowserPlatformConfigDraftLenient`（改 async，内部 merge + `savePlatformConfig`）签名行为不变。`SettingsView` 的 watch 回调改 `await`。
- **SemanticSearchScreen**：表单加 2 个数值字段（`defaultLimit` 默认 5、`maxLimit` 默认 8，`maxLimit ≥ defaultLimit` 校验）；保存 submit 改 async，emit 的 payload 扩含 rag，handler 做 merge。
- **PlatformTunablesScreen（新）**：照抄 SemanticSearchScreen 形态（`max-w-2xl` + `retro-inset` 分组卡 + 默认值提示 + 底部保存按钮）；6 字段分 4 组（检查点裁剪 / 上下文压缩 / AI 超时 / 助手历史），数值输入 + 范围校验（keepRecent≥1、sparseEvery≥1、0<triggerRatio≤1、keepRecentTurns≥1、chatTimeoutMs≥1000、maxStoredMessages≥1）；保存调 `savePlatformConfig({ ...getPlatformConfig(), checkpointPrune, contextCompression, ai: {...cfg.ai, chatTimeoutMs}, assistant: {...cfg.assistant, maxStoredMessages} })`。本地 `form` ref 从 `getPlatformConfig()` 初始化，不并入 `platformConfigDraft`（避免 provider 的 deep watch 误触发 tunables 自动保存）。
- **SettingsHub**：`entries` 加第 3 项（id `platform-tunables`，icon `SlidersHorizontal`，subtitle 如"6 项参数"）；`enterHubEntry` 加分支路由到新 `screen.kind === "tunables"`。

## agent 可见性

- 运行时游戏 agent（actorLevel 1）：`isPlatformMetadataPath` 已拦截 `.tsian/`，读不到配置（含 key）。不动。
- 桌面助手（actorLevel 4）：platform-meta scope read 路由加 config 文件取数后，`workspace_read({path:".tsian/local/platform-config.json"})` 可读；`workspace_write` 同理可写。这是 data-fileification 原则要求——助手用现有工具管配置，不新增工具。

## 风险点

- **46 同步读不改 async**：靠 cache。启动预热窗口用默认值——provider 未配时本就走 env/默认，窗口无感。但若用户改了配置后刷新页面，预热从文件读最新值，cache 更新——正确。
- **写后 cache 一致性**：`savePlatformConfig` 写文件 + 更新 cache 是两步，若写文件失败但 cache 已更新 → cache 和文件不一致。缓解：先写文件成功再更新 cache（写失败抛错，cache 不动）。
- **配置文件被手动编辑**：用户/助手直接改 `.tsian/local/platform-config.json` 后，内存 cache 是旧的 → 不生效直到重启预热。缓解：可加"配置文件 mtime 检查"或接受"重启生效"（prototype 可接受）。design 标记为已知限制。
- **platform-meta read 路由扩展**：要让 workspace_read 能取到 config 文件，需在 workspace-ops 的 platform-meta read 分支加 `local-platform-config` 取数。漏了则助手读不到——验收标准会catch。

## 风险文件

- `config/ai.ts` — 存储后端切换（localStorage → platform-config），写函数变 async。
- `config/platform-config.ts`（新）— 读写层 + cache + 预热。
- `storage/local-platform-config.ts`（新）— Dexie meta KV 存配置文件。
- `agent-runtime/context-lifecycle.ts` — const → 函数。
- `agent-runtime/semantic-index/search.ts`、`runtime-host/ai.ts`、`storage/assistant-conversations.ts`、`storage/checkpoints.ts` — tunables 消费点。
- `platform-host/workspace-ops.ts`（或等价 workspace 路由）— platform-meta read 加 config 取数。
- `views/SettingsView.vue` + `components/settings/*` — UI 保存路径 async 化 + tunables 编辑区。
