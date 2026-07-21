# 平台图像生成能力

## Goal

为平台提供可被不同 Agent 复用的 host-owned `generate_image` 高成本能力：玩家在设置中维护一份独立的 OpenAI-compatible 图像配置并可执行真实测试生成；显式授权的 Agent 可请求语义画幅，由宿主安全调用 Provider、验证图片 Blob。通用调用在 invoke option 与 Tool guard 均缺失时写入普通 `RuntimeWorkspaceTransaction`；合法 Tool 自带 guard 可进入 guarded path。`invokeAgent.generatedMediaSourceGuard` 存在时，host 将其 strict-normalize 并作为 invocation-authoritative `requiredSourceGuard` closure：Tool 必须携带逐字段相同 guard，且 `assetId` 必须等于 host 派生 identity，否则在 Provider 付费前 `IMAGE_INVALID_ARGUMENTS` fail、零 write且绝不降级 ordinary write；合法时 handoff 使用 option guard而非 Tool object。带 guard 的结果交给一致性任务拥有的 platform-host source-registration/storage seam。模型成功结果始终只有短引用 `{ path, mediaType }`。

本子任务交付平台能力、唯一 shared runtime identity helper、invoke option/Tool guard 都缺失时的 ordinary write、option 缺失时合法 Tool self-guard path，以及 required option-authoritative guarded host staging handoff；不实现正文插图协议、卡内 `image-director`、角色图片 UI，也不定义 source-registration 的权威 turn 读取或 checkpoint/timeline 并发提交语义。guarded integration 依赖 sibling `07-21-image-save-consistency` 提供的最终 seam。

## Background and Source Evidence

