# Design — 卡内插图 Agent 与输出协议

## 1. Scope and ownership

本设计把“正文插图”拆成四个稳定边界：

| Layer | Owns | Does not own |
|---|---|---|
| 本任务：卡协议 | storyteller block、opening 委派约定、Reply Projection、`image-director` Prompt/权限、卡 entrypoint、workspace manifest | Provider、媒体事务、checkpoint、Vue 交互 |
| 平台生图兄弟任务 | `generate_image`、Provider config/secret、唯一 `@tsian/play-bridge` identity helper、guard normalize、付费前 assetId binding、guarded handoff | 卡美术风格、插图 block、权威 turn parsing |
| 图片一致性兄弟任务 | card-agnostic source registration、exact-source storage metadata、并发 commit、checkpoint patch、restore、Blob GC | 叙事字段、卡 UI、runtime identity 重实现 |
| inline UI 兄弟任务 | projection JSON 验证、first-three interactivity、ready/init entrypoint capability、shared-helper request/path、整卡交互与资产显示 | Provider 请求、Agent id 常量、identity 算法重实现 |

平台只知道通用 Tool、通用 entrypoint 形状和通用字符串投影；沉浸阅读器卡定义“插图”的可编辑语义。这样不会把卡级玩法固化进平台，也不会把平台 secret 暴露给卡。

## 2. End-to-end data flow

```text
storyteller raw reply（opening turn 0 或正式 turn）
  → card reply-projection.json
      ├─ content: 删除 choices 与完整 illustration blocks，供后续 LLM context
      ├─ displayContent: 删除 choices，保留 illustration blocks 的原位置
      └─ projections.illustrations: 按顺序保存每块内的 raw JSON string
  → card frontend ready/init
      ├─ 读取/校验 entrypoints.imageGeneration 并缓存 reactive capability
      └─ 缺失/mismatch 时预先将 otherwise-valid blocks 降级
  → card frontend settled parser
      ├─ 验证 projected raw JSON 并保留原 projection index
      ├─ 只让正文顺序最先三个 valid blocks 可交互
      ├─ 调用 @tsian/play-bridge shared helper 得到 fingerprint/guard/identity/path
      ├─ 展示 title / description，不展示 refs
      └─ 整卡 pointer/Enter/Space 激活后 invokeAgent
          ├─ Agent input JSON: assetId + sourceGuard + prose + brief
          └─ InvokeAgentOptions.generatedMediaSourceGuard: 同一 guard（独立 authority channel）
  → remote bridge strict normalization
  → invokeAgent host captures requiredSourceGuard closure
  → image-director（one-shot / ephemeral）
      ├─ 读取点击时最新 scene/entity 文件
      ├─ 结合完整来源正文 + brief + fixed visual style
      ├─ 选择 semantic aspect
      └─ 调用 host-owned generate_image，透传 input guard 供一致性检查
  → generated media transaction（兄弟任务）
      ├─ required closure 与 Tool guard/assetId 任一不一致：pre-Provider IMAGE_INVALID_ARGUMENTS，zero writes/handoff
      ├─ Tool success 仅 `{ path, mediaType }`
      ├─ legal handoff 使用 required closure guard → generic source registration → exact-source storage metadata
      └─ 保存 Blob 并执行 source CAS / checkpoint patch
  → image-director 从 validated request 回显 assetId/guard（UI correlation only），Tool fields 置于 asset
  → frontend 比对 pending identity/guard，按 shared-helper path reread workspace
```

opening 不走旁路特例。`world-architect → agent_call storyteller → commit_play_setup → tsian.reply.project` 已经复用正式回合的 projector；本任务只同步委派 Prompt。

## 3. Storyteller protocol

### 3.1 Block syntax

一个合法示例：

```text
潮湿的站台在列车灯下显出一层冷白色。

[[插图]]
{"title":"雨夜车站的重逢","description":"坏掉的钟下，林澈隔着穿透雾气的列车灯认出了姐姐。","sceneRef":"scene:old-station","entityRefs":["character:lin-che","character:lin-yu"]}
[[/插图]]

她的手还停在半空，像是不敢确认眼前的人是否真实。
```

