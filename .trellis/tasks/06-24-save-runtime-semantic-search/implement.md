# Implement: save-runtime 语义检索

## 执行顺序(自底向上,每步可独立 build 验证)

### Phase 1: contracts 层(基础类型)

1. **`packages/contracts/src/runtime.ts`**
   - `WorkspaceOperationName` 加 `"semantic_search"`
   - `WorkspaceOperationRequest` 加 `semanticQuery?`/`typeFilter?`/`entityFilter?`
   - `WorkspaceSemanticType` = `"turn" | "agent-notes" | "memory-summary"`
   - `WorkspaceSearchResult` 加 `semanticType?`/`turn?`/`entities?`/`semanticScore?`
   - `AgentPlatformToolName` 加 `"workspace_semantic_search"`
   - `npm run build:contracts` 验证

### Phase 2: Dexie 存储层

2. **`apps/platform-web/src/storage/db.ts`**
   - `LocalEmbeddingIndexRecord` 接口
   - `TsianLocalDb` v10 → v11,加 `embeddingIndex!: Table<...>`
   - `this.version(11).stores({ ...existing, embeddingIndex: "&id, [scope+ownerId], path, type, updatedAt" })`
   - `npm run build:web` 验证(此时无消费者,但 schema 升级要跑通)

### Phase 3: embedding 配置(控制面板后端)

3. **`apps/platform-web/src/config/ai.ts`**
   - `BrowserEmbeddingConfig` 接口:`{ enabled, baseUrl, apiKey, model, dimensions }`(无 kind,dimensions 必填)
   - `StoredBrowserPlatformConfigDraft` 加 `embeddingConfig?: unknown`
   - `normalizeEmbeddingConfig()` + `resolveEmbeddingConfig()`(enabled && baseUrl && apiKey && model && dimensions 全满足才返回,否则 null)
   - `inferEmbeddingProtocol(model)`:Gemini 原生 model 名特征匹配,其余默认 openai-compatible
   - `getEmbeddingConfig()` / `saveEmbeddingConfig()` 读写 localStorage
   - 协议推断内部使用 auth header 构造(OpenAI 兼容 Bearer / Gemini 原生 x-goog-api-key),不暴露给玩家

### Phase 4: 索引层核心模块(新目录 semantic-index/)

4. **`apps/platform-web/src/agent-runtime/semantic-index/embedding-client.ts`**
   - `embed(texts: string[]): Promise<Float32Array[]>`
   - 读独立的 `embeddingConfig` 段(不碰 chat providerTypes);`resolveEmbeddingConfig()` 返回 null → throw(调用方 catch 返回空)
   - `inferEmbeddingProtocol(model)` 决定请求/响应格式:
     - openai-compatible(默认,覆盖硅基流动/Qwen/bge/OpenAI/中转站):`POST {baseUrl}/embeddings`,body `{model, input: string[]}`,响应 `data[].embedding`
     - gemini-native(留骨架,可后置):`POST {baseUrl}/models/{model}:embedContent`,响应 `embedding.values`
   - dimensions 从 config 读(玩家必填),用于校验返回向量维度一致
   - 单元测试:mock openai-compatible 响应,验证向量解析 + 维度校验

5. **`apps/platform-web/src/agent-runtime/semantic-index/index-store.ts`**
   - `getEmbeddingsByOwner(scope, ownerId): Promise<LocalEmbeddingIndexRecord[]>`
   - `upsertEmbeddings(records: LocalEmbeddingIndexRecord[]): Promise<void>`(按 path 先删后插)
   - `deleteEmbeddingsByPath(scope, ownerId, path): Promise<void>`
   - `deleteEmbeddingsByOwner(scope, ownerId): Promise<void>`(GC)
   - 单元测试:CRUD + 复合索引查询