- `AgentPlatformToolName` 与 `AgentPlatformToolConfig` 是共享契约；新增平台 Tool 名称会改变 contracts：`packages/contracts/src/runtime.ts:429-446`。
- Agent Tool 启用为空时会回退默认集合，而当前默认集合仅含协作和 workspace 读写；高成本 Tool 必须加入名称表但不得加入默认数组：`apps/platform-web/src/agent-runtime/permissions.ts:6-28`、`apps/platform-web/src/agent-runtime/permissions.ts:62-76`。
- Agent 配置解析使用独立的平台 Tool 白名单；未知名称会被过滤：`apps/platform-web/src/agent-runtime/registry.ts:63-71`、`apps/platform-web/src/agent-runtime/registry.ts:741-797`。
- 原生函数调用和 Text Tool Protocol 共用 `buildEnabledToolSchemas()`，因此同一 schema/授权门可覆盖两种模式：`apps/platform-web/src/agent-runtime/tool-schemas.ts:483-599`。
- host-owned Tool 的执行 seam 位于 runtime capability、execution context 和 built-in dispatch：`apps/platform-web/src/agent-runtime/turn-types.ts:171-224`、`apps/platform-web/src/agent-runtime/workspace-tools-types.ts:486-521`、`apps/platform-web/src/agent-runtime/workspace-tools/tool-execution.ts:348-551`。
- 正式回合、`invokeAgent` 和桌面助手各自创建 `RuntimeWorkspaceTransaction` 并绑定 host capabilities：`apps/platform-web/src/platform-host/runtime-turn.ts:99-128`、`apps/platform-web/src/platform-host/runtime-turn.ts:211-245`、`apps/platform-web/src/platform-host/ai-invocation.ts:251-285`、`apps/platform-web/src/platform-host/ai-invocation.ts:383-422`、`apps/platform-web/src/platform-host/assistant-chat.ts:405-435`、`apps/platform-web/src/platform-host/assistant-chat.ts:581-739`。
- Transaction 已支持 stage `Blob` 并导出 touched-path changes；普通写入继续使用既有 seam。guarded 调用不得把 `sourceGuard` 扩展进 `RuntimeWorkspaceTransaction`；本任务只产出 host guarded handoff，交给 sibling 的 source-registration 转成 storage-facing exact-source metadata：`apps/platform-web/src/storage/workspace-types.ts:9-29`、`apps/platform-web/src/storage/workspace.ts:620-681`、`apps/platform-web/src/storage/workspace-paths.ts:45-81`。
- Workspace 二进制本体使用 `Blob`，图片 MIME 会投影到 `WorkspaceFile.imageMimeType`；无需新增 Dexie 表：`packages/contracts/src/runtime.ts:247-263`、`apps/platform-web/src/storage/workspace.ts:117-149`、`apps/platform-web/src/storage/db.ts:63-77`、`apps/platform-web/src/storage/db.ts:180-215`。
- 平台配置已通过 Dexie `meta` 保存到 `.tsian/local/platform-config.json`，该路径不进 checkpoint；配置层提供启动预热和同步 module cache：`apps/platform-web/src/storage/local-platform-config.ts:3-18`、`apps/platform-web/src/storage/local-platform-config.ts:58-73`、`apps/platform-web/src/config/platform-config.ts:129-203`。
- 当前 storage loader 会把完整 platform config 包装成 `WorkspaceFile`，platform-meta volume 也接受整文件读写；若直接把图像密钥加入 raw JSON，会违反本任务的 Agent-visible workspace secret 边界，必须在 raw config IO 与 workspace projection 之间增加脱敏/保密写保护：`apps/platform-web/src/storage/local-platform-config.ts:32-50`、`apps/platform-web/src/platform-host/workspace-volumes.ts:298-330`、`apps/platform-web/src/platform-host/workspace-volumes.ts:395-411`。
- `PlatformConfig` 的默认值、merge 和 clone 都显式列出 section；新增独立图像 section必须同时接入这些位置，避免其它设置保存时丢失：`apps/platform-web/src/config/platform-config.ts:68-123`、`apps/platform-web/src/config/platform-config.ts:231-308`、`apps/platform-web/src/config/platform-config.ts:310-330`。
- 设置中心已有 hub 路由、section merge 保存、从聊天 preset 复制地址/密钥和用内存 draft 做真实 Provider 测试的模式：`apps/platform-web/src/components/settings/SettingsHub.vue:47-86`、`apps/platform-web/src/views/SettingsView.vue:157-169`、`apps/platform-web/src/views/SettingsView.vue:269-337`、`apps/platform-web/src/components/settings/SemanticSearchScreen.vue:211-239`、`apps/platform-web/src/views/SettingsView.vue:601-644`。
- Runtime trace 规范只允许 metadata；generic string summary 会记录 preview，不能用于图像 prompt：`.trellis/spec/platform-web/frontend/index.md:45-55`、`apps/platform-web/src/agent-runtime/trace.ts:100-117`。现有 model-call Tool 摘要只记录 Tool 名和参数 key：`apps/platform-web/src/agent-runtime/index.ts:1260-1276`。
- 父任务将平台能力列为子任务 1，并要求 Tool 接收 generated-media target/source metadata；精确 checkpoint/并发一致性算法仍委托给 sibling：`.trellis/tasks/07-21-inline-story-image-generation/prd.md:36-49`、`.trellis/tasks/07-21-inline-story-image-generation/design.md:91-115`。

## Requirements

### R1. Independent local image configuration

- `PlatformConfig` 新增独立根 section `imageGeneration`，MVP shape 必须且只能是 `{ baseUrl, apiKey, model }`；默认三个字段均为空。
- 配置继续使用 `.tsian/local/platform-config.json`、Dexie `meta` 和现有 module cache/preheat/save 流程；不得新增 Dexie table、DB name bump、第二份 secret store 或 save-runtime/card 配置文件。
- `.tsian/local/platform-config.json` 的 raw storage 内容可含本地密钥，但任何 Agent/Assistant/Workspace Explorer 的 `WorkspaceFile` 投影必须删除 `imageGeneration.apiKey`；对该文件的通用 platform-meta write/delete 必须无条件保留宿主已存密钥，确保 workspace read/write/delete 不能读取、设置、清空或轮换密钥。图像 Settings 的专用 config helper 是该密钥的唯一读写入口。
- 图像配置不属于聊天 Provider preset；设置页可从玩家选择的完整聊天 preset 复制 `baseUrl` 与 `apiKey`，但不复制模型，复制后仅填充图像 draft，后续保存和修改完全独立。
- `apiKey` 使用密码输入语义，不得出现在卡、save-runtime、Tool schema/arguments/result、bridge payload、trace 或非密码摘要中。

