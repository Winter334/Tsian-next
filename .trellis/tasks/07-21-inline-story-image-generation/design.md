# Design — 正文内嵌文生图

## 1. Program Architecture

本功能按“平台稳定能力 / 存档一致性 / 卡内可编辑语义 / 前端体验”四层拆分：

```text
storyteller raw reply
  → card reply projection
      ├─ content: pure narrative for future model context
      ├─ displayContent: narrative + inline [[插图]] blocks
      └─ projections.illustrations: ordered raw requests
  → card frontend inline cards
  → invokeAgent(
      card entrypoint,
      per-card contextSlot,
      persist:false,
      generatedMediaSourceGuard: authoritative guard
    )
      ├─ Agent input JSON: assetId + same guard
      └─ host closes requiredSourceGuard over generate_image runner
  → card image-director
      → read current scene/entities
      → compose fixed-style prompt + semantic aspect
      → host-owned generate_image tool
  → OpenAI-compatible image adapter
  → generated-media transaction
      ├─ save-runtime image Blob
      └─ checkpoint manifest patch / stale-result guard
  → invokeAgent completed
  → frontend reloads stable asset path and renders Object URL
```

平台不理解“正文插图”的玩法语义；卡不持有 Provider secret；前端不直接拼 Provider 请求；Agent 不接触大体积 base64；存储层不硬编码具体卡或 Agent 名。

## 2. Authority and Derived Data

| Data | Authority | Consumers | Lifecycle |
|---|---|---|---|
| 插图意图与位置 | assistant turn 的 `displayContent` / projection | 卡前端、image-director 调用输入、source registration | 随 turn history 分支存在 |
| invokeAgent guarded commit authority | strict-normalized `InvokeAgentRequest.generatedMediaSourceGuard` captured by host runner closure | `generate_image` required guard check、source registration | 单次 invocation transient；不信任 Agent/Tool 回显 |
| 当前场景和角色资料 | `save/scenes/**`、`save/entities/**` | image-director 点击时读取 | 使用点击时最新值，不复制快照 |
| 图像 Provider secret | 平台本地 config / Dexie meta / `.tsian/local/platform-config.json` platform-meta 管理入口 | host image adapter、具备 platform-meta 权限的高级配置管理 Agent/工具 | 不随卡或存档导出/回溯，不进入 Tool/trace/生成媒体产物 |
| 生成图片 | save-runtime 稳定资产路径 | 前端、checkpoint | 二进制 Blob，跟随存档 |
| 图片当前可恢复版本 | workspace path + checkpoint manifest path→hash | restore | 同一逻辑图片只有一个当前版本 |
| `idle/generating/failed` | 前端内存 | 插图卡 | 不持久化；刷新后由资产存在性重建 |
| Object URL | 前端内存派生 | `<img>` | 替换/restore/unmount 时 revoke |

不另建一份“视觉快照”或长期 image job 表。插图请求随 turn history 已有稳定来源，已完成资产通过确定性路径即可恢复。

## 3. Shared Contracts

### 3.1 Storyteller block

```text
[[插图]]
{
  "title": "雨夜车站的重逢",
  "description": "坏掉的钟下，林澈隔着穿透雾气的列车灯认出了姐姐。",
  "sceneRef": "scene:old-station",
  "entityRefs": ["character:lin-che", "character:lin-yu"]
}
[[/插图]]
```

- block 是 `additionalProperties:false` 的 closed object，恰好四字段且不 coerce：title string trim 后 `1..80` UTF-16 code units；description string `1..500`；sceneRef string 总长 `1..120` 且严格 `scene:<localId>`；entityRefs 为 `0..12` string array，每项总长 `1..120` 且严格 `<type>:<localId>`，重复项去重保持首现顺序且重复本身不致 fallback。
- ref 恰好一个 colon；每个 segment `1..80` UTF-16 code units，不得为 `.`/`..`，不得含 whitespace、`/`、`\\`、NUL 或额外 colon，允许其它非空 Unicode。scene localId 和 entity type/localId 使用同一 rule，与 `update_entity` 安全边界一致或更严格。
- `title`、`description` 面向玩家；`sceneRef`、`entityRefs` 只供 Agent 精确读取，fallback 永不展示 refs。interactive validity 要求全部四字段合法；invalid object 仅读取 string title/description，不 stringify/coerce。
- UI runtime validator 只有一份：优先位于 `@tsian/play-bridge` 的窄 shared module/root export，或卡 UI 单一 helper；`@tsian/contracts` 保持 type-only。storyteller/image-director Prompt 自包含重述同一边界，platform storage/source-registration 只消费 generic raw projection string。
- block index 是 `projections.illustrations` 中按正文出现顺序得到的原始 0-based index，模型不提供 request id，invalid/超量 block 也不得让后续项重编号。
- JSON schema 只描述叙事画面，不包含最终 prompt 或 Provider 参数。
- storyteller 每个 opening/formal turn 要求 1–3 块。UI 只让正文顺序前 3 个 closed-schema valid block 可交互；更多 valid block 保留原位置但降级为不可交互描述卡，不发起调用或增加费用。完整 invalid block 沿统一 fallback/省略规则处理，所有 marker 外正文保留。

