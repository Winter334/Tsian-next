# Implement — 卡内插图 Agent 与输出协议

## Phase 0: Dependency and contract gate

本阶段只对齐兄弟任务，不写产品代码。以下契约已由本轮规划冻结；实施开始时逐项确认 sibling 落地位置和版本后再做卡侧集成：

- [ ] 与 `07-21-platform-image-generation` 确认 `generate_image` 的最终 Tool name、Provider-neutral `prompt`、`aspect`、`assetId`、optional `sourceGuard` 和 success exactly `{ path, mediaType }`；Tool 不回显 guard/assetId，通用 Tool 不强制所有调用方携带 guard。
- [ ] 确认平台任务会同时扩展 `AgentPlatformToolName`、registry allow-list、Tool schema/executor，且不会把 `generate_image` 放入 `DEFAULT_AGENT_PLATFORM_TOOLS`。
- [ ] 冻结并只消费 `packages/play-bridge/src/generated-media-identity.ts` 的唯一 shared helper/package-root export：strict guard normalization、exact persisted raw `$1|trim` fingerprint、NUL identity、asset path 与 golden vector。禁止在本任务/Agent Prompt/contracts 再实现 hashing/canonicalization。
- [ ] 与 `07-21-image-save-consistency` 确认平台 guarded handoff `{identityKey,assetPath,blob,sourceGuard}`、card-agnostic source registration 与最终 exact-source storage metadata；本任务不定义 storage seam。
- [ ] 与 `07-21-card-inline-illustration-ui` 冻结 exact request/result、first-three-valid interactivity、ready/init `{agentId,protocol}` capability、whole-card paid activation 与 fallback。
- [ ] 冻结唯一 illustration brief runtime validator：closed 四字段 object，title `1..80`、description `1..500`、sceneRef/entityRef grammar、entityRefs `0..12` 首现去重、`additionalProperties:false`；优先由 `@tsian/play-bridge` 窄 runtime module/package root 导出，或卡 UI 单一 helper，禁止两份 UI validator。Prompt 必须自包含同一合同，storage 不解析。
- [ ] 确认 request 含 `assetId: identityKey` 和 `{kind:"turn-projection",turn,projectionKey:"illustrations",index,fingerprint}`；UI 同时把同一 guard 放入 `InvokeAgentOptions.generatedMediaSourceGuard`。Agent 只验证/原样透传 input 副本，不 hash/发明 id；Agent result 从 request 回显 assetId/guard 仅供 UI correlation，把 Tool path/mediaType 放入 asset。
- [ ] 确认 `InvokeAgentRequest` 与 play-bridge `InvokeAgentOptions` additively 声明 optional generic `generatedMediaSourceGuard?: GeneratedMediaTurnProjectionGuard`，SDK 明确转发；remote bridge 严格 normalize malformed/extra/noncanonical input 并拒绝而非静默丢弃。
- [ ] 确认 invokeAgent host 捕获 normalized option 为 authoritative `requiredSourceGuard` closure 并绑定 runner；required guard 存在时 Tool 缺 guard、任一字段 mismatch 或 wrong derived assetId 在 Provider 前 `IMAGE_INVALID_ARGUMENTS`，Provider/ordinary write/guarded handoff/source registration 全为零且不得 ordinary downgrade；legal handoff 只用 closure guard。
- [ ] 确认 option 缺失时仍保留 no Tool guard ordinary write、valid Tool self-guard guarded path 和 formal-turn direct unguarded compatibility；不得按 `agentId`、`purpose` 或 Agent result 硬编码行为。guarded metadata 只可来自 validated required option 或 option 缺失时 valid self-guard。
- [ ] 记录基线 build/status；保留无关 worktree 变更。

Exit gate: 四个任务对 raw fingerprint、shared helper、guard/request、Tool result、Agent result、closed brief schema、single runtime validator、first-three policy、exact-v1 entrypoint timing 和 paid whole-card activation 使用同一合同。

## Phase 1: Extend the optional Game Card entrypoint

### 1.1 Shared contracts

- [ ] 在 `packages/contracts/src/game-card.ts` 的 `GameCardRuntimeEntrypoints` 添加 `imageGeneration?: { agentId: string; protocol: "tsian.image-director.v1" }`。这是 protocol-versioned optional capability，不增加更复杂 descriptor；Agent id 必须由卡声明，frontend 不硬编码。
- [ ] 复核 `packages/contracts/src/bridge.ts` 的 Card bridge 继续直接返回共享 entrypoint 类型；不增加 image-director 专用 RPC。通用 `interaction.invokeAgent` payload 则按 Phase 0 additive 增加 `generatedMediaSourceGuard?`。
- [ ] 确认 contracts public index 已经导出 `game-card.ts` 类型；若已导出则不做无意义改动。

