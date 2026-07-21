# 技术设计：正文内嵌插图交互

## 1. 目标与边界

本设计只覆盖沉浸阅读器 play frontend：从最终 assistant 展示文本中识别插图 block、在正文原位渲染交互卡、调用卡级 image entrypoint、读取稳定 Blob 资产、恢复/清理 UI 状态，并同步开发源与卡内源。交付 tooling 另在冻结 scope 内修复平台卡包 exporter 的 UTF-8 inventory size 并提供确定性 repack。

平台 Provider、`generate_image`、Agent prompt、持久化提交、source guard 与 checkpoint patch 由 parent 的 sibling tasks 提供。UI 不直接调用 Provider，不解释平台内部 image result，不写 checkpoint，不把 generation 当作 formal turn。

## 2. 已确认现状

### 2.1 两棵 frontend source

```text
apps/play-frontend-dev/src
cards/沉浸阅读器.tsian-card/frontend/src
```

本功能涉及的 `components/story/**` 在两棵 source 中当前相同，`useTsian.ts` 等任务相关 shared files 也一致；但两棵树并非可整树覆盖的镜像：卡内树有完整 setup UI，且 character/context 相关文件存在有意差异。因此实施采用“task-owned 文件等价编辑 + 定向 diff”，不采用目录复制。

### 2.2 当前 narrative path

```text
session history / turn completed
  → useTsian: assistant.displayContent ?? assistant.content
  → StreamItem(kind=assistant, content)
  → StoryView
  → NarrativeMessage
  → renderMarkdown(all content)
  → v-html
```

当前 settled `StreamItem` 没有稳定 turn 字段；live assistant id 基于 `Date.now()`，history id 基于 turn 和数组位置。streaming path 直接渲染 raw `streamingText`。`SceneImage` 只是静态占位组件。

### 2.3 可复用平台 seam

- `useSyncAfterTurn` 已提供 `tsian.card.entrypoints()` 与带 `invocationId` 的 `onAgentInvocation`/`invokeAgent` 模式。
- `tsian.workspace.read(path, "save-runtime")` 返回 `WorkspaceReadResult | null`；二进制图片 authority 是 `file.binary`。
- `StatusBar.vue` 已有 version token + stale URL revoke + replacement revoke + unmount revoke 模式。
- 现有 detail modal 提供暗色遮罩、Escape、backdrop close 视觉惯例，但没有可直接满足本需求的完整 focus-trap abstraction。
- Composer disabled 只由 `!ready || streaming || syncing` 决定；插图生成不得进入该条件。

## 3. 依赖合同与 Phase 0 Gate

真实集成前，parent Phase 0 与 sibling tasks 必须冻结同一份合同；UI 只 import/消费，不维护第二份算法。

| 合同 | UI 所需事实 | Gate 原因 |
|---|---|---|
| illustration entrypoint | `imageGeneration?: { agentId: string; protocol: "tsian.image-director.v1" }`；host allowlist 与 card manifest 传递 closed object，UI 只接受 exact v1 | 当前 contracts/host 只暴露 `playerTurn`、`postTurnMaintenance` |
| block schema | closed object 恰好 title/description/sceneRef/entityRefs，`additionalProperties:false`；精确长度/ref grammar/entityRefs 去重 | parser 不得自行宽松兼容或 coercion |
| raw fingerprint / identity / path | Import the sole implementation from `@tsian/play-bridge` (`generated-media-identity.ts`): exact persisted `$1|trim` string → UTF-8 SHA-256, strict guard, NUL identity, asset path | UI must not parse/re-serialize before hashing or implement field sorting/Unicode/whitespace canonicalization |
| stable UI invocation data | guard-derived `identityKey` is `assetId`; derive stable per-card context slot from that identity; every attempt still gets a fresh invocation id | do not confuse stable media identity with invocation correlation |
| Agent request/result | Agent input contains helper-derived assetId/full sourceGuard; the same guard is independently passed as `InvokeAgentOptions.generatedMediaSourceGuard`; Agent result echoes input identity only for UI correlation and nests Tool `{path,mediaType}`; result path is non-authoritative | UI verifies pending identity/guard then rereads helper-derived path; durable authority is not reconstructed from Agent output |
| invoke authority | `InvokeAgentRequest` / `InvokeAgentOptions.generatedMediaSourceGuard?` is generic and additive; remote strict normalization → host `requiredSourceGuard` closure; required mismatches are pre-Provider zero-call/zero-write | fail closed per card, never retry unguarded, never route by `agentId`/`purpose` |
| entrypoint capability | ready/init 读取并缓存 `{agentId,protocol}`；只有 protocol exact `tsian.image-director.v1` 且 agentId 合法才可交互；missing/invalid/unknown 首帧 fallback | never wait for click to discover absence or protocol mismatch |
| card repack workflow | root command frozen as `npm run repack:immersive-reader`; UI child first fixes platform exporter text size to actual UTF-8 ZIP entry bytes with ASCII/Chinese/emoji/binary regressions, then deterministic repo script drives isolated Playwright/browser build → write-back → corrected export → exported/checked-in/disk inventory verification | dev dist and `npm run package:frontend` are not checked-in card authorities; uncorrected exported inventory cannot validate Chinese workspace disk sizes |