### R2. Settings control and paid test generation

- 设置 hub 新增独立“图像生成”入口和 screen；表单只持久化 `baseUrl`、`apiKey`、`model`。
- 提供明确标注“会产生真实调用费用”的“测试生成”操作。测试使用当前内存配置 draft，但图像 prompt 与 aspect 不由玩家输入：平台固定使用短 prompt `A red sailboat on a calm blue sea at sunrise, no text or watermark.` 与 `square`，两者都不持久化、不成为页面控件。
- 测试成功只把验证后的 Blob 转为当前 screen 的 object URL 预览：不写 workspace、不创建/修改 checkpoint、不写 bridge 状态。
- 新测试替换旧预览前以及 screen unmount 时必须调用 `URL.revokeObjectURL`；失败时保持已有成功预览，不把 Provider 原始正文展示给玩家。

### R3. OpenAI-compatible image adapter

- 对规范化后的根地址发送 `POST {baseUrl}/images/generations`，headers 使用本地 `apiKey`，JSON body 只包含 `model`、`prompt`、`size`。
- 语义 aspect 仅允许 `landscape | portrait | square`，固定映射为现代 GPT Image-compatible 尺寸：
  - `landscape` → `1536x1024`
  - `portrait` → `1024x1536`
  - `square` → `1024x1024`
- 映射依据 OpenAI Images API 当前 GPT Image 标准尺寸（官方 API reference `https://developers.openai.com/api/docs/api-reference/images/create`）；不得使用 DALL-E 3 专属的 `1792x1024` / `1024x1792`。MVP 不增加按模型配置尺寸的 UI 或 fallback。
- 未知/缺失 aspect 必须在网络调用前失败，不得回退到 square 或任意默认尺寸。
- 成功响应只接受非空 `data[0].b64_json` 或 `data[0].url`。若两者同时存在，优先 `b64_json`；URL 响应由宿主立即下载，不把远程 URL 返回给 Agent/UI 或持久化。
- base64 与下载分支必须汇合到同一个验证器：拒绝空 Blob、HTML/JSON/未知二进制、仅伪造 `Content-Type: image/*` 的响应以及不能实际解码的图片；最终产物必须是具有受支持 `image/*` MIME 且可解码、宽高大于 0 的 Blob。
- Adapter core 同时服务 Settings 测试和 Tool，不得复制 request/response/验证逻辑。

### R4. Structured and sanitized failures

- 使用稳定错误 code 区分至少：`IMAGE_PROVIDER_NOT_CONFIGURED`、`IMAGE_INVALID_ARGUMENTS`、`IMAGE_POLICY_REJECTED`、`IMAGE_AUTH_FAILED`、`IMAGE_PROVIDER_ERROR`、`IMAGE_NETWORK_ERROR`、`IMAGE_RESPONSE_INVALID`、`IMAGE_CONTENT_INVALID`、`IMAGE_RUNTIME_UNAVAILABLE`。
- Adapter 可读取 Provider 错误 payload 来识别已知 policy/content-filter code，但不得把原始 body、Provider message、prompt、API key、base URL 或下载 URL放入抛出的 `message/details`。
- Agent/UI 只消费由 code 映射的简短中文文案。安全 metadata 可包含 HTTP status、aspect/size、response source、MIME、byte size 和 duration；不得包含 prompt 内容或其 preview、secret、图片 bytes/base64。
- Abort 保留为 abort，不得误分类为 network failure；任何失败都不得 stage 新图片，重生成失败不得删除/覆盖旧图片。

### R5. Explicitly enabled platform Tool

