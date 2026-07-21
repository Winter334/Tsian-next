# 正文内嵌文生图

## Goal

为沉浸阅读器提供与叙事正文一体化的按需插图体验：storyteller 在开局和每个正式回合的合适位置声明 1–3 幅画面，玩家点击正文内的描述卡后，由卡内专职 Agent 调用平台图像能力并在原位显示结果。生图延迟、失败和费用不得阻断剧情正文，生成资产必须跟随存档与 checkpoint 正确回溯。

本父任务只维护跨层产品决策、子任务边界、共享契约和最终集成验收。实际代码由四个子任务独立规划、实现和检查。

## Background

当前仓库已经具备以下基础：

- 正式回合把 assistant 回复投影为 `content`、`displayContent` 和卡级 `projections`，平台不理解玩法语义：`apps/platform-web/src/platform-host/runtime-turn.ts:266`、`packages/contracts/src/runtime.ts:73`。
- 回复投影支持分别改写模型上下文和展示通道，并支持通过 `[]` 追加多个匹配结果：`apps/platform-web/src/platform-host/reply-projection.ts:372`、`apps/platform-web/src/platform-host/reply-projection.ts:424`。
- 卡前端可以通过 `invokeAgent` 发起不推进正式 turn 的旁路调用：`packages/play-bridge/src/tsian-api.ts:49`、`apps/platform-web/src/platform-host/ai-invocation.ts:190`。
- workspace 已能持久化图片 Blob；角色头像采用“领域数据保存资产引用、二进制保存到 save-runtime”的方式：`packages/contracts/src/bridge.ts:66`、`cards/沉浸阅读器.tsian-card/frontend/src/components/character/CharacterPortrait.vue:142`。
- checkpoint 已使用内容寻址 Blob 保存状态文件，但现有正式回合整表提交和旁路 `current-turn-auto` 语义不能直接安全承载长耗时并发生图：`apps/platform-web/src/platform-host/runtime-turn.ts:366`、`.trellis/spec/platform-web/storage/index.md:57`。
- 当前 Provider 只实现文本/工具对话，没有文生图调用；`SceneImage.vue` 也尚未接入真实图片数据。
- 当前 `exportGameCardPackage` 在 `apps/platform-web/src/storage/game-card-packages.ts:685-689` 对文本 workspace entry 使用 `content.length`（UTF-16 code units）填写 `size`，而实际 ZIP payload 由 `strToU8(file.content)` 写入；中文、emoji 等非 ASCII 文本会使 exported inventory 与 ZIP/disk 真实字节数不一致。

## Child Task Map and Dependencies

1. `07-21-platform-image-generation/` — 平台配置、OpenAI-compatible adapter、测试生成和 host-owned `generate_image` Tool。
2. `07-21-image-save-consistency/` — 正式回合与旁路媒体写入的并发提交、checkpoint 补丁、重生成和回溯一致性。
3. `07-21-card-illustration-agent-protocol/` — storyteller 插图协议、Reply Projection、卡级入口和 `image-director` Agent。
4. `07-21-card-inline-illustration-ui/` — 正文分段渲染、插图卡交互、并发 `invokeAgent`、图片恢复和大图查看。

依赖关系：

- 父任务 Phase 0 先冻结唯一 shared runtime identity helper 合同；实际实现归 `packages/play-bridge/src/generated-media-identity.ts` 并从包根导出。
- 子任务 1 先交付该 shared helper、Provider/Tool 主体和无 guard 普通写入；`platform-web` 为此增加 `@tsian/play-bridge` 真实依赖与 TS path。子任务 3 只消费 helper，不得复制算法。
- 子任务 2 消费 shared helper，并拥有 guarded handoff 的 platform-host source-registration 与 storage seam；子任务 1 的 guarded staging 集成依赖该 seam，不能先在 `RuntimeWorkspaceTransaction` 内发明 `sourceGuard` metadata。
- 子任务 4 依赖子任务 3 的标签、projection、entrypoint 和 Agent 返回契约，也依赖子任务 1–2 的真实资产持久化语义；静态 UI 可在契约冻结后提前开发。
- 父任务最后进行一次端到端集成验收，不在父目录直接实现产品代码。