以上合同已在本计划中冻结。静态 parser/card/lightbox 可先开发；只有 sibling 的 Tool/storage/Agent 实际 seam 尚未落地时，不得提前接线真实生成。

## 4. 数据流

```text
raw streaming turn-delta
  → projectStreamingIllustrationText(raw)
  → safe visible Markdown prefix only
  → NarrativeMessage(streaming)

frontend ready/init
  → tsian.card.entrypoints()
  → validate imageGeneration as {agentId, protocol:"tsian.image-director.v1"}
  → reactive capability cache
  → missing/invalid/unknown protocol marks otherwise-valid blocks fallback before first render

persisted assistant timeline item
  → displayContent ?? content + stable turn + raw projections.illustrations
  → parseNarrativeSegments(final text, raw illustration projections)
      ├─ markdown segment → renderMarkdown → local v-html
      ├─ extra valid / object-invalid visible fields → noninteractive fallback
      └─ first three closed-schema valid blocks → interactive illustration segment
          → shared play-bridge helper(exact raw projection, turn, original index)
          → guard + identityKey(assetId) + deterministic assetPath
          → registry entry(key=identityKey)
          → probe deterministic assetPath
          → if missing: whole-card description button
          → pointer/Enter/Space: invokeAgent side-channel
              ├─ Agent input JSON: assetId + sourceGuard + prose + brief
              └─ options.generatedMediaSourceGuard: same guard (host authority)
          → remote strict normalization → host requiredSourceGuard closure
          → required contract/mismatch rejection: current card failure, no unguarded retry
          → validate Agent result assetId/guard against pending (correlation only)
          → reread helper-derived workspace Blob
          → component-owned Object URL
          → image / lightbox
```

历史 reload、turn 0 与 restore 都重走 settled assistant path。不存在独立持久化 illustration UI record。

## 5. 模块与职责

建议文件边界如下；实际命名可遵守现有目录风格，但职责不得重新耦合到单个大组件。

### 5.1 Protocol parser and shared identity adapter

Pure parser code may live under `src/lib/`, but block validity must call one runtime validator rather than duplicating field rules across parser/components/request builder. Preferred ownership is a narrow `packages/play-bridge/src/illustration-brief.ts` module exported from `@tsian/play-bridge`; if implementation keeps it in the card UI, that helper is still the only runtime implementation. `@tsian/contracts` remains type-only. All runtime fingerprint/identity/path work is separately imported from the package's `generated-media-identity.ts`; UI code must not maintain a second canonicalization implementation. Platform storage/source-registration must not import the brief validator or parse the raw projection.

Responsibilities:

- validate the protocol sibling's exact closed schema through the sole runtime validator: title string trim length `1..80`, description `1..500`, sceneRef `scene:<localId>` and total `1..120`, entityRefs array `0..12` with each `<type>:<localId>` total `1..120`, first-occurrence dedupe, and `additionalProperties:false`;
- enforce ref grammar: exactly one colon; each segment `1..80` UTF-16 code units; neither `.` nor `..`; no whitespace, `/`, `\\`, NUL, or extra colon; other non-empty Unicode is allowed; never coerce field/item types;
- retain each complete marker's original `projections.illustrations` index and exact raw projection string;
- count closed-schema valid blocks in prose order and mark only the first three interactive; invalid blocks do not consume a valid slot; later valid blocks become fallback;
- call `fingerprintProjectionRaw(rawProjection)`, build the exact guard, derive `identityKey`, and derive `assetPath` through the shared package;
- use `assetId: identityKey` and full guard in the frozen Agent request;
- strictly validate Agent result `assetId/sourceGuard` against the pending request for UI correlation, while ignoring result path as authority and never treating the echo as commit authority;
- when invoking, pass the exact same guard in Agent input and `InvokeAgentOptions.generatedMediaSourceGuard`; do not derive required behavior from cached Agent id, purpose, or response fields.

