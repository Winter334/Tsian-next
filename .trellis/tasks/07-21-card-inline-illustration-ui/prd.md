# 正文内嵌插图交互

## Goal

在沉浸阅读器的 assistant 正文原位置渲染插图描述卡，让玩家按需并行生成插图、失败后重试、保留旧图重新生成，并通过沉浸大图查看结果；历史重载与 checkpoint restore 后，界面必须从最终 `displayContent` 和稳定 workspace 图片资产恢复，而不是依赖一次性的组件内存。

## Requirements

### R1. 最终正文按有序 segment 渲染

- 插图正文位置来自 settled assistant 的 `displayContent ?? content` 中 `[[插图]] ... [[/插图]]` marker；对应 identity/validation 的 raw body 来自同一 assistant item 的 `projections.illustrations[index]`。平台不新增正文插图专用 timeline 字段。UI 按完整 marker 出现顺序关联原 projection index，不因 invalid/extra block 重新编号。
- 前端将一条正文解析为有序 `markdown | illustration | illustration-fallback` segments。Markdown segment 可继续通过现有 Markdown renderer 输出局部 `v-html`；可生成 illustration 与不可交互 fallback 都必须由真实 Vue 组件渲染，禁止把卡片字符串塞进 `v-html`。
- 插图 block 必须由 UI 唯一 runtime validator 按 protocol sibling 的 closed schema 校验：恰好 `title`、`description`、`sceneRef`、`entityRefs` 四字段且 `additionalProperties:false`；title trim 后 `1..80`、description `1..500` UTF-16 code units；sceneRef 总长 `1..120` 且严格 `scene:<localId>`；entityRefs 为 `0..12` string，每项总长 `1..120` 且严格 `<type>:<localId>`，去重保持首现顺序。所有 ref 恰好一个 colon，segment `1..80`，不得为 `.`/`..`，不得含 whitespace、`/`、`\\`、NUL 或额外 colon，允许其它 Unicode 非空字符。UI 不 coerce；该 validator 优先消费 `@tsian/play-bridge` 窄 shared runtime module，或由卡 UI 单一 helper 实现，禁止第二份 runtime validator。
- fingerprint、identity、asset path 必须直接消费 `@tsian/play-bridge` 唯一 shared runtime helper，不在 UI 内重写 canonicalization/hash/path 算法。
- 非插图正文、没有 `displayContent` 的历史消息、turn 0 与普通历史 turn 均保持现有阅读体验；settled frontend item 必须同时保留 source turn 与 raw `projections.illustrations` string array，供 shared helper 使用。
- storyteller 要求每回合 1–3 块；UI 按正文顺序只让最先三个 closed-schema valid block 可交互。第 4 个及后续 valid block 转为不可交互 description fallback，不发起 Agent 调用、不增加 Provider 成本；invalid block 不占三个 valid 名额，所有周围正文继续。
- 完整 marker JSON 成功解析为 object 但 closed schema 无效时，只读取原值为 string 且 trim/长度合法的 `title` / `description`，不 stringify/coerce；任一可用则渲染不可交互同风格描述块，两者都不可用则省略。JSON parse 失败或解析为非 object 时省略。refs 永不展示，raw marker/JSON 永不进入 Markdown，所有降级保留前后 Markdown。
- settled 内容中的未闭合 opening marker 从 opening marker 起抑制到消息末尾；孤立 closing marker 本身被移除。任何可识别的插图控制 marker 都不得作为普通正文展示。

### R2. 流式输出不得泄露半成品协议

- Reply Projection 只在 turn end 的最终完整回复上执行；流式 `turn-delta` 仍视为未投影的 raw text。
- streaming render 使用独立的安全投影器：完整插图 block 从流式可见文本中移除，未闭合 block 及可能继续成长为 opening marker 的末尾前缀暂存，不渲染插图卡，也不允许 marker/JSON 闪现。
- turn end 后以持久化 assistant `displayContent ?? content` 一次性替换 streaming render，再解析并渲染可交互插图卡。
- 流式过滤不得吞掉完整 block 前后的普通正文，也不得改变最终持久化内容。