V1 brief 的规范化形状：

```ts
interface IllustrationBriefV1 {
  title: string
  description: string
  sceneRef: string
  entityRefs: string[]
}
```

约束（所有长度均在 trim 后按 UTF-16 code units 计，拒绝类型 coercion）：

- JSON object 恰好包含上述四字段，`additionalProperties: false`；任何缺字段或 extra field（包括 Provider、hidden prompt、model、dimension）都使 interactive schema 无效。
- `title`: string，长度 `1..80`。
- `description`: string，长度 `1..500`。
- `sceneRef`: string，总长度 `1..120`，严格为 `scene:<localId>`。
- `entityRefs`: array，长度 `0..12`；每项为 string，总长度 `1..120`，严格为 `<type>:<localId>`；trim 后去重并保持首现顺序。重复项本身允许 normalize，不使 block 无效；其它任一非法项使整个 block 无效。
- ref 恰好一个 colon；每个 segment 长度 `1..80`，不得为 `.` 或 `..`，不得含 whitespace、`/`、`\\`、NUL 或额外 colon，允许其它非空 Unicode 字符。`sceneRef` localId 和 entity type/localId 使用同一 segment rule；其安全边界与 `update_entity` 一致或更严格。
- title/description 是玩家可见画面预告；refs 只用于资料定位。block index 是其在 `projections.illustrations` 中的 0-based 顺序，不由模型提供 id。
- invalid object fallback 不做宽松 normalize：仍只读取原 object 中 string 类型的 title/description，不 stringify/coerce；任一在各自长度边界内可用即可显示不可交互 fallback；refs 永不显示。

runtime validation 必须只有一份实现。优先在 `packages/play-bridge/src/illustration-brief.ts` 一类窄 shared runtime module 导出 `IllustrationBriefV1` 与 validator，并从 `@tsian/play-bridge` package root 导出；若实现时评估为 card UI helper，则 parser、组件与 request builder 仍必须全部调用同一 helper，禁止复制第二份规则。`@tsian/contracts` 保持 type-only，不放 runtime validator。storyteller/world-architect/image-director Prompt 必须自包含地明确同一 closed schema，不只引用外部文档。平台 storage/source-registration 只处理 generic projection raw string，不导入或执行该 validator。

### 3.2 Placement and count

- block 必须放在目标画面的正文位置，不能统一堆在回复末尾。
- 每个 opening/formal turn 要求 1–3 块。
- 默认 1 块；2–3 块仅用于同一回合存在多个独立、重要且视觉差异明确的时刻。
- 该数量是 Prompt compliance，不是 platform commit validation。模型没有满足时仍然提交正文。

### 3.3 Opening delegation

`world-architect` 的 `agent_call` 只改变 `expectedOutput`：要求 storyteller 返回完整【开局正文】、正文原位置的【1–3 个插图 block】和【3–5 个初始选项】。不引入 opening-only marker、schema、retry 或 validation。

`commit_play_setup` 保持现状：

1. 接收完整 `openingReply`；
2. 调 `tsian.reply.project(openingReply)`；
3. 把完整 projected assistant item 写入 turn 0；
4. 只把 projected clean `content` 写入 storyteller context。

即使 illustration projection 缺失或内容无效，openingReply 非空这一既有提交条件仍然足够。

## 4. Reply Projection design

现有 choices 规则继续使用 `text: ""`，因为选项由前端其它通道消费且不应留在正文展示通道。新增 illustration 规则必须是：

```json
{
  "id": "illustrations",
  "match": "/\\[\\[插图\\]\\]([\\s\\S]*?)\\[\\[\\/插图\\]\\]/g",
  "content": "",
  "project": {
    "illustrations[]": "$1|trim"
  }
}
```

语义对照：