The persisted raw projection string is hashed byte-for-byte as UTF-8 after projector `$1|trim`. Never hash text re-extracted from `displayContent`, JSON.parse then hash, sort fields, normalize Unicode/whitespace, or re-serialize. Parsed/normalized brief is for validation/display/request semantics only, not identity.

### 5.2 纯 helper：ordered segment parser

建议公开概念接口：

```ts
type NarrativeSegment =
  | { kind: "markdown"; key: string; content: string }
  | { kind: "illustration"; key: string; blockIndex: number; rawProjection: string; block: IllustrationBlock }
  | { kind: "illustration-fallback"; key: string; blockIndex: number; title?: string; description?: string }

function parseNarrativeSegments(
  text: string,
  rawIllustrationProjections: readonly unknown[],
): NarrativeSegment[]
```

设计约束：

1. 单次从左到右扫描，不用一个贪婪 regex 横跨多 block。
2. `blockIndex` is the complete marker's original 0-based index and therefore the index into the persisted `projections.illustrations` array; invalid/extra blocks still advance it and frontend filtering never renumbers later blocks. Interactive validity requires a string raw projection at that exact index; fingerprint/identity uses that persisted string, not text re-extracted from `displayContent`.
3. opening/closing marker 不支持嵌套；遇到当前 opening 后，只寻找下一个 closing。
4. 完整 JSON object 只有通过唯一 validator 的全部 closed-schema/type/length/ref validation 才是 valid；按正文 valid 计数只有前三个生成可交互 `illustration` segment，第四个及以后生成不可交互 `illustration-fallback`，但仍保留原 index。invalid block 不消耗前三个名额。
5. object-invalid fallback 仍只读取原值为 string 且 trim/长度合法的 `title` / `description`；至少一个可用时生成不可交互 fallback，两个都不可用时省略。不得 stringify/coerce，refs 永不显示。
6. JSON parse failure 或 parsed non-object 均省略整个 block；继续扫描并保留前后 Markdown，绝不把 marker/raw JSON 交给 Markdown renderer。
7. 未闭合 opening marker 从 marker 到文本末尾丢弃；无法确定完整边界时不尝试提取降级文案。
8. 孤立 closing marker 只移除 marker，周围文本保留。
9. 相邻 Markdown 可合并，但 segment key 必须基于稳定位置/内容，不使用随机数。
10. 空 Markdown 不生成无意义 DOM；全是不可解析/无可用描述的坏 block 时得到空 segments，而不是 raw JSON。

该 fail-soft 策略唯一确定为“可解析 object 且有原值为 string、trim/长度合法的 title/description → 不可交互描述块；否则省略”。invalid refs 与其它 schema 失败也不得保留生成能力。fallback 只承载玩家可读文案，没有 source identity、workspace probe、生成/重试/重新生成或 lightbox 行为。

### 5.3 纯 helper：streaming-safe projection

`turn-delta` 未经过 Reply Projection，不能直接交给 settled parser。建议每次对累计 raw streaming string 做确定性投影，而不是维护易漂移的增量 parser state：

```ts
interface StreamingProjection {
  visibleText: string
  bufferedSuffix: string
}

function projectStreamingIllustrationText(raw: string): StreamingProjection
```

算法要求：

- 完整 `opening … closing` 范围从 `visibleText` 删除；
- opening 已出现但 closing 未出现时，从 opening 开始都进入 `bufferedSuffix`；
- raw 末尾若是 opening marker 的真前缀（例如 `[[插`），该 suffix 暂存，防止 marker 跨 delta 闪现；
- 下一批累计文本到达后重算，普通文本才释放；
- 孤立 closing marker 从 visible text 移除；
- 不解析或渲染 streaming illustration component；
- turn end 丢弃该临时投影，以 persisted assistant `displayContent ?? content` 为唯一最终值。

为了避免 Markdown 重排，可在现有 streaming cadence 下只传安全 `visibleText`；不得把 `bufferedSuffix` 持久化或写回 history。

### 5.4 Reactive entrypoint capability and generation registry

At frontend ready/init, call `tsian.card.entrypoints()`, require `imageGeneration` to be a valid `{ agentId: string, protocol: "tsian.image-director.v1" }` object, and cache it reactively for the current bridge/card lifecycle. Refresh/clear it on card lifecycle changes as appropriate. Do not defer the first discovery to a paid-card activation.

