# 卡内插图 Agent 与输出协议

## Goal

为沉浸阅读器卡定义完整、可分发且可由前端发现的正文插图协议：`storyteller` 在开局 turn 0 与正式回合的正文原位置声明插图意图，Reply Projection 将模型上下文、展示文本和结构化投影分流，卡内专职 `image-director` 在玩家点击时读取最新世界状态并调用 host-owned `generate_image` 完成生图。

本任务只负责卡内 Agent/Prompt/投影、可选卡级 entrypoint、相关共享入口契约和卡包 workspace manifest；平台图像 Provider/Tool 实现、媒体与 checkpoint 一致性、正文插图 UI 分属兄弟任务。

## Background

- 正式回合已经通过通用 Reply Projection 生成 `content`、`displayContent` 与 `projections`；平台投影器只做字符串替换和抽取，不理解玩法 JSON。
- 开局由 `world-architect` 通过 `agent_call` 委派 `storyteller`，随后 `commit_play_setup` 已调用同一个 `tsian.reply.project()`，把投影后的 turn 0 与 clean context 一次落盘。
- 卡前端已经能通过 `tsian.card.entrypoints()` 读取卡级运行时入口，并通过 `invokeAgent` 发起不推进正式回合的旁路 Agent 调用。本协议还依赖 additive 的通用 `InvokeAgentRequest` / play-bridge `InvokeAgentOptions.generatedMediaSourceGuard?: GeneratedMediaTurnProjectionGuard`：UI 将与 Agent input 相同的 guard 经独立 option 通道发送，remote bridge 严格规范化后由 host 捕获为该 invocation 的权威 closure。
- Agent 平台 Tool 名称由共享联合类型和 registry allow-list 过滤；`platformTools.enabled` 非空时才是显式集合，空数组会回退默认 Tool 集。
- 实际沉浸阅读器卡与平台内置的 frontend-less 空白 workspace 模板是两个独立产品，并非必须逐文件镜像。

## Requirements

### R1. Storyteller illustration block

- `storyteller` 的开局 turn 0 与每个正式回合都必须在预期画面出现的正文原位置输出 1–3 个完整 block：

  ```text
  [[插图]]
  {"title":"…","description":"…","sceneRef":"scene:…","entityRefs":["character:…"]}
  [[/插图]]
  ```

- 每个 block 必须是 `additionalProperties: false` 的 closed object，恰好包含四个字段；interactive validity 要求四者整体合法：
  - `title`: string；trim 后长度 `1..80` UTF-16 code units；不 coerce；
  - `description`: string；trim 后长度 `1..500` UTF-16 code units；不 coerce；
  - `sceneRef`: string；trim 后总长度 `1..120` UTF-16 code units；严格为 `scene:<localId>`；
  - `entityRefs`: array，长度 `0..12`；每项是 string，trim 后总长度 `1..120`，严格为 `<type>:<localId>`；去重后保持首现顺序，重复项本身只做 normalize、不使 block fallback。
- 所有 ref 恰好含一个 colon。每个 segment 长度为 `1..80` UTF-16 code units，不得为 `.` 或 `..`，不得含 whitespace、`/`、`\\`、NUL 或额外 colon；允许其它非空 Unicode 字符。`sceneRef` 的 localId 与 entity type/localId 使用同一 segment rule；该边界与 `update_entity` 的安全边界一致或更严格。
- 普通回合默认只声明 1 幅插图；只有正文中存在多个彼此独立且重要的视觉时刻时才使用 2–3 幅。
- block 只表达“画什么”，不得包含最终 prompt、negative prompt、Provider、模型、像素尺寸或任何 Provider-specific 参数。
- `title` 与 `description` 供生成前的前端卡片展示；`sceneRef` 与 `entityRefs` 只供 `image-director` 定位资料，前端不得展示。
- block 不承担人物头像/角色形象图协议；`portrait` 仅可作为竖向画幅名称，不代表本任务支持人物头像功能。