| Config key | Illustration behavior |
|---|---|
| `content: ""` | 只清理 Agent/LLM context lane |
| 不设置 `display` | display lane 保留原 block 与原位置 |
| 禁止 `text: ""` | 避免同时从 display lane 删除 block |
| `illustrations[]` | 多次匹配按出现顺序 append |
| `$1|trim` | 保存 block 内原始 JSON 文本，不做 JSON parse |

规则可以与 choices 规则顺序执行，因为两个 marker 不嵌套；验收必须覆盖同时含 choices 与 illustrations 的回复。

### 4.1 Fail-soft matrix

| Input | Projector | Frontend/commit |
|---|---|---|
| 完整 marker + closed-schema valid 四字段 JSON object | clean content；display 保留；raw string append | 从 Markdown 隔离，前三个 valid 块可交互，其余 valid 块不可交互 |
| 完整 marker + object，但字段/长度/ref/extra-field 任一无效 | 同样抽取字符串，不解析 | 从 Markdown 隔离；仅读取 string title/description，不 coerce；任一可用则显示不可交互 fallback |
| 完整 marker + 非 object/畸形 JSON，或 object 无可用 string title/description | 同样抽取字符串，不解析 | 从 Markdown 隔离并省略该 block；正文继续 |
| 0 块 | 不做数量校验 | 正文继续，无插图卡 |
| >3 个 valid 块 | 不做数量校验 | 按正文顺序仅前三个 closed-schema valid 块可交互；其余 valid 块为不可交互描述块，不增加调用/Provider 成本；invalid 块不占三个名额 |
| 未闭合/破碎 marker | regex 不匹配，不抛错 | UI final/stream parser 识别并隐藏破碎 marker；commit 继续 |
| projection config 自身损坏 | projector 既有 config diagnostics/fallback | 不引入 illustration 专用失败路径 |

projector 永远不依赖 card schema。JSON parsing、完整 marker 与 Markdown 的隔离、可见字段选择和交互 enablement 属于 UI 子任务；UI 必须以 `displayContent` 保留的位置和 `projections.illustrations` 的原 index 关联两条数据，不能把 invalid 完整 marker 重新交给 Markdown renderer。

## 5. Source identity and Agent request/result

### 5.1 Stable source identity and sole helper

All runtime consumers import the sole implementation from `@tsian/play-bridge` (`packages/play-bridge/src/generated-media-identity.ts`). This protocol task consumes it and must not implement guard normalization, hashing, NUL encoding, or path derivation again.

The exact guard shape is:

```ts
{
  kind: "turn-projection"
  turn: number
  projectionKey: "illustrations"
  index: number
  fingerprint: `sha256:${string}`
}
```

- `turn`: non-negative integer; opening is 0.
- `index`: original 0-based index in `projections.illustrations`; invalid/extra blocks are never renumbered.
- `fingerprintProjectionRaw(raw)`: SHA-256 of the exact persisted `$1|trim` string encoded as UTF-8. It never parses JSON, sorts fields, normalizes Unicode/whitespace, or re-serializes.
- `identityKey` and `assetPath` come from the same shared helper. The frontend computes them before invoking the Agent and sends `assetId: identityKey` plus the full guard.

`image-director` validates V1 shape and forwards the Agent-input `assetId`/guard unchanged to `generate_image`; it does not hash or invent an id. Independently, the frontend passes that same guard as `InvokeAgentOptions.generatedMediaSourceGuard`. The remote bridge strictly normalizes the optional field and the `invokeAgent` host captures it as a `requiredSourceGuard` closure when binding the runner. The closure—not Agent input, Tool fields, final result, `agentId`, or `purpose`—is the authoritative requirement for this invocation.

When required guard exists, Tool omission, any guard field mismatch, or `assetId` mismatch against the identity derived by the host from required guard returns `IMAGE_INVALID_ARGUMENTS` before Provider configuration/fetch, with zero Provider calls, zero ordinary writes, zero guarded writes/handoffs/source-registration calls, and no fallback to ordinary write. Exact match uses the closure guard for handoff; Tool data is consistency evidence only. Without an invoke option, no Tool guard remains an ordinary write and a valid Tool self-guard may enter the guarded path; formal-turn direct Tool use may omit guard. Guarded metadata therefore has only two legal origins: host-required-and-validated option authority, or a valid Tool self-guard while the option is absent.