### 3.2 Shared runtime identity module

唯一 identity/normalization 算法归 `packages/play-bridge/src/generated-media-identity.ts`，并从 `@tsian/play-bridge` 包根导出；同包可另以窄 `illustration-brief` runtime module 提供 UI 唯一 validator/type。`GeneratedMediaTurnProjectionGuard` 的 shared identity 可以由该 module 导出；由于 `InvokeAgentRequest` 是 contracts 的 serializable wire shape，contracts 可声明必要的等价 guard data shape，并由 play-bridge type-consume/re-export，禁止第二套 runtime normalizer/hash/canonical encoding/path 算法。`platform-web` 新增该包的真实 workspace dependency 与 TS path。`@tsian/contracts` 只放 `InvokeAgentRequest.generatedMediaSourceGuard`、`GameCardRuntimeEntrypoints.imageGeneration`、`AgentPlatformToolName` 等必要共享数据 shape，不承载 validator、hash、canonical encoding、path 等 runtime 算法。

该模块拥有并导出：

- `GeneratedMediaTurnProjectionGuard` 与严格 runtime normalizer；V1 shape 固定为 `{ kind: "turn-projection", turn, projectionKey: "illustrations", index, fingerprint }`；
- `fingerprintProjectionRaw(raw)`：对 projector `$1|trim` 得到、已经持久化在 `projections.illustrations[index]` 的**原始字符串本身**做 UTF-8 SHA-256，输出 `sha256:<64-lowercase-hex>`；绝不 JSON.parse、字段排序、Unicode/空白重写或 re-serialize；
- NUL 分隔 identity preimage、`deriveTurnProjectionIdentityKey(guard)` 与 `generatedMediaAssetPath(identityKey)`；
- 一组跨 host/frontend/storage 共用的 golden vector 测试。

```text
rawProjection = {"title":"雨夜","description":"重逢","sceneRef":"scene:station","entityRefs":[]}
fingerprint = sha256:d5d01760ea67ebb81076c3d7e7a34d966e3766d4f3b51f5927441292c3ea54a4

preimage = UTF-8(
  "tsian-generated-media-turn-projection-v1" NUL
  "12" NUL "illustrations" NUL "0" NUL fingerprint
)
identityKey = tp-v1-9ddcb65606a53538f1eb2cba492e8874519a29d0f3065f378ccafe4b5318f2b3
assetPath = save/assets/generated/tp-v1-9ddcb65606a53538f1eb2cba492e8874519a29d0f3065f378ccafe4b5318f2b3
```

UI 从 raw projection body 调 shared helper，得到 `fingerprint → sourceGuard → identityKey → assetPath`。每次沉浸阅读器调用必须把 `assetId: identityKey` 与完整 guard 放进 image-director request JSON，并把逐字段相同的 guard 放入 play-bridge `InvokeAgentOptions.generatedMediaSourceGuard`；SDK 将其映射到 `InvokeAgentRequest.generatedMediaSourceGuard`，remote bridge 用 shared strict normalizer 拒绝畸形/extra 字段。Agent 只校验并原样传递 input 中的 `assetId`/guard；不得自行 hash、canonicalize 或发明 id。Host 不信任 Agent input/result 回显：它把 strict-normalized invoke request option 捕获为 invocation-authoritative `requiredSourceGuard`，并在付费 Provider 请求前用同一 helper派生 identity/path、要求 Tool guard 完全一致且 `assetId` 匹配。

