# Implement — 平台配置体系

## 执行顺序（按依赖排）

P1（存储层）→ P2（读写层+cache）→ P3（provider 迁移）→ P4（tunables 接入）→ P5（workspace 路由让助手可读）→ P6（UI）→ P7（预热+验证）。每块独立可验证。

### P1：配置文件存储层

- [x] P1.1. 新建 `storage/local-platform-config.ts`：仿 `local-assistant-files.ts`，Dexie `meta` 表单 KV `platform-local-config` 存 `{ ".tsian/local/platform-config.json": { content } }` map。导出 `loadLocalPlatformConfigFile()` / `saveLocalPlatformConfigFile(content)` / `isLocalPlatformConfigPath(path)`。
- [x] P1.2. `platform-host/workspace-ops.ts:290-294` platform-meta read 分支：`loadLocalPlatformConfigFile()` 并入 `allFiles`（与 `loadLocalAssistantFiles` 并列），让 workspace_read/list 能取到配置文件。
- [x] P1.3. workspace write 路由（platform-meta write 分支）：`.tsian/local/platform-config.json` 写入经 `saveLocalPlatformConfigFile`（新 `localPlatformConfigVolume` + `resolveVolumeForScope` 二级路由）。确认 actorLevel 4 可写、低权限被拦（platform-meta readLevel/editLevel=4）。

### P2：配置读写层 + cache

- [x] P2.1. 新建 `config/platform-config.ts`：`PlatformConfig` interface（schema 见 design）+ `DEFAULT_PLATFORM_CONFIG`（provider 空、embedding 默认禁用、tunables 默认值）。注：schema 消除 design 的 embedding 冗余——`embeddingConfig` 保留在 `provider`（BrowserPlatformConfigDraft）内，不另设字段。
- [x] P2.2. 内存 cache：`let cache: PlatformConfig | null`、`getPlatformConfig()` 同步返 `cache ?? DEFAULT`、`async preheatPlatformConfig()` 读文件+merge默认+置 cache（parse 失败→删文件+返默认+toast）、`async savePlatformConfig(input)` 先写文件成功再更新 cache。
- [x] P2.3. `getPlatformConfigSection(key)` 辅助（按 section 取，供 tunables 消费点用）。

### P3：provider 迁移（localStorage → 配置文件）

- [x] P3.1. `config/ai.ts` 读函数（`getBrowserAiConfig`/`resolveBrowserAiConfigFor*`/`getBrowserPlatformConfigDraft`/`getEmbeddingConfig`/`resolveEmbeddingConfig`）：从 `localStorage[tsian-platform-config]` 改读 `getPlatformConfig().provider`（经 `readCachedPlatformConfigDraft()` 辅助，同步走 cache）。
- [x] P3.2. `config/ai.ts` 写函数（`saveBrowserPlatformConfigDraft`/`saveBrowserPlatformConfigDraftLenient`/`saveEmbeddingConfig`/`resetBrowserPlatformConfigDraft`）：改 `async`，调 `savePlatformConfig`（merge 到全量）。签名加 `Promise<void>` 返回。
- [x] P3.3. env 兜底 `getEnvAiConfig()`：保留，在 provider resolve 时 env 优先于配置文件值。
- [x] P3.4. 删 `PLATFORM_CONFIG_STORAGE_KEY` + localStorage 读写路径 + `getBrowserLocalStorage`；`getBrowserPlatformConfigStorageState` 改恒返 "ready"。
- [x] P3.5. SettingsView watch 自动保存回调改 `.catch()` 处理 async Promise；`handleSaveEmbeddingConfig` 改 async。

### P4：tunables 接入

- [x] P4.1. `storage/checkpoints.ts:194` `getCheckpointPruneConfig()`：改读 `getPlatformConfig().checkpointPrune`（接缝已就位，换实现）。
- [x] P4.2. `agent-runtime/context-lifecycle.ts`：`CONTEXT_COMPRESS_TRIGGER_RATIO`/`CONTEXT_KEEP_RECENT_TURNS` 从 `export const` 改为 `getContextCompressTriggerRatio()`/`getContextKeepRecentTurns()` 函数（同步读 cache）；消费点（`index.ts:1371,1755,2111`、`context-lifecycle.ts:272,450`）改函数调用。其余 const（256k/2000/300s/5/0.1）不动。
- [x] P4.3. `agent-runtime/semantic-index/search.ts`：`DEFAULT_SEMANTIC_LIMIT`/`MAX_SEMANTIC_LIMIT` 改 `getRagDefaultLimit()`/`getRagMaxLimit()` 读 `getPlatformConfig().rag`。
- [x] P4.4. `runtime-host/ai.ts`：`DEFAULT_CHAT_TIMEOUT_MS` 改 `getChatTimeoutMs()` 读 `getPlatformConfig().ai.chatTimeoutMs`（含 timeoutMessage 模板字符串内引用）。
- [x] P4.5. `storage/assistant-conversations.ts`：`MAX_STORED_MESSAGES` 改 `getMaxStoredMessages()` 读 `getPlatformConfig().assistant.maxStoredMessages`。