### R2. One protocol for opening and formal turns

- 不创建开局专用 block、投影规则或 schema。开局与正式回合共享 R1 的唯一协议。
- `world-architect` 的既有 `agent_call storyteller` 步骤必须同步 `expectedOutput`，要求返回开局正文、正文原位置的 1–3 个插图 block、以及 3–5 个初始选项。
- `commit_play_setup` 继续接收完整 `openingReply` 并使用现有投影路径；不得因插图 block 缺失、数量不符或 JSON 畸形而拒绝开局提交或重新调用模型。

### R3. Reply Projection lanes

- 沉浸阅读器卡的 `workspace/config/reply-projection.json` 增加插图规则，并保留现有选项规则语义。
- 对每个完整的 `[[插图]]...[[/插图]]` 匹配：
  - 使用 `content: ""`，仅从后续 Agent/LLM 可见的 clean `content` 中删除 block；
  - 不设置 `display` 或 `text`，因此 `displayContent` 保留原 block、原内容与原位置；
  - 使用 `illustrations[]` append 语义，把捕获组经 `trim` 后的原始 JSON 字符串按出现顺序写入 `projections.illustrations`。
- 禁止使用 `text: ""` 处理插图，因为它会同时删除展示通道中的 inline placement。
- 通用 projector 不解析、不规范化、不修复插图 JSON，也不校验字段和 1–3 数量；这些属于卡前端消费边界。

### R4. Fail-soft structured output

- 插图是增强能力，不是 turn 或开局 commit invariant。
- 缺失、数量不符、JSON 畸形、字段缺失、ref 无效或未闭合 marker 均不得：
  - 阻断正文或开局完成；
  - 使正式回合失败；
  - 仅因插图问题触发 storyteller 重试；
  - 阻断同回合其它有效插图。
- 每个完整 `[[插图]]...[[/插图]]` marker 都必须与 Markdown 正文隔离，绝不能因 JSON/字段无效而回落成普通 Markdown 或泄漏原始 marker。
- 前端按正文顺序保留原 projection index；只有最先出现的三个 closed-schema valid block 可交互。第 4 个及后续 complete valid block 也渲染为不可交互描述块，不增加 Agent 调用或 Provider 成本。invalid block 不占这三个 valid 名额。
- 前端统一降级：
  - 四字段 closed schema（`additionalProperties: false`）、类型、trim 后长度、ref grammar 和 entityRefs 整体合法，且未 coerce：若属于最先三个 valid block，则是可交互描述块；超出三个则是不可交互描述块；
  - 完整 marker 的 JSON 成功解析为 object 但 schema 无效时，仍只读取 string 类型的 `title` / `description`，不 stringify 或 coerce；任一字段 trim 后可用就显示不可交互 fallback，两者均不可用则省略；
  - JSON parse 失败或成功解析为非 object：省略该 block；
  - `sceneRef` / `entityRefs` 永不展示。
- 对无法被 regex 识别的不完整 marker，projector 保持通用字符串 fail-soft 行为；UI 子任务负责在最终展示和流式展示时识别并隐藏破碎 marker，避免向玩家泄漏。
- 所有降级都不得阻断或隐藏 marker 之外的合法正文，也不得影响同回合其它有效插图。

### R5. Card-owned image-director