- 新增 host-owned 平台 Tool `generate_image`，同时接入共享名称契约、registry 白名单、Studio/Assistant 共用控件、原生/Text schema 与 built-in executor。
- Tool 是高成本媒体能力，不加入 `DEFAULT_AGENT_PLATFORM_TOOLS`。只有 `platformTools.enabled` 显式含 `generate_image` 且未被 disabled 的 Agent 才能看到并调用它；单独启用 Tool 不要求同时启用 `workspace_write`。
- Tool input 固定为：
  - `prompt: string`：非空图像描述；
  - `aspect: "landscape" | "portrait" | "square"`；
  - `assetId: string`：统一 schema 中始终必填的稳定、非秘密逻辑 id，只允许 ASCII 字母数字开头及后续 `[A-Za-z0-9._-]`，总长 1–128，不允许 `/`、`..` 或路径分隔符；无 guard 的通用调用可使用任意符合 pattern 的 id，有 guard 时必须满足下述 canonical 来源-目标绑定；
  - `sourceGuard?`：可选的受限 generated-media 来源结构；MVP 只定义 `{ kind: "turn-projection", turn, projectionKey: "illustrations", index, fingerprint }`。`turn` 与 `index` 是非负整数，`fingerprint` 固定为 `sha256:<64 位小写 hex>`；不接受其它 kind/projectionKey、任意 JSON、路径或正文副本。
- `sourceGuard` 的可选性保证 Tool 通用：普通 storyteller/正式 turn 可在当前 turn 尚未落盘时省略它；MVP `image-director` 发起的旁路正文插图同时在 Agent input 与 `invokeAgent.generatedMediaSourceGuard` 携带相同完整 guard。若 Tool 字段存在但畸形，必须在网络调用前失败。
- `InvokeAgentRequest` 与 play-bridge `InvokeAgentOptions` 新增同名可选 `generatedMediaSourceGuard?: GeneratedMediaTurnProjectionGuard`。contracts 可声明共享 wire 所需的 serializable shape，play-bridge identity module 可导出/复用该类型；strict runtime normalizer、raw fingerprint、identity/path 算法仍唯一在 play-bridge。SDK 显式透传，remote iframe bridge 对 closed V1 shape strict-normalize；畸形、extra field 或不 canonical 输入必须拒绝整个 request，不能静默删除后按 unguarded 调用继续。
- `sourceGuard` 是 host/storage 一致性数据，不是 Provider 参数：adapter 不发送它，Tool observation/短结果不返回它，trace 不记录它的字段值。Agent input/final result 中的 guard 只服务 Agent execution/UI correlation，不提供 host commit authority。
- guarded runtime identity 的唯一实现必须新增于 `packages/play-bridge/src/generated-media-identity.ts` 并从包根导出。该模块拥有 guard type/strict normalize、raw projection fingerprint helper（对 projector `$1|trim` 持久化的原始字符串直接做 UTF-8 SHA-256，绝不 parse/re-serialize）、NUL canonical identity、asset path 与 golden vector。platform-web 新增 `@tsian/play-bridge` workspace dependency 和 TS path；`@tsian/contracts` 不承载这些 runtime 算法。
- 有 turn-projection guard 时，host 只调用 shared helper 派生 `identityKey` 与 `assetPath`，要求传入 `assetId` 精确匹配，并在 Provider 调用前拒绝 mismatch。identity preimage 固定为 UTF-8 `tsian-generated-media-turn-projection-v1\0${turn}\0${projectionKey}\0${index}\0${fingerprint}` 的 SHA-256，小写 hex 前加 `tp-v1-`；稳定路径为 `save/assets/generated/<identityKey>`。无 guard 时 `identityKey = assetId` 并使用同一路径 helper。模型不能提供任意 target path。
- 无 invoke-required guard 且 Tool 无 guard时，通过普通 transaction `write({ path: assetPath, data: blob })` stage Blob；无 invoke-required guard但 Tool 自带合法 guard时，进入 guarded source-registration path。
- `invokeAgent.generatedMediaSourceGuard` 经 remote/host strict normalization 后由 `invokeAgent` host 捕获，并在绑定该 invocation 的 image runner 时作为 `requiredSourceGuard` closure。若 closure 存在：Tool call 必须显式提供 `sourceGuard` 且与 required guard 的 `kind/turn/projectionKey/index/fingerprint` 全部相同，`assetId` 还必须精确等于 host 从 required guard派生的 identity；Tool 漏 guard、任一字段 mismatch 或错 assetId 都在 config resolution/Provider fetch 前返回 `IMAGE_INVALID_ARGUMENTS`，Provider 调用、ordinary write、guarded handoff 均为零，绝不降级为 unguarded write。合法时 guarded handoff 的 `sourceGuard` 必须取自 invocation closure，Tool guard仅用于一致性检查、不能改写 authority。
- option 缺失时保持通用性：Tool 无 guard ordinary write，合法 self-supplied guard guarded write；正式 turn direct Tool 可不带 guard。该行为不按 agentId、purpose 或其它业务字符串分流。
- 两种 guarded 成功都把 `{ identityKey, assetPath, blob, sourceGuard }` 交给 sibling 的 card-agnostic platform-host source-registration seam；该 seam 才读取 exact turn、验证 raw projection fingerprint、计算完整 turn file revision，并调用 storage `writeGeneratedMedia({ identityKey, assetPath, data: blob, source:{path,expectedRevision} })`。两种成功都只向模型返回 `{ path, mediaType }`，不得返回 guard、assetId、prompt、Provider/model、URL、base64 或 Blob。
- 无 guard 的调用沿调用宿主现有 transaction commit/checkpoint 语义：正式 turn direct Tool 结果由 after-turn transaction 纳入；无 guard 的 `invokeAgent` 只执行现有 workspace commit，不补写调用开始前的旧 checkpoint。只有 `generatedMedia` metadata 才触发 sibling 的 stale 校验/checkpoint path patch。
- 无当前 active save/transaction、配置不完整或 runner 未绑定时必须返回结构化失败；不得退化为 Settings-only 测试、直接存储写入或无声成功。