- exact v1 capability + valid `agentId`: eligible first-three valid segments may enter registry/probe/generation, and invocation uses only `capability.agentId`;
- capability pending, missing, malformed, wrong/unknown protocol, or bridge error: all otherwise-valid segments render as noninteractive fallback from first render, with locatable developer diagnostics; 正文/Composer remain normal；old cards without the field remain playable;
- never hardcode `image-director` and never show a temporarily interactive card while capability is unknown.

Generation state must survive StoryView windowing unmount/remount within the page session, so use a module-level reactive Map keyed by helper-derived stable identity. It is not a global queue:

```ts
type IllustrationPhase = "idle" | "generating" | "ready" | "failed"

type IllustrationAttemptKind = "initial" | "regenerate"

interface IllustrationRuntimeState {
  phase: IllustrationPhase
  attemptKind: IllustrationAttemptKind | null
  attemptToken: number
  invocationId: string | null
  epoch: number
  hasAsset: boolean
  feedbackNonce: number
}
```

关键规则：

- registry 保存逻辑状态、attempt token、invocation correlation 与 restore epoch，不保存 Blob 或 Object URL。
- `idle + no asset` 激活为 initial；`ready + asset` 的低调入口激活为 regenerate。
- 同一 entry 的 `generating` 状态直接拒绝第二次调用；不同 entry 不共享锁。
- initial failure：`failed/hasAsset=false`，短暂反馈后视觉回 idle，但下一次可立即重试。
- regenerate failure：`ready/hasAsset=true`，旧图不变，只递增 feedbackNonce。
- Agent success 不直接使用 response URL/path；先严格比较 response `assetId/sourceGuard` 与 pending request，再确认 attempt token/epoch，随后按 shared-helper `assetPath` reread。
- `invokeAgent` 的每个 attempt 使用全新 `crypto.randomUUID()`（或既有 SDK-compatible 生成器）；稳定 identity 不复用为 invocationId。
- entrypoint capability 在 ready/init 已决定是否生成 interactive segment；fallback 不进入 registry、不创建 identity/probe、不接受激活、不显示生成/重试/重新生成操作。开发诊断保留可定位信息，玩家文案不暴露内部合同。
- 无需为了最终结果订阅 delta/tool events；如果订阅仅用于 correlation/诊断，必须在 `finally` unsubscribe，且不把 Agent delta/status 显示成卡片常驻文案。

### 5.5 `useTsian` 与稳定 source turn

settled assistant item 必须携带持久化 turn、display text 和 raw projection strings：

```ts
{
  kind: "assistant"
  id: string
  turn: number
  content: string
  illustrationProjections: readonly unknown[]
  tokens?: number
}
```

- history path 从 `SessionHistoryEntry.turn` 传入 turn，并从该 assistant item 的 `projections.illustrations` 保留原 array values；turn 0 同样处理。
- live path 从 `send()`/`turn-completed` 的最终 persisted assistant item/result 取得相同 `turn + display text + projections`；不得只用 streaming text 或重跑 marker body canonicalization。
- DOM item id 可以继续服务渲染，但不得用于 `identityKey`、contextSlot 或 asset path。
- `reloadHistory()` 与 live finalize 对同一个 persisted assistant 应得到相同 turn、display text 和 raw projection string array。
- 若最终事件缺少稳定 turn 或 persisted projections，必须先修复/收敛 bridge consumption；不得以当前数组位置、时间戳或 display marker body 静默回退生成持久资产身份。

`StoryView` 将 `turn` 传给 settled `NarrativeMessage`。streaming `NarrativeMessage` 无 turn 且永不渲染插图卡。

## 6. `NarrativeMessage` 渲染模型

settled 模式：

```vue
<div class="msg-body prose">
  <template v-for="segment in segments" :key="segment.key">
    <div
      v-if="segment.kind === 'markdown'"
      class="narrative-markdown"
      v-html="renderedMarkdown(segment)"
    />
    <SceneImage
      v-else-if="segment.kind === 'illustration'"
      :source-turn="sourceTurn"
      :block-index="segment.blockIndex"
      :block="segment.block"
    />
    <IllustrationFallback
      v-else
      :title="segment.title"
      :description="segment.description"
    />
  </template>
</div>
```

这里的 `v-html` 只接收 Markdown segment 的现有 renderer 输出；SceneImage 与不可交互 fallback 始终由 Vue template 创建。fallback 复用未生成卡的排版、颜色和边框语言，但使用非交互 `<aside>`/`<div>`，不设置 button/role=button/tabindex/aria-busy，也不注册 generation registry。不得生成自定义组件 HTML 再指望 Vue hydrate。

