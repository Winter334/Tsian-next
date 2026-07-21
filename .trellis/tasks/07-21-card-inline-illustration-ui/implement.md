# 实施计划：正文内嵌插图交互

## Phase 0：依赖合同与交付工作流 Gate

- [ ] 阅读本任务 PRD/design、parent design/implement 及 curated specs；运行 `trellis-before-dev` 注入项目约定。
- [ ] 运行 `git status --short`，记录 baseline，确认两棵 frontend 与目标卡包没有待修改文件冲突；保留无关改动。
- [ ] 冻结并引用唯一 runtime identity helper：`packages/play-bridge/src/generated-media-identity.ts` 从 `@tsian/play-bridge` root 导出，负责 strict guard、exact raw `$1|trim` UTF-8 fingerprint、NUL identity 和 path。UI 禁止重实现 field sorting、Unicode/whitespace normalization、hash 或 path。
- [ ] 冻结 request/result 与双通道 authority：Agent input 带 helper-derived `assetId`/完整 `{kind,turn,projectionKey,index,fingerprint}`；同一 guard 另作为 `InvokeAgentOptions.generatedMediaSourceGuard` 发送；Tool result 仅 `{path,mediaType}`；Agent final result 从 request 回显 assetId/guard 仅作 UI correlation 并嵌套 asset。UI 必须比对 pending identity/guard，result path 非 authority。
- [ ] 确认 contracts `InvokeAgentRequest` 与 play-bridge `InvokeAgentOptions` 都 additively 声明 optional generic guard，SDK 明确转发；remote bridge strict normalization；host 捕获 `requiredSourceGuard` closure，不按 `agentId`/`purpose`/Agent output 建立 authority。
- [ ] 冻结 fail-closed matrix：required option 下 Tool omitted/wrong guard 或 wrong derived assetId 均 pre-Provider `IMAGE_INVALID_ARGUMENTS`，zero Provider/ordinary writes/guarded handoffs/source registration 且不降级 ordinary；exact match 用 closure guard handoff。no option + no guard ordinary、no option + valid self-guard guarded、formal-turn direct unguarded 兼容由 platform sibling 保留。
- [ ] 确认 `GameCardRuntimeEntrypoints.imageGeneration?: { agentId: string; protocol: "tsian.image-director.v1" }` 已落到 contracts/local+package normalizers/host bridge/card manifest；UI 在 ready/init 缓存 object，只接受 exact v1，并只从 `.agentId` 调用。pending/missing/malformed/wrong/unknown protocol 首帧 fallback，旧卡无字段兼容。
- [ ] 冻结并只实现/消费一份 illustration brief runtime validator：closed object 恰好四字段、`additionalProperties:false`；title `1..80`、description `1..500`、refs 总长 `1..120` UTF-16 code units；entityRefs `0..12` 首现去重；ref 恰好一个 colon，segments `1..80`，禁 `.`/`..`、whitespace、`/`、`\\`、NUL 与额外 colon。拒绝 coercion；Prompt 自包含同一合同，platform storage 不理解 schema。
- [ ] 冻结 first-three-valid policy、object-invalid/parse-failure fallback，以及 whole-card pointer/Enter/Space 付费同意：exact aria-label、无 confirmation modal/常驻费用/action row、in-flight 去重。
- [ ] 确认 image Agent、platform `generate_image` 与 save-consistency source guard/checkpoint patch 已提供真实 end-to-end seam；只做静态 UI 时可继续，真实 invoke 接线必须等待这些依赖。
- [ ] 冻结并实施卡 repack tooling：新增确定性 `scripts/repack-game-card.mjs`（或由同一命令驱动的更窄 helper）与根 `npm run repack:immersive-reader`。在脚本依赖 exported inventory 前，先修 `apps/platform-web/src/storage/game-card-packages.ts:685-689`，将文本 workspace `size` 从 UTF-16 `content.length` 改为 `strToU8(file.content).byteLength` 或等价 `TextEncoder` UTF-8 bytes；增加 ASCII/中文/emoji 文本与 binary ZIP entry size 回归，统一 export/import inventory `size` 为解压 entry 的 `Uint8Array.byteLength`（非压缩 archive size），且不改变字段可选性或其它 import 行为。随后以 card source/workspace/cover/current manifest 为输入，用隔离 Playwright/IndexedDB 驱动真实 browser build/write-back/corrected export，确定性解包并原子替换 dist、删除 stale hashes、从磁盘重算三类 inventory/version、拒绝 missing/extra/duplicate/type/size mismatch，并输出可重复 inventory。exported/checked-in/disk 必须双向一致；`npm run package:frontend` 与 dev dist 均不是 authority。
- [ ] 确认测试策略：复用届时已有 runner；若没有，批准临时 pure-function probe + packaged-browser matrix，不在本任务顺带引入全仓测试框架。
- [ ] 运行修改前基线：`npm run build --workspace play-frontend-dev`；若 baseline 失败，停止并记录既有失败。