### R3. 生成前、生成中与首次失败体验

- 未生成卡只显示 `title + description`，没有“生成插图”“点击显影”“重试”、费用或其它常驻操作行；整卡是原生可激活控件。
- 一次明确 pointer、Enter 或 Space 整卡激活即表示玩家同意该次会产生真实 Provider 费用的生成尝试；不增加确认 modal。精确 accessible intent 是 `aria-label="生成插图：<title>"`。
- 卡片必须有可见 `:focus-visible`、原生 Enter/Space 语义和足够触控命中区。Settings 测试按钮的显式费用警告保持不变。
- 首次生成时保留 title/description，使用低调的动态显影反馈，不显示状态文字，并阻止同一卡的鼠标、触控或键盘重复触发。
- 首次失败后恢复可点击的 description 卡，只给短暂、轻微的失败视觉；不常驻显示失败原因或“重试”文字，再次激活即重试。
- `prefers-reduced-motion: reduce` 下取消 shimmer、显影、抖动等非必要运动，以静态忙碌/失败样式表达同一状态。

### R4. 成功、重新生成与大图

- 首次成功后正文原位置只显示最新图片，隐藏 title/description 文案；`description` 用作图片 `alt`，`title` 可用于按钮和对话框的 accessible name。
- 成功不会自动打开大图；只有点击当前图片才打开沉浸大图。
- 图片状态提供低调但可发现、可聚焦的“重新生成”入口；不得依赖 hover 才能在触控或键盘环境中到达。
- 重新生成期间继续显示旧图，阻止同一卡重复重新生成；失败时保留旧图并只给短暂轻微反馈；成功时原子替换旧图。
- 同一逻辑插图始终使用同一稳定资产路径，只展示最新版本，不增加版本画廊。
- 大图具备 `role="dialog"`、`aria-modal="true"`、明确标题/关闭名称、初始焦点、焦点约束、Escape/遮罩/关闭按钮关闭与关闭后的触发点焦点返回。

### R5. 每卡独立调用 image entrypoint

- frontend 在 ready/init 时调用 `tsian.card.entrypoints()`，把 `imageGeneration` 严格校验并缓存为 `{ agentId: string, protocol: "tsian.image-director.v1" }` reactive capability；只有 exact protocol v1 才可交互，不得等玩家点击才首次读取/发现缺失。Agent id 只能来自 cached `imageGeneration.agentId`，不得硬编码 `image-director`。
- 如果 capability 缺失、malformed、protocol 错误或未知，所有 otherwise-valid description card 从首次 render 即降级为 invalid block 同风格的不可交互 fallback：显示可用 title/description，否则省略。不得伪装成可生成卡，不显示生成操作，不响应 pointer/Enter/Space。正文和 Composer 正常，并在开发诊断中保留可定位信息；旧卡无字段继续正常游玩。
- 对 assistant item 的 exact raw `projections.illustrations[index]` 调用 shared helper，得到 fingerprint、完整 guard、`identityKey` 和 asset path。每次调用必须把同一身份经两个独立通道发送：Agent input JSON 带 `assetId: identityKey` 与 `sourceGuard`；`invokeAgent` options 带 authoritative `generatedMediaSourceGuard: sourceGuard`。不得用 display marker body、parsed/normalized brief 做 hash，不得本地排序字段或规范化 Unicode/空白。
- `InvokeAgentRequest` 与 play-bridge `InvokeAgentOptions` 的 guard 字段是 optional、generic additive contract；UI 通过 options 字段建立本 invocation 的 host-required authority，不从 Agent id、`purpose`、Agent result 或卡业务字符串推导。remote bridge 必须严格 normalize，host 必须捕获为 `requiredSourceGuard` closure。
- 每次首次生成、失败重试或重新生成都创建新的瞬时 `invocationId`；不得把稳定 request identity 当作 invocation correlation id。
- 调用使用 `persist: false`、每卡不同且稳定的 `contextSlot`，不传 `checkpoint`，不使用 deprecated `commitMode` / `checkpointReason`。
- 前端只传冻结的插图请求与来源身份，不把当前组件中的 scene/entity 快照当作权威输入；image Agent 在玩家点击时自行读取最新 scene/entity。
- 每张卡有独立 in-flight 锁。不同卡可自然并行调用；不增加全局队列、取消、配额或跨卡互斥。
- 插图调用是 side-channel，不进入正式 turn timeline，不改变 Composer 的 disabled 条件；玩家可在最多三张图并行生成时继续推进故事。