### 3.3 Image-director request/result

前端发送严格 JSON：

```json
{
  "schema": "tsian.image-director.request.v1",
  "assetId": "<shared-helper-derived-identityKey>",
  "sourceGuard": {
    "kind": "turn-projection",
    "turn": 12,
    "projectionKey": "illustrations",
    "index": 0,
    "fingerprint": "sha256:<64-lowercase-hex>"
  },
  "prose": "完整来源回合 clean prose",
  "brief": {
    "title": "雨夜车站的重逢",
    "description": "坏掉的钟下，林澈隔着穿透雾气的列车灯认出了姐姐。",
    "sceneRef": "scene:old-station",
    "entityRefs": ["character:lin-che", "character:lin-yu"]
  }
}
```

成功 result 固定为 `{ schema, status: "completed", assetId, sourceGuard, asset: { path, mediaType } }`。`image-director` 从已验证 request 回显 `assetId` 与完整 guard，并把 Tool 成功结果的 `path/mediaType` 放入 `asset`；Tool 本身不回显 guard。前端严格核对 result 的 `assetId`/guard 与 pending request，但该回显只做 UI correlation。加载 authority 始终是 shared helper 从 pending guard 派生的 `assetPath`，随后重新 `workspace.read`；任意 Agent result path 都不能决定读取目标。durable commit authority 则只来自 invoke option 的 host closure 与 source registration/exact-source CAS，绝不来自 Agent 回显。

### 3.4 Card runtime image capability

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

这是唯一冻结 shape，不增加 descriptor。沉浸阅读器 manifest 声明 `{ "agentId":"image-director", "protocol":"tsian.image-director.v1" }`；contracts、local/package normalizers 和 host bridge 显式验证/复制 object。frontend ready/init 缓存 capability，只有 exact protocol v1 与合法 agentId 才启用交互，Agent id 只从 object 读取；pending/missing/malformed/wrong/unknown protocol 从首帧 fallback。旧卡无字段兼容。该 card capability 与平台 `PlatformConfig.imageGeneration` Provider 配置是两条独立合同，不能混淆。

### 3.5 InvokeAgent authority contract

`InvokeAgentRequest` 与 play-bridge `InvokeAgentOptions` 增加同名可选字段：

```ts
generatedMediaSourceGuard?: GeneratedMediaTurnProjectionGuard
```

该命名描述通用 generated-media 来源，不编码 `image-director`、agentId 或 purpose。play-bridge 将 options 字段原样送入 RPC request；remote bridge 必须 strict-normalize closed V1 shape，拒绝 unknown fields、非 canonical number/string 与任何畸形值，不能静默丢弃后继续 unguarded invoke。host `invokeAgent` 在进入 Agent runtime 前保存 normalized guard，并在绑定 `generate_image` runner 时形成 `requiredSourceGuard` closure。沉浸阅读器同时把同一 guard 放进 Agent input JSON，供 Agent 执行与 UI result correlation；两份数据用途不同，host authority 只认 option。

Runner 行为矩阵：

| invoke option | Tool `sourceGuard` | Host behavior |
|---|---|---|
| absent | absent | ordinary write；保持通用 Tool 与正式 turn direct Tool 兼容 |
| absent | valid | Tool-owned guarded path；按 Tool guard 验证/registration |
| absent | malformed | Provider 前 `IMAGE_INVALID_ARGUMENTS` |
| present/valid | omitted | Provider 前 `IMAGE_INVALID_ARGUMENTS`；零 write，不降级 |
| present/valid | 任一字段 mismatch | Provider 前 `IMAGE_INVALID_ARGUMENTS`；零 write，不降级 |
| present/valid | exact match, but wrong `assetId` | Provider 前 `IMAGE_INVALID_ARGUMENTS`；零 write，不降级 |
| present/valid | exact match + derived `assetId` | 以 invocation option guard（不是 Tool object）作为 guarded handoff authority |

该规则不读取 `agentId`/`purpose` 字符串，也不把所有通用 Tool 调用变成 guarded。合法路径中 guarded metadata 只可能由 host-required-and-validated option path，或在 option 缺失时由合法 Tool self-guard path 产生。

### 3.6 Platform Tool and guarded handoff

`generate_image` 接收 Provider-neutral 输入：