## Requirements

### R1. Platform capability boundary

- 平台提供 host-owned、可由多个 Agent 复用的 `generate_image` 平台 Tool，而不是卡内 browser-script Tool；平台 Tool 全局 `sourceGuard` optional，但本次 `image-director` use case required。`InvokeAgentRequest` 与 play-bridge `InvokeAgentOptions` 同步新增可选、通用命名的 `generatedMediaSourceGuard?: GeneratedMediaTurnProjectionGuard`；因 `InvokeAgentRequest` 属于共享 wire contract，必要的 serializable guard shape 可由 contracts 声明并由 play-bridge identity module re-export/type-consume，严格 normalizer、hash、canonical encoding/path 算法仍唯一归 `packages/play-bridge/src/generated-media-identity.ts`。platform-web 增加 `@tsian/play-bridge` 真实依赖/TS path。
- 无 invoke option 时，无 guard 的通用 Tool 调用写入 ordinary transaction；合法自带 Tool guard 进入 guarded path。正式 turn direct Tool 可无 guard。若 `invokeAgent.generatedMediaSourceGuard` 存在，host 先 strict-normalize 并把它作为 invocation-authoritative `requiredSourceGuard` closure 绑定给该调用内的 `generate_image` runner：Tool call 省略 `sourceGuard`、任一 guard 字段不匹配、或 `assetId` 不等于 host 从 required guard 派生的 identity，均在任何 Provider 付费请求与 workspace write 前以 `IMAGE_INVALID_ARGUMENTS` 失败，绝不降级 ordinary write；合法时 guarded handoff 必须使用 invocation option guard，Tool 字段只做一致性检查、不能改写 authority。其它合法 guarded 调用也由 host 在付费前重算并验证 `assetId`/path，图片验证后输出 `{ identityKey, assetPath, blob, sourceGuard }` 给一致性任务的 source-registration/storage seam；平台任务不把 sourceGuard 扩展为 transaction metadata，也不解析权威 turn projection。Tool 成功结果严格只有 `{ path, mediaType }`。
- 该 Tool 是高成本能力，不加入默认平台工具集；每个 Agent 必须显式启用。
- Provider 地址、密钥和模型属于平台本地配置，绝不进入卡包、Tool 入参、workspace、bridge payload、Agent 上下文或 trace。
- 首版只支持单一全局 OpenAI-compatible 配置，不建立多 preset 或通用 Provider 插件系统；控制面板测试使用平台内置固定短 prompt/方形画幅，只在页面内存预览。

### R2. Illustration output contract

- 插图采用玩家点击触发；开局 turn 0 和每个正式回合都要求 1–3 个 block，普通回合通常 1 个，只有多个独立重要画面时才增加到 2–3 个。UI 按正文顺序只让前 3 个 closed-schema valid block 可交互；更多 valid block 降级为不可交互描述卡，不增加调用或费用；invalid block 按统一 fallback/省略规则处理且不丢正文。
- 每块是 `additionalProperties:false` 的 closed `IllustrationBriefV1`，恰好包含 `title`、`description`、`sceneRef`、`entityRefs`。title/description 必须是 string，trim 后分别为 `1..80` / `1..500` UTF-16 code units；sceneRef 必须是 string、总长 `1..120` 且严格 `scene:<localId>`；entityRefs 必须是 `0..12` string array，每项总长 `1..120` 且严格 `<type>:<localId>`，去重保持首现顺序，重复本身不致 fallback。所有 ref 恰好一个 colon，每段 `1..80`，不得为 `.`/`..`，不得含 whitespace、`/`、`\\`、NUL 或额外 colon，允许其它 Unicode 非空字符。类型不得 coerce。
- block 只描述叙事画面，不得包含最终 prompt、negative prompt、Provider、model、hidden prompt 或具体像素参数。interactive validity 要求四字段整体合法；invalid object fallback 仅读取 string title/description，不 stringify/coerce，refs 永不显示。
- UI 使用一份 runtime validator（优先由 `@tsian/play-bridge` 窄 runtime module/root export，或卡 UI 单一 helper）；storyteller/image-director Prompt 自包含重述同一合同。`@tsian/contracts` 保持 type-only，平台 storage/source-registration 不理解 block schema。
- `content` 删除插图块，保持后续 LLM 上下文为纯正文；`displayContent` 保留块和原始位置；`projections.illustrations` 保存按出现顺序抽取的原始 JSON 字符串，projection 引擎不负责 JSON 解析。
- 格式错误必须 fail-soft：正文和开局继续落定，无效插图不触发整回合重试或失败。