**Gate 结论**：上述 entrypoint/brief validator/identity/path/request 合同与 `repack:immersive-reader` 已冻结；真实 Agent integration 仍等待 sibling seam 实际可用，静态 parser/card 工作可先行。

## Phase 1：纯 parser、stream projection 与 identity seam

在 `apps/play-frontend-dev/src/lib` 先实现纯逻辑，并计划等价同步到卡内 source：

- [ ] 定义/导入 protocol sibling 的 `IllustrationBlock`，并让 parser/request builder/component 共同调用唯一严格 runtime validator（优先从 `@tsian/play-bridge` 窄 module/root export 消费，或卡 UI 单一 helper）；不本地扩展/复制 schema。另从 `@tsian/play-bridge` 导入唯一 identity helper。
- [ ] validator exact rules：closed 四字段且 no extra；title string trim `1..80`，description `1..500`；sceneRef string `scene:<localId>` 总长 `1..120`；entityRefs array `0..12`、string items `<type>:<localId>` 总长 `1..120`、去重保首现；ref 单 colon，segments `1..80` 且禁 `.`/`..`、whitespace、slash/backslash/NUL/额外 colon；拒绝 coercion。
- [ ] 实现单趟 ordered segment parser，输入 settled display text 与同一 assistant item 的 raw `projections.illustrations` array，输出稳定 segments；完整 marker ordinal 是原 projection index，invalid/extra block 不重新编号。
- [ ] interactive segment 必须持有 exact persisted raw projection string；缺失/非 string/mismatch 不生成 identity/call。fingerprint 禁止使用 display marker body 或 parsed brief。
- [ ] 按正文 valid 顺序仅最先三个 closed-schema block 输出 interactive segment；额外 valid block 输出不可交互 fallback，invalid 不占名额且零额外调用/Provider 成本。
- [ ] 保持 Markdown 原换行；object-invalid fallback 仅读取原值为 string 且在各自长度边界内的 title/description，不 stringify/coerce，refs 永不显示；无可用字段、parse failure 或 non-object 省略；raw marker/JSON 永不外泄。
- [ ] fallback 不创建 source identity、不注册 registry、不 probe workspace、不支持生成/重试/重新生成/lightbox，也不得 coerce 非字符串字段。
- [ ] 让 block index 按完整 protocol block 的出现顺序计数，invalid block 不改变后续 block identity。
- [ ] 实现未闭合 opening 与孤立 closing 的 settled fail-soft 清理。
- [ ] 实现 streaming-safe projection：删除完整 block、暂存未闭合 block 与 opening marker 的末尾真前缀、移除孤立 closing。
- [ ] 调用 shared `fingerprintProjectionRaw(rawProjection)` 并由 shared helper 派生 guard/identityKey/assetPath；request 使用 `assetId: identityKey`。禁止随机数、DOM id、时间戳、title、parsed brief 或 UI normalization 参与稳定 path authority。
- [ ] 为 pure cases 建立 table-driven 验证：0/1/3/4+ block、首中尾、相邻 block、malformed/parse failure、closed-schema/type/length/ref/extra-field invalid、entityRefs 0/12/13 与重复首现去重、non-coercing fallback、only first three valid interactive、extra valid zero-call fallback、original projection index/raw string preservation、display body 与 persisted raw projection 区分、stream marker cases、raw fingerprint golden vector、identity repeat/change。
- [ ] 为 platform package exporter 建立 size 回归：ASCII、中文、emoji 文本与 binary fixture 经 export 后，manifest inventory `size` 精确等于解压所得 ZIP entry `byteLength`；中文/emoji 断言不会退回 `content.length`，import/export inventory 定义一致。