The consistency-owned source-registration seam only receives a legally authoritative guarded handoff, then reads the exact authoritative turn, generically resolves `projections[projectionKey][index]`, and uses the same raw-string helper before creating exact-source storage metadata.

### 5.2 Image-director request V1

前端向 card-discovered Agent 发送以下严格 JSON 文本：

```json
{
  "schema": "tsian.image-director.request.v1",
  "assetId": "tp-v1-<shared-helper-derived-lowercase-sha256>",
  "sourceGuard": {
    "kind": "turn-projection",
    "turn": 12,
    "projectionKey": "illustrations",
    "index": 0,
    "fingerprint": "sha256:<64-lowercase-hex>"
  },
  "prose": "完整的本回合 clean narrative text",
  "brief": {
    "title": "雨夜车站的重逢",
    "description": "坏掉的钟下，林澈隔着穿透雾气的列车灯认出了姐姐。",
    "sceneRef": "scene:old-station",
    "entityRefs": ["character:lin-che", "character:lin-yu"]
  }
}
```

- `assetId` 与 `sourceGuard` 都由前端通过 shared helper 从持久化 raw projection 构造；guard 必含 `kind: "turn-projection"`，`projectionKey` 必须为 `"illustrations"`。Agent 只校验并逐层原样传递，不自行重算 fingerprint/identity。
- `prose` 来自该 assistant item 的 clean `content`，是完整来源回合正文，不是 marker 周边片段，也不包含最终 prompt。
- 请求不携带 scene/entity 快照；Agent 在执行时自行读取最新文件。
- 请求不携带 style、Provider、model、dimensions、API key 或历史图片数据。
- frontend uses `persist: false`; each activation is a one-shot input, and sends the exact same guard separately as `InvokeAgentOptions.generatedMediaSourceGuard`; every attempt has a fresh `invocationId`.
- The Agent-input copy is execution data. The invoke-option copy becomes the host's authoritative `requiredSourceGuard` closure; neither `purpose` nor the discovered Agent id selects guarded behavior.

### 5.3 Image-director success result V1

Agent 成功时最终回复只含一段无 Markdown fence 的 JSON：

```json
{
  "schema": "tsian.image-director.result.v1",
  "status": "completed",
  "assetId": "tp-v1-<same-request-identityKey>",
  "sourceGuard": {
    "kind": "turn-projection",
    "turn": 12,
    "projectionKey": "illustrations",
    "index": 0,
    "fingerprint": "sha256:<64-lowercase-hex>"
  },
  "asset": {
    "path": "<host-returned-save-runtime-path>",
    "mediaType": "image/png"
  }
}
```

- Tool success is strictly `{ path, mediaType }`; it never echoes `assetId` or guard.
- Agent copies `assetId` and `sourceGuard` from its already validated request into the final result, and places Tool `path/mediaType` under `asset`. It does not infer or alter either identity field. This echo is UI correlation only and never authorizes a media commit.
- frontend compares result `assetId` and every guard field against the pending request. `asset.path` is not authoritative: frontend derives `assetPath` again with the shared helper and rereads that path via `workspace.read`. If the host contract is missing, bridge/runner rejects, or identity mismatches, only this card attempt fails; other cards and the formal turn continue.
- Durable commit authority comes from the normalized invoke-option closure followed by source registration and exact-source CAS, never from the Agent final result.
- 不返回 prompt、negative prompt、Provider、model、width/height、base64、URL、scene/entity 内容或解释文字。
- Tool/Agent 失败通过既有 `invokeAgent` failed/rejection 语义处理；不得伪造 `status: completed`。UI 保留正文，并把失败限制在当前卡。

## 6. Image-director Agent design

### 6.1 Card files

新增：

```text
workspace/agents/image-director/
├── agent.json
├── AGENT.md
└── visual-style.md
```

