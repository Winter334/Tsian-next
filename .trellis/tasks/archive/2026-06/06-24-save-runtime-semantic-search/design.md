# Design: save-runtime 语义检索

技术设计。需求/约束/验收见 `prd.md`。

## 1. 边界与落点分层

```
┌─ contracts (packages/contracts/src/runtime.ts)
│   WorkspaceOperationName +="semantic_search"
│   WorkspaceOperationRequest += semanticQuery/typeFilter(语义参数)
│   WorkspaceSearchResult += 元数据回显字段(turn/semanticType)
│   AgentPlatformToolName += "workspace_semantic_search"(独立粒度,见 §2.1)
│
├─ 索引层 (新模块 apps/platform-web/src/agent-runtime/semantic-index/)
│   embedding-client.ts    — 远程 embedding API 调用(openai-compatible only,Bearer)
│   embedding-config.ts    — embeddingConfig 读写(localStorage,独立段)
│   index-store.ts         — Dexie embeddingIndex 表 CRUD + 按 owner 取/删
│   chunker.ts             — 三分语料切块(turn 整体 / markdown 按段 / JSON 跳过)
│   embed-queue.ts         — 轻量内存异步嵌入队列(不阻塞 turn)
│   staleness.ts           — file.updatedAt vs vector.updatedAt 比对 + 按需补嵌
│   search.ts              — type pre-filter → cosine top-K → 元数据回显
│
├─ workspace 运行时 (apps/platform-web/src/agent-runtime/workspace-operations.ts)
│   executeWorkspaceOperation 加 "semantic_search" 分支 → 调 semantic-index.search
│   DEFAULT_RUNTIME_WORKSPACE_OPERATIONS += "semantic_search"(只读同级)
│
├─ proactive enqueue (apps/platform-web/src/platform-host/index.ts)
│   turn commit 后(commitSuccessfulRuntimeTurnForSave 返回)对当轮 save-runtime
│   文件 staleness 检查 + 入 embed-queue(异步,不阻塞 turn)
│   (不挂 executeWorkspaceMutation——staged 路径绕过它,对主语料是死代码)
│
├─ 工具暴露 (apps/platform-web/src/agent-runtime/workspace-tools.ts + permissions)
│   RUNTIME_WORKSPACE_TOOL_NAMES += semanticSearch
│   WORKSPACE_OPERATION_TOOL_NAMES set += "semantic_search"
│   AgentPlatformToolName += "workspace_semantic_search"
│   assertOperationExposed 传导(复用现有机制)
│   buildWorkspaceToolInstructions 列工具(仅当 agent 启用)
│
├─ 控制面板 (apps/platform-web/src/config/ai.ts + views/SettingsView.vue)
│   BrowserEmbeddingConfig 类型 + embeddingConfig 读写(独立段)
│   SettingsView 加"语义检索"分区
│
└─ Dexie (apps/platform-web/src/storage/db.ts)
    库名 tsian-agent-runtime-v10 → v11(this.version(1) 重置,无迁移)
    public/tsian-game-card-frontend-sw.js 镜像库名同步
    加 embeddingIndex 表
```

## 2. 数据契约

### 2.1 contracts 扩展

```ts
// runtime.ts
export type WorkspaceOperationName =
  | "list" | "search" | "read" | "glob" | "diff"
  | "write" | "edit" | "move" | "delete" | "validate"
  | "semantic_search"  // 新增,只读

export interface WorkspaceOperationRequest {
  // ... 现有字段 ...
  /** semantic_search: 自然语言查询。 */
  semanticQuery?: string
  /** semantic_search: 语料类型过滤(turn/agent-notes/memory-summary)。 */
  typeFilter?: WorkspaceSemanticType
}

export type WorkspaceSemanticType = "turn" | "agent-notes" | "memory-summary"

export interface WorkspaceSearchResult {
  // ... 现有字段 ...
  /** semantic_search 模式回显:语料类型。字面 search 省略。 */
  semanticType?: WorkspaceSemanticType
  /** semantic_search 模式回显:turn 编号(raw turn 专用)。 */
  turn?: number
}

export type AgentPlatformToolName =
  | "agent_call"
  | "workspace_read"
  | "workspace_write"
  | "inspect_frontend"
  | "workspace_semantic_search"  // 新增,独立粒度
```

**为什么 `workspace_semantic_search` 独立粒度,不复用 `workspace_read`**:`workspace_read` 映射 list/search/read/glob 四个只读 op。如果把 semantic_search 塞进 workspace_read,所有有 workspace_read 的 agent 自动获得 semantic_search——破坏 per-agent 粒度(retrieval 要、master 不要)。独立粒度让"谁能语义检索"可单独配置,且与 embedding 能力开关正交(见 §5 双开关)。