**验证点**

- [ ] JSON 无法解析或无可用描述的 block 只被省略；可解析 object 的 schema/ref failure 仅在 title/description 原值为 string 且 trim/长度合法时生成不可交互 fallback，不 coerce；所有 case 都保留相邻正文且不发起调用。
- [ ] streaming 任意前缀都不出现可识别 marker 或 block JSON。
- [ ] UI 不对 Unicode/空白/字段顺序执行 identity canonicalization；shared helper 对 exact persisted raw bytes 的 golden vector与内容变化测试通过。
- [ ] 相同 turn/original index/raw projection 派生同 identity；任一 guard input 变化得到 shared helper 预期结果。

**回滚点**：pure helpers 可独立回退，不触及现有 narrative renderer。

## Phase 2：稳定 assistant turn 与 segment renderer

同时修改两棵 source 中的 `useTsian.ts`、`StoryView.vue`、`NarrativeMessage.vue` 及 Phase 1 新增 shared files：

- [ ] 扩展 settled assistant `StreamItem`，携带稳定 `turn` 和同一 persisted assistant item 的 raw `projections.illustrations` values；streaming item 不伪造二者。
- [ ] history reload 从 `entry.turn` 与 assistant projections 传递 turn/raw strings，包括 opening turn 0。
- [ ] live finalize 从最终 persisted assistant result 传递相同 turn/display/projections，移除 identity 对 `Date.now()`、数组位置或 display marker re-extraction 的依赖。
- [ ] 若 live final result 无稳定 turn/projections，先修复消费 seam；不得静默 fallback 到不稳定 identity。
- [ ] StoryView 将 settled turn 传入 NarrativeMessage；streaming path 只传 streaming-safe `visibleText`。
- [ ] NarrativeMessage settled 模式按 ordered segments render：Markdown segment 局部 `renderMarkdown`/`v-html`，合法 illustration segment 使用真实 Vue `SceneImage`，invalid schema/ref fallback 使用无交互语义的 Vue 描述块。
- [ ] 保留 EmberForge streaming 体验，但不在 streaming 阶段创建可点击插图卡。
- [ ] 验证 `displayContent ?? content` fallback、普通 Markdown 与 turn timeline/windowing 没有回归。

**验证点**

- [ ] live turn、history reload 与 turn 0 的同一 block 得到相同 original index/raw projection/identity。
- [ ] 插图 block 在段落原位置，前后 Markdown 顺序/换行正确。
- [ ] `NarrativeMessage` 中不存在将交互 component 字符串注入 `v-html` 的路径。
- [ ] `npm run build --workspace play-frontend-dev`。

**回滚点**：先保留稳定 turn 字段，renderer 可退回纯 Markdown；不得恢复 raw marker 泄露。

## Phase 3：ready/init capability、module registry 与 deterministic asset probe