- prompt；
- `aspect: "landscape" | "portrait" | "square"`；
- 必填 `assetId`；
- optional `sourceImagePaths?: string[]`：`1..4` 个普通 workspace/save-runtime 图片引用。存在时平台走无 mask `/images/edits`，用于让 Agent 参考已有角色/场景图片保持视觉一致性；缺失时走 `/images/generations`。MVP 不支持 mask/局部重绘，因为这更偏人类手动编辑；
- 平台 Tool 全局 optional 的 `sourceGuard`。MVP `image-director` use case 必须提供完整 turn-projection guard，其它通用 Agent 可省略。

Tool 成功结果严格只有 `{ path, mediaType }`，不含 guard、assetId、prompt、Provider/model、URL 或 bytes。无 invoke-required guard 且 Tool 无 guard时，host 用 `identityKey = assetId` 与 shared path helper 后执行 ordinary `transaction.write`，保持既有提交语义；无 invoke-required guard但 Tool 自带合法 guard时仍进入 guarded path。

任何 guarded path 都先严格 normalize 并用 shared helper 在付费前验证 `assetId`/path 绑定。若来自 `invokeAgent` option 的 `requiredSourceGuard` 存在，Tool 必须同时提供逐字段相同的 `sourceGuard`；省略、任一字段 mismatch 或错误 assetId 均返回 `IMAGE_INVALID_ARGUMENTS`，且 Provider 调用与 write/handoff 计数均为零，不允许回退 ordinary write。完全匹配时，host 必须丢弃 Tool object 的 authority，只把 invocation option closure 中的 normalized guard用于 guarded staging handoff：

```ts
{ identityKey, assetPath, blob, sourceGuard }
```

平台任务不把 `sourceGuard` 扩展进 `RuntimeWorkspaceTransaction`，不定义 durable/storage-facing `GeneratedMediaCommitMetadata`，也不读取或解析权威 turn projection。该 handoff 进入一致性子任务拥有的 card-agnostic platform-host source-registration seam：后者读取精确 turn 文件并验证 generic projection，然后调用 storage transaction `writeGeneratedMedia({ identityKey, assetPath, data, source: { path, expectedRevision } })`。storage metadata 不含 `sourceGuard`，storage 也不解析 projection。

## 4. Child Ownership

### Child 1 — Platform image generation

拥有：配置类型和 UI、adapter、测试生成、平台 Tool schema/权限、`packages/play-bridge/src/generated-media-identity.ts` 唯一 shared runtime helper、`InvokeAgentRequest`/play-bridge options/remote normalizer 的通用 guard 传播、invokeAgent runner 的 `requiredSourceGuard` closure、guard 规范化/付费前 `assetId` 绑定、无 option+无 Tool guard ordinary write、无 option+合法 Tool guard guarded path，以及 option-authoritative guarded host handoff `{ identityKey, assetPath, blob, sourceGuard }`。

不拥有：权威 turn projection 读取/解析、storage-facing `GeneratedMediaCommitMetadata`、`RuntimeWorkspaceTransaction` 的 sourceGuard metadata、checkpoint manifest 更新算法、具体插图标签、image-director Prompt 或卡前端。

### Child 2 — Save consistency

拥有：正式 turn 增量提交语义、card-agnostic platform-host source-registration seam、storage-facing `{ identityKey, assetPath, source:{path,expectedRevision} }` metadata、来源有效性检查、checkpoint path-level patch、restore race、旧 Blob GC、并行 trace/canonical slot。

不拥有：Provider 调用、Tool schema、卡业务字段或视觉 UI。

### Child 3 — Card protocol and Agent

拥有：插图 closed block schema、自包含 storyteller / opening delegation Prompt、projection rule、image-director、protocol-versioned card capability、卡 manifest；消费 shared identity helper/data contract，不实现第二份 identity 算法；与 UI child 共同确保 runtime validator 只有一份。

不拥有：平台 secret、存储 commit 实现、前端交互。

### Child 4 — Inline UI