- 在实际沉浸阅读器卡 workspace 新增 `agents/image-director/agent.json` 与相邻 `AGENT.md`；缺少 `AGENT.md` 时 registry 会忽略该 Agent，因此两者都是必需文件。
- 新增卡内固定 style context，并由 `agent.json.contextPaths` 以稳定的 system/prelude 上下文注入；美术风格不得进入平台 Provider 配置。
- `image-director` 负责完整生成流程，而不是只返回 prompt：
  1. 校验 request 的 `assetId` 及完整通用 source guard `{ kind: "turn-projection", turn, projectionKey: "illustrations", index, fingerprint }`；
  2. 根据 `sceneRef`、`entityRefs` 读取调用时最新 `save/scenes/**` 与 `save/entities/**` 文件；
  3. 结合来源回合完整 clean prose、结构化 brief 和固定 style，组装 Provider-neutral prompt；
  4. 只选择 `landscape | portrait | square` 之一作为语义画幅；
  5. 调用 host-owned `generate_image`，并把 request 的 `assetId` 与 source guard 原样传递；
  6. Tool success 只含 `{ path, mediaType }`；Agent 把已验证 request 的 `assetId/sourceGuard` 原样回显到最终 result，并把 Tool fields 放入 `asset`。
- `generate_image` 的通用平台 Tool schema 将 `sourceGuard` 保持为 optional，以便其它非 turn-projection 用例复用；但在本卡 image-director 协议中它是 use-case-required：request 缺失 guard 或 `assetId` 时 Agent 不得调用 Tool，每次本卡 Tool 调用都必须原样传递两者。
- frontend 从 raw `projections.illustrations[index]` 调用 `@tsian/play-bridge` 唯一 shared helper，计算 fingerprint、完整 guard、`identityKey` 和 path。它必须把同一身份经两个独立通道发送：Agent input JSON 包含 `assetId: identityKey` 与 `sourceGuard`；`invokeAgent` options 包含 authoritative `generatedMediaSourceGuard: sourceGuard`。Agent 只严格验证并透传 input 副本，禁止 hash projection、改写 guard、发明 id/path；Agent final result 的 guard 只供 UI correlation，不能建立提交 authority。
- remote bridge 必须严格规范化 option guard；host `invokeAgent` 捕获 normalized option 为 `requiredSourceGuard` closure 并据此绑定 `generate_image` runner，不得从 `agentId`、`purpose`、Agent input 或 final result 推导 required 模式。required option 存在时，Tool 缺 guard、任一 guard 字段不匹配或 `assetId` 不等于 host 从 required guard 派生的 identity，均必须在任何付费 Provider 请求前以 `IMAGE_INVALID_ARGUMENTS` 失败，且 Provider 调用、ordinary write、guarded write/handoff/source registration 全为零，绝不降级为 unguarded ordinary write；合法 handoff 使用 closure guard，Tool 字段仅作一致性检查。
- 若 invoke option 缺失，通用 Tool 兼容性保持：Tool 无 guard 走 ordinary write；合法 Tool self-guard 可走 guarded path；formal-turn direct Tool call 可不带 guard。本卡 UI 始终使用 required option 路径。guarded metadata 只有两种合法来源：host-required-and-validated option path，或 option 缺失时合法 Tool self-guard。
- Tool result 不回显 guard 或 assetId。Agent final result 从已验证 request 回显两者；frontend 必须与 pending request 逐字段比对，且 host contract 缺失、拒绝或 identity mismatch 只使当前卡失败。result path 不具 authority；frontend 再用 shared helper 派生 path 并通过 `workspace.read` 读取。图片一致性层只接收 authority-validated handoff，再用同一 helper 验证 raw projection，并丢弃 restore/分支改写后的迟到结果。
- 点击时的 save workspace 是场景/实体的权威来源；不得在 turn projection、Agent 请求或其它卡文件中保存历史视觉快照。
- ref 缺失或不可读时，Agent 可利用其余有效引用、brief 与来源正文继续；若不足以安全生成，则仅使当前插图失败，不得伪造资产引用。
- `image-director` 不写通用 workspace 文件，也不自行 hash 或发明 assetId/asset path；它验证 request 后原样传给 Tool。host 按 `@tsian/play-bridge` shared helper 派生 expected identity/path，并在付费前校验 assetId。实际资产写入、来源校验与 checkpoint 一致性由 host-owned `generate_image` 及其提交链完成。

### R6. Expensive Tool visibility