6. **`apps/platform-web/src/agent-runtime/semantic-index/chunker.ts`**
   - `chunkWorkspaceFile(file: WorkspaceFile): Chunk[]`
   - §3 三分语料规则:turn 整体 / markdown 按段 / JSON 跳过
   - 路径 → type 派生
   - 单元测试:turn JSON 切块 / markdown 按标题切 / JSON 跳过 / 损坏 JSON 跳过

7. **`apps/platform-web/src/agent-runtime/semantic-index/embed-queue.ts`**
   - 单例内存队列,串行消费,去重,不持久化
   - `enqueue(job)` / 内部 `consume()` 循环
   - 失败丢 job(staleness 兜底),背压丢弃旧 job
   - `flush()` 尽力刷(visibilitychange)

8. **`apps/platform-web/src/agent-runtime/semantic-index/staleness.ts`**
   - `findStaleFiles(files: WorkspaceFile[], scope, ownerId): WorkspaceFile[]`
   - 比 `file.updatedAt` vs 索引 `fileUpdatedAt` + 缺失文件
   - 触发 embed-queue 补嵌

9. **`apps/platform-web/src/agent-runtime/semantic-index/search.ts`**
   - `semanticSearch(input, files, scope, ownerId, actorLevel): Promise<WorkspaceSearchResult[]>`
   - §4 流程:embed 查询 → staleness 兜底 → 取向量 → type filter → entity filter(可选) → cosine → top-K → 结果构造
   - 全程不抛错(空索引/API 失败 → 返回 [])
   - 单元测试:cosine 排序 / type filter / 空索引返回空

### Phase 5: workspace 运行时接入

10. **`apps/platform-web/src/agent-runtime/workspace-operations.ts`**
    - `WORKSPACE_OPERATION_NAMES` 加 `semantic_search`
    - `DEFAULT_RUNTIME_WORKSPACE_OPERATIONS` 加 `"semantic_search"`
    - `normalizeWorkspaceOperationName` 自动支持(satisfies 检查)
    - `executeWorkspaceOperation` 加 `if (operation === "semantic_search")` 分支 → 调 `semantic-index/search.ts`
    - 注意:semantic_search 需要 ownerId,execution context 要传 saveId/cardId(从调用方解析)

11. **`apps/platform-web/src/agent-runtime/workspace-tools.ts`**
    - `RUNTIME_WORKSPACE_TOOL_NAMES` 加 `semanticSearch: "semantic_search"`
    - `WORKSPACE_OPERATION_TOOL_NAMES` set 加 `"semantic_search"`
    - tool-schemas.ts 加 `workspaceSemanticSearchSchema`

12. **`apps/platform-web/src/agent-runtime/permissions.ts`**
    - `WORKSPACE_READ_OPERATIONS`(若有)加 `"semantic_search"`(只读同级)
    - 或确认 semantic_search 走 read 权限路径

### Phase 6: 工具暴露(per-agent)

13. **`apps/platform-web/src/agent-runtime/index.ts`**(权限推导)
    - `deriveAgentRuntimePermissionProfile` 识别 `workspace_semantic_search`
    - `buildWorkspaceToolInstructions` 列工具(仅当 agent 启用)
    - 工具指令文案:语义查含义 / 字面查确切 / 可并用 / 空则回退

14. **默认 retrieval agent 配置**(`storage/workspace.ts` 默认 schema)
    - `agents/retrieval/agent.json` 的 `platformTools.enabled` 加 `"workspace_semantic_search"`
    - `agents/retrieval/AGENT.md` 加 §9 指引(语义 vs 字面 vs 并用)

### Phase 7: 写钩子(异步嵌入)

15. **`apps/platform-web/src/platform-host/workspace-volumes.ts`**
    - `executeWorkspaceMutation` write 分支末尾:if `resolveEmbeddingConfig()` → `embedQueue.enqueue(embed)`
    - delete 分支末尾:同上 + `deleteEmbeddingsByPath`
    - **不碰 staged transaction 路径**(staleness 兜底)

