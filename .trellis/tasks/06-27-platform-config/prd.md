# 平台配置体系：.tsian/local 统一配置 + provider 迁入 + tunables 接入

## Goal

把散落在 localStorage、硬编码常量里的平台配置统一到 `.tsian/local/` workspace 文件，建立"一个配置源 + 内存缓存 + 控制面板 UI"的配置体系。让配置随本地 workspace 走（设备迁移友好）、助手 agent 可见可管（data-fileification）、玩家能在控制面板调"对自己有用"的参数。

不做 secret/非 secret 两层拆分——key 等所有配置都存配置文件，靠 actorLevel 分层默认隐藏 `.tsian/`（不是针对 key 的特别防护，助手 agent 本来就该能看见 key，给其他 agent 开最高权限也能看见是用户自己的选择）。

## Confirmed Facts（代码调研确认）

### 配置文件位置
- `.tsian/` 是 platform-owned metadata，对普通运行时 agent 隐藏（`isPlatformMetadataPath`，`workspace-paths.ts:42-44`）。
- **`.tsian/local/` 被 `isSaveRuntimePersistencePath` 排除**（`workspace-paths.ts:57-59`，函数体 `:50-61`）——不进 save checkpoint/restore，不随 checkpoint 回滚；该处注释已点名"未来平台配置"为本任务预留。配置文件必须放此处。
- `exportGameCardPackage` 只打 `gameCardContentFiles` + frontend + cover（`game-card-packages.ts:572-631`），**不含 `.tsian/`**——配置（含 key）不进 game-card 导出包，天然隔离。
- `.tsian/` 现按生命周期分两层（前置任务 `06-27-tsian-layout-refactor` 已落）：`.tsian/save/` = per-save 文件（traces 挪至此，进 checkpoint）；`.tsian/local/` = platform 级（助手文件，不进 checkpoint）。`.tsian/checkpoints/`、`indexes/`、`cache/` 空壳已删（数据在 Dexie 表）。无"配置"子目录——本任务在 `.tsian/local/` 下建 `platform-config.json`。

### 现有 provider/embedding 配置（localStorage，要迁入）
- 存储键 `tsian-platform-config`（`config/ai.ts:157`），结构 `BrowserPlatformConfigDraft`（`:113-118`）：`activeProviderId` + `providerTypes[]` + `embeddingConfig`。
- provider preset 含 `baseUrl/apiKey/models[]/fallbackStrategy`（`:66-76`），model 含 `parameters`（contextWindow/maxOutputTokens/temperature 等，`:21-30`）。
- env 兜底 `VITE_AI_BASE_URL/VITE_AI_API_KEY/VITE_AI_MODEL`（`ai.ts:648-667`）。
- `config/ai.ts` 有 30+ 导出（类型 + 同步读写 + 校验 + fetchModels），**46 个外部同步读调用点**（embed-queue、assistant-chat、frontend-inspector、SettingsView 等）。
- per-agent provider/model 选择已在 workspace：`.tsian/local/assistant/agent.json` + 卡 `agents/<id>/agent.json`。

### 硬编码 tunables（按"对玩家有用"标准筛过的纳入清单）
- 检查点裁剪 `keepRecent:50/sparseEvery:20`（`checkpoints.ts:194`，已有 `getCheckpointPruneConfig()` 接缝 + TODO(platform-config) 注释 `:189-192`）。
- 上下文压缩：`CONTEXT_COMPRESS_TRIGGER_RATIO:0.85`（`context-lifecycle.ts:51`）、`CONTEXT_KEEP_RECENT_TURNS:5`（`:53`）。其余（256k budget fallback、2000 target、300s task-timeout、5 tool-rounds、0.1 stall）不纳入——task/sub-agent 内部或 fallback，玩家无感。
- RAG：`DEFAULT_SEMANTIC_LIMIT:5`、`MAX_SEMANTIC_LIMIT:8`（`search.ts:29-30`）。preview/queue/batch 不纳入（工程内部）。
- AI 超时：`DEFAULT_CHAT_TIMEOUT_MS:600_000`（`ai.ts:108`）。fetch timeout 不纳入。
- 助手历史：`MAX_STORED_MESSAGES:200`（`assistant-conversations.ts:26`）。

### 不纳入（工程内部，玩家无感或调了危险）
- workspace 限制（search/read 限制）、Claude max_tokens 兜底、diagnostics/inspector/trace、debug ring buffer、toast 上限、DOM depth、clock 间隔、旧历史窗口 slice(-20)、action executor timeout、chunkSize/overlap（不存在，首版不做）。

## Decisions（已与用户确认）