- `generate_image` 是通用 host-owned 平台 Tool，先由 `07-21-platform-image-generation` 扩展共享 `AgentPlatformToolName`、registry allow-list、Tool schema/executor 和权限测试。
- `generate_image` 不得加入 `DEFAULT_AGENT_PLATFORM_TOOLS`。
- `image-director.platformTools.enabled` 必须是显式非空数组，且只含本流程所需能力：`workspace_read` 与 `generate_image`；不得因默认回退额外获得 `agent_call` 或 `workspace_write`。
- MVP 中 `storyteller` 不获得 `generate_image`。除平台“不进默认集”的硬约束外，卡内 storyteller 配置还应将其列入 `platformTools.disabled` 作为防御性声明。
- `world-architect`、`stage-manager` 和其它卡 Agent 也不得因本任务获得该 Tool。

### R7. Optional card entrypoint

- `GameCardRuntimeEntrypoints` 增加可选 protocol-versioned capability：`imageGeneration?: { agentId: string; protocol: "tsian.image-director.v1" }`；不引入更复杂 descriptor。
- 沉浸阅读器卡声明 `runtime.entrypoints.imageGeneration: { "agentId": "image-director", "protocol": "tsian.image-director.v1" }`。
- local Game Card normalization、package import/export normalization、platform host bridge 的已知字段白名单均必须保留并验证这个 closed object；旧卡无字段保持兼容。
- `@tsian/play-bridge` 继续通过现有 `tsian.card.entrypoints()` 返回共享类型，不增加 image-director 专用 RPC；只对现有通用 invoke RPC additively 增加 `InvokeAgentRequest` / `InvokeAgentOptions.generatedMediaSourceGuard?` 并沿 remote host 严格传播。
- UI 在 frontend ready/init 时读取并缓存该 capability；只有 `protocol === "tsian.image-director.v1"` 且 `agentId` 合法时才可交互。字段缺失、错误或未知 protocol 从首帧起把所有 otherwise-valid 描述卡降级为不可交互 fallback，不得等玩家激活后才发现。
- UI 只能从 cached `imageGeneration.agentId` 取得 Agent id，禁止硬编码 `image-director`；未声明入口的旧卡必须继续正常游玩。
- 对最先三个可交互 valid block，未生成态采用整卡 pointer/Enter/Space 激活；一次明确激活即表示同意该次付费生成，不增加确认 modal，不显示常驻费用或“点击显影/生成插图”action row，精确 `aria-label="生成插图：<title>"`，in-flight 时阻止重复激活。Settings 测试按钮仍必须明确提示真实费用。

### R8. Actual card and package manifest

- 卡包三类 inventory 的 `size` 统一定义为对应解压 ZIP entry payload `Uint8Array.byteLength`，不是压缩 archive size；文本即 UTF-8 编码后的 bytes，binary 即原始 entry bytes，禁止使用 UTF-16 `string.length`，且不改变字段可选性或其它 import 契约。现有 `exportGameCardPackage` 在 `apps/platform-web/src/storage/game-card-packages.ts:685-689` 尚违反此定义；修复及 ASCII/中文/emoji 文本、binary 回归归 UI/repack tooling sibling，Protocol task 不单独修改 exporter。
- 本任务同步实际卡 `cards/沉浸阅读器.tsian-card/workspace/**` 的 storyteller、world-architect 委派说明、Reply Projection 与新 Agent 文件。
- `cards/沉浸阅读器.tsian-card/game-card.json` 必须：
  - 更新内层 manifest 的 `runtime.entrypoints.imageGeneration`；
  - 为所有新增 workspace 文件增加唯一、正确的 path/mediaType/UTF-8 byte size；
  - 更新所有被修改 workspace 文件的 byte size；
  - 保证列出的文件存在、无重复，且实际 workspace 文件没有漏列。