选择独立 `visual-style.md` 而不是平台配置：风格是卡级、会随卡演进的内容；独立 context 又可让 Agent SOP 保持短小。该文件由 `contextPaths` 以 `role: "system"`、`position: "prelude"` 注入。

V1 固定风格方向为：统一的电影感半写实叙事插画、绘画性数字质感、环境与人物关系共同构图、自然且有层次的光线、克制一致的色彩、符合当前世界时代/材质；禁止画面文字、水印、UI、拼贴和角色设定图式纯肖像。Prompt 只写最终画面可观察内容，不写平台/Provider 指令。

### 6.2 Machine config

配置意图：

```json
{
  "id": "image-director",
  "contextPaths": [
    {
      "path": "agents/image-director/visual-style.md",
      "role": "system",
      "position": "prelude"
    }
  ],
  "skills": { "enabled": [], "disabled": [] },
  "tools": { "enabled": [], "disabled": [] },
  "platformTools": {
    "enabled": ["workspace_read", "generate_image"],
    "disabled": []
  },
  "workspaceAccess": { "level": 1 },
  "entryMode": "ephemeral"
}
```

关键点：

- registry 只在相邻 `AGENT.md` 存在时收录 `agent.json`。
- 非空 `platformTools.enabled` 避免默认回退带来 `agent_call`/`workspace_write`。
- 不给 generic workspace write；媒体写入封装在 host-owned Tool 内。
- ephemeral 与 UI `persist:false` 双重表达 one-shot 行为，不生成跨调用 context snapshot。
- 该 Agent 不是 platform-essential system Agent。

storyteller 保持既有 Tool 行为，但在 `platformTools.disabled` 中明确加入 `generate_image`。平台任务还必须保证该 Tool 不进默认集；二者共同形成可测试的防线。

### 6.3 SOP

`AGENT.md` 必须自包含地定义：

1. 只接受 V1 request JSON；校验 `assetId`、完整 `sourceGuard`、prose 与 brief。
2. 将 `scene:<localId>` 映射到 `save/scenes/<localId>.json`；将 `<type>:<localId>` 映射到 `save/entities/<type>/<localId>.json`。只按合法 ref 读取已知 save path，不把任意输入当 workspace path。
3. 所有读取发生在点击调用时；请求中的 prose/brief 是叙事意图，workspace 文件是当前 scene/entity 状态的权威。
4. 某个 ref 缺失/无效时记录为不可用并继续使用剩余资料；没有足够画面信息时让当前调用失败，不臆造文件内容。
5. 选择一个 aspect：
   - `landscape`: 环境、多人关系、移动/冲突和横向空间；默认优先；
   - `portrait`: 纵向空间或完整人物动作构图，不表示头像功能；
   - `square`: 紧凑、平衡的近景或物件/小群体时刻。
6. prompt 由“当前可见主体与动作、环境/时代/天气/光线、构图、固定风格、无文字/水印/UI”组成；Provider-neutral，不输出给玩家。
7. 调用 `generate_image`，把已验证 request 的 `assetId` 与完整 `sourceGuard` 原样传递；禁止 hash raw projection、只传 turn、另造 block id 或发明 asset id。通用平台 Tool 中 guard 为 optional，但本卡 use case 缺少 `assetId`/guard 时不得调用 Tool。Tool success 只含 `{ path, mediaType }`。
8. 成功后从 validated request 复制 `assetId/sourceGuard`，从 Tool success 复制 `path/mediaType` 到 `asset`，输出 §5.3 exact JSON；无额外散文或 fence。

## 7. Platform Tool dependency and visibility

在平台生图兄弟任务合入前，卡中写入字符串 `generate_image` 会被以下两处过滤/拒绝：

- `AgentPlatformToolName` closed union；
- agent registry 的 `AGENT_PLATFORM_TOOL_NAMES` allow-list。

因此集成顺序必须满足：

1. contracts 加入 Tool name；
2. registry/permissions/Tool registry 加入执行能力；
3. 明确不加入 `DEFAULT_AGENT_PLATFORM_TOOLS`；
4. 再验证卡 Agent 的可见 Tool 集。