1. **配置文件位置**：`.tsian/local/platform-config.json`（platform-meta scope，不进 checkpoint，不进 game-card 导出）。
2. **存 key**：不做 secret 拆分，所有配置（含 apiKey）存配置文件。靠 actorLevel 分层（运行时 agent 默认看不到 `.tsian/`，助手 actorLevel 4 可见可管），不为 key 做特别防护。
3. **provider 并入**：把 localStorage `tsian-platform-config` 的 provider/embedding 配置迁进 `.tsian/local/platform-config.json`，破坏性更新无过渡（prototype 无用户数据）。
4. **纳入标准**：只纳入"对玩家有用"的配置（8 项 tunables + provider/embedding），工程内部硬编码不纳入。
5. **内存缓存**：配置读层提供同步 cache（46 个现有同步调用点不全改 async），启动预热 + 写后失效。热路径（embed-queue/assistant-chat）读 cache 不读 Dexie。
6. **env 兜底保留**：`VITE_AI_*` 仍作环境变量兜底（部署场景），优先级低于配置文件。

## Requirements

- 新建 `config/platform-config.ts`：配置读写层，读 `.tsian/local/platform-config.json` + 默认值合并；内存 cache（同步读）+ 启动预热 + 写后失效；`getPlatformConfig()` / `getPlatformConfigSection(key)` / `savePlatformConfig(input)`。
- 配置 schema：`{ provider: BrowserPlatformConfigDraft, embedding: BrowserEmbeddingConfig, checkpointPrune: {keepRecent, sparseEvery}, contextCompression: {triggerRatio, keepRecentTurns}, rag: {defaultLimit, maxLimit}, ai: {chatTimeoutMs}, assistant: {maxStoredMessages} }`。
- provider 迁移：`config/ai.ts` 的存储后端从 localStorage 改为 platform-config（签名尽量保持，内部换后端）；删 localStorage `tsian-platform-config` 路径。
- tunables 接入：`getCheckpointPruneConfig()` 接 platform-config；`context-lifecycle.ts` 的 triggerRatio/keepRecentTurns 接配置；`search.ts` 的 defaultLimit/maxLimit 接配置；`ai.ts` chatTimeoutMs 接配置；`assistant-conversations.ts` maxStoredMessages 接配置。
- 控制面板 UI：SettingsView hub 加第 3 入口"运行参数"。8 项 tunables 按归属分进三屏——`rag.defaultLimit/maxLimit` 进现有语义检索屏（与 embedding 同屏），`checkpointPrune`/`contextCompression`/`ai.chatTimeoutMs`/`assistant.maxStoredMessages` 进新 `PlatformTunablesScreen`，provider/embedding 留现有 AI 提供商屏。保存统一走"读全量 → merge 本屏 section → `savePlatformConfig`"（方案 A）。现有屏底层换 platform-config 后端后模板不变。
- env 兜底：`VITE_AI_*` 仍优先于配置文件的 provider/embedding（部署场景），其余 tunables 无 env 兜底。

## Acceptance Criteria

- [ ] `.tsian/local/platform-config.json` 存在且含完整配置（provider/embedding + tunables）；改配置后文件内容更新。（手动验证）
- [x] 配置不进 checkpoint（`.tsian/local/` 被 `isSaveRuntimePersistencePath` 排除）；不进 game-card 导出包（`exportGameCardPackage` 只打 content+frontend+cover）。
- [x] 现有同步读调用点不改 async（靠内存 cache）；启动后 cache 预热完成前用默认值。
- [ ] provider/embedding 从 localStorage 迁到配置文件后，SettingsView 能正常读/改/存 provider + model + embedding + key；旧 localStorage 数据直接弃（破坏性）。（手动验证）
- [ ] tunables 从配置读取生效（改 keepRecent 后裁剪行为变；改 triggerRatio 后压缩触发点变；改 chatTimeoutMs 后超时变；改 maxStoredMessages 后助手历史上限变）。（手动验证）
- [ ] 助手 agent（actorLevel 4）能 workspace_read `.tsian/local/platform-config.json`；运行时游戏 agent（默认低权限）读不到 `.tsian/`。（手动验证，代码依据已就位：platform-meta readLevel=4）
- [ ] env `VITE_AI_*` 仍能覆盖 provider/embedding（部署兜底）。（手动验证，`getEnvAiConfig` 保留）
- [x] vue-tsc + vite build 通过。

## Out of Scope

- 云同步（配置随 `.tsian/local/` 是否同步是云存档任务的事，本任务只做本地）。
- 不纳入的工程内部 tunables（workspace 限制、diagnostics、trace 等）——未来按需单开。
- chunkSize/overlap（不存在，首版不做）。
- task/sub-agent 模式的压缩参数（256k budget fallback、2000 target、300s timeout 等）——玩家无感不纳入。
- 配置版本化/迁移机制（prototype 阶段破坏性更新，配置 schema 变了就重置）。

## Open Questions

- 配置文件 schema 变更时的处理：破坏性重置（删文件重建默认）还是带版本字段？倾向破坏性（prototype），待 design 定。