- 卡版本只在 protocol、UI 和最终打包产物汇合后统一递增一次，避免兄弟任务各自重复 bump；最终集成负责人拥有这次版本与全量 manifest 校验。
- UI 子任务拥有 `frontend/src`、开发前端副本、`frontend/dist` 和相关 `frontendFiles` 更新；两个任务会修改同一 `game-card.json`，合并后必须重新进行全量 path/size 校验。

### R9. Default template decision and sibling boundaries

- 不把沉浸阅读器专属 `image-director`、插图 Prompt 或 Reply Projection 复制到 `apps/platform-web/src/storage/workspace-templates/**` 的内置空白模板。
- 理由是该模板与实际卡并非镜像，且当前没有沉浸阅读器 frontend/投影消费者；复制会制造无人消费的数据并可能显示原始 marker。
- 平台通用 entrypoint normalizer/bridge 支持仍需更新，使任何未来卡都可以选择声明 `imageGeneration`。
- 依赖边界：
  - 平台图像任务拥有 `InvokeAgentRequest` / `InvokeAgentOptions.generatedMediaSourceGuard?` additive contract、remote strict normalization、host `requiredSourceGuard` closure、required mismatch 的 pre-Provider zero-call/zero-write gate，并导出 `packages/play-bridge/src/generated-media-identity.ts` 的唯一 runtime helper，同时拥有 Provider/Tool schema、guard normalization、付费前 assetId binding 与 guarded host handoff；required routing 不按 `agentId`/`purpose` 硬编码；
  - 图片一致性任务拥有 card-agnostic source-registration、权威 raw projection 验证、exact-source storage metadata、并发提交、checkpoint patch、restore 与 Blob GC；
  - UI 任务消费 shared helper，并拥有正文 block 的唯一 runtime validator（优先放在 `@tsian/play-bridge` 的窄 runtime module 并从 package root 导出；若实现评估证明只需卡 UI helper，也必须保证 UI 仅一份 validator）；该 validator 严格执行 R1 closed schema。storyteller 与 image-director Prompt 必须自包含重述同一边界；
  - UI 任务另拥有 first-three interactivity、ready/init capability、inline placement、调用输入构造、状态/并发、资产读取与 whole-card interaction；
  - 本任务拥有卡侧 schema 与自包含 Prompt、Agent pass-through、entrypoint 与 workspace manifest；`@tsian/contracts` 保持 type-only，不放 runtime validator；
  - 平台 storage/source-registration 只理解 generic turn/projection raw string，不解析 illustration block、entrypoint capability 或 ref grammar。
- 在兄弟契约尚未落地时不得私自发明 Provider 参数、checkpoint 语义或前端持久状态。

## Acceptance Criteria