streaming 模式继续显示 EmberForge，但 content 先经过 streaming-safe projection，并且不创建 SceneImage。

Markdown segment 切分会影响段落边界，因此 parser 保留 block 周围原始换行；不要对每段无条件 `trim()`。可只在判空时检查 whitespace。

## 7. `SceneImage` 状态与视觉

### 7.1 mount/probe

组件取得稳定 identity/path 后立即 probe workspace：

- path 不存在：registry `hasAsset=false`，显示 description card；
- 有有效 Blob 且 `<img>` 可加载：`hasAsset=true`，显示图片；
- bridge/null/missing binary/zero bytes/decode error：fail-soft 为无资产；可记录开发诊断，不显示内部错误文案。

probe 需要 component-local load version。任何 await 后先比较 `loadVersion`、props identity 与 global epoch。

### 7.2 未生成与 initial generation

使用原生 `<button type="button">` 包裹 title/description。整卡是唯一 initial generation activation target；exact `aria-label` is `生成插图：${title}`. One explicit pointer/Enter/Space activation is consent for that paid generation attempt. Do not add a confirmation modal, fee copy, or visible “点击显影/生成插图” action row. Settings paid-test warning remains unchanged.

生成中保持 button/卡片 DOM 尺寸稳定，设置 `aria-busy="true"`，同时 native disabled 或事件 guard 防重复。若使用 `disabled` 会让浏览器移出焦点，应优先用 `aria-disabled` + guard 保持焦点，或在实现中验证 disabled 不造成焦点丢失。

视觉反馈使用低对比边缘亮度、纹理显影或轻微 veil，不显示 spinner 状态句。reduced motion 下改为静态边框/overlay。

failure feedback 用短暂 CSS class/nonce（例如柔和边框褪色），不改变卡片内容。定时器属于组件，unmount 时清理。

### 7.3 ready 与 regeneration

ready figure 包含：

- 主图片按钮：点击只开 lightbox；aria-label 如“查看大图：{title}”；
- `<img :alt="description">`；
- 独立低调 regenerate `<button>`，始终可由键盘/触控找到，在 pointer hover/focus-within 时可增强而不是从 DOM/无障碍树消失；
- regenerating overlay 不遮掉旧图，不改变 img URL；regenerate button guard 重复触发；
- regenerate failure 保持旧 URL；success reread 后才替换。

图片 source decode/error 后不可直接保留 broken-image UI；撤销 URL 并回到无资产卡。

## 8. Blob 与 Object URL 生命周期

Object URL 严格组件所有，不放入 module registry：

```text
load starts → ++loadVersion
read deterministic path
  → stale? return
validate binary Blob
createObjectURL(blob)
  → stale? revoke(newUrl), return
preload/decode image
  → stale/error? revoke(newUrl), return/fail-soft
revoke(oldUrl)
assign newUrl
```

以下路径必须调用 revoke：

1. 有效新图替换旧图；
2. create 后发现 loadVersion/epoch/identity stale；
3. decode/load 失败；
4. props source/path 改变；
5. restore invalidation；
6. `onBeforeUnmount`。

windowing 卸载旧 `SceneImage` 时 URL 会释放；重新挂载从 workspace reread 是预期行为。不要为了减少 reread 把 URL 提升为 singleton，否则组件卸载无法成为可靠 cleanup boundary。

## 9. invokeAgent 调用

伪代码表达已冻结的双通道职责；字段名以 sibling 的通用 `generatedMediaSourceGuard` 合同为准：

```ts
async function requestIllustration(entry, kind) {
  if (entry.phase === "generating") return

  const agentId = currentImageGenerationCapability().agentId
  if (!agentId) return // should already render fallback, never a paid-card discovery

  const epoch = currentIllustrationEpoch()
  const attemptToken = ++entry.attemptToken
  const invocationId = crypto.randomUUID()
  entry.phase = "generating"
  entry.attemptKind = kind
  entry.invocationId = invocationId

  try {
    const pendingRequest = buildFrozenRequestWithSharedHelper(entry.identity)

    const result = await tsian.invokeAgent(agentId, pendingRequest, {
      invocationId,
      purpose: "inline-illustration",
      contextSlot: entry.identity.contextSlot,
      persist: false,
      generatedMediaSourceGuard: pendingRequest.sourceGuard,
    })

    assertResultIdentityMatchesPending(result, pendingRequest)
    if (!isCurrent(entry, epoch, attemptToken)) return
    await requestAssetReload(entry.identity.assetPath)
  } catch (error) {
    if (!isCurrent(entry, epoch, attemptToken)) return
    applyInitialOrRegenerateFailure(entry, kind)
  }
}
```

