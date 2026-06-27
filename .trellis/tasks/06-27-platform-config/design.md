# Design — 平台配置体系

> 前置任务 `06-26-checkpoint-storage-dedup` 已留 `getCheckpointPruneConfig()` 接缝。本任务建配置体系并把 provider + 8 tunables 接入。

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
  → 控制面板保存时调
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
- `checkpoints.ts:195` `getCheckpointPruneConfig()` → 读 `getPlatformConfig().checkpointPrune`（接缝已就位，只换实现）。
- `context-lifecycle.ts` `CONTEXT_COMPRESS_TRIGGER_RATIO`/`CONTEXT_KEEP_RECENT_TURNS` → 读 `getPlatformConfig().contextCompression`。这两个是 `export const`，消费点（`index.ts:1351,1713,2051` 等）直接引常量——改成引一个 `getContextCompressionConfig()` 函数（同步读 cache）。
- `search.ts:29-30` `DEFAULT_SEMANTIC_LIMIT`/`MAX_SEMANTIC_LIMIT` → 读 `getPlatformConfig().rag`。
- `ai.ts:108` `DEFAULT_CHAT_TIMEOUT_MS` → 读 `getPlatformConfig().ai.chatTimeoutMs`。
- `assistant-conversations.ts:26` `MAX_STORED_MESSAGES` → 读 `getPlatformConfig().assistant.maxStoredMessages`。

> 取舍：`context-lifecycle.ts` 的常量是 `export const`，多处 import。改成函数后所有 import 点改函数调用。这些是同步读 cache，不引入 async。

## 控制面板 UI

SettingsView 现有 `ProviderManagementScreen`/`ModelConfigScreen`/`SemanticSearchScreen` 读写路径改走 `config/ai.ts`（内部已改 platform-config 后端，UI 代码基本不变）。

新增"平台配置"区（或 SettingsHub 新条目）：编辑 8 项 tunables（检查点裁剪/上下文压缩/RAG/AI 超时/助手历史），数值输入 + 默认值提示 + 范围校验。保存调 `savePlatformConfig`。

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