- [ ] 在 frontend ready/init 调 `tsian.card.entrypoints()`，把 `imageGeneration` 严格验证为 `{agentId,protocol:"tsian.image-director.v1"}` 并缓存 reactive capability；在 card/bridge lifecycle 变化时刷新或清理。
- [ ] capability pending/缺失/malformed/protocol 错误或未知时不得暂时渲染可激活卡；otherwise-valid block 从首次 render 直接 fallback，正文/Composer 正常，开发诊断可定位。旧卡无字段继续游玩。
- [ ] 新增 module-level illustration registry/composable，key 为 shared-helper identityKey，只保存逻辑状态/attempt token/epoch，不保存 Object URL。
- [ ] 实现 `idle | generating | ready | failed` 与 `initial | regenerate` transition。
- [ ] 同一 source generating 时拒绝重复 attempt；不同 source 无共享 mutex，可自然并行。
- [ ] SceneImage mount 根据 deterministic path 调 `workspace.read(path, "save-runtime")`。
- [ ] 严格检查 `file.binary`、size 与图片 decode；`null`/bridge/Blob/decode failure fail-soft。
- [ ] 使用 component-local load version，处理 await 后 stale identity/epoch。
- [ ] 实现 component-owned Object URL：stale create、decode fail、replace、source change、restore 与 unmount 均 revoke。
- [ ] windowing 卸载时仅 URL 被清理，in-flight registry lock 继续存在；重挂载从 path probe。

**验证点**

- [ ] spy/浏览器证据显示每个 createObjectURL 路径最终有且只有对应 revoke。
- [ ] success probe 后快速 source 切换不会显示旧图。
- [ ] 无资产/坏资产不出现 broken `<img>` 或内部路径文案。

**回滚点**：asset probe/registry 可独立关闭，卡退回静态 description。

## Phase 4：卡片交互、生成与重新生成

- [ ] 将 SceneImage 的未生成态实现为原生整卡 button，只显示 title/description；exact `aria-label="生成插图：<title>"`。
- [ ] 一次 pointer/Enter/Space 激活即表示同意该次真实付费生成；不增加 confirmation modal、费用文案或“点击显影/生成插图”action row。Settings 测试费用警告保持。
- [ ] 增加 `aria-busy`/`aria-disabled` guard、可见 focus ring 与约 44px 命中区；initial generating 防所有输入重复且避免焦点丢失。
- [ ] initial generating 保持 description，使用无状态文字的低调显影。
- [ ] initial failure 恢复整卡 retry，只显示短暂轻微反馈并清理 timer。
- [ ] 从 ready/init cached capability 的 `imageGeneration.agentId` 取 Agent id，且只在 cached protocol exact v1 时到达本阶段；不得在首次激活才调用 entrypoints/discover missing。
- [ ] 每次 attempt 生成新的 invocationId，传 helper-derived stable per-card contextSlot、`persist:false` 与短 purpose；不传 checkpoint/injection/legacy commit fields。
- [ ] Agent request 由 shared helper wrapper 构造，包含 `assetId: identityKey` 和 full guard；同一次 `invokeAgent` options 必须传 exact same `generatedMediaSourceGuard`；不传旧 scene/entity 快照。
- [ ] 任何缺失 host option contract、remote rejection、host required mismatch 只应用当前卡 initial/regenerate failure；不得移除 option 重试或走 ordinary write，且不改变其它卡/Composer/formal turn。
- [ ] Promise 成功后严格比较 result `assetId/sourceGuard` 与 pending request，仅作为 UI correlation；epoch/token 当前后重新读取 shared-helper assetPath，绝不使用 Agent result path 或 echo 作为 authority。
- [ ] ready 状态只显示最新 image，alt 为 description；点击 image 只打开 lightbox。
- [ ] 增加可键盘/触控发现的低调 regenerate button；regenerating 保留旧 URL，failure 保留旧图，success reread 后原子替换。
- [ ] 验证插图调用不进入 Composer disabled rule、不写 formal history、不等待其它卡。

**验证点**

- [ ] initial success/failure/retry 状态矩阵。
- [ ] regenerate success/failure 且旧图保留行为。
- [ ] 连续双击/Enter 不产生同一卡第二次 invoke。
- [ ] 三张不同 eligible cards 快速触发得到重叠 invocation 时间区间与不同 invocationId/contextSlot/path；第四个及后续 valid card 不可激活且零调用。
- [ ] 生图期间可完成下一 formal turn，旧卡状态不被新 turn 清空。

**回滚点**：真实 invocation 可由一个 UI seam 断开；description/ready-from-existing-asset 仍可单独工作。

## Phase 5：Lightbox、移动端与 reduced motion