拥有：segment parser、唯一 brief runtime validator 的消费/实现、ready/init exact-v1 reactive capability、前三个合法 block 交互上限、整卡付费激活体验、双通道 authority 调用（Agent input `assetId+guard` 与 invoke options 相同 `generatedMediaSourceGuard`）、invokeAgent 并发调用、Agent result correlation、authoritative path 重读、Blob 读取/Object URL、大图、task-owned 双源同步，以及确定性 repack tooling/root command。该 tooling scope 还拥有先修 `apps/platform-web/src/storage/game-card-packages.ts:685-689` 的 exporter 文本 size：以 `strToU8(file.content).byteLength` 或等价 `TextEncoder` UTF-8 byte length 替代 `content.length`，并为 ASCII/中文/emoji 文本和 binary entry 增加回归；直接 import shared helper 派生 guard/identity/path。

不拥有：Provider 请求、checkpoint 直接修改、Prompt 编排或 UI-local canonical/hash/path 算法。

## 5. Persistence and Concurrency Strategy

### 5.1 Formal turn commits

当前正式 turn 在 LLM 调用前取得 workspace 快照，结束时整表替换。异步图片若在其间提交，会被陈旧快照删除。子任务 2 必须把正式 turn 改成基于显式 `RuntimeWorkspaceChanges` 的增量/CAS 合并：

- 正式 turn 只提交自己写入/删除的路径；
- 对未触及路径保留提交时数据库当前值；
- 对同路径并发冲突使用明确的 compare-and-swap 或可重试策略，不能静默覆盖；
- after-turn checkpoint 从提交后的合并状态构建。

### 5.2 Guarded source registration and checkpoint patch

不能调用现有 `current-turn-auto` 去重建来源 turn checkpoint，因为长耗时调用结束时当前 workspace 可能已经是未来 turn 状态。正确方向是：

1. `invokeAgent` host 从 strict-normalized option 捕获 authoritative `requiredSourceGuard`；runner 要求 Tool `sourceGuard` 存在且逐字段匹配，并用 shared helper 在付费前重算 guard identity/path、验证 `assetId`。省略/mismatch/错误 assetId 都 `IMAGE_INVALID_ARGUMENTS`、零 Provider/零 write且不降级。option 缺失时，Tool 无 guard走 ordinary write，合法自带 guard仍可走下述 guarded registration。
2. 图片验证后只交出 `{ identityKey, assetPath, blob, sourceGuard }`；required option 路径中的 `sourceGuard` 必须取自 invocation closure，Tool 字段只做一致性检查。
3. 一致性任务的 platform-host source-registration 读取精确 `save/history/turns/turn-NNNNNN.json`，generic 解析 assistant `projections[projectionKey][index]`，用 shared helper 对 raw projection string 重算 fingerprint，并计算完整 turn file UTF-8 SHA-256 revision。
4. source-registration 调 storage transaction `writeGeneratedMedia({ identityKey, assetPath, data: blob, source:{path,expectedRevision} })`；storage 不接收 sourceGuard、不解析 projection/card schema。
5. durable commit 在同一 Dexie 事务中验证 exact source path/revision 与 target CAS；若来源已不存在或改变，整个图片结果零写入并返回 stale/cancelled 语义。
6. 若来源有效，将图片 workspace row 写入当前状态，并只对仍保留且 `checkpoint.turn >= sourceTurn` 的 checkpoint manifest 更新该 asset path 的 hash；不重建其它路径，不新建已 prune checkpoint。
7. 重生成同路径时，相关 manifest 的 path hash 同步切换到新 hash；事务完成后扫描 workspace + remaining manifests 回收旧 hash。

该机制是 card-agnostic “generated media path patch”。平台任务仅拥有 optional guard 规范化、identity 绑定与 guarded staging handoff；一致性任务拥有从 guard 到 exact-source metadata 的转换和 storage 最终权威合同。

### 5.3 Restore race

restore 与图片 commit 必须按 save 串行化或在同一事务中用 branch/version signature 检测：

- restore 先发生：source guard 失败，迟到图不回写已放弃分支；
- media commit 先发生：restore 根据已更新 manifest 恢复；
- 两者不得产生 workspace 有图而 checkpoint 未更新的半提交。

### 5.4 Parallel images

三个不同 canonical slots 可同时运行；不同稳定路径按路径级增量合并。禁止并发目录级删除。每个 trace path 加 invocationId，避免同 Agent 同毫秒碰撞。

## 6. Failure Semantics