### R6. 稳定资产、重载与 restore

- Agent success 后，frontend 严格验证 Agent final result 的 `assetId/sourceGuard` 与 pending request 完全一致。Tool 自身只返回 `{path,mediaType}`，不回显 guard；Agent echo 只用于 UI correlation，不能作为 commit authority，result path 也无 authority。
- durable authority 来自 normalized invoke option 的 host `requiredSourceGuard` closure、source registration 和 exact-source CAS。若 host 不支持/拒绝该 contract，或 required option 与 Tool guard/derived `assetId` mismatch，调用必须在 paid Provider/write 前 fail closed，UI 只将当前卡置为 initial/regenerate failure，不尝试无 guard fallback，也不影响其它卡或 formal turn。
- frontend 重新用 `@tsian/play-bridge` shared helper 派生 `assetPath`，只从该 path 调用 `tsian.workspace.read(path, "save-runtime")`；不得信任或加载 Agent 文本中返回的任意路径。
- 只有 `WorkspaceReadResult.binary` 为非空、非零字节、可用图片 Blob 时才进入 ready；`null`、缺少 binary、空 Blob、bridge failure 或图片加载失败均 fail-soft。
- 历史 reload、turn 0、窗口化消息重新挂载与 checkpoint restore 后，插图状态从 settled assistant 内容和稳定 asset path 重建。生成中/失败状态不写 workspace、不写 history、不恢复为后台任务。
- restore 开始时增加 illustration epoch，令旧 Promise/UI callback 失效并立即撤销旧分支 Object URL；restore 完成后重载 history 并重新读取当前分支资产。
- UI 不创建版本、不直接创建/覆盖 checkpoint，也不自行实现 stale-result commit；图片提交、来源 guard 与 checkpoint 一致性由 sibling 平台机制负责。
- Object URL 由图片组件实例所有：创建后若结果已过期立即 revoke，替换前 revoke 旧 URL，组件卸载、source/path 改变与 restore 时都必须 revoke。

### R7. 响应式、键盘与视觉一致性

- 延续沉浸阅读器现有深色、编辑感、余烬/纸张视觉语言，不引入与正文争夺注意力的高饱和操作面板或常驻技术状态文案。
- 桌面与移动端都不得产生横向溢出；图片卡保持稳定版心和合理 aspect box，大图使用 `object-fit: contain` 并适配安全可视区域。
- 所有功能必须可仅用键盘完成；焦点样式在暗色背景下有足够对比度，生成锁不得造成焦点丢失。
- 可见文案描述玩家结果，不暴露 Agent id、workspace path、request id、Provider、checkpoint 或 bridge 术语。

### R8. 双源同步与可交付卡包

- 未来实施必须对以下两棵 source 中的 task-owned shared files 做等价修改：
  - `apps/play-frontend-dev/src`
  - `cards/沉浸阅读器.tsian-card/frontend/src`