- [ ] 新增 illustration 专用 lightbox，复用 reader 暗色遮罩/卡片视觉，不直接复制缺失 focus trap 的旧 modal 行为。
- [ ] 添加 `role="dialog"`、`aria-modal`、labelled title、显式 close accessible name。
- [ ] 实现初始焦点、Tab/Shift+Tab 约束、Escape、backdrop、close button 与 trigger focus return。
- [ ] source invalidated/restore/unmount 时安全关闭并移除 listener/scroll lock。
- [ ] 图片 `object-fit: contain`，适配 `100dvh`、safe area、窄屏与横屏，不横向溢出。
- [ ] idle/ready/regenerate 控件不依赖 hover；hover 只增强可见性。
- [ ] 添加 `prefers-reduced-motion`，取消 shimmer/位移/抖动等非必要 animation，保留静态 state distinction。
- [ ] 检查暗色 focus/文字/边界对比度和 200% zoom/reflow。

**验证点**

- [ ] 纯键盘从 description generate → ready image → lightbox → close → regenerate 全流程。
- [ ] 360×800、390×844、横屏窄高、桌面 1280×800 无横向 overflow。
- [ ] reduced motion 下无持续显影动画，功能与反馈仍完整。

**回滚点**：lightbox 独立回退为不开大图，不影响生成/asset display。

## Phase 6：reload、restore 与 stale async

- [ ] 新增全局 illustration epoch/invalidation API。
- [ ] StoryView restore 开始前 invalidate：旧 attempts stale、mounted URLs revoke/close lightbox。
- [ ] restore 成功后沿既有 history/runtime/window flow rebuild，再从 settled content/path probe。
- [ ] restore 失败时也以平台当前 workspace 重建/复核，不继续信任 restore 前 URL。
- [ ] 每个 invocation/probe/decode callback 在写 UI 前比较 epoch、attempt token、load version 与 source identity。
- [ ] prune 不再存在于 history 的闲置 registry entries；不得把 generating state 写 workspace/history 或恢复成后台 job。
- [ ] 配合 save-consistency sibling 验证 restore-before-commit 与 commit-before-restore 两种顺序；UI epoch 与平台 source guard 均生效。

**验证点**

- [ ] reload 有图/无图、turn 0、历史 window unmount/remount。
- [ ] 生成中 restore 到 source 前：旧 Promise 不改新 UI，迟到 commit 被平台拒绝。
- [ ] 图生成后 restore 到 source/later checkpoint：预期图片可恢复。
- [ ] 连续 restore/reload 后无 stale image、重复卡或 Object URL 累积。

**回滚点**：epoch integration 可独立回退，但在 platform source guard 未被移除的前提下进行；否则不能宣称 restore 安全。

## Phase 7：平台 exporter 修复、双源同步与卡内 dist/package