### R3. Card Agent orchestration

- `image-director` 属于沉浸阅读器卡，前端通过可选 `GameCardRuntimeEntrypoints.imageGeneration?: { agentId: string; protocol: "tsian.image-director.v1" }` capability 发现；不引入更复杂 descriptor，禁止硬编码 Agent id。
- 沉浸阅读器 UI 每次调用必须双写同一 authoritative identity：Agent input JSON 含 helper-derived `assetId` 与完整 `sourceGuard`，同时 `invokeAgent` options 含逐字段相同的 `generatedMediaSourceGuard`。该 option 才是 host commit authority；不得信任 Agent input、Tool arguments 或 Agent final result 回显来建立 authority。
- local/package normalizers 和 host bridge 显式验证/透传 entrypoint object；play-bridge 将 `generatedMediaSourceGuard` 从 options 透传为 `InvokeAgentRequest`，remote bridge 对该 guard strict normalize，拒绝畸形/extra/非 canonical 字段而非静默删除。旧卡/旧调用无新增字段保持兼容。frontend ready/init 缓存 capability，只有 exact protocol v1 才允许交互，Agent id 只从 `.agentId` 读取；缺失、错误或未知 protocol 从首帧 fallback。
- `image-director` 读取点击时的最新场景与实体资料，不冻结历史视觉快照；使用卡内固定美术风格，不提供玩家风格选择或自定义；输出 `landscape | portrait | square` 语义画幅并调用 `generate_image`。
- storyteller 在 MVP 中不获得生图 Tool；未来自动插图可通过显式授权复用同一能力。

### R4. Inline frontend experience

- 前端把 assistant `displayContent` 解析成有序 Markdown 与插图段，使用唯一 closed-schema runtime validator；完整 marker block 始终从 Markdown 隔离。JSON/object schema 无效时仅读取 string title/description 且不 coerce，任一可用即渲染不可交互 fallback，否则省略；refs 永不显示。
- exact-v1 capability 在 frontend ready/init 时读取、校验并缓存为 reactive object；不得等玩家点击才首次发现缺失。capability pending/缺少/malformed/protocol 错误或未知时，所有 schema 合法 description card 从首次渲染起即为不可交互 fallback，正文/Composer 正常，开发 diagnostic 可定位。
- 未生成卡只显示标题与简述，不显示“生成插图/点击显影”、常驻费用或操作行；整卡一次明确 pointer/Enter/Space 激活即表示本次付费生成同意，不额外弹确认 modal，`aria-label` 为“生成插图：<title>”，in-flight 防重复。Settings 测试按钮仍需明确费用。
- 成图点击后打开大图；允许重新生成，新图生成期间保留旧图，成功后替换且只保留最新版本，失败时保留旧图。
- turn 0、实时回合、历史重载和 checkpoint restore 使用相同渲染语义。
- 流式阶段不得向玩家闪出未闭合的插图 marker。
- 每张图具有独立状态和 shared-helper 派生的稳定 identity/path；不同卡的最多三次付费调用自然并行，玩家仍可继续剧情；不增加全局队列、取消、配额或跨重载后台任务恢复。
- Object URL 必须在替换、恢复和卸载时释放。

### R5. Asset and checkpoint consistency