- 禁止用整树覆盖同步，因为卡内 frontend 具有 dev frontend 不包含的 setup UI，且另有已知有意差异；只同步本任务新增/修改的共享文件，并逐文件比较。
- dev frontend 必须通过 `npm run build --workspace play-frontend-dev`，但它只做 TypeScript/Vite 开发构建检查，其 dist 不是 checked-in card dist authority。`npm run package:frontend` 只生成 standalone source frontend package，不会更新仓库卡内 `frontend/dist` 或 `game-card.json`，也不是真实平台 builder 验证。
- 本 UI child 的实施 tooling scope 已冻结：新增确定性仓库脚本（默认 `scripts/repack-game-card.mjs`，若实现采用更窄 helper 也必须由同一根命令驱动），并在根 `package.json` 加入命令 `npm run repack:immersive-reader`。该 scope 同时必须先修 `apps/platform-web/src/storage/game-card-packages.ts:685-689`：文本 workspace inventory 的 `size` 使用 `strToU8(file.content).byteLength` 或等价 `new TextEncoder().encode(file.content).byteLength`，不得使用 UTF-16 `content.length`；并增加 ASCII、中文、emoji 文本与 binary entry size 回归。export/import inventory 的 `size` 统一定义为实际解压 ZIP entry payload bytes（`Uint8Array.byteLength`，不是压缩后 archive size）；不改变字段可选性或其它 import 契约。因修改 `apps/platform-web`，必须运行 `npm run build:web`。不再保留 maintainer 决策或手工复制选项。
- 脚本输入为 `cards/沉浸阅读器.tsian-card/frontend/src/**`、card workspace、cover 与当前 `game-card.json`。若 Node 不能直接调用 browser esbuild-wasm，脚本必须用 Playwright 启动 `platform-web` 并使用临时/隔离 IndexedDB profile 导入当前 card package/source，调用真实 browser build/export path，下载 zip 后确定性解包回 card 目录。
- 固定 builder 验收链是 card `frontend/src/**` → `buildFrontend`（`apps/platform-web/src/frontend-build/engine.ts:272`）→ `writeBackDist`（`apps/platform-web/src/frontend-build/write-back.ts:55`）→ 修正后的 `exportGameCardPackage` dynamic inventory（`apps/platform-web/src/storage/game-card-packages.ts:660`）→ 与 checked-in/disk card inventory 双向比对 → packaged iframe 验证。repack 脚本必须依赖 exporter size 回归通过之后的实现，否则中文 workspace 的三方 size 对比没有证明力。
- repack 必须原子替换 checked-in `frontend/dist/**`、删除 stale hashed dist，并从磁盘重新生成 `game-card.json` 的 `workspaceFiles` / `frontendFiles` / `coverFiles` path、mediaType、与实际 ZIP entry 定义一致的真实 byte size及必要的统一 card version；拒绝 missing、extra、duplicate 或 type/size mismatch，输出排序稳定且可重复的 inventory。不得临时手工复制，也不得用 dev dist 覆盖卡内 setup source。

## Acceptance Criteria