### R6. Host integration and trace secrecy

- Formal turn、`invokeAgent` 和 desktop Assistant 三个 Agent Runtime host path 都要绑定同一个 image runner；递归 `agent_call` 复用同一 capability。formal/Assistant binding 没有 invoke-level required guard时保持 Tool 自带 guard optional 规则；`invokeAgent` binding额外闭包捕获 normalized `generatedMediaSourceGuard`。
- Tool 在 runtime executor 的 stateful serial group 执行，避免同一 round 内与其它 staged write 产生无序覆盖；不同 `invokeAgent` transaction 的跨调用并发提交语义不在本任务处理。
- 为 `generate_image` 增加专用 metadata-only trace 分支，不得将 `call.arguments`、prompt 或 generic `summarizeTraceValue` 传入 trace。成功 trace 仅含 Tool 名、aspect/size、path、MIME、byte size、duration；失败仅含 sanitized code、HTTP status（如有）和 duration。
- Tool observation、turn Tool event 和 saved Agent tool memory 只接收短引用/简洁错误，永远不接收图片 bytes/base64 或 Provider 原文。

### R7. Dependency and delivery boundary

- `exportGameCardPackage` 的 UTF-8 inventory size 修复、ASCII/中文/emoji/binary 回归与 repack 脚本归 `07-21-card-inline-illustration-ui` 的 repack tooling scope，不归本平台 Provider/Tool 子任务；该 UI child 因修改 `apps/platform-web` 必须运行 `npm run build:web`。本任务不得顺带实现该 exporter 修复。
- 本任务的 `PlatformConfig.imageGeneration = { baseUrl, apiKey, model }` 与 card runtime capability `GameCardRuntimeEntrypoints.imageGeneration?: { agentId: string; protocol: "tsian.image-director.v1" }` 同名但分层独立。card capability object/protocol 的 contracts/local+package normalizer/host bridge 传播归 protocol/UI sibling；不得改变本任务 Provider config、`generate_image` Tool input/result、adapter 或 authorization shape。
- 本任务在 `packages/play-bridge/src/generated-media-identity.ts` 实现并从包根导出唯一 shared runtime helper；`platform-web` 新增 `@tsian/play-bridge` 真实依赖与 TypeScript path。它同步扩展 `InvokeAgentRequest.generatedMediaSourceGuard`、play-bridge `InvokeAgentOptions`/SDK 映射、remote iframe bridge strict normalizer和 invokeAgent host binding；卡/dev frontend 与 protocol sibling 消费该 helper/option，`@tsian/contracts` 继续只放必要跨包 data shape。
- 本任务交付给 sibling 的 guarded handoff 是 `{ identityKey, assetPath, blob, sourceGuard }`；required invoke option 路径必须使用 closure guard，Tool guard不能覆盖。无 option+无 guard只产生普通 transaction Blob write；无 option+合法 Tool guard仍可产生 guarded handoff。Tool 在所有情况下都只看到/返回 `{ path, mediaType }`。
- sibling `07-21-image-save-consistency` 的 source-registration seam 接收 handoff 后读取并 generic 验证权威 turn projection，计算完整 turn file revision，再用最终 storage contract `{ identityKey, assetPath, source:{path,expectedRevision} }` stage/commit。该 storage metadata 不含 sourceGuard。
- 本任务负责 optional source guard 的受限 schema、strict normalize、shared helper、付费前 identity/path 绑定和 handoff；不得扩展 `RuntimeWorkspaceTransaction` 为 sourceGuard metadata，不得定义 durable `GeneratedMediaCommitMetadata`，不得解析权威 turn projection或实现来源有效性/checkpoint 算法。
- 本任务不得修改 formal-turn full-snapshot commit、side-channel checkpoint option、checkpoint manifest patch、restore race、regeneration GC、timeline 或分支语义；这些由 sibling 统一设计实现。
- 本任务不修改卡包、`image-director`、storyteller protocol、Reply Projection 或正文/角色 UI；除 shared identity helper 外不增加 play-bridge RPC/bridge payload。

