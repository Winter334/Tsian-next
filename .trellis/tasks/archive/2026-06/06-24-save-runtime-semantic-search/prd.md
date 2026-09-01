# save-runtime 语义检索

## Goal

为 workspace 补齐向量语义检索能力,让 agent 能按"含义"召回早已掉出上下文窗口的远期剧情与记忆,而不再受限于字面 substring/regex(`workspace.search`)的释义鸿沟。

核心痛点:save-runtime 是游玩中不断累积的活记忆(叙事日志、lore、摘要),会超过上下文窗口。`AgentContextSnapshot`(summary + 最近 K=5 轮)承认了"内存放不下只能截断"——被截掉的长尾就是召回缺口。字面 search 在这里结构性失效(玩家说"灯塔的事",正文写"她走向海边那座塔",词面零重叠)。语义检索是那层截断的按需还原。

## Why Native, Not Skill

原生而非 skill,理由是访问面、权限传导、GC 三点,而非"写路径唯一瓶颈":

- **访问面**:skill 跑在 browser_script 作用域,不便直接枚举 workspace volume 全量文件 / 读写 IndexedDB 向量库;原生模块在 agent-runtime 内,与 storage/workspace 同进程,可直读 volume 与 Dexie。
- **权限传导**:per-agent 工具暴露经 `assertOperationExposed` + `exposedOperations` 是原生机制;skill 无 per-agent 开关(retrieval 要、master 不要这个粒度 skill 给不了)。
- **GC 随存档生灭**:删存档时 drop `(save-runtime, saveId)` 一片向量,原生挂在 save 生命周期上最干净;skill 管不到存档删除。
- **增量**:在 turn commit(`commitSuccessfulRuntimeTurnForSave`)这个 **play-time 真实写瓶颈**上做 staleness 驱动的 proactive enqueue,拿到 raw turn + maintenance 的真增量(见"异步嵌入"节)。

非工作区语料(对话史/外部 RAG)才归 skill。

> 原论证"原生 workspace 有唯一写瓶颈经 `executeWorkspaceMutation` → volume,写时顺手 re-embed 即免费增量"经核验**不成立**:play-time 写(raw turn + maintenance)全走 staged transaction → `commitSuccessfulRuntimeTurnForSave` → 直接 `localDb.workspaceFiles.put`,绕过 `executeWorkspaceMutation`。挂在那个 dispatch 上的写钩子对主语料是死代码。本设计已把 proactive enqueue 移到 turn commit(见下),`executeWorkspaceMutation` 钩子废弃。

## Scope (MVP)

**仅 save-runtime 一种 scope**,主键 `(save-runtime, saveId)`。

- save-runtime 是游玩期不断累积、会超窗口、字面 search 失效的活记忆——语义检索在这里是刚需。
- card-content 已被 `contextPaths` 注入 agent 上下文,边际收益低;其"向量随卡分发"决策从 MVP 消失,降级为可选。
- save-runtime 是玩家私有、从不导出、随存档生灭——无分发场景,归属与 GC 最干净(删存档 drop 这片)。

## 语料三分 + 预处理归 agent

| 路径 | 形态 | 检索单元 | 预处理 |
|---|---|---|---|
| `save/history/turns/*.json` | 原始剧情(user+assistant,无工具噪声) | **一个 turn 一个 chunk**,不按 token 切 | 轻预处理:拼 user/assistant 直嵌 |
| `save/agents/*/notes.md`、`save/memory/summaries/*` | agent 已浓缩产物 | 按标题/段落切(天然语义边界) | **无**——预处理在生成时已由 memory-maintenance Skill 完成 |
| `save/world/`、`save/state/`、`save/frontend/` | JSON 状态 | — | **跳过**,字面 search 够用 |

**核心原则:预处理责任归 agent/Skill,索引责任归原生,两件事不叠在同一处做。** 把预处理塞进索引管道会让 save-runtime 每轮写都触发模型 pass,是热路径灾难。

