# 卡内插图 Agent 与输出协议

## Goal

为沉浸阅读器卡定义一个可持久化、可发现、可独立失败的正文插图协议：`storyteller` 在 opening turn 0 与每个正式回合的正文原位置声明 1–3 个插图简报，通常只声明 1 个；Reply Projection 保存结构化来源；玩家点击后，卡内 `image-director` 读取最新世界资料并调用 host-owned `generate_image`。

本任务只负责卡侧 Prompt、Reply Projection、brief validator、`image-director`、可选 entrypoint 与卡 workspace inventory。Provider、Tool executor、Host target binding、checkpoint 一致性和插图 UI 分属兄弟任务。

## Requirements

### R1. One illustration brief protocol

- 唯一 marker 为：

  ```text
  [[插图]]
  {"title":"…","description":"…","sceneRef":"scene:…","entityRefs":["character:…"]}
  [[/插图]]
  ```

- marker 位于对应画面正文之后；opening turn 0 与正式回合使用完全相同的格式。
- `IllustrationBriefV1` 是 closed object，恰好包含 `title`、`description`、`sceneRef`、`entityRefs`，不得有额外字段或类型 coercion。
- `title` / `description` trim 后分别为 1..80 / 1..500 UTF-16 code units。
- `sceneRef` 必须是 `scene:<localId>`；`entityRefs` 是 0..12 个 `<type>:<localId>`，去重保留首现。
- 每个 ref 总长 1..120，恰好一个 colon；每个 segment 长 1..80，禁止空白、`/`、`\\`、NUL、`.`、`..` 和额外 colon。
- Prompt 要求每次 opening 或正式回合输出 1–3 个完整 block，正常情况下只输出 1 个；只有正文存在多个彼此独立且重要的视觉时刻时才增加到 2–3 个。
- brief 只描述画面，不包含最终 prompt、Provider、model、secret、像素尺寸、目标路径或持久化身份。

### R2. Projection and fail-soft validation

- `workspace/config/reply-projection.json` 为每个完整 marker 配置：`content: ""`、不设置 `display/text`、把 trim 后捕获值 append 到 `projections.illustrations[]`。
- 因此 clean `content` 不含 marker，`displayContent` 保留正文位置，projection 保存按出现顺序排列的 raw JSON string。
- 通用 projector 不解析 card JSON，也不强制 1–3 数量。缺失、超量、畸形或未闭合 marker 都不能阻断 opening publication、正式回合 commit 或触发 storyteller 重试。
- 新增唯一 runtime validator，严格执行 R1。Prompt 内的自包含规则与 validator 必须保持一致，卡 UI 不得复制第二份可执行 schema。
- 前三个 valid brief 可交互；更多 valid brief 只显示不可交互描述。invalid complete marker 可显示经过限制的 `title` / `description` fallback 或省略，但绝不把 marker/JSON 交给 Markdown。

### R3. Current storyteller and opening integration

- 更新当前 `storyteller` 输出说明，使正式回合在正文原位置产生 1–3 个 brief，通常 1 个。
- 更新 `agents/world-architect/skills/开局建模/SKILL.md` 中当前的 storyteller delegation request，明确 opening prose、1–3 个 brief 与初始选项的完整输出要求。
- `publish_opening` 继续使用统一 Reply Projection 落盘 turn 0；不得引入 opening-only marker 或绕过 projector。
- 所有设计、测试和说明以 `开局建模` + `publish_opening` 为准，不增加第二套开局提交入口。

### R4. Card-owned image-director