## Acceptance Criteria

- [ ] AC1: `imageGeneration` 仅含 `baseUrl/apiKey/model`，可经现有 platform config preheat/cache/save 往返；缺失/损坏旧配置回退空默认，保存其它 section 不会删除它，且不新增 Dexie table。
- [ ] AC1a: raw platform-config storage 可由专用宿主 helper 保存密钥，但所有 workspace/platform-meta 投影均不含 `imageGeneration.apiKey`，通用 workspace write/delete 不能读取、设置、清空或轮换该密钥。
- [ ] AC2: 设置 hub 有独立“图像生成”screen；可从选定聊天 preset 复制地址和密钥，保存后两份配置互不联动。
- [ ] AC3: “测试生成”明确提示真实费用，使用未保存配置 draft + 固定 prompt `A red sailboat on a calm blue sea at sunrise, no text or watermark.` + 固定 `square` 发出一次真实请求；页面无 prompt/aspect 输入，成功只在 Settings 内存预览，workspace/checkpoint 无变化，替换/unmount 会 revoke object URL。
- [ ] AC4: Adapter 对三种 semantic aspect 发出精确 size；无效 aspect 在 fetch 前结构化失败且不存在静默回退。
- [ ] AC5: Adapter 可处理 `data[0].b64_json` 和 `data[0].url`，URL 会立即下载；伪图片、空数据、不可解码图片和 malformed payload 均在写入前被拒绝。
- [ ] AC6: `generate_image` 不在默认 Tool 集；未显式授权 Agent 的 native/Text schema 均不出现它，显式授权且未 disabled 时两种协议均可调用。
- [ ] AC7: 有 active transaction 的授权 Agent 成功调用后，模型只收到 `{ path, mediaType }`；无 invoke option+无 Tool guard时 `identityKey = assetId` 且只产生 ordinary Blob write，无 option+合法 Tool guard进入 guarded path；required invoke option + exact Tool guard/assetId match时，把 `{ identityKey, assetPath, blob, sourceGuard }` 交给 sibling seam，且 guard 来自 option closure。
- [ ] AC7a: `sourceGuard` 对通用 Tool 可省略；本卡 `image-director` 同时在 Agent input 和 `invokeAgent.generatedMediaSourceGuard` 提供同一 guard。remote bridge strict-normalize option。required option 存在时，Tool 漏 guard、guard 任一字段不精确匹配或 `assetId` 错误均在 Provider 前 `IMAGE_INVALID_ARGUMENTS` fail，零 Provider、零 ordinary/guarded write且不降级；exact match合法成功。option 缺失时，无 guard ordinary write、合法 guard guarded write，正式 turn direct Tool可无 guard；不依赖 agentId/purpose。
- [ ] AC7b: shared helper 的 raw fingerprint/identity/path golden vector 在 play-bridge、platform host 和 sibling consumer 间一致；无 UI/host/storage 第二份 canonicalization。Agent final result guard只做 UI correlation；durable authority来自 host option closure+source registration。无 guard `invokeAgent` 不补旧 checkpoint。
- [ ] AC7c: card runtime `imageGeneration` object/protocol change does not alter `PlatformConfig.imageGeneration`, Provider adapter, `generate_image` request or exact Tool result；平台任务不解析 illustration brief closed schema，storage/source-registration 仍只 generic 处理 raw projection。
- [ ] AC8: 缺配置、无 active save/transaction、Provider policy 拒绝、鉴权、网络、响应格式或图片校验失败均返回稳定 code/简短文案；失败不产生 touched path，重生成失败保留旧 staged/baseline 文件。
- [ ] AC9: Formal turn、`invokeAgent` 和 desktop Assistant 均绑定能力；单独授权 `generate_image` 即可使用，不依赖 `workspace_write`。`invokeAgent` binding 将 normalized request option作为 required guard closure，formal/Assistant 不伪造 required guard。
- [ ] AC10: Tool schema/arguments/cards/workspace/bridge/trace 中不存在 API key；trace、错误和 Tool event/memory 中不存在 prompt 内容、Provider 原始正文、URL、base64 或图片 bytes。bridge 只新增 bounded generated-media guard data，不含 prose/secret。
- [ ] AC11: 本任务不改变 checkpoint/timeline/restore/并发提交算法，不把 sourceGuard 写入 transaction/storage metadata；guarded metadata只可能由 required-and-validated invoke option path或 option缺失时合法 Tool self-guard path产生。sibling 用 exact-source metadata 执行来源 CAS 与 checkpoint path patch，无 guard write 保持宿主原有提交语义。
- [ ] AC12: `npm run build --workspace @tsian/play-bridge`、`npm run build:contracts`、`npm run build:web` 与 `git diff --check` 通过，并完成人工安全检查与 Settings object URL 生命周期检查。

## Operational Constraints

- API key 不进入 Tool、卡、workspace、bridge payload 或 trace。
- trace 不含密钥/提示词内容。
- 测试图只在设置页面内存预览，不写 workspace/checkpoint，释放 object URL。
- 只修改该 task 目录，不 start，不碰 task.json，不提交。

## Out of Scope

- 多图像 Provider preset、Provider registry、ComfyUI、可配置 endpoint/request/JSONPath 或自定义 size 映射。
- Tool 的通用玩家配置框架、将 secret 注入 Tool/Skill/browser script、为 Agent 选择图像配置、允许玩家自定义 Settings 测试 prompt/aspect。
- Provider 内容预审核、prompt 自动改写、自动重试、队列、配额、取消 UI、价格估算或 usage 账单。
- storyteller 自动生图、`image-director` Prompt/卡 entrypoint、正文插图 block、角色/地点图片 UI。
- 图片编辑、variation、mask、多图返回、图库、多版本资产或旧存档迁移。
- checkpoint/timeline patch、source-registration 对权威 turn/projection 的读取与有效性判定、storage-facing exact-source metadata、restore/late-result 提交算法、跨 transaction 同路径冲突与 Blob GC。