**cosine 相似度复用 `score`,不另设 `semanticScore`**:MVP retrieval 分 `semantic_search` 与 `search` 两个工具调,不混排,无需为"可能混排"预留独立字段。结果回显只加 `semanticType`/`turn` 两个语义模式专属字段。

### 2.2 Dexie embeddingIndex 表

```ts
// db.ts — 库名 tsian-agent-runtime-v11,this.version(1) 重置(原型期换名换代,
// 同 v9→v10 先例,无迁移,旧库 abandoned)。public/tsian-game-card-frontend-sw.js
// 镜像库名同步。
export interface LocalEmbeddingIndexRecord {
  /** 主键,确定性 id: `${scope}:${ownerId}:${path}:${chunkIndex}` */
  id: string
  scope: WorkspaceScope
  ownerId: string
  path: string
  chunkIndex: number
  /** 嵌入文本(供 staleness 比对 + 调试)。 */
  text: string
  /** 向量。Float32Array → IndexedDB 存储(Structured Clone 支持)。 */
  vector: Float32Array
  /** 路径派生的语料类型。 */
  type: WorkspaceSemanticType
  /** raw turn 的 turn 编号(仅 type=turn)。 */
  turn?: number
  /** 原始文件 createdAt。 */
  fileCreatedAt?: number
  /** 文件 updatedAt 快照(staleness 比对基准)。 */
  fileUpdatedAt: number
  /** 向量写入时间戳。 */
  updatedAt: number
  /** 产出该向量的 embedding 模型标识(版本锁/staleness 判据)。 */
  model: string
}

embeddingIndex: "&id, [scope+ownerId], path, type, updatedAt"
```

**为什么内存队列不持久化 job**:进程重启丢队列不丢正确性——staleness 兜底会在下次搜索时按需补嵌。持久化 job 表是过度设计,增加复杂度且 IndexedDB 写入本身就是成本。轻量内存队列 + staleness 兜底是成本/复杂度/正确性的最佳平衡。

### 2.3 embeddingConfig(localStorage,独立段)

```ts
// config/ai.ts
export interface BrowserEmbeddingConfig {
  enabled: boolean
  baseUrl: string
  apiKey: string
  model: string
  dimensions: number  // 必填,玩家从模型规格查得
  // 无 kind 字段——MVP 只支持 openai-compatible,请求恒 Bearer
}

// 存进 tsian-platform-config 的 embeddingConfig 字段(与 providerTypes 平级)
// StoredBrowserPlatformConfigDraft += embeddingConfig?: unknown
```

`resolveEmbeddingConfig()`:enabled && baseUrl && apiKey && model && dimensions 全满足 → 返回配置;否则 null。null = 索引不生长(链 1 关闭)。

**协议**:MVP 只支持 openai-compatible——`POST {baseUrl}/embeddings`,body `{model, input: string[]}`,响应 `data[].embedding`,auth `Authorization: Bearer {apiKey}`。无协议推断、无 Gemini 原生分支;用到再加。dimensions 从 config 读(玩家必填),用于校验返回向量维度一致,不一致 throw(调用方 catch 返回空)。

**dimensions 必填**:不自动探测。维度是向量存储 + cosine 的硬约束,填错致静默 bug。玩家从模型规格查得后明确填入。`resolveEmbeddingConfig` 校验 dimensions 为正整数。

## 3. 三分语料切块(chunker.ts)

```ts
interface Chunk {
  path: string
  chunkIndex: number
  text: string
  type: WorkspaceSemanticType
  turn?: number
  fileCreatedAt?: number
}

function chunkWorkspaceFile(file: WorkspaceFile): Chunk[]
```

### 3.1 raw turn(`save/history/turns/turn-XXXXXX.json`)

- **一个文件一个 chunk**,不按 token 切。
- 解析 `RawAirpHistoryTurnRecord`(schema `tsian.airp.history.turn.v1`):取 `turn`、`createdAt`、`messages`。
- 嵌入文本 = `玩家：{user.content}\n叙事：{assistant.content}`(user/assistant 直拼,无前情提要前缀)。
- type=`turn`,turn 字段填 record.turn,fileCreatedAt 填 createdAt 时间戳。
- 解析失败(JSON 损坏)→ 跳过该文件,不阻塞索引。

### 3.2 agent 浓缩产物(`save/agents/*/notes.md`、`save/memory/summaries/*.md`)

- markdown 按 `## `/`### ` 标题切段;无标题的按段落(空行分隔)切。
- 每段一个 chunk,chunkIndex 递增。
- type 按路径派生:`save/agents/*/notes.md` → `agent-notes`;`save/memory/summaries/*` → `memory-summary`。
- 嵌入文本 = 段落原文(带标题)。

### 3.3 JSON 状态(`save/world/`、`save/state/`、`save/frontend/`)

- **跳过**,返回空 chunk 数组。字面 search 够用。

### 3.4 路径 → type 派生规则