- 新增 `workspace/agents/image-director/agent.json`、相邻 `AGENT.md` 和固定美术风格 context；缺一不可。
- `image-director.platformTools.enabled` 是显式非空集合，只含 `workspace_read` 与 `generate_image`；不得获得 `workspace_write` 或 `agent_call`。
- `storyteller` 不获得 `generate_image`；其它卡 Agent 也不因本任务获得该 Tool。
- Agent request 是 closed `{ brief, prose }`。其中 brief 已由前端 validator 验证，prose 是来源回合 clean content；request 不含 target、revision、branch epoch、path、asset id 或 guard。
- Agent 在点击时根据 `sceneRef` / `entityRefs` 读取最新 `save/scenes/**` 与 `save/entities/**`，结合固定风格组装 Provider-neutral prompt，并选择 `landscape | portrait | square`。
- Agent 只把已读资料中可信、可访问的 raster workspace 路径作为参考图，去重后最多 4 个；没有参考图时走文生图，有参考图时走图生图。不得使用 URL、data URL、base64、inline bytes 或 mask。
- 一次 invocation 至多调用一次 `generate_image`。Tool 成功结果只有 `{path, mediaType}`；Agent 返回 closed `{schema:"tsian.image-director.result.v1",asset:{path,mediaType}}`，不回显输入、prompt 或 Host target。
- ref 缺失时可用剩余资料与正文继续；信息不足或 Tool 失败只使当前卡失败，不影响故事与其它插图。

### R5. Optional card entrypoint

- `GameCardRuntimeEntrypoints` 增加可选：

  ```ts
  imageGeneration?: {
    agentId: string
    protocol: "tsian.image-director.v1"
  }
  ```

- 实际卡声明 `{agentId:"image-director",protocol:"tsian.image-director.v1"}`。
- contracts、local manifest normalization、package import/export normalization、Host bridge 和 `tsian.card.entrypoints()` 必须保留这个 closed object；旧卡缺少字段时保持兼容。
- 未知 protocol 或无效 agent id 对前端表现为 capability unavailable，不得退回硬编码 Agent id。

### R6. Card inventory and delivery

- 同步实际 `cards/沉浸阅读器.tsian-card/workspace/**` Prompt、projection、Agent 与 style 文件。
- 更新 `game-card.json` 的 entrypoint 和所有受影响 workspace inventory path/mediaType/byte size；保证不存在 missing、extra 或 duplicate entry。
- 使用已经存在的 `npm run package:card` / `npm run repack:immersive-reader` 完成最终汇合；本任务不修改现有打包基础设施。
- 卡版本只在协议、UI 和最终 dist 汇合时统一递增一次。

### R7. Sibling boundaries

- 平台图片任务拥有 `desktop.env`、图像 adapter、`generate_image`、shared generated-media target、invoke option 和 stable path helper。
- 一致性任务拥有 invocation-start source binding、source revision / branch epoch CAS、checkpoint patch 与 Blob GC。
- UI 任务拥有 assistant view model、ordered settled parser、交互状态、target-only invocation、stable path probe、Object URL 与 lightbox。
- 本任务不得把 durable target 放进 Agent input 或 Tool input，不得在 card workspace 保存历史场景/角色视觉快照。

## Acceptance Criteria

- [ ] AC1: opening 与正式 storyteller Prompt 都自包含同一个 closed brief schema，要求 1–3 个且明确通常 1 个。
- [ ] AC2: 1、2、3 个完整 marker 均得到 clean `content`、原位 `displayContent` 和 ordered raw `projections.illustrations[]`。
- [ ] AC3: 缺失、超量、invalid JSON、invalid schema 与未闭合 marker 均不阻断 turn；marker/JSON 不泄漏到 Markdown。
- [ ] AC4: 唯一 validator 覆盖字段、长度、ref grammar、去重与 additional-properties 边界。
- [ ] AC5: `开局建模` delegation 与 `publish_opening` 集成产生可投影 turn 0，无过期入口引用。
- [ ] AC6: `image-director` 只拥有 `workspace_read` + `generate_image`，请求只含 brief/prose，一次调用最多一次 Tool。
- [ ] AC7: 文生图与 1..4 个可信参考路径图生图都可由 Agent 选择；非法引用不进入 Tool。
- [ ] AC8: entrypoint closed object 在所有 normalization/bridge 边界保留，旧卡与未知 protocol 安全降级。
- [ ] AC9: 卡 workspace inventory 与磁盘一致，并能由现有 package/repack 工作流消费。

## Out of Scope

- 图片 Provider 配置 UI、Tool executor、Host commit 与 checkpoint 算法。
- inline 插图组件、生成状态、lightbox、reload/restore UI。
- 自动生成、全局队列、取消、图库、多版本管理、mask/inpainting 与人物头像协议。
- 打包基础设施改造、新打包脚本和旧配置迁移。
