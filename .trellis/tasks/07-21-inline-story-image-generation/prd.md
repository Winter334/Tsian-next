# 正文内嵌插图生成

## Goal

为沉浸阅读器提供连续、按需且不阻塞剧情的正文插图体验：`storyteller` 在开局 turn 0 和每个正式回合的正文原位置声明 1-3 个插图 brief，玩家点击描述卡后，由卡内 `image-director` 调用平台 `generate_image` Tool，使用文生图或参考图图生图生成资产并在原位展示。图片失败、延迟和费用不得影响正文推进；生成结果必须随存档、reload 和 checkpoint restore 保持一致。

父任务只冻结跨层合同、子任务边界和最终验收。产品代码由四个子任务实现。

现状证据见 [`research/current-state-review-2026-08-26.md`](research/current-state-review-2026-08-26.md)。

## Product Decisions

1. MVP 同时支持 text-to-image 与 reference-image image-to-image。视觉连续性是 AIRP 核心体验，不是后续增强。
2. 开局和每个正式回合必须输出 1-3 个 brief，通常 1 个；只有多个独立关键画面时才输出 2-3 个。
3. 图片由玩家点击触发；整张未生成卡的一次 pointer/Enter/Space 激活即同意本次付费，不增加确认弹窗。
4. 驱动 `image-director` 的仍是现有 chat Provider；图像 API 是平台 Tool 的宿主依赖，不新增 image Provider type。
5. MVP 不做图像或 Tool 配置 UI。外部工具/服务变量统一存放在 `.tsian/local/desktop.env`，沿用既有 `.tsian` actor-level 权限。
6. RAG/embedding 直接改用同一 env 文件；删除旧 `embeddingConfig` 和对应 UI，不迁移、不 fallback、不双写。
7. 前端只提交 closed generated-media target；Host 读取权威 projection、捕获 source revision 并决定资产路径。Agent 不 hash、不回显 guard、不授权 commit。
8. 已完成的卡打包、统一 diagnostics 和 generic invokeAgent checkpoint retry 不进入本任务范围。

## Child Tasks

1. `07-21-platform-image-generation`：`desktop.env`、RAG destructive switch、图像 adapter、`generate_image` Tool、invoke target wire contract。
2. `07-21-image-save-consistency`：source binding、正式回合 merge、generated-media CAS、checkpoint patch、restore epoch 与 Blob GC。
3. `07-21-card-illustration-agent-protocol`：brief marker、Reply Projection、当前 opening 流程、entrypoint 与 `image-director`。
4. `07-21-card-inline-illustration-ui`：assistant view model、inline parser、生成状态、reload/restore、Object URL 和现有打包链验收。

共享合同先冻结；子任务 1-3 可按各自边界推进，子任务 4 的真实调用接线依赖前三项。

## Requirements

### R1. Illustration intent

- marker 固定为 `[[插图]]`、单个 JSON object、`[[/插图]]`，位于对应正文段落之后。
- `IllustrationBriefV1` 是 closed object，恰好包含 `title`、`description`、`sceneRef`、`entityRefs`。
- `title` / `description` trim 后分别为 1..80 / 1..500 UTF-16 code units。
- `sceneRef` 必须是 `scene:<localId>`；`entityRefs` 是 0..12 个 `<type>:<localId>`，去重保留首现。每个 ref 总长 1..120，恰好一个 colon；segment 长 1..80，禁止空白、`/`、`\\`、NUL、`.`、`..` 和额外 colon。
- Prompt 要求每回合 1-3 个，但 projection/commit 对畸形或缺失插图 fail-soft，不能重试或阻断正文。
- `content` 删除完整插图 marker，`displayContent` 保留 marker 的原位置，`projections.illustrations` 按出现顺序保存 trim 后的 raw JSON string。

### R2. Platform image capability