- [ ] 先修改 `apps/platform-web/src/storage/game-card-packages.ts:685-689`：文本 workspace entry 的 `size` 使用 `strToU8(file.content).byteLength` 或等价 `TextEncoder` bytes，binary 继续使用实际 bytes；export/import inventory 的 size 定义为解压 ZIP entry payload `Uint8Array.byteLength`，不改变字段可选性或其它 import 契约。
- [ ] 增加 ASCII/中文/emoji 文本与 binary exporter regression：exported manifest size 精确等于解压 entry bytes，并覆盖 import/export inventory 定义一致；运行 `npm run build:web`。在这些回归通过前不得运行或信任 repack 的 exported/checked-in/disk 对比。
- [ ] 列出本任务实际触及的 shared files；在 `cards/沉浸阅读器.tsian-card/frontend/src` 做等价变更。
- [ ] 对 task-owned files 做逐文件 diff；允许且保留 setup/character/context 已知差异，禁止整树覆盖。
- [ ] 运行 `npm run build --workspace play-frontend-dev`，仅把它作为 TypeScript/Vite 开发检查，不把 dev dist 当 card authority。
- [ ] 运行 `npm run repack:immersive-reader`：脚本读取 card `frontend/src/**`、workspace、cover 和当前 manifest；以 Playwright 临时/隔离 IndexedDB profile 导入 package/source，驱动 `buildFrontend` → `writeBackDist` → 修正后的 `exportGameCardPackage`，下载并确定性解包。
- [ ] 脚本 staging 成功后原子替换 `cards/沉浸阅读器.tsian-card/frontend/dist/**`，确保所有旧 hashed dist 被完整 replacement 删除，禁止逐文件临时手工复制。
- [ ] 从仓库磁盘重新生成 `game-card.json.workspaceFiles/frontendFiles/coverFiles`，覆盖 source/dist/workspace/cover，按规范推断 mediaType 并记录与 ZIP entry 定义相同的真实 UTF-8/binary byte size 与必要的一次统一 version bump。
- [ ] verifier 双向比较 corrected exported/checked-in/disk inventory，要求 missing/extra/duplicate/path/type/size 均为零；输出 path-sorted 可重复 inventory，并验证连续运行结果稳定。
- [ ] 在 packaged iframe 中加载卡，确认 entry、相对 assets、bridge、workspace Blob 与所有交互工作。
- [ ] `npm run package:frontend` 仅在需要验证 standalone source frontend package 时运行；明确它不是 checked-in repack，也不验证 browser builder。

**验证点**

- [ ] 两棵 source 的 task-owned files 语义一致。
- [ ] 卡专有 setup UI/有意差异未被覆盖。
- [ ] dist entry/assets 可加载，无 stale hashed file、404 或 MIME 错误。
- [ ] platform exporter 的 ASCII/中文/emoji 文本与 binary fixtures 均报告实际 ZIP entry bytes；中文/emoji 不等于 UTF-16 `content.length` 的 case 被锁定，import/export inventory 定义一致且 `npm run build:web` 通过。
- [ ] `game-card.json` 三类 inventory 与修正后的 export、磁盘完全一致，重复执行 repack 得到稳定 inventory。

**回滚点**：source、dist 与 manifest inventory 必须作为一个交付单元同时回滚。

## Phase 8：端到端矩阵与质量门

### 8.1 功能矩阵

- [ ] 普通正文、turn 0、无 `displayContent` fallback。
- [ ] 1/2/3/4+ 张 blocks 位于段首/段中/段尾；仅前三个 valid 可交互，额外 valid fallback 零调用。
- [ ] malformed JSON 省略、closed-schema/type/length/ref/extra-field invalid 的 non-coercing fallback（含 title+description/单字段/无可用字段）、entityRefs duplicate/0/12/13、未闭合/孤立 marker、跨 delta partial marker。
- [ ] initial generate success/failure/retry。
- [ ] ready lightbox 与 regenerate success/failure。
- [ ] 三卡并行、同卡去重、生图期间继续故事。
- [ ] reload/window remount/restore before source/restore after source。
- [ ] Object URL replacement/stale/unmount/restore cleanup。

### 8.2 体验矩阵

- [ ] pointer、touch、Enter/Space、Tab/Shift+Tab、Escape。
- [ ] 360px mobile、desktop、landscape、200% zoom。
- [ ] normal motion 与 reduced motion。
- [ ] ready/init capability exact-v1/missing/malformed/wrong/unknown protocol，whole-card paid activation/aria-label/no-confirmation/in-flight dedupe，dual-channel equal guard，Agent result identity mismatch/correlation-only，missing host contract/bridge rejection/current-card isolation，workspace missing/bad Blob。
- [ ] host integration matrix：required option + Tool omitted guard、wrong guard、wrong `assetId` 均 pre-Provider zero Provider/zero ordinary+guarded writes；exact match success 且 handoff 用 closure guard；no option + no guard ordinary 与 no option + valid self-guard/formal direct compatibility；变更 `agentId`/`purpose` 不改变行为。

### 8.3 最终命令

```bash
npm run build:contracts
npm run build --workspace @tsian/play-bridge
npm run build --workspace play-frontend-dev
npm run repack:immersive-reader
npm run build:web

git diff --check
python ./.trellis/scripts/task.py list-context 07-21-card-inline-illustration-ui
python ./.trellis/scripts/task.py validate 07-21-card-inline-illustration-ui
```