平台通用 Tool schema 对 `sourceGuard` 保持 optional；只有携带 guard 的调用才进入 turn-projection source validation。本卡 image-director 把 optional 能力提升为 use-case-required，保证每次卡内插图都可执行 stale-result guard。

Tool 输入不得包含 Provider secret/config。Tool trace/debug/persisted tool-call projection 必须 metadata-only：保留 invocation/aspect/status/path/mediaType 等 safe fields，redact full prompt，不记录 sourceGuard values、图片 body/base64；该能力由平台兄弟任务实现，本任务只做集成断言。

## 8. Optional card entrypoint

共享契约扩展：

```ts
export interface GameCardRuntimeEntrypoints {
  playerTurn?: string
  postTurnMaintenance?: string
  imageGeneration?: {
    agentId: string
    protocol: "tsian.image-director.v1"
  }
}
```

传播矩阵：

| Producer/consumer | Required change |
|---|---|
| `packages/contracts/src/game-card.ts` | 加上述可选 object capability 及语义注释；不引入复杂 descriptor |
| `packages/contracts/src/bridge.ts` | 复核 Card bridge 共享返回类型/注释，无专用 RPC |
| `apps/platform-web/src/storage/game-cards.ts` | local manifest normalization 保留并逐字段校验 closed object、非空 `agentId` 与 exact protocol |
| `apps/platform-web/src/storage/game-card-packages.ts` | package import/export normalization 同上 |
| `apps/platform-web/src/platform-host/index.ts` | 已知字段白名单显式复制 normalized `imageGeneration` object，不透传未知字段 |
| `packages/play-bridge/src/tsian-api.ts` | 继续返回共享类型，更新开发者注释；无 id 常量 |
| card `game-card.json` | 声明 `{ "agentId": "image-director", "protocol": "tsian.image-director.v1" }` |
| inline UI sibling | ready/init 后缓存 object；只有 exact v1 可交互，并从 `.agentId` 调用 |

保留当前 normalizer 的既有约束：当 `runtime.entrypoints` 出现时 `playerTurn` 仍为必需；本任务只增加一个可选 object capability，不扩大“只有 imageGeneration、无 playerTurn”的 manifest 形态，也不把 `PlatformConfig.imageGeneration` / Provider config 混入该 card runtime shape。

缺字段时 bridge 返回对象中没有 `imageGeneration`。frontend 在 ready/init 读取并缓存 reactive capability；只有 object 的 `protocol === "tsian.image-director.v1"` 且 `agentId` 为合法非空字符串时启用交互。字段缺失、错误、未知 protocol 或 malformed object 时，所有 otherwise-valid block 从首帧起变为不可交互 fallback，并留下不含 secret/prompt 的可定位开发诊断；不得等首次激活才发现，也不得猜 Agent id。旧卡无字段仍正常游玩。

对前三个 closed-schema valid block，整张未生成描述卡是唯一付费生成激活目标。一次 pointer、Enter 或 Space 激活即表示玩家同意该次真实生成，不再弹确认 modal，不保留费用/“点击显影/生成插图”action row；exact accessible intent 为 `aria-label="生成插图：<title>"`，生成中阻止重复激活。该产品选择不改变 Settings 测试按钮的显式费用警告。

## 9. Actual card, blank template and package manifest

### 9.1 Actual card changes

预期变更文件：

- `workspace/agents/storyteller/output-format.md`: 正式 turn block 约定与 1–3 策略；
- `workspace/agents/storyteller/agent.json`: defense-in-depth 禁用 `generate_image`；
- `workspace/agents/world-architect/skills/游玩设定/SKILL.md`: opening delegation expectedOutput；
- `workspace/config/reply-projection.json`: illustration rule；
- `workspace/agents/image-director/{agent.json,AGENT.md,visual-style.md}`: 新 Agent；
- `game-card.json`: entrypoint、workspace file entries 与 byte sizes。