- 图片 Blob 是 save-runtime 媒体资产；正文投影是插图意图来源；临时 UI 状态和 Object URL 不持久化。guarded durable authority 来自 strict-normalized `invokeAgent.generatedMediaSourceGuard` 的 host closure 与其驱动的 source registration/exact-source CAS；Agent request/result guard 只用于执行输入与 UI correlation，不能授权 commit。
- 不同插图路径的并发提交必须合并，不能因正式回合提交陈旧 workspace 快照而丢失。
- 图片生成或重生成成功后，只补丁式更新对应资产及当前分支中适用的 checkpoint manifest；不得用未来 workspace 整体重建旧 checkpoint。
- 若来源 turn/插图块已因 restore 或分支改写而不存在，迟到结果必须丢弃。
- 重新生成只保留当前资产版本，并正确回收不再被 workspace 或 checkpoint 引用的旧 Blob。

### R6. Failure isolation

- Provider 拒绝、网络错误、无效响应、Agent 失败、图片读取失败，以及 required invocation guard 缺失 host 契约/Tool 漏 guard/任一 guard 字段 mismatch/错误 assetId，只影响对应插图卡，不影响已完成正文或其它并发图片。required guard 违规统一在 Provider 付费请求前 `IMAGE_INVALID_ARGUMENTS` fail，零 Provider 调用、零 ordinary/guarded write，不能降级。
- 不增加平台预审核、自动改写或自动重试；依赖所配置 Provider 的内容政策，拒绝时恢复对应卡片的可重试状态。
- 错误对 UI 使用简洁结构化信息；详细诊断进入 metadata-only trace，不记录密钥、完整 prompt 或图片内容。

### R7. Packaging and compatibility

- 两棵 source 只同步 task-owned files，禁止整树复制；`npm run build --workspace play-frontend-dev` 只做 TypeScript/Vite 开发检查，其 dist 不作为 checked-in card dist authority。
- UI child tooling scope 在实施时新增确定性仓库脚本（默认 `scripts/repack-game-card.mjs` 或同命令驱动的窄 helper）与根命令 `npm run repack:immersive-reader`。因为该链依赖平台 export inventory，UI child 必须先修复 `apps/platform-web/src/storage/game-card-packages.ts:685-689`：文本 workspace entry 的 `size` 使用 `strToU8(file.content).byteLength` 或等价 `new TextEncoder().encode(file.content).byteLength`，不得使用 `content.length`；并增加 ASCII、中文、emoji 文本及 binary entry size 回归。export/import inventory 的 `size` 统一定义为对应解压 ZIP entry payload `Uint8Array.byteLength`，非压缩 archive size；不改变字段可选性或其它 import 契约。脚本随后才可依赖修正后的 exporter。
- 脚本输入 card `frontend/src/**`、workspace、cover 与当前 manifest；通过隔离 Playwright/IndexedDB 驱动真实 `buildFrontend` → `writeBackDist` → `exportGameCardPackage`，确定性解包并原子替换 card dist、删除 stale hashes，再从磁盘重算 `workspaceFiles/frontendFiles/coverFiles` path/mediaType/实际 byte size/必要版本，拒绝 missing/extra/duplicate/type/size mismatch 并输出可重复 inventory。
- 验收必须比较真实 platform builder/export inventory 与 checked-in card inventory，并在 packaged iframe 验证。`npm run package:frontend` 只是 standalone source package，不是 checked-in repack 或平台 builder 验证；不得手工复制。
- 共享 contracts/bridge 发生变化时，`InvokeAgentRequest`、play-bridge `InvokeAgentOptions`、SDK 映射、remote bridge strict normalizer、platform host consumer 与 UI caller 必须在同一任务链中更新；运行 `npm run build:contracts`、`npm run build --workspace @tsian/play-bridge`、`npm run build:web` 和 `npm run build --workspace play-frontend-dev`。
- 不要求旧存档迁移；缺少插图 projection/资产的历史回合继续按普通正文显示。

## Acceptance Criteria