```
save/history/turns/*.json    → turn
save/agents/*/notes.md       → agent-notes
save/memory/summaries/*      → memory-summary
其它 save/ 下 .md             → agent-notes(兜底,保守归入可检索)
其它 save/ 下 .json           → 跳过
```

## 4. 检索流程(search.ts)

```ts
async function semanticSearch(
  input: WorkspaceOperationRequest,
  files: WorkspaceFile[],
  scope: WorkspaceScope,
  ownerId: string,
  actorLevel: number,
): Promise<WorkspaceSearchResult[]>
```

1. **embed 查询**:调 embedding-client,`input.semanticQuery` → queryVector。失败 → 返回空数组(不抛错)。
2. **staleness 兜底**:枚举 scopedReadableFiles,比 `file.updatedAt` vs 索引 `fileUpdatedAt`。stale/missing 的文件 → 入 embed-queue 等补嵌(异步补,本次查询用现有索引)。
3. **取候选向量**:`embeddingIndex.where("[scope+ownerId]").equals([scope, ownerId])` 取该 owner 全部向量。
4. **type pre-filter**:若 `input.typeFilter` 指定,过滤 `record.type === typeFilter`。未指定 → 全类型。
5. **cosine 排序**:`sim = dot(qv, rv) / (|qv|*|rv|)`,降序。
6. **top-K**:默认 5,上限 8(`normalizeSearchLimit` 复用,但语义模式独立上限)。
7. **结果构造**:每条 → `WorkspaceSearchResult` 外壳(path/name/updatedAt/score=sim/preview=chunk.text 前 96 字符)+ 元数据回显(semanticType/turn)。`matches` 省略(语义无行级命中)。
8. **索引完全空时**(该 owner 无任何向量):返回空数组,不抛错。agent 收到空自然回退字面 search。

## 5. 双开关解耦传导链

```
链 1 — 向量生产能力(平台全局,控制面板):
  embeddingConfig.enabled && 配全
  → resolveEmbeddingConfig() 返回配置
  → embed-queue 开始消费 + turn commit 触发 proactive enqueue
  → embeddingIndex 生长
  embeddingConfig 未配/关
  → resolveEmbeddingConfig() 返回 null
  → embed-queue 空转(不调 API)
  → 索引不生长(已有向量保留,不主动删)
  （不关心谁有工具)

链 2 — 工具暴露(per-agent,agent.json):
  agent.platformTools.enabled 含 "workspace_semantic_search"
  → AgentPlatformToolConfig 解析
  → 该 agent 的 exposedOperations 含 "semantic_search"
  → assertOperationExposed 放行
  → buildWorkspaceToolInstructions 列出工具
  （不关心有没有向量）

交汇点 — 工具执行(尽力而为):
  executeWorkspaceOperation("semantic_search")
  → assertOperationExposed 检查(链 2)
  → semanticSearch() 执行
  → resolveEmbeddingConfig() 查能力(链 1)
    有配置 → embed 查询 + cosine
    无配置 → 返回空数组(不抛错)
  → 返回结果(可能空)
```

**关键:两条链在配置层不交汇,只在执行层交汇,且交汇点是"尽力而为返回空"不是"前置门控抛错"。** 这让四象限都合法。

## 6. 异步嵌入队列(embed-queue.ts)

```ts
interface EmbedJob {
  scope: WorkspaceScope
  ownerId: string
  path: string
  operation: "embed" | "delete"
}

// 单例内存队列,串行消费(避免并发 embedding API 调用)
class EmbedQueue {
  enqueue(job: EmbedJob): void  // 去重(同 path 待嵌入只保留一个)
  flush(): void                  // 进程退出/visibilitychange 时尽力 flush
}
```

- **串行消费**:一次一个 embedding API 调用,避免并发限制 + 成本突发。
- **去重**:同 path 多次变更只保留最新一次嵌入(攒批)。
- **不持久化**:进程重启丢队列,staleness 兜底补。不引入 IndexedDB job 表。
- **失败重试**:API 失败 → 该 job 丢弃(不重试轰炸),下次 staleness 会重新发现它 stale 再补。
- **背压**:队列过长(>阈值)时丢弃旧 job(staleness 兜底兜得住)。

## 7. proactive enqueue 挂点(platform-host/index.ts)

`commitSuccessfulRuntimeTurnForSave` 是 play-time 的真实写瓶颈:raw turn + maintenance 写都经 staged transaction 攒变更,turn 成功时由它一次性 `localDb.workspaceFiles.put` 落库(`executeWorkspaceMutation` 被绕过)。proactive enqueue 挂在它的调用点之后:

```ts
// index.ts,turn 成功收尾
await commitSuccessfulRuntimeTurnForSave(activeSaveId, {
  snapshot: snapshotAfter,
  history: nextHistory,
  workspaceFiles: workspaceTransaction.finalWorkspaceFiles(),
  checkpointReason: "after-turn",
})
// ← proactive enqueue:对当轮 save-runtime 文件 staleness 检查 + 入队
if (resolveEmbeddingConfig()) {
  const finalFiles = workspaceTransaction.finalWorkspaceFiles()
  const saveRuntimeFiles = finalFiles.filter(/* save-runtime 路径 */)
  enqueueStaleEmbeddings(activeSaveId, saveRuntimeFiles)  // staleness.ts
}
```

- `enqueueStaleEmbeddings` 复用 staleness.ts:比 `file.updatedAt` vs 索引 `fileUpdatedAt`,只对 stale/missing 入队 `embed`;已新鲜的不重复嵌(避免每轮全量重嵌)。
- delete:当轮删了某 path → 入队 `delete`(index-store 删该 path 全部 chunk)。从 `finalWorkspaceFiles` 与 baseline 的差集得被删 path,或 staleness 发现索引里有但文件没了 → delete。
- **不阻塞 turn**:enqueue 是同步入队(异步消费),turn 已落盘完成。
- **staged transaction 不进 dispatch**(现有注释明确)是本设计能简单落地的关键——enqueue 挂在 commit 后而非每个 staged write 上,不必穿透 transaction。

**`executeWorkspaceMutation` 不挂钩子**:该 dispatch 不是 play-time 写瓶颈。studio / 非 turn 写(Explorer 编辑 save-runtime、卡导入等)由搜索时 staleness 兜底补嵌,不为它们单挂钩子(YAGNI)。

## 8. retrieval AGENT.md 指引更新

```
- semantic_search 用于按含义找远期事件/设定(玩家说"灯塔的事"但正文用别的措辞)。
- search 用于找确切措辞/结构标记(找某符号、某 JSON 字段)。
- 两者可在同一 turn 并用:语义召回候选 + 字面验证细节。
- semantic_search 返回空时(索引未建/无相关),回退 search。
```

> 注:agent.json / AGENT.md 是 `storage/workspace.ts` 内嵌默认内容常量(非磁盘文件)。改默认值 + bump `DEFAULT_WORKSPACE_VERSION` + 加 `DEFAULT_SAVE_RUNTIME_UPGRADE_FILE_PATHS` 让存量存档升级拿到新配置(见 implement Phase 6)。

## 9. 兼容性与回滚

- **contracts 加 op 是加法**,不破坏现有 op。旧 agent.json 无 `workspace_semantic_search` → 不暴露,行为同现状。
- **Dexie 换名 v10 → v11**:原型期破坏性(无迁移,旧库 abandoned,`this.version(1)` 重置,同 v9→v10 先例)。`public/tsian-game-card-frontend-sw.js` 镜像库名同步。回滚:换回 v10 名 + 重开库。
- **embeddingConfig 默认关** → 未配置时全系统行为同现状,零影响。
- **proactive enqueue 在 commit 后,不进事务** → enqueue 出问题不丢数据,只丢索引新鲜度(staleness 兜底)。
- **回滚**:删 semantic-index 模块 + 撤 contracts op + Dexie 换回 v10 名。embeddingConfig 留着无害(关着)。

## 10. 风险点

- **embedding API 中文叙事质量**:选型已定(硅基流动 + Qwen embedding),Qwen 系对中文叙事是强项。实现时用真实 turn 正文验证召回质量(验证步骤,非选型风险)。
- **远程 API 热路径**:异步嵌入解耦了 turn 落盘,但首次全量建索引(新存档/清空后)会有一段"索引追赶"期,此期间语义检索结果不全。staleness 兜底渐进补,可接受。
- **Dexie Float32Array 存储**:Structured Clone 支持 TypedArray,但需验证 Dexie 版本兼容 + 查询时取回类型正确(非 ArrayBuffer)。
- **chunker 对损坏 JSON 的健壮性**:raw turn 文件损坏不阻塞索引(跳过),但要有日志/trace 可观测。

## 11. Open Questions 落点

- **AgentPlatformToolName 粒度**:§2.1 已定,独立 `workspace_semantic_search`。
- **embedding API 选型**:已定,硅基流动(SiliconFlow)+ Qwen embedding。openai-compatible 协议标准直接覆盖。留 implement 验证步骤(用真实 turn 正文测召回)。
- **异步队列形态**:§6 已定,内存队列 + staleness 兜底。
- **chunk 拼接格式**:§3.1 已定,user/assistant 直拼。
- **proactive enqueue 落点**:§7 已定,turn commit 后(platform-host/index.ts),非 `executeWorkspaceMutation`。
- **实体 tag / entityFilter**:砍除,不做(收益面窄、对主语料无增益、被 agent 自选兜住)。
- **协议推断 / Gemini 骨架**:砍除,MVP 只做 openai-compatible。