`agents/README.md` 当前只说明目录机制而不维护固定阵容，不为新 Agent 做无消费者的 roster 复制。

### 9.2 Blank template decision

不修改 `apps/platform-web/src/storage/workspace-templates/**` 的 storyteller/world-architect/template files，也不在 builtin blank manifest 添加 `imageGeneration`。证据与原因：

- 它与实际沉浸阅读器卡内容已经明显不同，不是构建源/镜像；
- 它没有沉浸阅读器 packaged frontend；
- 它没有对应 illustration projection/UI consumer；
- 写入 marker 会产生原始标签泄漏和无人消费数据。

通用 contracts/normalizers/bridge 的扩展已经让未来模板在拥有消费者时自行 opt in。

### 9.3 Manifest algorithm

Inventory contract: `workspaceFiles`、`frontendFiles`、`coverFiles` 的 `size` 都表示相应解压 ZIP entry payload `Uint8Array.byteLength`，不是压缩 archive size。文本使用 UTF-8 编码 bytes，binary 使用原始 entry bytes；不得使用 JavaScript UTF-16 `string.length`，且不改变字段可选性或其它 import 行为。当前 `exportGameCardPackage` 在 `apps/platform-web/src/storage/game-card-packages.ts:685-689` 对文本仍使用 `content.length`，由 UI/repack tooling sibling 在使用 exported inventory 前改为 `strToU8(file.content).byteLength` 或等价 `TextEncoder`，补 ASCII/中文/emoji 文本与 binary size 回归并运行 `npm run build:web`。Protocol task 只维护 workspace manifest，不复制 exporter 修复。

对最终卡包执行全量而非手工抽查：

1. `JSON.parse(game-card.json)` 成功且 schema 正确；
2. `workspaceFiles` path 唯一，并与 `workspace/**` 实际文件集合精确相等；
3. `frontendFiles`、`coverFiles` 同样与各自目录一致（最终与 UI 子任务汇合后）；
4. 每个 path 使用 `/`、文件存在、mediaType 与类型一致；
5. `size === fs.readFile(file).byteLength`，即与实际 ZIP entry payload 一致的 UTF-8/二进制真实字节数，不用 JS 字符长度；
6. entrypoint 指向 registry 可发现的 Agent；
7. 最后才统一 bump card version，并重新计算所有被合并任务改动的 sizes。

本任务可以先更新 workspace entries；UI 子任务改动同一个 manifest 后，最终集成必须重新执行全量算法，不能保留两份局部计算结果。

## 10. Test strategy

### 10.1 Projection fixtures

对 1、2、3 块且分布在不同段落的 raw replies，逐一断言：

- `content` 不含 `[[插图]]`，也不含 choices；
- `displayContent` 保留每块完整文本及相对段落位置，但不含 choices；
- `projections.illustrations` 是按顺序的 raw trimmed string array；
- projector 没有把 JSON 转成 object。

再覆盖完整 marker 内 malformed JSON、非 object、title/description 任一/均缺失、生成字段缺失、0 块、4+ valid 块、未闭合 marker；projector/turn commit 不抛错，不触发重试。完整 marker 无论有效与否都进入 raw projection 并与 Markdown 隔离：按正文顺序最先三个 complete valid 块可交互，额外 valid 块显示不可交互描述且零额外调用；object-invalid 仅读取原值为 string 且 trim/长度合法的 title/description，不 coerce，无可用字段或 parse failure 时省略；未闭合 marker 的 final/stream 防泄漏由 UI 处理。

### 10.2 Opening fixture

用 storyteller fixture 返回“开局正文 + inline illustration blocks + choices”，走 `commit_play_setup` 使用的同一 projection seam，断言：

- turn 0 assistant item 保留 `displayContent` 与 `projections.illustrations`；
- `save/agents/<playerTurnAgent>/context.json` 只收到 clean content；
- malformed/missing illustration 不影响 opening commit；
- world-architect `expectedOutput` 明确引用共享协议而非 opening-only schema。

### 10.3 Agent/permission fixtures

