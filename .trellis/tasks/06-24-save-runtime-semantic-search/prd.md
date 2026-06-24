# save-runtime 语义检索

## Goal

为 workspace 补齐向量语义检索能力,让 agent 能按"含义"召回早已掉出上下文窗口的远期剧情与记忆,而不再受限于字面 substring/regex(`workspace.search`)的释义鸿沟。

核心痛点:save-runtime 是游玩中不断累积的活记忆(叙事日志、lore、摘要),会超过上下文窗口。`AgentContextSnapshot`(summary + 最近 K=5 轮)承认了"内存放不下只能截断"——被截掉的长尾就是召回缺口。字面 search 在这里结构性失效(玩家说"灯塔的事",正文写"她走向海边那座塔",词面零重叠)。语义检索是那层截断的按需还原。

## Why Native, Not Skill

增量更新归属是核心瓶颈。skill 不在写路径上,只能 diff 式增量(维护 manifest、追 stale、挡 race)。原生 workspace 有唯一写瓶颈经 `executeWorkspaceMutation` → volume,写时顺手 re-embed 即免费增量。**原生是唯一能优雅解决增量的位置。** 非工作区语料(对话史/外部 RAG)才归 skill。

## Scope (MVP)

**仅 save-runtime 一种 scope**,主键 `(save-runtime, saveId)`。

- save-runtime 是游玩期不断累积、会超窗口、字面 search 失效的活记忆——语义检索在这里是刚需。
- card-content 已被 `contextPaths` 注入 agent 上下文,边际收益低;其"向量随卡分发"决策从 MVP 消失,降级为可选。
- save-runtime 是玩家私有、从不导出、随存档生灭——无分发场景,归属与 GC 最干净(删存档 drop 这片)。

## 语料三分 + 预处理归 agent

| 路径 | 形态 | 检索单元 | 预处理 |
|---|---|---|---|
| `save/history/turns/*.json` | 原始剧情(user+assistant,无工具噪声) | **一个 turn 一个 chunk**,不按 token 切 | 轻预处理:拼 user/assistant 直嵌,可选前情提要前缀 |
| `save/agents/*/notes.md`、`save/memory/summaries/*` | agent 已浓缩产物 | 按标题/段落切(天然语义边界) | **无**——预处理在生成时已由 memory-maintenance Skill 完成 |
| `save/world/`、`save/state/`、`save/frontend/` | JSON 状态 | — | **跳过**,字面 search 够用 |

**核心原则:预处理责任归 agent/Skill,索引责任归原生,两件事不叠在同一处做。** 把预处理塞进索引管道会让 save-runtime 每轮写都触发模型 pass,是热路径灾难。

## 元数据与标签

- **第一类标签(结构化事实,写时免费)**:`type`(路径派生:turn/agent-notes/memory-summary)、`turn`、`createdAt`。
  - 只有 **`type` 值得作为 pre-filter**:解决跨类型语义污染(查设定命中 summary 而非恰好提到一词的 turn),零成本。
  - **`turn`/`createdAt` 不做 filter**——语义检索核心用例是召回远期事件,时间 filter 会排除要找的答案。用作 vector 之后的近因加权公式(纯算术,非模型),或不用。
  - 其余免费标签(agentId/role)低方差低杠杆,存作扩展位,不挂过滤。
- **第二类标签(实体/事件,需语义判断)**:归 agent,不归索引层。
  - 唯一成立的"顺带产出"位置 = memory-maintenance 冷路径(Skill 本就在做浓缩+结构化,提 tag 是同质任务;叙事 turn 热路径上挂提取是双任务+漂移+延迟三重风险,否决)。
  - 漂移由 `save/world/` 受控词表约束:实体标签引用 agent 已维护的实体库,不凭空造词。
  - maintenance 输出扩展 tag 字段,索引层在 maintenance 写文件时(写钩子)同事务 ingest。
  - 实体 tag 是**可选增强 filter**:有就精准锚定,没有退化纯向量。渐进增强,非全有全无。MVP 留扩展位,实体 tag 摄取与过滤可后续迭代。