`repack:immersive-reader` 的验证证据必须先覆盖 exporter ASCII/中文/emoji 文本与 binary size 等于实际 ZIP entry bytes，然后显示真实 card `frontend/src/**` → `buildFrontend` (`engine.ts:272`) → `writeBackDist` (`write-back.ts:55`) → 修正后的 `exportGameCardPackage` (`game-card-packages.ts:660`) → exported/checked-in/disk inventory 双向 compare → packaged iframe 全链路；`npm run package:frontend` 不得替代其中任何一步。

contracts、play-bridge、remote host 与 UI 的冻结合同必须同时提供并通过：

```bash
npm run build:contracts
npm run build --workspace @tsian/play-bridge
npm run build:web
npm run build --workspace play-frontend-dev
```

- [ ] 运行 `trellis-check` 做 spec、build、cross-layer data flow、双源同步与 package inventory 审查。
- [ ] 检查玩家可见文本不含 Agent id/path/request/provider/checkpoint 技术信息。
- [ ] 检查日志/diagnostic 不含 prompt、Provider payload、secret、base64 或 Blob。
- [ ] stale-language scan：`rg "generatedMediaSourceGuard|requiredSourceGuard|sourceGuard|Agent result|result path|agentId|purpose|ordinary write" .trellis/tasks/07-21-card-inline-illustration-ui`，确认 UI 双通道、correlation-only、current-card fail closed 与 no-unguarded-retry 语言完整。
- [ ] 复核 contracts/platform/play-bridge/UI/repack 的实际改动范围和全部 build，不把 sibling required build 作为可省略项。
- [ ] 任何缺失浏览器环境或 sibling 未完成项必须准确报告为未验证，不能把 AC 标记为完成；本计划已冻结 repack 命令与 tooling scope，不得再回退为“命令待定”。

## 风险文件

- `apps/play-frontend-dev/src/composables/useTsian.ts` 与卡内副本：live/history turn identity 和最终 projected content。
- `apps/play-frontend-dev/src/components/story/StoryView.vue` 与卡内副本：streaming、windowing、restore 编排、Composer independence。
- `apps/play-frontend-dev/src/components/story/NarrativeMessage.vue` 与卡内副本：Markdown/interactive component 边界。
- `apps/play-frontend-dev/src/components/story/SceneImage.vue` 与卡内副本：多状态交互、Blob/Object URL 与 a11y。
- 新增 illustration pure helpers/registry/lightbox：stable identity、stale async 与 focus lifecycle。
- `cards/沉浸阅读器.tsian-card/frontend/dist/**`：hashed output/stale cleanup。
- `apps/platform-web/src/storage/game-card-packages.ts` 及其 exporter regression seam：文本 UTF-8 ZIP-entry size、binary size 和 import/export inventory 定义；改动后必须 `build:web`。
- `scripts/repack-game-card.mjs`（或同命令的窄 helper）与根 `package.json`：UI child tooling scope，依赖修正后的真实 browser builder/export、原子 dist replacement 与全量 inventory regeneration。
- `cards/沉浸阅读器.tsian-card/game-card.json`：entrypoint sibling integration 与完整 workspace/frontend/cover inventory。

## 不实施事项

- 不实现 Provider config/adapter/Tool、image-director、storyteller prompt 或 Reply Projection rule。
- 不实现 checkpoint、正式 turn commit、host guard normalization/closure、Blob GC 或 restore serialization；UI 只消费 `generatedMediaSourceGuard` option 合同并实现当前卡 fail-closed/result correlation。
- 不增加全局队列、取消、配额、自动生成、图库、多版本或角色/地点图片 UI。
- 不为方便 UI 在 bridge/timeline 增加卡特有 illustration schema。
- 本计划不表示 start、commit、push 或产品代码修改已执行；tooling 已在本任务 scope 中冻结，实施时无需另行批准。