16. **GC 接入**(`storage/saves.ts` 或存档删除点)
    - 删存档时调 `deleteEmbeddingsByOwner("save-runtime", saveId)`

### Phase 8: 控制面板 UI

17. **`apps/platform-web/src/views/SettingsView.vue`** + **`components/settings/`**
    - 新增"语义检索"分区(与"AI 服务商"并列)
    - 表单:enabled 开关 + baseUrl + apiKey + model + dimensions(必填)。无 kind 下拉(协议从 model 名内部推断,玩家无感)
    - "从 chat preset 复制凭据"按钮(UX 糖,填 baseUrl/apiKey)
    - 保存调 `saveEmbeddingConfig()`
    - 状态提示:未配全(含 dimensions 缺失)时"配置不全,语义检索未生效"

### Phase 9: maintenance tag 扩展位(R6)

18. **`skills/memory-maintenance/SKILL.md`** + script
    - `apply_maintenance_plan` outputSchema 加 `tags` 字段
    - 脚本解析 tags,经 workspace write 时写钩子 ingest

19. **`semantic-index/index-store.ts`** 扩展
    - `LocalEmbeddingIndexRecord` 加 `entities?: string[]`
    - ingest 时读 maintenance tags 写入

### Phase 10: 验证 + spec 同步

20. **embedding API 召回验证**(选型已定:硅基流动 + Qwen embedding)
    - 在控制面板配好 embeddingConfig(baseUrl=`https://api.siliconflow.cn/v1` + 硅基流动 apiKey + 具体 Qwen embedding 模型名)
    - 用真实 turn 正文建索引 + 真实查询(如"灯塔的事")验证 top-K 召回质量
    - 确认 Qwen embedding 对中文叙事散文的跨释义召回效果

21. **`.trellis/spec/platform-web/frontend/type-safety.md`**
    - workspace op 列表加 `semantic_search`
    - `workspace_semantic_search` 工具映射
    - embeddingConfig 契约(独立段,默认关)
    - 双开关解耦说明

## 验证命令

- `npm run build:contracts` — contracts 层编译
- `npm run build:web` — 全链路编译
- 单元测试(chunker/index-store/search/embedding-client)
- 手动验证:
  - embedding 未配时 `semantic_search` 返回空不抛错
  - embedding 配全 + retrieval 启用工具 → 语义检索返回 top-K
  - type filter 生效(查设定命中 summary)
  - 写文件后异步嵌入(staleness 兜底)
  - 删存档 → embeddingIndex 对应记录 drop
  - master 无 semantic_search 工具(委托 retrieval)
  - 远程 API 失败 → 返回空,不阻塞 turn

## 风险点 / 回滚点

- **高风险**:Dexie v11 升级。原型期破坏性(无迁移),但 service worker `tsian-game-card-frontend-sw.js` 镜像 DB 名,确认同步。回滚:降版本 + 重开库。
- **低风险**:embedding API kind 适配。MVP 只实现 openai-compatible 协议标准(覆盖 OpenAI/DeepSeek/各种兼容端点)。用户在独立的 embeddingConfig 段(控制面板"语义检索"分区)配置 baseUrl/apiKey/model——选型是用户配置的事,不是代码硬编码。Gemini/Claude kind 的 embedding 适配列为可选,非 MVP;用户想用这些可走它们的 OpenAI 兼容端点。
- **中风险**:Float32Array 在 Dexie 存储/取回类型。Phase 2 要验证 Structured Clone 往返正确。
- **低风险**:semantic_search op 是加法,不破坏现有 op。embeddingConfig 默认关,零影响现状。

## task.py start 前检查

- [ ] prd.md acceptance criteria 完整可测
- [ ] design.md 技术方案完整,开放点已定(粒度独立/队列内存/拼接直拼)
- [ ] implement.md 步骤有序,验证命令明确
- [ ] embedding API 选型 Open Question 有验证步骤
- [ ] 用户已 review 或批准