- 插图 JSON 无效：投影/正文照常保存；完整 block 由前端拦截，不把 marker/原始 JSON 交给 Markdown。object-invalid fallback 仅读取原值为 string 且在 title/description 长度边界内的字段，不 coerce；任一可用即渲染不可交互描述块，否则省略；refs 永不显示。
- card image capability pending/缺失/malformed/错误或未知 protocol：otherwise-valid 插图卡从首帧不可生成但正文正常；开发/卡配置诊断指出原因。旧卡无字段继续正常游玩。
- Provider 未配置：Tool 返回 `IMAGE_PROVIDER_NOT_CONFIGURED`。
- invokeAgent required guard host contract 不可用、remote option 畸形、Tool 漏 guard、任一 guard 字段 mismatch 或 `assetId` 不等于 required guard identity：当前 invocation/card 以 `IMAGE_INVALID_ARGUMENTS` fail；任何 Provider fetch、ordinary write、guarded handoff 或 checkpoint patch 均为零，不得按 agentId/purpose 特判或降级。
- Provider policy/network/response failure：对应 invocation 失败，transaction discard，正文与旧图不变。
- URL 下载或 MIME 验证失败：不写资产。
- 重生成失败：旧 workspace row/hash/图片保持不变。
- stale source：结果丢弃，不把废弃分支复活。
- 其它并发图失败：不影响已成功图片。

## 7. Compatibility and Packaging

- 历史 turn 没有插图块时按普通 Markdown 渲染。
- `displayContent` 缺失时继续回退 `content`。
- 增加可选 protocol-versioned card image capability，不要求所有卡配置；旧卡无字段继续兼容。
- 两棵 frontend source 只同步 task-owned shared files，禁止整树覆盖。`npm run build --workspace play-frontend-dev` 只做开发构建检查，其 dist 不是 checked-in card authority。
- UI child 在实施时新增 deterministic repo script（默认 `scripts/repack-game-card.mjs`）和根命令 `npm run repack:immersive-reader`。在依赖 exporter inventory 前，先修 `apps/platform-web/src/storage/game-card-packages.ts:685-689`：文本 workspace entry 的 `size` 必须等于 `strToU8(file.content).byteLength` 或等价 `TextEncoder` 结果，binary entry 使用其实际 bytes；export/import inventory 的 size 统一指解压 ZIP entry payload `Uint8Array.byteLength` 而非压缩 archive size，不改变字段可选性或其它 import 契约。以 ASCII、中文、emoji 文本与 binary fixture 锁定。若 Node 不能直接调用 browser esbuild-wasm，就用 Playwright 临时/隔离 IndexedDB profile 驱动 card source → `buildFrontend` (`engine.ts:272`) → `writeBackDist` (`write-back.ts:55`) → 修正后的 `exportGameCardPackage` (`game-card-packages.ts:660`)；下载并确定性解包，原子替换 dist、删除 stale hashes，从磁盘重算 workspace/frontend/cover inventory 与必要版本，拒绝 missing/extra/duplicate/type/size mismatch，输出可重复 inventory，并与 exported/checked-in/disk inventory 双向比对后验证 packaged iframe。由于改动 `apps/platform-web`，UI child 必须运行 `npm run build:web`。
- `npm run package:frontend` 只打 standalone source frontend package，不是 checked-in card repack，也不是平台真实 builder 验证；禁止手工复制。
- 本轮只修改当前沉浸阅读器卡的 workspace/Agent 协议，不同步到平台默认空白卡的 workspace template；默认模板接入属于后续独立消费端。
- 不迁移旧存档，不添加多版本画廊数据。

## 8. Rollback

- 平台能力可通过移除配置页面、Tool schema/adapter 和新增 config 字段回滚；secret 没有进入卡或存档。
- 卡协议可通过移除 entrypoint、Agent、projection rule 和 Prompt 约定回滚；旧 turn 中未知 marker 应由前端 fail-soft 清理策略保证可读。
- UI 可退回纯 Markdown NarrativeMessage；图片资产即使残留也不影响正文。
- UI/repack 回滚必须把 exporter UTF-8 size 修复、对应 ASCII/中文/emoji/binary 回归和 repack/inventory 脚本作为同一交付单元处理；不得只回退 exporter 而继续信任 exported/checked-in/disk size 对比。
- 存储一致性改动必须具备独立行为测试和可逆 seam；不能通过恢复整表替换语义来“快速回滚”而重新引入已知 lost update。