- 新增高成本 host-owned `generate_image`，不进入默认 Tool 集，只对显式授权 Agent 可见。
- Tool 输入只有 `prompt`、`aspect: landscape | portrait | square`、可选 `sourceImagePaths`（1..4 个普通 workspace 图片路径）；不接受 Provider、model、API key、目标路径、asset id、guard、URL、base64 或 mask。
- 无参考图走 text-to-image；有参考图走无 mask image-to-image。adapter 验证所有参考 Blob、响应 Blob、MIME、大小和可解码性。
- Tool 成功 observation 只有 `{ path, mediaType }`；错误使用稳定、脱敏 code，diagnostics 不记录 secret、完整 prompt、URL、base64 或图片 bytes。

### R3. Unified desktop environment

- `.tsian/local/desktop.env` 是跨 save 的 platform-meta workspace 文件，不进 checkpoint、卡包或 save-runtime，不新增 Dexie table。
- 支持简单 `KEY=VALUE`、空行和 `# comment`；不执行 shell，不插值，不 include，不支持 multiline。重复 key/非法行必须给出确定性诊断。
- MVP 图片键为 `TSIAN_IMAGE_BASE_URL`、`TSIAN_IMAGE_API_KEY`、`TSIAN_IMAGE_MODEL`。
- RAG 键为 `TSIAN_EMBEDDING_BASE_URL`、`TSIAN_EMBEDDING_API_KEY`、`TSIAN_EMBEDDING_MODEL`、`TSIAN_EMBEDDING_DIMENSIONS`。
- 工具各自只读取白名单键并做 typed resolve；整份 env 不自动注入 Agent、Tool 参数、bridge 或 browser-script 环境。
- 文件沿用现有 `.tsian` 权限：普通运行时 Agent 默认不可见；明确拥有 platform-meta 高权限的管理助手可以读写，这是有意能力。
- 删除旧 embedding 配置 schema、Settings 表单和 helper；缺少新 env 键时语义检索按未配置处理。RAG 的 recall tunables 仍保留在结构化 platform config。

### R4. Host-authoritative generated media target

- `InvokeAgentOptions` / shared request 新增 optional closed target：`{ kind: "turn-projection", turn, projectionKey, index }`。`turn/index` 为非负整数，`projectionKey` 是受限标识符；extra 或畸形字段在 RPC 边界拒绝。
- 沉浸阅读器点击只把该 target 放入 invoke options；Agent input 只含 brief 和来源 prose，不重复 target、revision、path 或 guard。
- Host 在 invocation 开始时读取对应 persisted assistant projection，捕获 source path/revision 与当前 branch epoch，并派生稳定路径 `save/assets/generated/turn-projection/<turn>/<projectionKey>/<index>`。
- bound invocation 最多允许一次 `generate_image` Provider 调用。Tool/Agent 不能选择或覆盖 durable target。
- generic unbound Tool 调用由 Host 分配唯一资产路径并沿现有 transaction 语义提交。

### R5. Card Agent orchestration

- card runtime entrypoint 是 optional `{ agentId, protocol: "tsian.image-director.v1" }`；旧卡或未知 protocol 降级为普通正文。
- `image-director` 是 ephemeral Agent，显式启用 `workspace_read` 和 `generate_image`，不获得 `workspace_write`。
- Agent 点击时读取最新 scene/entity 资料，使用卡内固定美术风格；从可信资料中的现有图片引用收集最多 4 个参考路径。
- Agent 只生成 Provider-neutral prompt、选择语义 aspect、调用 Tool 一次，并返回 closed result `{ schema, asset:{path,mediaType} }`；不返回 prompt、Provider、target、secret 或参考图片内容。
- current opening integration 必须更新 `开局建模` 的 storyteller delegation 与 `publish_opening`，不引入旧开局提交入口。

### R6. Persistence and checkpoint consistency