- [ ] AC1: 开局委派说明与 storyteller 正式输出说明使用同一 closed illustration brief schema；两者自包含精确 title/description 长度、scene/entity ref grammar、entityRefs 0..12 去重规则及 `additionalProperties:false`，要求正文原位置 1–3 块，普通回合明确默认 1 块。
- [ ] AC2: 1、2、3 个完整 block 的投影结果均满足：clean `content` 无插图 block，`displayContent` 保留原位置，`projections.illustrations` 是按顺序追加的原始 JSON 字符串数组。
- [ ] AC3: 完整 marker 内的无效 JSON、缺块、超量和未闭合 marker 均 fail-soft；完整 marker 始终与 Markdown 隔离。只有正文顺序最先三个 closed-schema valid block 可交互，额外 valid block 为不可交互描述块且不增加调用/Provider 成本；object-invalid fallback 仅读取 string title/description 且不 coerce，有任一可用字段时显示，无可用字段或 parse failure 时省略；任何情形都不阻断 turn 0、正式正文或 commit，也不因插图单独重试。UI 只有一个 runtime validator，平台 storage/source-registration 不解析 block schema。
- [ ] AC4: frontend 将同一 helper-derived 身份经双通道发送：Agent input 带 `assetId`/完整 `{kind:"turn-projection",turn,projectionKey:"illustrations",index,fingerprint}` guard/完整来源 prose/结构化 brief，invoke options 带 authoritative `generatedMediaSourceGuard`。Agent 不 hash/发明 id，只校验并把 input 副本原样传给 Tool；Tool 只返回 `{path,mediaType}`；Agent final result 从 request 回显 assetId/guard 并把 Tool fields 放入 asset，但 echo 只用于 UI correlation。
- [ ] AC4b: remote bridge 严格规范化 invoke option，host 捕获 `requiredSourceGuard` closure 且不按 `agentId`/`purpose` 路由。required option + Tool omitted guard、wrong guard 或 wrong derived `assetId` 均在 Provider 前返回 `IMAGE_INVALID_ARGUMENTS`，Provider/ordinary write/guarded write-handoff/source registration 都为零且无 ordinary downgrade；exact match 成功并只用 closure guard handoff。无 option + 无 Tool guard 仍支持 ordinary write，无 option + valid Tool self-guard 可 guarded，formal-turn direct Tool 可无 guard；缺失 host contract/mismatch 只失败当前卡。
- [ ] AC4a: frontend ready/init 缓存 `{agentId,protocol}` entrypoint capability；只有 exact `tsian.image-director.v1` 可交互，缺失/错误/未知 protocol 从首帧降级，Agent id 只从 `imageGeneration.agentId` 读取。可交互未生成卡以整卡 pointer/Enter/Space 激活作为单次付费同意，无确认 modal/常驻费用或 action row，`aria-label="生成插图：<title>"` 且 in-flight 去重。Settings 测试费用警告不变。
- [ ] AC5: 固定统一 style 位于卡内 Agent prompt/context；卡包与平台配置中没有玩家风格选项、Provider secret、最终 prompt 或 Provider-specific 参数。
- [ ] AC6: `generate_image` 只对显式授权的 `image-director` 可见；storyteller 和其它卡 Agent 看不到该 Tool，且默认 Tool 集不包含它。
- [ ] AC7: 前端可通过 `tsian.card.entrypoints().imageGeneration` 发现 `{agentId,protocol:"tsian.image-director.v1"}`；共享 contract、两条 manifest normalization 路径和 host bridge 均保留并逐字段验证可选 object，前端没有硬编码 Agent id。
- [ ] AC8: 实际沉浸阅读器卡声明新 entrypoint，所有新增/变更 workspace 文件在 package manifest 中的 JSON、path、mediaType 和实际 ZIP entry byte size 正确且无遗漏/重复；文本 size 按 UTF-8 bytes，binary 按原始 bytes。最终 exported/checked-in/disk 三方校验依赖 UI sibling 先修正 exporter，并以 ASCII/中文/emoji/binary 回归证明。
- [ ] AC9: 内置空白 workspace 模板不含沉浸阅读器专属 Agent/marker/projection，既有卡缺少新 entrypoint 时保持兼容。
- [ ] AC10: opening delegation/projection、1–3 block、invalid block、Tool visibility、entrypoint normalization/bridge 与 manifest path/size 检查均有可重复验证证据。
- [ ] AC11: `npm run build:contracts`、`npm run build --workspace @tsian/play-bridge`、`npm run build:web` 和 `git diff --check` 通过；最终与 UI 汇合后卡前端构建/打包也通过。

## Out of Scope

- 角色头像、角色形象图或其它独立画廊消费端。
- storyteller 同步或自动调用生图 Tool。
- 玩家可选、自定义或每张图切换美术风格。
- Provider 配置、secret、模型选择、实际 HTTP adapter 与测试生成 UI。
- 图片资产事务、稳定路径最终编码、checkpoint/restore、并发合并与 Blob GC。
- inline 插图 Vue 组件、流式 marker 处理、大图查看、重生成交互和 Object URL 生命周期。
- 历史视觉快照、旧存档迁移、自动重试、任务队列、费用/进度管理。