- [ ] AC1: 控制面板可保存单一图像 Provider 配置并执行一次不落盘的测试生成；API key 不离开平台秘密边界。
- [ ] AC2: 显式授权的 `image-director` 可通过通用 `generate_image` Tool 生成并持久化图片；未授权 Agent 看不到该 Tool。沉浸阅读器调用的 Agent input 与 `invokeAgent.generatedMediaSourceGuard` 必须携带逐字段相同的 helper-derived guard，Host 只把 option closure 当 commit authority。
- [ ] AC2a: required invoke option 存在时，Tool 漏 `sourceGuard`、guard 任一字段不匹配或 `assetId` 错误均在 Provider 前返回 `IMAGE_INVALID_ARGUMENTS`，零 Provider 调用、零 workspace/checkpoint write且不降级 ordinary write；完全匹配时成功走 option-authoritative guarded handoff。option 缺失时，Tool 无 guard 保持 ordinary write，合法自带 guard仍可进入 guarded path，正式 turn direct Tool 可无 guard；行为不依赖 agentId/purpose 字符串。
- [ ] AC3: 开局和正式回合可产生 1–3 个正文内 closed-schema block；title/description/ref 长度与 grammar、entityRefs 去重和 `additionalProperties:false` 由唯一 runtime validator 执行，Agent 上下文不含 UI 标签。按正文顺序前 3 个完整合法 block 可交互，更多合法 block 仅显示不可交互描述且不增加费用；invalid object fallback 不 coerce，正文仍保留正确 inline placement。
- [ ] AC3a: frontend ready/init 缓存 `{agentId,protocol}` capability；只有 exact `tsian.image-director.v1` 可交互，Agent id 只从 object 读取；缺失/invalid/未知 protocol 从首次渲染即降级全部 otherwise-valid description card，旧卡兼容且 diagnostic 可定位。
- [ ] AC4: 玩家可同时点击最多三张插图卡，生图期间继续故事，各卡独立完成或失败。
- [ ] AC5: 未生成整卡由一次 pointer/Enter/Space 激活即授权该次付费生成，aria-label 明确“生成插图：<title>”，无额外确认 modal、常驻费用/操作行且防重复；生成中、失败恢复、完成态、替换失败/成功和大图查看均符合 R4，完成态正文不显示标题或描述。
- [ ] AC6: 正式 turn 与并发生图交错提交时图片不丢失，trace 不重名，context slot 不发生规范化碰撞。
- [ ] AC7: checkpoint restore 能得到该节点应有的最新图片；恢复到来源之前不会被迟到结果重新污染，旧图片 Blob 可被回收。
- [ ] AC8: turn 0、实时回合、刷新重载和 restore 后均能从持久化投影与稳定资产路径重建 UI，且无 Object URL 泄漏；Agent result 的 request guard/path 只做 correlation，UI 读取和 durable commit authority 分别来自 pending helper identity 与 host option closure/source registration。
- [ ] AC9: Provider 失败、无效插图 JSON、缺失引用、invoke guard host 契约缺失及 required guard/asset mismatch 均 fail-soft，只使当前插图卡失败，不阻断正文、开局或其它图片；required guard 违规有零 Provider/零 write 证据。
- [ ] AC10: contracts、platform-web、开发前端构建通过；UI child 先把 `exportGameCardPackage` 文本 size 修正为 UTF-8 实际 ZIP entry bytes，并以 ASCII/中文/emoji 文本和 binary entry 回归锁定 import/export inventory 的真实-byte 定义；`npm run build:web` 通过后，`npm run repack:immersive-reader` 才通过真实 browser builder/write-back/export 链原子重建 card dist 与全量三类 inventory，exported/checked-in/disk inventory 双向一致且 packaged iframe 通过。`npm run package:frontend` 未被误当 authority，父任务完成跨子任务端到端验收。

## Out of Scope

- 角色形象图、地点概念图等其它消费端 UI，以及将插图能力同步进平台默认空白卡模板。
- storyteller 自动或同步生图模式。
- 玩家可选/自定义美术风格。
- 多图像 Provider presets、ComfyUI、自定义 endpoint/request/JSONPath 映射。
- 通用社区 Tool 配置入口或将 API key 暴露给 browser-script Tool。
- 图像内容平台预审核、自动提示词规避或自动重试。
- 全局任务队列、取消、进度百分比、费用配额、跨重载恢复正在运行的网络任务。
- 历史回合视觉快照和多版本图片画廊。
- 旧存档数据迁移。