### P5：workspace 路由（助手可读配置）

- [x] P5.1. 确认 P1.2/P1.3 后，助手（actorLevel 4）`workspace_read({path:".tsian/local/platform-config.json"})` 能取到内容（volume 路由 + allFiles 并入）；运行时 agent（level 1）被 `isPlatformMetadataPath` + platform-meta readLevel=4 拦截读不到。代码依据已就位，运行时验证见 P7.3。
- [x] P5.2. `workspace_list` 的 platform-meta 枚举：配置文件出现在助手可见的 `.tsian/local/` 列表中（allFiles 并入）。运行时验证见 P7.3。

### P6：控制面板 UI

- [x] P6.1. `SettingsHub.vue` `entries` 加第 3 入口"运行参数"（id `platform-tunables`，icon `SlidersHorizontal`，subtitle "检查点 / 压缩 / 超时 / 历史"）；`SettingsView.vue` `Screen` type 加 `{ kind: "tunables" }`，`enterHubEntry`/`goBack`/`headerTitle` 加对应分支。
- [x] P6.2. 新建 `components/settings/PlatformTunablesScreen.vue`：照抄 `SemanticSearchScreen` 形态（`max-w-2xl` + `retro-inset` 分组 + 底部保存按钮）。6 字段 4 组：检查点裁剪 keepRecent/sparseEvery（默认 50/20）、上下文压缩 triggerRatio/keepRecentTurns（默认 0.85/5）、AI 超时 chatTimeoutMs（默认 600000）、助手历史 maxStoredMessages（默认 200）。数值输入 + 默认值提示 + 范围校验（keepRecent≥1/sparseEvery≥1/0<triggerRatio≤1/keepRecentTurns≥1/chatTimeoutMs≥1000/maxStoredMessages≥1）。本地 `form` ref 从 `getPlatformConfig()` 初始化（不并入 `platformConfigDraft`，避免 provider deep watch 误触发自动保存）。
- [x] P6.3. `PlatformTunablesScreen` 保存：emit payload 经 `handleSaveTunables` 做 `savePlatformConfig({ ...getPlatformConfig(), checkpointPrune, contextCompression, ai, assistant })`。
- [x] P6.4. `SemanticSearchScreen.vue` 扩 2 字段：`rag.defaultLimit`（默认 5）/`rag.maxLimit`（默认 8），`maxLimit ≥ defaultLimit` 校验；emit 改 `(config, rag)` 双参，`handleSaveEmbeddingConfig` 做 merge（`{ ...getPlatformConfig(), provider: {...cfg.provider, embeddingConfig}, rag }`）。
- [x] P6.5. `ProviderManagementScreen`/`ModelConfigScreen`：模板不动；底层经 P3 换后端后，`SettingsView` 的 `watch` 自动保存回调改 `void ...catch()`（P3.5 已覆盖），UI 正常。

### P7：预热 + 验证

- [x] P7.1. `App.vue onMounted`：调 `preheatPlatformConfig()`（app 启动预热 cache，不阻塞启动）。
- [ ] P7.2. 验证（手动）：改配置 → `.tsian/local/platform-config.json` 内容更新；改 keepRecent → 裁剪行为变；改 triggerRatio → 压缩触发变；改 chatTimeoutMs → 超时变；改 maxStoredMessages → 助手历史上限变。
- [ ] P7.3. 验证（手动）：助手 workspace_read 配置文件成功；运行时 agent 读不到。
- [ ] P7.4. 验证（手动）：env `VITE_AI_*` 覆盖 provider/embedding。
- [x] P7.5. vue-tsc + vite build 通过。

## Validation Commands

```bash
npx vue-tsc -b        # platform-web 类型检查（含 vue）
npx vite build apps/platform-web   # 构建
# 运行时验证（手动）：
# 1. 设置页改 provider + key + 8 tunables → 保存 → 刷新页面 → 配置仍在
# 2. 检查 .tsian/local/platform-config.json 内容（助手 workspace_read 或调试）
# 3. 回溯存档 → 配置不回滚
# 4. 导出 game-card → 包内无 .tsian/local/
# 5. 助手 workspace_read .tsian/local/platform-config.json → 成功
```

## 风险点与回滚

- **46 同步读不改 async**：靠 cache，启动预热窗口用默认值。回滚 = 改回 localStorage（git revert P3）。
- **写函数变 async**：SettingsView 保存 handler 改 await。漏改一个 → UI 保存不生效（build 时 tsc 会报未 await 的 Promise）。
- **配置文件手动编辑不立即生效**：已知限制，重启预热生效。prototype 可接受。
- **破坏性 provider 迁移**：旧 localStorage 数据弃，用户重设 provider + key。prototype 无用户数据可接受。

## Follow-up before task.py start

- 无。所有决策已定（配置位置、存 key、provider 并入、8 tunables、cache、env 兜底、破坏性 schema 变更）。