### 1.2 Producers and consumers

- [ ] 更新 `apps/platform-web/src/storage/game-cards.ts` 的 local manifest normalizer：存在时只接受 closed object，`agentId` 为 trim 后非空 string，`protocol` exact `"tsian.image-director.v1"`，拒绝 extra fields，并保留 normalized object。
- [ ] 更新 `apps/platform-web/src/storage/game-card-packages.ts` 的 package normalizer，使用与 local path 一致的 object/protocol 语义和明确错误码。
- [ ] 保持既有规则：`runtime.entrypoints` 一旦提供仍要求 `playerTurn`；不要借此任务重构整个 entrypoint schema。
- [ ] 更新 `apps/platform-web/src/platform-host/index.ts` 的已知字段白名单，把 normalized `imageGeneration` object 显式复制给 Card bridge；仍不透传任意未知 manifest/object 字段。
- [ ] 更新 `packages/play-bridge/src/tsian-api.ts` 注释，说明 `entrypoints()` 可返回 post-turn 与 image-generation 入口；实现继续用共享类型，不增加硬编码 id 或专用方法。

### 1.3 Entrypoint validation

- [ ] 覆盖 local/package normalizer 的合法 closed object、缺字段旧卡、non-object、空白/non-string `agentId`、缺失/错误/未知 protocol 及 extra object field 用例。
- [ ] 验证 host bridge 返回声明的 normalized `imageGeneration` object，未声明时字段缺失而不是默认 `image-director`；UI 只有 exact v1 才启用。
- [ ] 验证 play bridge 消费共享 entrypoint 字段，不新增 image-director 专用 method；通用 invoke method 的 additive option/request 字段完整传播。

Exit gate: 合法 entrypoint 从 package/local manifest 一直传到 `tsian.card.entrypoints()`，旧卡行为不变。

## Phase 2: Add the card-owned image-director

### 2.1 Agent files

在 `cards/沉浸阅读器.tsian-card/workspace/agents/image-director/` 新增：

- [ ] `agent.json`：id/title/summary、fixed-style context、empty skills/user tools、explicit platform Tools、workspace access、ephemeral entry mode。
- [ ] `AGENT.md`：完整 request validation、ref-to-path 映射、点击时读取、aspect 判定、Provider-neutral prompt 编排、Tool 调用和 exact result JSON。
- [ ] `visual-style.md`：卡级唯一固定美术风格；只写画面语言与硬禁项，不包含 Provider/model/尺寸/API 配置。

`agent.json` 的关键断言：

- [ ] `platformTools.enabled` 精确为 `workspace_read`、`generate_image`，且数组非空。
- [ ] 不启用 `workspace_write`、`agent_call` 或 semantic search。
- [ ] `entryMode` 为 `ephemeral`。
- [ ] `contextPaths` 对 `visual-style.md` 使用 system/prelude。
- [ ] 相邻 `AGENT.md` 存在，registry 能收录该 Agent。

### 2.2 Request handling SOP

- [ ] 只接受 `schema: "tsian.image-director.request.v1"`。
- [ ] 验证完整 `sourceGuard.kind === "turn-projection"`、非负 `turn/index`、固定 `projectionKey === "illustrations"`、fingerprint、helper-derived canonical `assetId`、完整 `prose`，并按 Phase 3.0 的唯一 closed-schema validator 合同验证 `brief`。
- [ ] `image-director` 不重算/hash/重编号 source guard，不发明 identity/path；调用 `generate_image` 时把 request 的 `assetId` 与完整 guard 原样传递。
- [ ] 明确把 `scene:<localId>` 映射到 `save/scenes/<localId>.json`，把 `<type>:<localId>` 映射到 `save/entities/<type>/<localId>.json`；拒绝把输入 ref 直接当任意路径。
- [ ] 所有 scene/entity 读取发生在 invocation 执行时；不要求或保存历史视觉 snapshot。
- [ ] 单个 ref 缺失时使用剩余有效资料；无足够画面信息时失败当前 invocation，不伪造文件内容。
- [ ] 从 `landscape | portrait | square` 选择一个 aspect；默认环境/多人叙事使用 landscape，portrait 只表示竖向构图而非头像产品。
- [ ] prompt 仅含当前可见主体/动作、环境/时代/天气/光线、构图和 fixed style，Provider-neutral。
- [ ] Tool 调用包含 request 的完整 `assetId/sourceGuard`；虽然平台 Tool guard 为 optional，本卡用例要求必填，缺失时 Agent 不得开始生图。
- [ ] Tool success 严格只接受 `{path,mediaType}`。Agent 成功只返回 `tsian.image-director.result.v1` JSON，从 validated request 原样复制 `assetId/sourceGuard` 供 UI correlation，把 Tool fields 放入 `asset`；明确 final echo 不提供 commit authority。
- [ ] 最终回复不含 Markdown fence、解释、prompt、Provider、尺寸、URL/base64 或 scene/entity 原文。