- capability is loaded/validated reactively at ready/init, not fetched here for the first time;
- request includes helper-derived `assetId` and full guard; options carry that exact guard separately as authoritative `generatedMediaSourceGuard`;
- remote bridge strictly normalizes the option and host binds it as `requiredSourceGuard`; UI never uses `agentId` or `purpose` as authority signals;
- Agent result must echo pending `assetId/sourceGuard` for correlation only; Tool only supplied `{path,mediaType}` to Agent, and durable commit authority comes from host closure + source registration + exact-source CAS;
- response path remains non-authoritative; reread `entry.identity.assetPath` derived by shared helper;
- missing host support, bridge rejection, required/Tool mismatch, or wrong derived assetId fails only this attempt/card; never retry without `generatedMediaSourceGuard` and never fall back to an ordinary write;
- 不传 `checkpoint`、`injection`、legacy commit fields。
- `purpose` 是日志/UI label，不用来路由平台行为。
- Promise resolved 表示 workspace commit 已完成，随后读取资产；不靠 `completed` delta 提前读。
- 同一卡 initial/regenerate 调用不能重叠；不同卡的 Promise 不互相 await。

## 10. reload、restore 与竞态

### 10.1 普通 history reload

`reloadHistory()` 清空并重建 settled StreamItems。组件 mount 根据 identity probe 资产。registry 可在 reload 前按仍存在的 `identityKey` prune idle/ready entry；不能误取消真实平台 invocation，但页面刷新本来不会恢复前端后台任务。

### 10.2 checkpoint restore

在 StoryView restore orchestration 中：

1. restore 请求开始前 `invalidateIllustrations()`：全局 epoch `+1`，将 registry 中 in-flight attempt 标为 stale，通知 mounted SceneImage revoke URL；
2. 调平台 restore；
3. 成功后执行既有 `reloadHistory()`、runtime refresh/window reset；
4. 新 settled components 按恢复分支文本和 deterministic path probe；
5. 旧 Promise resolve/reject 时因 epoch/token 不匹配不得改新 UI或创建 URL。

平台 source guard 负责阻止迟到 commit 复活旧分支；UI epoch 只负责不显示 stale outcome，两者不能相互替代。

restore 失败时仍以平台当前 workspace 为 authority：reload/reprobe 或明确恢复当前组件读取，不能继续信任 restore 前 URL。具体与现有 restore error flow 对齐。

### 10.3 正在生图时继续故事

正式 turn 新增 history 不会清空 illustration registry；旧卡仍在窗口内时保持进度，windowing 卸载后 registry 仍持有 in-flight lock。Promise success 后资产已由平台持久化；若组件未挂载，不创建 URL，之后 mount 再 probe。

## 11. Lightbox 与 accessibility

建议独立 `IllustrationLightbox.vue`，复用现有 mask/card 视觉，但补足行为：

- 仅 ready image 可打开；生成 success 不自动打开；
- `role="dialog" aria-modal="true"`，`aria-labelledby` 指向 title；
- 打开前保存 trigger element；`nextTick` 后 focus close button/dialog；
- Tab/Shift+Tab 被约束在对话框可聚焦元素内；
- Escape、显式关闭按钮与 backdrop（只在 `event.target === event.currentTarget`）关闭；
- close/unmount 移除 keydown listener，并在 trigger 仍 connected 时 focus return；
- body scroll lock 如需实现必须引用计数/恢复原值，避免破坏已有 overlay；若当前 reader 容器而非 body 滚动，则只阻止 mask overscroll。

移动端使用 `100dvh`/安全 padding，图片 `max-width/max-height` + `object-fit: contain`。关闭按钮命中区至少约 44px。

## 12. 样式状态矩阵

| 状态 | 内容 | 可激活目标 | 运动 |
|---|---|---|---|
| idle/no asset | title + description；无费用/action row | whole-card pointer/Enter/Space generate, `aria-label="生成插图：<title>"`; activation is paid consent | 无 |
| initial generating | title + description + 低调 veil | 整卡锁定，保持焦点 | 轻微显影；reduced-motion 静态 |
| initial failed | title + description + 短暂失败边缘 | 整卡 retry | 最多短渐隐；reduced-motion 静态 |
| ready | 最新 image | image→lightbox；低调 regenerate | 无 |
| regenerating | 旧 image + 低调 overlay | image 可继续查看；regenerate 锁定 | 轻微；reduced-motion 静态 |
| regenerate failed | 旧 image + 短暂失败边缘 | image + regenerate | 同上 |