## 检索流程(成本地板)

```
查询 → embed 查询(1 次 embedding)
     → type pre-filter(免费)
     → [可选] entity filter(agent 产出,有则用;MVP 可缺省)
     → cosine top-K=5~8(免费算术,可选近因公式加权)
     → 返回 [{path, turn, type, preview, entities?}, ...]
     → agent 读候选 → 自选 → workspace.read 取原文
```

- **无 reranker 模型**:消费端是每回合本就在跑的 agent,返回带元数据的小 K 候选让它自己判断 + workspace.read 取原文,已付费的 agent 推理顺手做了 reranker 的活。给已是模型的消费者配独立 reranker 是重复付费。
- **无查询改写 LLM pass**:与 reranker 同属热路径额外 model pass,成本敏感下一并搁置。
- 质量靠上游免费组合补回:好 chunking(turn 不切/memory 按段切)+ type filter + 小 K + agent 自选。在 save-runtime 规模(几百到低千级 chunk)下补得回来。

## Embedding 来源

**三方 API**(用户决策)。质量高、无首次下载体积、实现快。但带来热路径网络调用风险,需异步嵌入解耦(见下)。

远程模型向量基本关闭"随卡分发"路径——但 MVP 是 save-runtime 不分发,不影响。

**已定选型:硅基流动(SiliconFlow)+ Qwen embedding 模型**。硅基流动是 OpenAI 兼容 API(`https://api.siliconflow.cn/v1`,`POST /embeddings`,响应 `data[].embedding`),MVP 的 openai-compatible 协议标准直接覆盖,零额外适配。Qwen 系 embedding 对中文叙事是强项,正面匹配本项目的中文散文语料。用户在控制面板"语义检索"分区配置 baseUrl/apiKey/model,选型是配置不是硬编码。

## 异步嵌入 + Staleness 兜底

远程 API 的热路径风险:save-runtime 每轮落盘 raw turn 时若同步等 embedding,网络延迟/失败会阻塞 turn 收尾。

- **写路径解耦**:turn 落盘即完成(不等 embedding),向量嵌入异步排队。不阻塞 turn。
- **staleness 兜底**:搜索时枚举 owner 文件,比 `file.updatedAt` vs `vector.updatedAt`,只重嵌 stale/missing 的 chunk。远程 API 失败时退化为"下次搜索时按需补嵌"。
- **正确性源头 = 廉价 staleness 校验,不是"每个写都触发钩子"**。`executeWorkspaceMutation` 注释明确 staged turn 的 transaction 攒变更不进 dispatch——正确性不能依赖完美捕获所有写路径。staleness 兜底让 staged 路径、直接调 volume、卡导入全都不丢正确性,只丢一点性能。写钩子(挂 re-embed)是优化,让常见情况已新鲜。

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

**无 kind 字段**——协议从 model 名内部推断(Gemini 原生 model 名有稳定特征,其余默认 OpenAI 兼容,覆盖硅基流动/Qwen/bge/OpenAI/各种中转站)。玩家无感,不用理解协议差异。

**dimensions 必填**(不自动探测):维度是向量存储和 cosine 计算的硬约束,填错会导致维度不匹配的静默 bug。玩家配置 embedding 模型时维度是该模型的已知规格,查得后明确填入,比"自动探测可能错"更可控。

**另起独立段,不并入 chat provider 结构**。理由:chat 的 `BrowserAiModelConfig` 字段(toolCallMode/streaming/采样参数 7 个/contextWindow/reasoningEffort)对 embedding 全无意义,且 `toolCallMode` 是必填校验项——塞进 chat 结构要么填无意义值绕校验,要么改校验到处开 embedding 分支。embedding 配置本来就简单(无采样/无 toolCall/无 streaming),给它贴合的小结构比硬塞进 chat 大结构更诚实,且 chat 代码零改动零回归。