## 元数据与标签

- **结构化标签(写时免费)**:`type`(路径派生:turn/agent-notes/memory-summary)、`turn`、`createdAt`。
  - 只有 **`type` 值得作为 pre-filter**:解决跨类型语义污染(查设定命中 summary 而非恰好提到一词的 turn),零成本。
  - **`turn`/`createdAt` 不做 filter**——语义检索核心用例是召回远期事件,时间 filter 会排除要找的答案。存作元数据回显 + 近年加权可选输入,MVP 不做加权。
  - 其余免费标签(agentId/role)低方差低杠杆,存作扩展位,不挂过滤。
- **实体/事件标签(需语义判断):不做。** 不在索引层挂实体提取,也不在 maintenance 冷路径顺带产 tag。检索精度靠 type pre-filter + 小 K + agent 自选 reranker 兜住;实体级 filter 的收益面只落在 summary/notes(已比 raw turn 更结构化、纯向量更准),且对主语料 raw turn 无增益(raw turn 永不带 tag),不值得单建 plumbing。需要时再立专项设计。

## 检索流程(成本地板)

```
查询 → embed 查询(1 次 embedding)
     → type pre-filter(免费)
     → cosine top-K=5~8(免费算术)
     → 返回 [{path, turn, type, preview}, ...]
     → agent 读候选 → 自选 → workspace.read 取原文
```

- **无 reranker 模型**:消费端是每回合本就在跑的 agent,返回带元数据的小 K 候选让它自己判断 + workspace.read 取原文,已付费的 agent 推理顺手做了 reranker 的活。给已是模型的消费者配独立 reranker 是重复付费。
- **无查询改写 LLM pass**:与 reranker 同属热路径额外 model pass,成本敏感下一并搁置。
- 质量靠上游免费组合补回:好 chunking(turn 不切/memory 按段切)+ type filter + 小 K + agent 自选。在 save-runtime 规模(几百到低千级 chunk)下补得回来。

## Embedding 来源

**已定选型:硅基流动(SiliconFlow)+ Qwen embedding 模型**。硅基流动是 OpenAI 兼容 API(`https://api.siliconflow.cn/v1`,`POST /embeddings`,响应 `data[].embedding`),MVP 直接覆盖,零额外适配。Qwen 系 embedding 对中文叙事散文是强项,正面匹配本项目语料。用户在控制面板"语义检索"分区配置 baseUrl/apiKey/model/dimensions,选型是配置不是硬编码。

**MVP 只支持 openai-compatible 协议**(覆盖硅基流动/Qwen/bge/OpenAI/各种中转站)。其它协议(如 Gemini 原生 `:embedContent`)用到再加,不为它预留骨架。

远程模型向量基本关闭"随卡分发"路径——但 MVP 是 save-runtime 不分发,不影响。

## 异步嵌入 + Staleness 兜底

**正确性源头 = 廉价 staleness 校验,不是"每个写都触发钩子"。** 搜索时枚举 owner 的 save-runtime 文件,比 `file.updatedAt` vs 索引记录的 `fileUpdatedAt` 快照,只重嵌 stale/missing 的 chunk。staleness 兜底让所有写路径(staged commit、直接调 volume、卡导入、studio 编辑)都不丢正确性,只丢一点性能。`executeWorkspaceMutation` 注释明确 staged turn 的 transaction 攒变更不进 dispatch——正确性不能依赖完美捕获所有写路径。

**proactive enqueue 落在 turn commit**:在 `commitSuccessfulRuntimeTurnForSave` 落库后(platform-host 调度点),对当轮 save-runtime 文件跑 staleness 检查 + 入队 re-embed。这是 play-time 的真实写瓶颈(raw turn + maintenance 都 staged → 经此 commit),让索引在每轮后自动追新,不等下次搜索才补。远程 API 失败时退化为"下次搜索时按需补嵌";commit 时 enqueue 失败不阻塞 turn(turn 已落盘完成)。