### 2.3 Tool dependency integration

- [ ] 平台 Tool 未合入时，保留明确阻塞状态；不要用 card-local browser script 替代通用 Tool。
- [ ] 平台 Tool 合入后验证 Agent Tool schema 中确实出现 `generate_image`。
- [ ] 验证 Tool trace/persisted debug 只含 metadata，完整 prompt、secret 与图片 payload 均被平台任务隐藏。
- [ ] 验证 `generate_image` 自行拥有媒体写入，不因此给 Agent generic `workspace_write`。

Exit gate: image-director 可被发现，只看到必需 Tools，按最新 workspace 状态完成一次成功调用并返回 exact short JSON。

## Phase 3: Update storyteller and opening delegation

### 3.0 Shared illustration brief contract

- [ ] 实现/消费 UI 唯一 runtime validator；优先位置为 `packages/play-bridge/src/illustration-brief.ts` 并从 package root 导出（若采用 card UI helper，仍只允许这一份 runtime implementation）。`@tsian/contracts` 保持 type-only。
- [ ] closed object 恰好四字段且 `additionalProperties:false`；所有 trim 后长度按 UTF-16 code units：title `1..80`、description `1..500`、sceneRef/entityRef 总长 `1..120`；严格拒绝 coercion。
- [ ] sceneRef 严格 `scene:<localId>`；entityRefs 是长度 `0..12` 的 string array，每项 `<type>:<localId>`，去重保持首现顺序，重复本身不触发 fallback。
- [ ] ref 恰好一个 colon；segment `1..80`，不得为 `.`/`..`，不得含 whitespace、`/`、`\\`、NUL 或额外 colon，允许其它 Unicode 非空字符；与 `update_entity` 边界一致或更严格。
- [ ] invalid object fallback 只读取 string title/description，不 stringify/coerce；任一字段在其边界内可用即可显示不可交互 fallback；refs 永不显示。
- [ ] storyteller、opening delegation 和 image-director Prompt 均自包含重述同一边界；platform storage/source-registration 不导入该 validator、不 parse projection JSON。

### 3.1 Formal storyteller output

- [ ] 在 `workspace/agents/storyteller/output-format.md` 增加自包含的插图格式段：closed 四字段 schema、完整长度/ref grammar、`additionalProperties:false`、inline placement、1–3 数量、普通回合默认 1、2–3 的使用判据和禁止字段。
- [ ] 给出一个 compact JSON example，避免模型输出 Markdown code fence 或把 marker 堆到结尾。
- [ ] 在输出前 checklist 增加：每个有效 block 描述独立可见时刻、refs 指向当前叙事对象、没有最终 prompt/Provider 参数。
- [ ] 保持已有正文长度、人称、选项和文风规则，不把插图文字算成替代正文。

### 3.2 Storyteller Tool denial

- [ ] 在 `workspace/agents/storyteller/agent.json` 的 `platformTools.disabled` 显式加入 `generate_image`。
- [ ] 不在 storyteller 的 enabled、Skills 或 user Tools 中增加生图入口。
- [ ] 结合平台默认集测试，确认 storyteller 看不到 Tool；不能只靠 Prompt 说“不要调用”。

### 3.3 Opening delegation

- [ ] 更新 `workspace/agents/world-architect/skills/游玩设定/SKILL.md` 第 3 步 `agent_call storyteller` 的 `expectedOutput`：开局正文 + 正文原位置 1–3 插图块 + 3–5 初始选项。
- [ ] 直接自包含重述共享 block 的 closed schema、长度/ref grammar、entityRefs 去重与禁止内容，使按需加载的 Skill 不假设已读 storyteller `output-format.md`。
- [ ] 更新 `openingReply` action description，只说明整体可能含 illustrations/choices；不把插图变成 action input schema 的硬校验项。
- [ ] 不修改 `commit-play-setup.js` 去 parse/count illustration，也不新增 opening-only retry。