协议推断复用 auth header 构造逻辑(OpenAI 兼容走 Bearer,Gemini 原生走 x-goog-api-key)。同账号 chat+embedding 重填一次凭据的便利,做成 UI 层"从 chat preset 复制 baseUrl/apiKey"按钮,不靠结构耦合。

凭据边界:apiKey 存 localStorage(平台侧),不进 workspace、不随 card 分发。向量索引存 IndexedDB(workspace 侧),随 save 生灭。两者分离,复用现有约定。

## AIRP 融入(三挂点,零侵入)

AIRP turn 流程:master LLM turn → 委托 retrieval → retrieval 跑 workspace.search + read_entity → 返回精炼结论 → master 写叙事 → 委托 post-processing 落盘 raw turn/更新 world/按需 maintenance。

三个融入挂点:
1. **retrieval agent 加 `semantic_search` 工具**(唯一 agent 可见点):不替换字面 search,并存。字面查确切措辞/结构,语义查远期事件/设定。retrieval 的 AGENT.md 加指引。结果形态复用 `WorkspaceSearchResult` 外壳 + 元数据回显,让 retrieval"读候选→精炼"行为不改。
2. **post-processing maintenance 顺带吐 tag**(冷路径):memory-maintenance Skill 的 `apply_maintenance_plan` action 扩展输出 tags;索引层在 maintenance 写文件时(写钩子)同事务 ingest。
3. **raw turn 落盘写钩子异步嵌入**(透明):post-processing 每 turn 落盘 raw turn(已存在),写钩子触发异步 re-embed,agent 完全不感知。

**master 流程、context 注入、压缩机制、agent 间协作——一行不动。**

## Requirements

### R1 新增 `workspace.semantic_search` 操作(只读)

- contracts `WorkspaceOperationName` 加 `"semantic_search"`。
- 只读 op,与 `search` 同级,复用 `assertOperationExposed` + `scopedReadableFiles` + actor-level read 检查,挂进 `DEFAULT_RUNTIME_WORKSPACE_OPERATIONS`。
- 请求参数:`query`(自然语言)、`scope?`、`limit?`(默认 5,上限 8)、`typeFilter?`(turn/agent-notes/memory-summary)、`entityFilter?`(string[],可选)。
- 结果复用 `WorkspaceSearchResult` 外壳(path/name/updatedAt/score/preview),`matches`(行级)在语义模式省略,加元数据回显字段(turn/type/entities?)。
- 索引空时返回空结果,不抛错。

### R2 向量索引存储(Dexie)

- `tsian-agent-runtime-v10` → v11,加 `embeddingIndex` 表:`"&id, [scope+ownerId], path, updatedAt"`。
- 每行:`{ scope, ownerId, path, chunkIndex, vector: Float32Array, text, type, turn?, createdAt?, updatedAt, model }`。
- 按 `[scope+ownerId]` 复合索引按 owner 整片取/整片删。GC = 删存档时 drop `(save-runtime, saveId)`。
- 查询 JS 暴力 cosine(save-runtime 规模够快,不引 ANN 库)。

### R3 异步嵌入 + staleness 兜底

- 写钩子(volume write/delete 上挂 re-embed):触发布异步嵌入队列,不阻塞 turn。
- staleness 校验:搜索时枚举 owner 文件,比 `file.updatedAt` vs `vector.updatedAt`,只重嵌 stale/missing。
- 远程 API 失败不抛错给 agent,退化 staleness 补嵌。

### R4 embedding 配置(控制面板)

- `tsian-platform-config` 加独立 `embeddingConfig` 段,默认 `enabled: false`。
- 字段:enabled / baseUrl / apiKey / model / dimensions(必填)。无 kind 字段——协议从 model 名内部推断。
- 配全才生效(严格):`resolveEmbeddingConfig` 未配/配不全(含 dimensions 缺失)→ 返回 null → 索引不生长。
- 控制面板加"语义检索"分区,与"AI 服务商"并列;可选"从 chat preset 复制凭据"UX 糖。