**写路径解耦**:turn 落盘即完成(不等 embedding),向量嵌入异步排队,不阻塞 turn 收尾。

> 原"`executeWorkspaceMutation` write/delete 上挂 re-embed"方案废弃:该 dispatch 不是 play-time 写瓶颈。studio / 非 turn 写由搜索时 staleness 兜底,不单挂钩子。

## 双开关解耦(关键架构)

两个独立维度,归两个不同地方,不耦合:

| 维度 | 管在哪 | 粒度 | 现有机制 |
|---|---|---|---|
| embedding 能力(能不能产向量) | 控制面板 `embeddingConfig` | 平台全局 | `tsian-platform-config` (localStorage) |
| 工具暴露(agent 能不能调) | agent.json `platformTools` | per-agent | `AgentPlatformToolName` + `assertOperationExposed` |

四象限都合法不报错:
- 工具有 + 数据有:正常语义检索。
- 工具有 + 数据无:工具返回空结果,不抛错;agent 自然回退字面 search。
- 工具无 + 数据有:后台建索引,合法(暖索引后再开工具)。
- 工具无 + 数据无:全关。

两条链唯一交汇点在工具执行时:调 `semantic_search` → 查索引 → 有向量就 cosine 返回,没向量就返回空。交汇点是"尽力而为",不是"前置门控"。

索引生产跟 embedding 能力(链 1),不跟工具暴露(链 2):API 配了就开始建索引,不管有没有 agent 配工具。不想付费 → 关 API 配置(正确的成本控制粒度),不是靠"不给 agent 工具"。

## Embedding 配置形态(独立段,不并入 chat provider)

`tsian-platform-config` 里加独立 `embeddingConfig` 字段,与 chat `providerTypes` 平级:

```
embeddingConfig: {
  enabled: boolean        // 默认 false
  baseUrl: string
  apiKey: string
  model: string
  dimensions: number      // 必填,玩家从模型规格查得
}
```

**无 kind 字段**——MVP 只支持 openai-compatible 协议,玩家配置 OpenAI 兼容端点(硅基流动是其一),无需区分协议。请求恒 `Authorization: Bearer {apiKey}`,不抽 `buildAuthHeadersForKind` 共享 helper(chat 代码零改动)。

**dimensions 必填**(不自动探测):维度是向量存储和 cosine 计算的硬约束,填错会导致维度不匹配的静默 bug。玩家配置 embedding 模型时维度是该模型的已知规格,查得后明确填入,比"自动探测可能错"更可控。

**另起独立段,不并入 chat provider 结构**。理由:chat 的 `BrowserAiModelConfig` 字段(toolCallMode/streaming/采样参数 7 个/contextWindow/reasoningEffort)对 embedding 全无意义,且 `toolCallMode` 是必填校验项——塞进 chat 结构要么填无意义值绕校验,要么改校验到处开 embedding 分支。embedding 配置本来就简单(无采样/无 toolCall/无 streaming),给它贴合的小结构比硬塞进 chat 大结构更诚实,且 chat 代码零改动零回归。

凭据边界:apiKey 存 localStorage(平台侧),不进 workspace、不随 card 分发。向量索引存 IndexedDB(workspace 侧),随 save 生灭。两者分离,复用现有约定。

## AIRP 融入(两挂点,零侵入)

AIRP turn 流程:master LLM turn → 委托 retrieval → retrieval 跑 workspace.search + read_entity → 返回精炼结论 → master 写叙事 → 委托 post-processing 落盘 raw turn/更新 world/按需 maintenance。