Exit gate: opening 与正式 turn 使用同一种 block，且 storyteller 是唯一负责声明插图意图的叙事 Agent。

## Phase 4: Configure Reply Projection

- [ ] 在 `workspace/config/reply-projection.json` 增加全局匹配完整 marker 的 `illustrations` 规则。
- [ ] 使用 `content: ""`；禁止使用 `text: ""` 或 `display: ""`。
- [ ] 使用 `"illustrations[]": "$1|trim"`，保留 raw JSON string 和出现顺序。
- [ ] 保留 choices 规则现有 `text: ""` / `choices` 行为。
- [ ] 不给 projector 增加 illustration schema、JSON.parse、字段修复或数量判断。

### 4.1 Projection fixtures

准备可重放 fixture，至少覆盖：

- [ ] 1 块、2 块、3 块，分别位于段落之间而非全部结尾。
- [ ] illustrations 与 choices 同时存在。
- [ ] 完整 marker 内合法 JSON。
- [ ] 完整 marker 内 malformed JSON。
- [ ] JSON 缺字段、含禁止字段。
- [ ] 0 块、4+ valid 块和未闭合 marker。

每个完整 marker fixture 断言：

- [ ] `content` 清掉 block。
- [ ] `displayContent` 保持 block 与相对位置。
- [ ] `projections.illustrations` 是 string array 而非 parsed objects。
- [ ] 多块顺序与正文一致。
- [ ] 验证完整 marker 无论 JSON 是否有效都与 Markdown 正文隔离，不把 marker/raw JSON 交回 Markdown renderer。
- [ ] 按正文顺序只有最先三个 closed-schema valid block 可交互；额外 valid block 为不可交互描述块且不调用 Agent/Provider；invalid block 不占三个名额。
- [ ] object-invalid fallback 仅读取 string title/description，不 stringify/coerce；任一合法可用则显示，二者均不可用或 JSON parse failure 时省略。
- [ ] 未闭合 marker 的 final/stream 防泄漏由 inline UI 子任务验证；projector 不增加玩法 parse。
- [ ] invalid block 不使 projector 抛错或使 turn/opening commit 失败。

未闭合 marker 断言 projector 保持既有 fail-soft；原始 marker 的最终 UI 隐藏属于 inline UI 子任务，不在 projector 添加玩法补丁。

Exit gate: `content` / `displayContent` / `projections` 三通道行为与 PRD 完全一致。

## Phase 5: Add the card entrypoint and package workspace manifest

### 5.1 Inner card manifest

- [ ] 在 `cards/沉浸阅读器.tsian-card/game-card.json` 的 inner manifest 添加：
  ```json
  "imageGeneration": {
    "agentId": "image-director",
    "protocol": "tsian.image-director.v1"
  }
  ```
- [ ] 不修改已有 `playerTurn` 与 `postTurnMaintenance`。
- [ ] 验证 entrypoint id 在实际 card workspace registry 中存在。

### 5.2 Workspace file list and byte sizes

- [ ] 为 `workspace/agents/image-director/agent.json`、`AGENT.md`、`visual-style.md` 新增 `workspaceFiles` entries。
- [ ] 更新 storyteller output/agent config、world-architect Skill、Reply Projection 等所有实际修改文件的 size。
- [ ] `mediaType` 使用 `application/json` 或 `text/markdown`，与现有清单惯例一致。
- [ ] 使用 `Buffer.byteLength(fileContents)` / 实际文件 buffer byte length 计算与 ZIP entry payload 一致的 UTF-8/binary bytes，不使用字符数。
- [ ] 记录 exporter 依赖：现有 `apps/platform-web/src/storage/game-card-packages.ts:685-689` 的文本 `content.length` 会使中文/emoji exported inventory 错误；由 UI/repack tooling sibling 先改为 `strToU8(...).byteLength` 或等价 `TextEncoder`，补 ASCII/中文/emoji/binary 回归并运行 `npm run build:web`。本 Protocol task 不复制该平台修复。
- [ ] 全量比较 `workspaceFiles` 与 `workspace/**`：无遗漏、无不存在 path、无重复 path。
- [ ] 不因新增 Agent 修改只描述目录机制的 `workspace/agents/README.md`。

### 5.3 Coordination with frontend packaging

