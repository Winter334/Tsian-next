# 平台图像生成与桌面环境变量

## Goal

提供可复用、host-owned 的 `generate_image` 平台 Tool，同时建立统一 `.tsian/local/desktop.env` 读取能力。Tool 支持文生图和最多 4 张参考图的图生图，配置不进入卡包、存档或 Tool 参数。现有 RAG/embedding 直接改用同一 env 文件，旧配置与 UI 被删除。

本任务负责配置文件、shared invoke target contract、image adapter、Tool 权限/执行和 RAG destructive switch；generated-media source CAS/checkpoint patch 由 `07-21-image-save-consistency` 实现。

## Requirements

### R1. Desktop environment file

- 新增 `.tsian/local/desktop.env` 全局 platform-meta 虚拟文件，复用现有 Dexie `meta`、WorkspaceVolume 和 `.tsian` 权限模型；不新增表。
- parser 只支持单行 `KEY=VALUE`、空行、`# comment` 和可选单/双引号包裹值。禁止 shell expansion、变量插值、include、export directive 和 multiline。
- key 必须匹配 `[A-Za-z_][A-Za-z0-9_]*`；重复 key、非法行或未闭合引号返回明确 parse diagnostic，不执行半份损坏配置。
- 提供统一原始 map 读取 seam；图片与 embedding resolver 只读取自己的白名单键。
- 文件不整体注入 Agent context、browser script、Tool schema、bridge 或 diagnostics。现有高权限桌面助手可按 `.tsian` 权限读取/维护原文。

### R2. Destructive RAG configuration switch

- 图片 resolver 使用 `TSIAN_IMAGE_BASE_URL`、`TSIAN_IMAGE_API_KEY`、`TSIAN_IMAGE_MODEL`。
- embedding resolver 使用 `TSIAN_EMBEDDING_BASE_URL`、`TSIAN_EMBEDDING_API_KEY`、`TSIAN_EMBEDDING_MODEL`、正整数 `TSIAN_EMBEDDING_DIMENSIONS`。
- 删除 `BrowserEmbeddingConfig`、`provider.embeddingConfig`、get/save/resolve helper、Settings `SemanticSearchScreen` 及 spatial 等价输入。
- 不迁移、不 fallback、不双写旧值。env 缺失/损坏/未配全时 embedding 能力关闭；现有 RAG recall tunables 继续来自 `platform-config.json`。
- 更新所有 clone/default/normalize/test fixture，不能留下隐藏的旧配置消费者。

### R3. Shared generated-media target

- contracts 声明 optional serializable `GeneratedMediaTurnProjectionTarget`：`{kind:"turn-projection",turn,projectionKey,index}`。
- play-bridge `InvokeAgentOptions.generatedMediaTarget?` 显式映射到 request；remote iframe bridge strict-normalize closed shape，拒绝 extra、负数、非整数和不安全 projection key。
- shared runtime helper只负责 target normalization 与 stable asset path；不读取 projection、不计算 source digest、不授权 commit。
- omission 保持普通 `invokeAgent` 兼容。

### R4. Image adapter

- MVP 内部 adapter 固定为 OpenAI Images compatible；不新增 Provider type、preset 或 Settings UI。
- 无参考图调用 normalized `/images/generations` JSON；有 1..4 张参考图调用 `/images/edits` multipart，不发送 mask。
- `landscape | portrait | square` 映射到 adapter 支持的固定尺寸；非法 aspect 在网络前失败。
- 接受有效 `b64_json` 或 HTTP(S) URL；URL 立即下载，不返回或持久化远程 URL。
- 对参考图和结果统一执行大小上限、签名/MIME 与 raster decode 检查，拒绝 HTML、JSON、SVG、空 Blob 和伪造图片。
- Provider body/message、prompt、API key、base URL、URL、base64 和 bytes 不进入公共错误或 diagnostics。

### R5. Explicit Tool

- `AgentPlatformToolName`、registry、Studio/Assistant 控件、native/Text schemas 和 executor 新增 `generate_image`，但不加入 `DEFAULT_AGENT_PLATFORM_TOOLS`。
- input closed schema：`prompt`、`aspect`、optional `sourceImagePaths`；无 durable target/path、caller identity、Provider/model 或 mask。
- Host 从调用 workspace 读取参考路径，只允许可访问的普通 workspace raster Blob；拒绝 `.tsian/**`、URL/data/base64、frontend/temp 和不存在路径。
- bound invocation 使用 consistency child 提供的 Host binding/commit callback，并在首次付费调用后锁定；第二次调用在 Provider 前返回 `IMAGE_INVALID_ARGUMENTS`。
- unbound invocation 由 Host 生成唯一路径，写入当前 `RuntimeWorkspaceTransaction`，返回同样的短结果。
- formal turn、`invokeAgent` 和 desktop Assistant 复用同一 adapter/runner；递归 Agent 保持同一 binding 与一次调用限制。

### R6. Errors and diagnostics

- 至少区分 not configured、invalid arguments、auth、policy、provider、network、invalid response/content、runtime unavailable、target already used。
- Abort 保持 Abort，不改写为 network error。
- Tool observation 只有短错误 code/message 或 `{path,mediaType}`。
- metadata-only diagnostics 可记录 status、aspect、尺寸、endpoint branch、MIME、byte size、duration；不得记录 secret 或内容。

## Acceptance Criteria

- [ ] AC1: `desktop.env` 可通过既有 platform-meta volume list/read/write/delete，跨 save 持久且不进 checkpoint/card package。
- [ ] AC2: parser 与图片/embedding typed resolver 覆盖合法、缺失、重复、损坏、引号和 dimensions 边界。
- [ ] AC3: 旧 embedding schema/UI/helper 被完整删除；RAG 仅从 env 读取且未配时安全关闭。
- [ ] AC4: `generatedMediaTarget` 从 play-bridge 到 host 严格透传；畸形请求 fail closed，omission 兼容。
- [ ] AC5: 文生图与 1..4 参考图图生图请求/响应/Blob 验证均通过；mask 不存在。
- [ ] AC6: Tool 仅显式授权可见，不依赖 `workspace_write`；bound 第二次调用零 Provider 请求。
- [ ] AC7: unbound 与 bound 成功都只返回 `{path,mediaType}`，失败不覆盖旧资产。
- [ ] AC8: diagnostics/bridge/Tool memory 不包含 env value、prompt、URL、base64 或图片 bytes。

## Out of Scope

- generated-media source lookup、revision/branch epoch、checkpoint patch 和 Blob GC。
- 卡 brief、entrypoint、`image-director`、正文 UI。
- 图像/Tool Settings UI、Provider registry、模型发现或配置测试按钮。
- mask、局部重绘、ComfyUI、自定义 endpoint mapping、自动重试。
- 旧 embedding 配置迁移或兼容。