- 正式 turn 以 explicit written/deleted changes 合并到最新 workspace，不能整表 delete/replace，从而保留并发生图写入。
- Host source binding 同时校验 source revision 与 restore-only branch epoch；正式剧情继续前进不使合法在途图片失效，restore/branch rewrite 会使旧结果 stale。
- checkpoint 新增内部 `historyFileCount`，明确其快照包含多少个连续 turn 文件（初始 checkpoint 为 0，opening turn 0 发布后为 1）。generated-media commit 原子写 workspace 资产，并把相同 path/hash 补丁到当前分支所有 `historyFileCount >= sourceTurn + 1` 的 retained manifests；source 之前的 checkpoint 不含该资产。
- regeneration 覆盖同一路径并更新所有 eligible manifests；失败保留旧图。
- restore、prune、rewrite、concurrent formal turn 和 concurrent different-image commits 必须序列化或 CAS；stale 结果不写 workspace/checkpoint。
- 未被 workspace 或任一 checkpoint 引用的旧/new-orphan Blob 必须 GC。

### R7. Inline frontend

- live/history assistant view model 必须保留 `{turn, content, displayContent, projections}`；turn 0、实时完成、reload 和 restore 使用相同数据边界。
- settled parser 输出 ordered Markdown/illustration segments；完整 marker 永不作为 Markdown 泄漏。schema invalid 时只显示可安全读取的 string title/description fallback，否则省略；其它正文不丢失。
- 按正文顺序只让最先 3 个 valid block 可交互；超量 valid block 为不可交互描述。
- 每张卡独立 `idle | generating | ready | failed`；不同卡自然并发，故事可继续。重新生成期间保留旧图，成功后替换，失败保留旧图。
- reload/restore 按 stable target path probe Blob。Object URL 在替换、target 变化、restore 和 unmount 时 revoke。
- streaming 阶段不得闪现未闭合 marker 或交互卡。
- 使用现有 `npm run package:card` / `npm run repack:immersive-reader`，不得重做 exporter 或打包 harness。

## Acceptance Criteria

- [ ] AC1: `.tsian/local/desktop.env` 可由现有高权限 platform-meta workspace 路径管理；parser/typed resolver 覆盖图片和 embedding 键，secret 不进入 Tool/bridge/diagnostics。
- [ ] AC2: 旧 `embeddingConfig` 与配置 UI 被删除，RAG 只使用 env，新配置缺失时安全关闭且无兼容分支。
- [ ] AC3: 显式授权 Agent 可调用 `generate_image` 完成文生图与 1..4 参考图图生图；未授权 Agent 看不到 Tool，bound invocation 第二次调用在 Provider 前失败。
- [ ] AC4: 开局和每个正式回合 Prompt 要求 1-3 个 closed brief；1/2/3 块均正确投影，畸形/缺失仍可落定正文。
- [ ] AC5: frontend live/history 保留 turn/projections，turn 0、实时、reload、restore 的同一 target 使用同一路径。
- [ ] AC6: 玩家可独立并发生图并继续剧情；idle/generating/failed/ready/regenerate/lightbox 和键盘可访问性符合 R7。
- [ ] AC7: 正式回合与生图交错提交不丢文件；restore/branch rewrite 后迟到结果丢弃，普通剧情前进不误杀在途结果。
- [ ] AC8: `historyFileCount` 明确区分初始 checkpoint 与 opening turn 0；确实包含 source turn 的 retained checkpoints 都含最新对应图片，source 之前不含；重生成与 GC 无孤儿泄漏。
- [ ] AC9: Provider、参数、参考图、响应、Agent 或 stale-source 失败只影响当前插图卡，不阻断正文或其它图片。
- [ ] AC10: contracts、play-bridge、platform-web、开发卡前端构建和相关 smoke/integration tests 通过；现有 repack 命令能重建并验证 packaged card。

## Out of Scope

- 自动/同步生图、全局队列、取消、进度百分比、费用配额或跨 reload 恢复在途网络请求。
- mask、局部重绘、玩家自定义风格、多版本画廊或历史视觉快照。
- 图像/Tool Settings UI、Provider presets、ComfyUI 或任意自定义 request mapping。
- 角色头像/地点概念图等其它图片消费端。
- 旧 embedding 配置迁移、兼容读取或旧存档迁移。
- 已完成的卡打包、diagnostics 与通用 invocation 工作。