两个融入挂点:
1. **retrieval agent 加 `semantic_search` 工具**(唯一 agent 可见点):不替换字面 search,并存。字面查确切措辞/结构,语义查远期事件/设定。retrieval 的 AGENT.md 加指引。结果形态复用 `WorkspaceSearchResult` 外壳 + 元数据回显,让 retrieval"读候选→精炼"行为不改。
2. **turn commit 异步嵌入**(透明):`commitSuccessfulRuntimeTurnForSave` 落库后,platform-host 对当轮 save-runtime 文件做 staleness 检查 + 入队 re-embed,agent 与 post-processing 完全不感知。

**master 流程、context 注入、压缩机制、agent 间协作——一行不动。**

## Requirements

### R1 新增 `workspace.semantic_search` 操作(只读)

- contracts `WorkspaceOperationName` 加 `"semantic_search"`。
- 只读 op,与 `search` 同级,复用 `assertOperationExposed` + `scopedReadableFiles` + actor-level read 检查,挂进 `DEFAULT_RUNTIME_WORKSPACE_OPERATIONS`。
- 请求参数:`query`(自然语言,语义模式用 `semanticQuery` 字段)、`scope?`、`limit?`(默认 5,上限 8)、`typeFilter?`(turn/agent-notes/memory-summary)。
- 结果复用 `WorkspaceSearchResult` 外壳(path/name/updatedAt/score/preview),`matches`(行级)在语义模式省略,加元数据回显字段(`semanticType?`/`turn?`)。cosine 相似度直接填 `score`,不另设 `semanticScore` 字段。
- 索引空时返回空结果,不抛错。

### R2 向量索引存储(Dexie)

- 库名 `tsian-agent-runtime-v10` → `tsian-agent-runtime-v11`(原型期换名换代,`this.version(1)` 重置,无迁移,同 v9→v10 先例;`public/tsian-game-card-frontend-sw.js` 镜像库名同步)。
- 加 `embeddingIndex` 表:`"&id, [scope+ownerId], path, updatedAt"`。
- 每行:`{ scope, ownerId, path, chunkIndex, vector: Float32Array, text, type, turn?, createdAt?, updatedAt, model }`。
- 按 `[scope+ownerId]` 复合索引按 owner 整片取/整片删。GC = 删存档时 drop `(save-runtime, saveId)`。
- 查询 JS 暴力 cosine(save-runtime 规模够快,不引 ANN 库)。

### R3 异步嵌入 + staleness 兜底

- **proactive enqueue**:turn commit(`commitSuccessfulRuntimeTurnForSave` 落库后,platform-host 调度点)对当轮 save-runtime 文件做 staleness 检查 + 入队 re-embed,不阻塞 turn。
- **staleness 校验**:搜索时枚举 owner 文件,比 `file.updatedAt` vs 索引 `fileUpdatedAt` + 缺失文件,只重嵌 stale/missing。
- 远程 API 失败不抛错给 agent,退化 staleness 补嵌。

### R4 embedding 配置(控制面板)

- `tsian-platform-config` 加独立 `embeddingConfig` 段,默认 `enabled: false`。
- 字段:enabled / baseUrl / apiKey / model / dimensions(必填)。无 kind 字段——MVP 只支持 openai-compatible,请求恒 Bearer。
- 配全才生效(严格):`resolveEmbeddingConfig` 未配/配不全(含 dimensions 缺失)→ 返回 null → 索引不生长。
- 控制面板加"语义检索"分区,与"AI 服务商"并列;可选"从 chat preset 复制凭据"UX 糖。

### R5 工具暴露(per-agent,解耦)

- `AgentPlatformToolName` 加 `"workspace_semantic_search"`(独立粒度,见 design §2.1)。
- agent.json `platformTools.enabled` 决定 per-agent 暴露,经 `assertOperationExposed` + `exposedOperations` 传导。
- 默认 retrieval agent 配置加该工具;master 不需要(它委托 retrieval)。
- `buildWorkspaceToolInstructions` 列出该工具(仅当 agent 启用 + embedding 能力在位时,执行层尽力而为)。
- agent.json / AGENT.md 是 `storage/workspace.ts` 内嵌默认内容常量,改默认值 + bump `DEFAULT_WORKSPACE_VERSION` + 加 `DEFAULT_SAVE_RUNTIME_UPGRADE_FILE_PATHS` 让存量存档升级拿到新配置。