- 带 `agent.json + AGENT.md` 时 registry 有 `image-director`；移除 SOP fixture 时无条目。
- `enabledAgentPlatformTools(image-director)` 精确为 `workspace_read, generate_image`。
- storyteller、world-architect、stage-manager 与默认 Tool 集不含 `generate_image`。
- 模拟 Tool 成功时 Tool payload 精确为 `{path,mediaType}`；Agent result 从 request 回显 exact `assetId/sourceGuard` 并把 Tool fields 放入 asset；模拟失败或 ref 缺失时没有伪造 success。
- 变更 scene/entity fixture 后再次调用，prompt 构造使用新内容，证明没有历史视觉快照。

### 10.4 Entrypoint and manifest fixtures

- local/package normalizers 保留合法 closed `imageGeneration` object；缺字段旧卡兼容；空白/non-string `agentId`、缺失/错误/未知 protocol、extra object fields 和非 object 值被明确拒绝。
- bridge 只透出三个已知字段，且 image capability 是显式复制的 normalized object；`tsian.card.entrypoints()` 可读取 exact v1。UI ready/init reactive cache 对 missing/invalid/unknown protocol 首帧降级，Agent id 只从 object 读取。
- whole-card pointer/Enter/Space 激活使用 exact `aria-label`，无 confirmation/cost/action row，in-flight 去重；Settings cost warning 仍存在。
- manifest 全量 path/duplicate/mediaType/byte-size validator 通过；最终 UI/repack 集成还必须证明修正后的 exporter 对 ASCII/中文/emoji 文本和 binary entry 都报告实际 ZIP entry bytes，且 exported/checked-in/disk inventory 双向一致。
- builtin blank template 不出现 `image-director`、插图 marker/projection 或 image entrypoint。

### 10.5 Invoke authority and failure fixtures

- Verify the UI sends one equal guard through Agent input `sourceGuard` and `InvokeAgentOptions.generatedMediaSourceGuard`; remote normalization rejects malformed, extra-field, or noncanonical option data rather than dropping it.
- Required option + omitted Tool guard, any wrong guard field, or wrong `assetId`: `IMAGE_INVALID_ARGUMENTS` before Provider, with counters proving zero Provider calls, zero ordinary writes, zero guarded writes/handoffs/source registrations, and no ordinary fallback.
- Required option + exact Tool guard + host-derived `assetId`: success; inspect handoff to prove its guard is the host closure rather than a Tool-overwritable copy.
- No option + no Tool guard remains an ordinary write; no option + valid Tool self-guard remains guarded; formal-turn direct Tool use may omit guard.
- Vary `agentId` and `purpose` while keeping the option matrix fixed to prove no business-string routing. Simulate absent host support/bridge rejection and confirm only the current card attempt fails.

若实现时仓库仍没有 unit test runner，不为本功能单独引入大型框架；优先用现有纯函数 seam、可重复 Node manifest validator 和 Playwright/host integration fixture。所有人工 smoke 场景必须补充可重放 fixture 或命令，不能只记录“看起来正常”。



## 11. Security, compatibility and rollback

- secret 永不进入 card、workspace、bridge request、Agent context 或 trace。
- frontend 只把唯一 runtime validator 输出的四字段 normalized brief 传给 Agent，避免把 unknown AI JSON 字段提升为 Prompt/Tool 参数；fallback 不 coercion。
- 历史 turn 没有 projection 时继续按普通 Markdown；缺 `displayContent` 时仍回退 `content`。
- 旧卡缺少 `imageGeneration` 不受影响；新 entrypoint 是 optional additive contract。
- 回滚卡功能时可移除 image entrypoint、Agent、projection rule 和 storyteller guidance；平台通用 optional contract 可以保留，不影响其它卡。
- 回滚 projection 后，已有历史 `displayContent/projections` 仍是 JSON-compatible data；旧正文可继续显示。
- 不通过把 `generate_image` 加入默认 Tool 集来修复可见性问题，也不通过给 storyteller 授权来绕过 image-director。