### R5 工具暴露(per-agent,解耦)

- `AgentPlatformToolName` 加 `"workspace_semantic_search"`(或复用 workspace_read 粒度,design 定)。
- agent.json `platformTools.enabled` 决定 per-agent 暴露,经 `assertOperationExposed` + `exposedOperations` 传导。
- 默认 retrieval agent 配置加该工具;master 不需要(它委托 retrieval)。
- `buildWorkspaceToolInstructions` 列出该工具(仅当 agent 启用 + embedding 能力在位时,执行层尽力而为)。

### R6 maintenance tag 产出(可选增强,MVP 留扩展位)

- memory-maintenance `apply_maintenance_plan` action 扩展 outputSchema 加 `tags` 字段。
- 索引层在 maintenance 写文件时同事务 ingest tag + 摘要向量。
- 实体 tag 引用 `save/world/` 受控词表防漂移。
- 查询时 `entityFilter` 可选:有 tag 就精准锚定,无退化纯向量。
- MVP 可只做 schema 扩展 + ingest 钩子,过滤逻辑可后置。

## Acceptance Criteria

- [ ] `workspace.semantic_search` op 存在,只读,受 actor-level read 权限保护。
- [ ] 索引空时返回空结果不抛错;agent 自然回退字面 search。
- [ ] Dexie `embeddingIndex` 表按 `(scope, ownerId)` 分库;删存档时对应向量 drop。
- [ ] 三分语料:raw turns 按 turn 整体索引、agent 浓缩产物按段落索引、JSON 状态跳过。
- [ ] `type` pre-filter 生效(查设定优先命中 summary 而非 turn)。
- [ ] embedding 配置默认关;配全才生效;未配时索引不生长、工具调用返回空。
- [ ] embedding 能力开关与工具暴露开关独立:四象限(工具有无 × 数据有无)都不崩。
- [ ] 写钩子触发异步嵌入,不阻塞 turn 收尾;远程 API 失败不抛错给 agent。
- [ ] staleness 兜底:文件 `updatedAt` 晚于向量 `updatedAt` 时下次搜索补嵌。
- [ ] retrieval agent 可用 `semantic_search`;master 不暴露(委托 retrieval)。
- [ ] 结果复用 `WorkspaceSearchResult` 外壳 + 元数据回显;retrieval 精炼行为不改。
- [ ] 控制面板有"语义检索"分区,可配 embedding API,默认关。
- [ ] master 流程/context 注入/压缩机制/agent 间协作零改动。
- [ ] `npm run build:web` + `npm run build:contracts` 通过。

## Out of Scope

- card-content 语义检索(降级为可选,非 MVP)。
- 向量随卡分发(远程模型版本锁死,且 save-runtime 不分发,无场景)。
- reranker 模型 / 查询改写 LLM pass(成本敏感,搁置)。
- ANN 索引(HNSW/IVF)— save-runtime 规模暴力 cosine 够用。
- 本地 transformers.js embedding(用户选三方 API;本地方案作为未来离线可选保留)。
- 实体 tag 过滤的完整实现(MVP 留 schema 扩展 + ingest 钩子,过滤逻辑可后置)。

## Open Questions

- [x] `AgentPlatformToolName` 粒度:design §2.1 已定,独立 `workspace_semantic_search`。
- [x] embedding API 选型:**硅基流动 + Qwen embedding**(用户已定)。OpenAI 兼容协议,MVP 直接覆盖。实现时用真实 turn 正文验证 top-K 召回质量(验证步骤,非选型问题)。
- [x] 异步嵌入队列形态:design §6 已定,轻量内存队列 + staleness 兜底。
- [x] chunk 文本拼接格式:design §3.1 已定,user/assistant 直拼,前情提要前缀 MVP 不做。