## Acceptance Criteria

- [ ] `workspace.semantic_search` op 存在,只读,受 actor-level read 权限保护。
- [ ] 索引空时返回空结果不抛错;agent 自然回退字面 search。
- [ ] Dexie 库名 `tsian-agent-runtime-v11`,`embeddingIndex` 表按 `(scope, ownerId)` 分库;删存档时对应向量 drop;SW 镜像库名同步。
- [ ] 三分语料:raw turns 按 turn 整体索引、agent 浓缩产物按段落索引、JSON 状态跳过。
- [ ] `type` pre-filter 生效(查设定优先命中 summary 而非 turn)。
- [ ] embedding 配置默认关;配全才生效;未配时索引不生长、工具调用返回空。
- [ ] embedding 能力开关与工具暴露开关独立:四象限(工具有无 × 数据有无)都不崩。
- [ ] turn commit 后异步嵌入,不阻塞 turn 收尾;远程 API 失败不抛错给 agent。
- [ ] staleness 兜底:文件 `updatedAt` 晚于向量 `updatedAt` 时下次搜索补嵌;studio/非 turn 写也靠此兜住。
- [ ] retrieval agent 可用 `semantic_search`;master 不暴露(委托 retrieval)。
- [ ] 结果复用 `WorkspaceSearchResult` 外壳 + 元数据回显(`semanticType`/`turn`);retrieval 精炼行为不改。
- [ ] 控制面板有"语义检索"分区,可配 embedding API,默认关。
- [ ] 存量存档经 `DEFAULT_WORKSPACE_VERSION` 升级拿到 retrieval 新工具配置 + AGENT.md 指引。
- [ ] master 流程/context 注入/压缩机制/agent 间协作零改动。
- [ ] `npm run build:web` + `npm run build:contracts` 通过。

## Out of Scope

- card-content 语义检索(降级为可选,非 MVP)。
- 向量随卡分发(远程模型版本锁死,且 save-runtime 不分发,无场景)。
- reranker 模型 / 查询改写 LLM pass(成本敏感,搁置)。
- ANN 索引(HNSW/IVF)— save-runtime 规模暴力 cosine 够用。
- 本地 transformers.js embedding(用户选三方 API;本地方案作为未来离线可选保留)。
- 实体/事件 tag 与 `entityFilter`(收益面窄、对主语料无增益、被 agent 自选兜住,不做;需要时再立专项)。
- Gemini 原生等非 openai-compatible embedding 协议(MVP 只支持 openai-compatible,用到再加)。
- 近因加权公式(MVP 纯 cosine;加权用到再加)。
- `executeWorkspaceMutation` 写钩子(挂错瓶颈,废弃;studio 写靠 staleness 兜底)。

## Open Questions

- [x] `AgentPlatformToolName` 粒度:design §2.1 已定,独立 `workspace_semantic_search`。
- [x] embedding API 选型:**硅基流动 + Qwen embedding**(用户已定)。OpenAI 兼容协议,MVP 直接覆盖。实现时用真实 turn 正文验证 top-K 召回质量(验证步骤,非选型问题)。
- [x] 异步嵌入队列形态:design §6 已定,轻量内存队列 + staleness 兜底。
- [x] chunk 文本拼接格式:design §3.1 已定,user/assistant 直拼。
- [x] proactive enqueue 落点:turn commit(`commitSuccessfulRuntimeTurnForSave`),非 `executeWorkspaceMutation`(后者被 staged 路径绕过,对主语料是死代码)。
- [x] 实体 tag / entityFilter:砍除,不做。
- [x] 协议推断 / Gemini 骨架:砍除,MVP 只做 openai-compatible。