- [ ] AC1: settled assistant 的 `displayContent ?? content` 被解析为顺序正确的 Markdown/插图组件；插图出现在协议 block 的原位置，交互组件不经过 `v-html`。
- [ ] AC2: 按正文顺序仅最先三个 closed-schema valid block 可交互；额外 valid block 是零调用不可交互 fallback，invalid block 不占名额。完整 marker object-invalid fallback 只读取 string title/description、不 coerce，任一在对应长度边界内可用时渲染，否则省略；parse failure/non-object 省略。capability 缺失/invalid/未知 protocol 从首帧把 otherwise-valid blocks 同样降级。所有 malformed/marker case 不显示 refs/raw JSON、保留周围正文且不调用。
- [ ] AC3: streaming 中 partial/complete 插图 block 均不闪现，turn end 后才由最终 projected assistant 内容渲染可交互卡。
- [ ] AC4: frontend ready/init 缓存 `{agentId,protocol}` image capability，只有 exact `tsian.image-director.v1` 允许交互且 Agent id 只从 object 读取；未生成卡只显示 title/description，整卡 pointer/Enter/Space 激活一次即同意本次付费生成，exact `aria-label="生成插图：<title>"`，有可见焦点，无 confirmation modal、常驻费用或 action row，in-flight 防重复。
- [ ] AC5: 首次生成保留 description、显示无文字的低调反馈并阻止重复点击；失败后恢复整卡重试且不常驻失败/重试文字。
- [ ] AC6: 首次成功只显示图片、alt 等于 description、不会自动开大图；点击图片打开具备 Escape/遮罩/关闭按钮、焦点约束与焦点返回的大图。
- [ ] AC7: 重新生成时旧图持续可见；失败保留旧图，成功替换旧图；同一位置始终只显示最新图片。
- [ ] AC8: Agent id 来自 ready/init cached `imageGeneration.agentId` 且 protocol 已验证为 exact v1；每个逻辑 block 使用 persisted raw projection + original index + shared helper 得到稳定且不同的 guard/assetId/contextSlot/path，每次尝试有新的 invocationId，并使用 `persist:false` 且不请求 checkpoint。
- [ ] AC8a: frontend 将同一个 helper-derived guard 通过 Agent input `sourceGuard` 与 `InvokeAgentOptions.generatedMediaSourceGuard` 双通道发送，并在 input 携带 derived `assetId`；Agent result 必须匹配 pending values但仅作 UI correlation，result path 不作为 authority，workspace reread path 由 shared helper 再派生。UI 没有第二份 hash/canonicalization/path 算法。
- [ ] AC8b: contracts/options additive 字段经 play-bridge 明确转发、remote strict normalization 与 host `requiredSourceGuard` closure 生效，不按 `agentId`/`purpose` 路由。required option 下 Tool omitted/wrong guard 或 wrong `assetId` 均 pre-Provider `IMAGE_INVALID_ARGUMENTS`、zero Provider/ordinary write/guarded handoff 且无 ordinary downgrade；exact match 成功并以 closure guard handoff。缺失 host contract/bridge rejection/mismatch 只失败当前卡，UI 不改用无 guard 调用。
- [ ] AC9: 快速激活三张不同的 eligible 插图时三次调用可重叠、同一卡不可重复调用、额外 valid cards 不调用、Composer 仍可继续故事；一张失败不影响其它卡。
- [ ] AC10: image Agent 在点击时读取最新 scene/entity；前端请求不把旧组件 scene/entity 数据作为权威快照。
- [ ] AC11: reload、turn 0、历史窗口重新挂载和 checkpoint restore 可从最终 assistant 内容与确定性 workspace Blob 恢复正确图片；restore 后不显示旧分支图片。
- [ ] AC12: Object URL 在 stale create、替换、source/path 变化、restore 与 unmount 路径均有对应 revoke，重复 reload/restore 不累积 URL。
- [ ] AC13: 360px 级移动端、桌面端、纯键盘和 reduced-motion 场景可用，无横向溢出、隐藏 hover-only 操作或非必要运动。
- [ ] AC14: 两棵 frontend source 的 task-owned 文件语义一致，同时保留卡内 setup/已知差异；不得用整树覆盖同步。
- [ ] AC15: dev frontend build 通过但其 dist 不作为卡 dist authority；平台 exporter 文本 size 已改为 UTF-8 实际 ZIP entry bytes，ASCII/中文/emoji 文本和 binary 回归通过，且 `npm run build:web` 通过；随后 `npm run repack:immersive-reader` 才通过隔离 Playwright/browser 的真实 build/write-back/export 链重建卡内 dist，原子删除 stale outputs，并从磁盘重算三类 inventory；exported/checked-in/disk 三方 missing/extra/duplicate/type/size 为零，重复运行 inventory 一致，packaged iframe 通过。`npm run package:frontend` 未被误当作其中任何一步。
- [ ] AC16: frozen sibling image capability、closed block schema/validator、identity/fingerprint、asset path、dual-channel invoke authority 与 Agent request/result correlation 合同均按本计划消费；真实生成仅等待对应实现 seam 可用。UI 不直接调用 Provider、不修改 checkpoint、不持久化后台 job。无 option + no Tool guard ordinary write、无 option + valid Tool self-guard guarded path 与 formal-turn direct unguarded compatibility 由平台 sibling 保持，UI 不通过 business strings 改写这些通用规则。

## Out of Scope

- Provider 配置、Provider 请求、`generate_image` Tool、图像 prompt 编排与 image Agent 本身。
- 正式 turn 增量提交、source guard、checkpoint path patch、restore/commit 竞态和 Blob GC。
- 全局生成队列、取消、配额、usage、自动生成或自动打开大图。正文卡的单次整卡激活已是付费同意，不增加确认 modal/常驻计费文案；Settings 测试的显式费用警告仍属平台任务。
- 图片编辑、variation、画廊、历史版本、角色头像/地点图库和旧存档迁移。
- 把卡特有插图 schema 提升为平台 timeline/bridge 一等字段。