不显示“生成中/失败/重试”常驻句，不把不可见 hover 控件作为唯一入口。

exact-v1 capability 缺失或无效在 ready/init capability 阶段已确定；block 从首次 render 即输出不可交互 fallback，不进入状态机。

## 13. 双源同步与卡包构建

### 13.1 source 同步

1. 在 `apps/play-frontend-dev/src` 实现并 build；
2. 对任务触及的 shared files 在卡内 `frontend/src` 做等价变更；
3. 新增 shared file 两边同时创建；
4. 定向比较 task-owned 文件；
5. 不覆盖卡内 `components/setup/**`，也不覆盖已确认有意差异的 character/context files。

### 13.2 Frozen deterministic repack command

Development check:

```bash
npm run build --workspace play-frontend-dev
```

This is only a TypeScript/Vite check; its dist is not the checked-in card authority. Likewise `npm run package:frontend` only packages `apps/play-frontend-dev/src` as a standalone `.tsian-frontend.zip`; it neither updates `cards/沉浸阅读器.tsian-card/frontend/dist` nor verifies the platform browser builder.

The UI child tooling scope is frozen to add a deterministic repository script, default `scripts/repack-game-card.mjs` (a narrower image-task helper is acceptable only if exposed through the same command), and root script:

```bash
npm run repack:immersive-reader
```

Before that command may trust exported inventory, this same child must fix `apps/platform-web/src/storage/game-card-packages.ts:685-689`: text workspace entries use `strToU8(file.content).byteLength` or equivalent `new TextEncoder().encode(file.content).byteLength`, never UTF-16 `content.length`. Export/import inventory `size` uniformly means the corresponding uncompressed ZIP entry payload `Uint8Array.byteLength`, not compressed archive size; preserve existing field optionality and all other import behavior. Add regressions covering ASCII text, Chinese text, emoji text (including surrogate pairs), and binary entries; assert manifest inventory size equals the uncompressed entry byte length read from the ZIP and remains consistent across import/export inventory. Because this changes `apps/platform-web`, `npm run build:web` is mandatory.

Inputs:

- `cards/沉浸阅读器.tsian-card/frontend/src/**`;
- the card's `workspace/**` and cover files;
- current `cards/沉浸阅读器.tsian-card/game-card.json`.

Execution algorithm:

1. stage/import the current card package/source in a temporary directory; never copy either frontend source tree wholesale and never copy dev dist into the card;
2. if browser `esbuild-wasm` cannot be called directly from Node, start `platform-web` with Playwright in a temporary/isolated IndexedDB browser profile;
3. import the card/package source and invoke the production path `buildFrontend` (`apps/platform-web/src/frontend-build/engine.ts:272`);
4. let `writeBackDist` (`apps/platform-web/src/frontend-build/write-back.ts:55`) replace the complete IndexedDB `frontend/dist/**` set and remove stale hashed outputs;
5. call the corrected `exportGameCardPackage` (`apps/platform-web/src/storage/game-card-packages.ts:660`) only after the UTF-8/binary entry-size regression passes, so package inventory is generated dynamically from actual IndexedDB contents using actual ZIP entry bytes, then download the zip;
6. deterministically unpack to a staging directory, verify normalized unique paths, and atomically replace checked-in `frontend/dist/**` rather than incrementally copying hashes;
7. scan repository disk and regenerate all `workspaceFiles`, `frontendFiles`, and `coverFiles` entries with path, mediaType, actual UTF-8/binary byte size matching the ZIP-entry definition, and the one necessary integrated card version bump; reject missing, extra, duplicate, type/size mismatch, or dangling frontend entry;
8. emit a path-sorted repeatable inventory, run twice/golden-compare as needed, compare corrected exported inventory bidirectionally with both checked-in manifest and disk inventory, and load the packaged iframe through the bridge.

The checked-in deliverable is therefore two-stage: task-owned file synchronization in both source trees, followed by deterministic card repack plus real platform-builder validation. There is no maintainer-choice branch or temporary manual-copy fallback.

## 14. 验证策略

当前 `play-frontend-dev` 没有已确认的专用测试 runner。不要在本 UI 子任务里顺带引入全仓测试框架，除非实施前另行批准。优先：

1. 若当时已有可用 Vitest/同类 runner，将 parser、stream projection、identity wrapper、registry transition 做 table-driven unit tests；
2. 若仍无 runner，编写可重复的临时 TypeScript/browser probe 或最小 fixture（不把一次性产物提交），并保留 case/result；
3. dev build + card package build；
4. packaged iframe 浏览器矩阵做真实 bridge/workspace/lightbox 验收。

