# 角色形象上传与持久化

## Goal

支持玩家在角色卡中上传角色形象图片并持久化；无上传图片时不再使用首字占位，而是按角色性别展示内置默认头像。让角色卡固定立绘栏始终保持 RPG 档案主视觉感，同时让玩家上传的形象随存档生命周期保存。

## Background

`07-04-present-characters-character-cards` 已实现角色卡全屏视图，其中 `CharacterPortrait.vue` 是 3:4.15 比例的固定立绘栏。MVP 阶段无图片时使用首字占位 + 暗色仪式风边框/微光。本任务补齐图片上传、持久化与默认头像 fallback。

当前 `tsian.workspace.write` 的公开 play bridge 类型只接受 string，但 platform-web 的底层 Runtime Workspace / storage 已支持 Blob。二进制上传需要正式扩展 bridge 边界，而不是通过 `platform.runAction("workspace.write")` 逃生口绕过公共 API。

用户提供两张默认头像源文件：

- `F:/workspace/tmp/avarar/默认头像-女.png`
- `F:/workspace/tmp/avarar/默认头像-男.png`

## Decisions

- D1: 默认头像是 play frontend 内置 UI 资产，打包进前端，不进入 workspace。
- D2: 玩家上传头像是 `save-runtime` workspace media asset，路径为 `save/assets/portraits/characters/<localId>.webp`。
- D3: character entity JSON 只保存 `portrait` 引用元数据，不内嵌 base64 或 object URL。
- D4: `portrait` 图片默认不进入 AIRP runtime / character injection；非多模态 agent 仍依赖 `appearance` / `brief` / `status` 等文本字段。
- D5: 无上传图片或上传图片读取失败时，按性别使用默认头像：优先 `identity.gender`，兼容顶层 `gender`；缺失、未知、不明确或其它值使用男图兜底。
- D6: 玩家前端只允许为 protagonist 上传/更换头像；NPC 默认只读（可展示已有 `portrait.path`，不显示上传入口）。

## Requirements

- R1: 正式扩展 `tsian.workspace.write` / bridge contract，使 play frontend 可写入 `string | Blob`，并保持原有 string 写入兼容。
- R2: 上传图片持久化到 `save-runtime` workspace：`save/assets/portraits/characters/<localId>.webp`。
- R3: character entity 支持可选 `portrait` 元数据：`{ path, mimeType?, updatedAt?, updatedBy? }`；该字段只作为 UI/media 引用，不表示 AIRP 必须读图。
- R4: `CharacterPortrait.vue` 有上传图片时展示 workspace binary image；无上传图片或读取失败时展示默认男/女头像，不再展示首字占位。
- R5: 默认头像按性别选择：`identity.gender` 优先，兼容顶层 `gender`；女/英文 female/woman/girl/f 使用女图；男/英文 male/man/boy/m 使用男图；未知/缺失/不明确使用男图。
- R6: 上传 UI 入口不破坏角色卡视觉，符合烛火书卷·重铸主题；上传中、成功、失败有可见反馈。
- R7: 上传图片限制格式与大小：支持 png/jpg/webp，源文件大小上限 5MB；前端裁剪/缩放到 3:4.15 并输出 WebP。
- R8: 上传权限先聚焦玩家 persona：只有 `entityRef === protagonistRef` 的角色显示上传/更换入口；NPC 默认只读。
- R9: 默认 AIRP injection 不读取、不展开、不注入图片 binary 内容；`appearance` 保持非多模态角色视觉语义来源。

## Acceptance Criteria

- [ ] `tsian.workspace.write` 的公开类型、remote bridge normalizer 与平台 host 写入链路支持 `Blob`，并保持 string 写入可用。
- [ ] 玩家可以在 protagonist 角色卡上传 png/jpg/webp 图片；图片被裁剪为 3:4.15 WebP 并写入 `save/assets/portraits/characters/<localId>.webp`。
- [ ] 上传成功后 character entity JSON 写入 `portrait.path` 元数据；重新打开角色卡时能读取 workspace binary 并展示。
- [ ] 无上传图片、图片缺失或读取失败时展示内置默认头像，不显示首字占位。
- [ ] 默认头像按性别选择：明确女用女图，明确男用男图，未知/缺失/不明确用男图。
- [ ] NPC 角色卡可展示已有 `portrait.path`，但不显示玩家上传入口。
- [ ] 上传错误（格式不支持、文件过大、解码失败、写入失败）有清晰提示。
- [ ] object URL 在替换和组件卸载时被 revoke。
- [ ] SDK 文档说明 `workspace.write` 支持 `Blob`，任务设计说明明确 portrait 图片不默认进入 AIRP injection。
- [ ] 通过 `npm run build --workspace @tsian/contracts`。
- [ ] 通过 `npm run build --workspace @tsian/play-bridge`。
- [ ] 通过 `npm run build --workspace play-frontend-dev`。
- [ ] 通过 `npm run build:web`。

## Out of Scope

- AI 生图集成。
- 多套形象切换。
- 形象历史版本。
- NPC 上传权限完整策略。
- 本机私有头像覆盖层（local-only override）。
- 默认把图片内容注入 LLM 或要求所有 AIRP 模型支持多模态。

## Dependencies

- 依赖 `07-04-present-characters-character-cards`（已归档，提供 CharacterPortrait 占位与角色卡壳）。
- 涉及 `packages/contracts`、`packages/play-bridge`、`apps/platform-web` bridge 边界，以及 `apps/play-frontend-dev` UI。