- [ ] 不修改 `frontend/src`、`apps/play-frontend-dev/src`、`frontend/dist`；这些属于 inline UI 子任务。
- [ ] 记录 `game-card.json` 是两个子任务共享修改点；UI 合入后重新计算全量 workspace/frontend/cover paths 与 sizes。
- [ ] card version 由父任务最终集成统一 bump 一次；本任务不要独立反复递增。
- [ ] 最终集成执行 `npm run repack:immersive-reader`，再全量验证 manifest；该命令由 UI child 在实施时加入根 `package.json`，先修平台 exporter 的 UTF-8 entry-size 语义并通过 ASCII/中文/emoji/binary 回归与 `npm run build:web`，再通过真实 browser builder/export path 生成 checked-in card 产物。
- [ ] 明确 `npm run package:frontend` 仅打 standalone frontend source package，不是 checked-in card repack authority，也不替代平台真实 builder 验证。

Exit gate: 当前卡包 JSON 可解析，workspace path/mediaType/byte size 全部一致。

## Phase 6: Preserve the independent blank template

- [ ] 不修改 `apps/platform-web/src/storage/workspace-templates/agents/storyteller.ts`、`world-architect.ts`、`files.ts` 或 builtin blank manifest 来复制卡专属协议。
- [ ] 增加/执行断言：builtin blank workspace 不含 `image-director`、`[[插图]]` projection/prompt，也不声明 `imageGeneration`。
- [ ] 通用 contract/normalizer/bridge 仍允许未来其它卡主动 opt in。
- [ ] 若实现期间发现产品已让 builtin blank 使用沉浸阅读器同一 frontend，暂停并重新确认 parent scope；不要静默改变本决策。

Exit gate: 通用能力可用，但 frontend-less blank template 没有无人消费的卡专属数据。

## Phase 7: Behavioral and integration validation

### 7.1 Opening and turn behavior

- [ ] 用 opening fixture 走 `agent_call storyteller → commit_play_setup → tsian.reply.project` seam，确认 turn 0 assistant item 含 display/projections，storyteller context 只含 clean content。
- [ ] opening 缺 illustration 或含 malformed illustration 时仍成功 commit，且没有仅因 illustration 触发 retry。
- [ ] 正式 turn 的 1/2/3 blocks 均通过三通道断言。
- [ ] malformed/非 object/缺字段/超量 block 按统一 UI 降级：完整 marker 始终与 Markdown 隔离；最先三个 valid block 可交互，额外 valid block 为零调用 fallback；object-invalid 仅显示原值为 string 且 trim/长度合法的 title/description，不 coerce，二者均不可用或 parse failure 时省略；所有情形不影响正文或其它有效项。

### 7.2 Agent, invoke authority and Tool behavior

- [ ] registry 在 `agent.json + AGENT.md` 齐全时发现 image-director；缺 SOP fixture 时不发现。
- [ ] image-director 可见 Tools 精确为 `workspace_read`、`generate_image`。
- [ ] storyteller、world-architect、stage-manager 与默认 Tool 集均不含 `generate_image`。
- [ ] 同一 source request 修改 scene/entity fixture 后再次调用，确认使用新资料而不是 turn-time snapshot。
- [ ] scene 或部分 entities 缺失时 fail-soft；没有 Tool success 时不返回伪造 asset。
- [ ] aspect 只可能是 landscape/portrait/square。
- [ ] UI 发送 equal Agent-input `sourceGuard` 与 option `generatedMediaSourceGuard`；strict remote normalizer 对 malformed/extra/noncanonical option fail closed，不静默删除。
- [ ] required option + Tool omitted guard：`IMAGE_INVALID_ARGUMENTS` pre-Provider，Provider=0、ordinary writes=0、guarded writes/handoffs/source-registration=0。
- [ ] required option + any guard mismatch：同样 zero Provider/zero writes/no downgrade；required option + wrong `assetId`：同样失败。
- [ ] required option + exact Tool guard + derived assetId：成功，且 spy 证明 handoff guard 来自 host closure，Tool fields 不能覆盖 authority。
- [ ] no option + no Tool guard：ordinary write 仍支持；no option + valid Tool self-guard：guarded path；formal-turn direct Tool 无 guard 仍支持。
- [ ] 更换 `agentId`/`purpose` 不改变上述矩阵；缺失 host contract 或 bridge rejection 只让当前插图卡失败，不影响其它卡/正式 turn。
- [ ] success Tool payload 精确为 `{path,mediaType}`；Agent result 是 frontend 可 `JSON.parse` 的单个短 JSON object，从 request 回显 matching `assetId/sourceGuard` 仅供 correlation，不声称 Tool 回显 guard 或获得 durable authority。