纯函数/集成用例至少包括：0/1/3/4+ block、block 位于首/中/尾、相邻 block、malformed JSON、closed-schema/type/UTF-16 length/ref/extra-field invalid、entityRefs 0/12/13 与重复首现去重、object-invalid non-coercing fallback、parse failure omission、前三个 valid 交互与后续 valid 零调用 fallback、原 projection index 保留、raw fingerprint golden vector、identity/content changes、未闭合/孤立 marker、stream prefix、ready/init capability valid/missing/malformed/wrong/unknown protocol、dual-channel equal guard、result identity mismatch、missing host contract/bridge rejection/current-card isolation。Unicode/空白样例断言 brief ref validator 遵守冻结 grammar，并断言 identity helper 只对 exact persisted raw string bytes 计算而不 JSON normalization。host integration fixture 另覆盖 required option + Tool omitted guard/wrong guard/wrong assetId 的 pre-Provider zero-call/zero-write、exact required match success、no option + no guard ordinary compatibility、no option + valid self-guard 与 formal direct compatibility，并证明不按 `agentId`/`purpose` 路由。卡包 exporter 另以 ASCII、中文、emoji 文本和 binary ZIP entries 断言 inventory `size` 等于实际 entry bytes；中文/emoji 样例必须证明结果不同于 UTF-16 `content.length`，且 import/export inventory 仍遵守同一定义。

## 15. Failure Semantics

| Failure | UI result |
|---|---|
| exported inventory text `size` used before exporter fix | UTF-16 `content.length` makes Chinese/emoji differ from ZIP/disk bytes, so exported/checked-in/disk comparison is invalid; block repack, fix exporter, and require ASCII/Chinese/emoji/binary regressions plus `build:web` |
| invalid JSON | 省略整个 block，周围正文保留，无调用 |
| closed-schema/invalid ref 且 object 有可用 string title/description | 不 coerce；渲染不可交互同风格 fallback，无 identity/probe/调用；refs 不显示 |
| closed-schema/invalid ref 且无可用 string title/description | 省略整个 block，周围正文保留，无调用 |
| extra closed-schema valid block after first three | 渲染不可交互描述 fallback；保留原 projection index；无 registry/probe/调用/Provider 成本 |
| capability pending/missing/malformed/wrong or unknown protocol at ready/init | 从首帧降级为不可交互描述块：有可用 string title/description 则展示，否则省略；无 identity/probe/调用/生成/重试/重新生成/lightbox |
| Agent result assetId/guard mismatch | 当前 attempt failure；echo 只作 correlation；不读取 result path，不更新图片 |
| missing generatedMediaSourceGuard host contract / remote strict rejection | 当前卡 initial failure 或 regenerate 保留旧图；不做无 guard retry，不影响其它卡/Composer/formal turn |
| required option 与 Tool guard/derived assetId mismatch | host pre-Provider `IMAGE_INVALID_ARGUMENTS`；Provider=0、ordinary/guarded write/handoff=0；UI 只应用当前卡 failure |
| invoke rejected/provider failure | initial 回 description；regenerate 保留旧图 |
| success but path missing | 同 attempt failure，不能用 response 任意 path 补救 |
| missing/empty/non-image Blob | fail-soft；old image exists 时继续保留 old URL |
| created URL becomes stale | 立即 revoke，不更新 UI |
| restore during invocation | epoch invalidates old callback/URL；新分支重建 |
| one of three cards fails | 只影响对应 registry entry |
| lightbox source replaced | 同一 source 展示最新 URL；若 source invalidated 则关闭 dialog |

开发诊断不得含 prompt、Provider body、secret 或 image bytes；玩家文案不暴露内部合同。

## 16. Rollback

- renderer 可回退为 NarrativeMessage 全文 Markdown；历史中的 marker 仍需保留 fail-soft 清理，避免 raw 协议泄露。
- SceneImage/registry/lightbox 可独立移除；已持久化资产变为未引用文件，不影响正文或 formal turn。
- stable turn 字段是渲染元数据，可随 UI 回滚，但不得改变 persisted timeline schema。
- source、dist、manifest inventory、平台 exporter UTF-8 size 修复及其 size 回归必须作为同一 repack 交付单元回滚；不得保留依赖旧 `content.length` inventory 的脚本或三方对比结论。
- 双源回滚必须同时回退 task-owned files，并重新构建卡内 dist/inventory，不能只回退 dev source。