### 7.3 Entrypoint and package behavior

- [ ] frontend ready/init 读取并缓存 `tsian.card.entrypoints().imageGeneration` object；只有 `protocol === "tsian.image-director.v1"` 且 agentId 合法才启用，消费路径没有 `"image-director"` 字面量；missing/invalid/unknown protocol 从首帧把 otherwise-valid 卡降级，不等待玩家激活。
- [ ] whole-card pointer/Enter/Space 一次激活即同意该次付费生成；exact `aria-label="生成插图：<title>"`，无额外 confirmation modal/常驻费用/action row，in-flight 防重复；Settings test 仍显示费用警告。
- [ ] 旧卡没有新字段时正常导入、选择和游玩。
- [ ] invalid entrypoint object/protocol 在 local/package normalization 边界失败且错误可诊断；缺字段旧卡兼容。
- [ ] `game-card.json` JSON/path/mediaType/size/duplicate/full-coverage validator 通过。

## Phase 8: Build and quality gate

按依赖顺序运行：

```bash
npm run build:contracts
npm run build --workspace @tsian/play-bridge
npm run build:web
```

与 UI 子任务汇合后的最终集成再运行：

```bash
npm run build --workspace play-frontend-dev
npm run repack:immersive-reader
npm run build:web
```

`play-frontend-dev` 的 build 只做 TypeScript/Vite 开发检查，其 dist 不是 checked-in card dist authority。`repack:immersive-reader` 必须先证明平台 exporter 对 ASCII/中文/emoji 文本与 binary inventory 都使用实际 ZIP entry bytes，再驱动隔离 profile 的真实平台链：card `frontend/src/**` → `buildFrontend` (`apps/platform-web/src/frontend-build/engine.ts:272`) → `writeBackDist` (`apps/platform-web/src/frontend-build/write-back.ts:55`) → 修正后的 `exportGameCardPackage` 动态 inventory (`apps/platform-web/src/storage/game-card-packages.ts:660`) → 确定性解包/原子替换 checked-in dist → exported/checked-in/disk inventory 双向比对 → packaged iframe smoke。`npm run package:frontend` 明确不在该 authority chain 中。

同时运行：

```bash
python ./.trellis/scripts/task.py list-context 07-21-card-illustration-agent-protocol
python ./.trellis/scripts/task.py validate 07-21-card-illustration-agent-protocol
git diff --check
```

- [ ] 检查 card package manifest 的 JSON、全量 path、mediaType 与 byte size。
- [ ] 检查没有 API key、完整 prompt、base64/image payload 进入卡、workspace、bridge 或 trace fixture。
- [ ] 检查没有角色头像、自动 storyteller 生图、玩家 style selector 或历史视觉 snapshot 混入范围。
- [ ] 检查 `InvokeAgentRequest` / `InvokeAgentOptions.generatedMediaSourceGuard` 从 contracts → play-bridge → remote strict normalizer → host required closure 完整传播；Agent result 只作 UI correlation，durable authority 只来自 closure + source registration + exact-source CAS。
- [ ] stale-language scan：`rg "generatedMediaSourceGuard|requiredSourceGuard|sourceGuard|agentId|purpose|ordinary write|Agent result" .trellis/tasks/07-21-card-illustration-agent-protocol`，逐项确认没有旧的 Agent/Tool echo authority、business-string routing、required invocation ordinary downgrade 表述。
- [ ] 检查 default blank template 未被卡协议污染。
- [ ] 运行 `trellis-check`，记录所有行为证据和兄弟依赖版本。

## Rollback

- entrypoint 是 optional additive contract；若卡功能回滚，可先从卡 manifest 删除 `imageGeneration`，旧 bridge/contracts 保留也无行为影响。
- 删除 image-director 文件、storyteller illustration guidance、opening expectedOutput 与 projection rule，即可把卡恢复为纯正文；已有历史 projection 仍是 JSON-compatible 数据。
- 不通过把 `generate_image` 加入默认 Tool 集、授权 storyteller 或复制到 builtin blank template 来“临时修复”集成失败。
- 若 Tool/asset contract 尚未稳定，回滚卡 entrypoint 暴露并保持 feature unavailable；不要引入 card-local Provider 调用。

No task start, commit, push, destructive reset, or product implementation is implied by this planning document.
