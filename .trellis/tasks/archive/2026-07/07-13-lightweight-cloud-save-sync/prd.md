# 轻量云备份自动同步

## Goal

为 Tsian 增加面向玩家的轻量 **云备份** 和本地存档导入/导出能力，让玩家能在不理解工程概念的情况下备份当前游玩进度、换设备拉取云端备份、或把存档保存成自己的本地文件。该能力默认关闭，不改变现有本地优先的游玩流程。

## Background / Confirmed Facts

- 现有本地存档是 Dexie `saves` 元数据 + `workspaceFiles` 当前运行时文件；存档记录包含 `gameCardId` 和 `gameCardVersion`，不复制整张卡内容。见 `apps/platform-web/src/storage/db.ts:12`、`apps/platform-web/src/storage/saves.ts:79`。
- 有效 workspace 是卡内容/前端/manifest 与 save runtime 的叠加；备份不能上传或导出整份有效 workspace，否则会把 `agents/`、`skills/`、`frontend/`、`docs/`、`game-card.json` 重复塞进每个存档。
- 路径生命周期已有边界：`save/**` 是 active save runtime；`.tsian/local/**` 是本地平台数据，不进入 save checkpoint/restore；其它 `.tsian/**` 是 per-save 平台元数据。见 `apps/platform-web/src/storage/workspace-paths.ts:45`、`apps/platform-web/src/storage/workspace-paths.ts:49`。
- 本地 checkpoint 已采用 thin manifest + SHA-256 blob 的内容寻址思路，但本任务明确不同步/导出 checkpoint。见 `apps/platform-web/src/storage/checkpoints.ts:42`、`apps/platform-web/src/storage/blobs.ts:1`。
- 服务器已有用户/session 鉴权、SQLite 初始化、文件系统 BlobStore、市场/工坊上传下载路由基础；尚无 cloud backup 表或 API。见 `apps/platform-server/internal/storage/db.go:39`、`apps/platform-server/internal/storage/blobstore.go:10`、`apps/platform-server/internal/server/server.go:45`。
- 前端已有带 cookie 的 `apiFetch` 和 auth/market API client；尚无 cloud backup API client。见 `apps/platform-web/src/platform-host/api-client.ts:23`。
- 当前没有现成的存档导入/导出功能；已有 Game Card package 导入/导出是卡包能力，不是 Save Instance 备份。

## Product Decisions

- 玩家侧功能名称统一为 **云备份**，避免“云同步/云存档”暗示复杂多端合并。
- 云备份默认关闭；登录后不自动批量上传历史本地存档。
- 全局“自动备份”开启后，只在成功回合结束后备份正在玩的当前存档，不后台扫描其它存档。
- 手动“备份”是单存档操作：没有云端备份时创建云端备份，已有云端备份时用本机当前进度更新云端备份；MVP 不做“一键备份全部存档”。
- 启动器提供一个“同步云端”入口，避免换设备后没有本地存档时缺少拉取入口。当前卡有多个云端备份时，用弹窗选择要拉取的备份。
- 控制面板的“云备份”页不提供拉取/恢复按钮；云端备份列表用于查看与删除。保存与拉取操作放在启动器语境中。
- 删除本机存档时，如果存在云端备份，弹窗询问是否同时删除云端备份；选择否则只删除本机存档。
- 本地存档导入/导出纳入 MVP，作为无需账号和服务器的玩家自备份兜底；范围与云备份一致。
- 启动器存档区顶部放“新建存档 / 导入 / 同步云端”；每个存档行放“继续 / 重命名 / 备份 / 导出 / 删除”。
- 手动“备份”遇到云端版本比本机记录更新时，不做分叉或合并；弹窗说明风险后允许玩家用本机当前进度覆盖云端备份。

## Requirements

### R1. Backup Scope

- 云备份和本地导出只保存当前存档状态，不保存 checkpoint 或历史回滚点。
- 包含路径：
  - `save/**`
  - per-save `.tsian/**` 平台元数据，但必须排除 `.tsian/local/**`
- 排除路径：
  - checkpoint/checkpoint blobs
  - embedding index/cache
  - assistant local context
  - temp attachments
  - card content and frontend: `agents/**`、`skills/**`、`docs/**`、`frontend/**`、`game-card.json` 等
- 云端备份和本地导出都必须记录存档名、`cardId`、`cardVersion`、更新时间/导出时间和文件清单。

### R2. Player-Facing Language

- 玩家界面不得暴露 `manifest`、`blob`、`revision`、`checkpoint`、`workspace`、`runtime state` 等工程术语。
- 界面文案优先使用“备份 / 自动备份 / 同步云端 / 导入 / 导出 / 空间已用”等可理解表达。
- 技术边界可转译为玩家语言，例如“只备份当前进度，不备份回滚点”。

### R3. Cloud Backup Data Model and Quota

- 云端保存当前备份清单和文件内容；不上传整个 save zip，也不保存历史 revision。
- 服务端强制每用户云备份总量不超过 100MB。
- 配额统计按用户所有云端备份当前文件清单的 `size` 总和计算；不要求按去重后 blob 大小计费。
- 文件内容可按 `ownerUserId + sha256 hash` 物理去重，但不得跨用户去重。
- 服务端必须校验上传文件的实际 size/hash 与客户端声明一致。
- 服务端必须限制请求体大小，防止单次请求撑爆内存/磁盘；该限制是基础安全校验，不作为复杂产品配额呈现。
- 服务端必须校验备份路径白名单，拒绝卡内容、`.tsian/local/**`、临时文件和其它非 save-owned 路径。
- 删除或替换云端备份后，服务端应清理该用户不再被任何当前备份引用的文件内容。

### R4. Automatic Backup

- 全局自动备份开关默认关闭。
- 登录且自动备份开启时，成功提交一轮后自动备份当前 active save。
- 自动备份应 debounce/延迟触发，避免回合内或维护阶段的连续 workspace 写入导致频繁上传中间态。
- 自动备份失败不得阻塞游玩；本地存档仍是权威运行数据，UI 显示待同步/失败状态或轻量提示。

### R5. Manual Backup

- 每个本地存档行提供“备份”操作。
- 第一次备份该存档时，创建对应云端备份；再次备份时，更新同一个云端备份。
- 如果云端备份已在其它设备更新，点击“备份”时弹窗说明覆盖风险；玩家确认后允许用本机当前进度覆盖云端，取消则不上传。
- 未登录或服务器不可用时，提示玩家无法使用云备份，但本地导出仍可用。

### R6. Sync From Cloud

- 启动器提供一个“同步云端”按钮，即使当前卡没有本地存档也可使用。
- 点击“同步云端”时，拉取当前游戏卡对应的云端备份列表。
- 当前卡没有云端备份时，提示“暂无云端备份”。
- 当前卡有一个云端备份时，直接进入拉取流程。
- 当前卡有多个云端备份时，打开选择弹窗；列表显示备份名称、云端更新时间、大小和卡版本。
- 如果所选云端备份能匹配到本机已有同一云备份身份的存档，覆盖前必须弹确认，明确提示本机当前进度会被云端备份替换。
- 如果本机没有匹配存档，则同步到一个新的本地存档，避免在全局按钮语境下误覆盖其它存档。
- 如果本机没有对应 `cardId` 的游戏卡，UI 应提示玩家先安装或切换到对应游戏卡。
- 如果本机存在同 `cardId` 但版本不同，沿用现有“旧存档继续使用新版卡”的确认心智，不在本任务中引入 card family 或 migration 机制。

### R7. Delete Behavior

- 删除本机存档时，如果该存档有关联云端备份，确认弹窗必须提供“同时删除云端备份”和“只删除本机存档”的选择。
- 选择“只删除本机存档”时，云端备份保留，之后仍可通过“同步云端”恢复到本机。
- 选择“同时删除云端备份”时，服务端删除对应云端备份并清理不再引用的用户级文件内容。
- 控制面板“云备份”页也允许删除云端备份。

### R8. Local Save Import / Export

- 本地“导出”是单存档操作，导出当前存档状态到本地备份文件。
- 本地“导入”入口放在启动器存档区顶部，保证本机没有存档时也可以导入。
- 导出范围与云备份一致；不导出 checkpoint、游戏卡包、Agent/Skill/frontend/docs 或完整有效 workspace。
- 导出文件必须包含可校验的元数据：格式 schema、存档名、`cardId`、`cardVersion`、导出时间、文件清单。
- 导出格式必须支持二进制 workspace 文件；MVP 使用 zip 包而不是单个 JSON。
- 导入存档文件默认创建新的本地 save，不覆盖已有本地存档。
- 导入文件的 `cardId` 与当前游戏卡不匹配时，提示玩家先安装或切换到对应游戏卡。

### R9. UI Placement

- “控制面板 → 云备份”负责显示和管理：自动备份开关、已用空间 / 100MB、云端备份轻量列表。
- 控制面板云端备份列表用于查看和删除云端备份，不提供拉取/恢复按钮。
- 账号中心只显示登录状态和云备份可用性提示，不承载主开关或单存档操作。
- 启动器存档区顶部：`新建存档 / 导入 / 同步云端`。
- 每个本地存档行：`继续 / 重命名 / 备份 / 导出 / 删除`。
- 启动器不额外常驻显示纯云端备份行。

## Out of Scope

- 云端 checkpoint/回滚历史同步。
- 云端保存游戏卡包、Agent/Skill/frontend/docs 或完整有效 workspace。
- 实时多端协作、path-level merge 或复杂分叉管理。
- 按单存档、单文件、文件数、云存档数的产品配额。
- 跨用户 blob 去重。
- 付费扩容、图片压缩、图片专用 CDN/缩略图处理。
- card `familyId`、runtime schema migration 或卡 ID 管理入口。

## Acceptance Criteria

- [ ] 登录用户可以在“控制面板 → 云备份”看到自动备份开关、空间使用量、100MB 总配额和云端备份列表。
- [ ] 账号中心文案只提示登录后可使用云备份，不承诺默认同步或游戏卡同步。
- [ ] 全局自动备份开启后，只有正在玩的当前存档会在成功回合提交后自动备份；其它存档不会被后台扫描或自动上传。
- [ ] 云备份只上传 `save/**` 和允许的 per-save `.tsian/**` 文件；不会上传卡内容、前端、checkpoint、embedding index、`.tsian/local/**` 或 temp attachments。
- [ ] 服务端校验上传文件 hash/size 和路径白名单后才接受备份提交。
- [ ] 用户云备份总量超过 100MB 时，服务端拒绝提交并返回可展示的空间不足错误。
- [ ] 手动“备份”创建或更新单个存档的云端备份；遇到云端版本冲突时，玩家确认后才允许用本机当前进度覆盖云端备份。
- [ ] “同步云端”在启动器中有入口，即使当前卡没有任何本机存档也可以尝试拉取云端备份。
- [ ] “同步云端”在当前卡有多个云端备份时打开选择弹窗；匹配到已有本机存档时覆盖前必须确认，没有匹配本机存档时创建新的本地 save。
- [ ] 本地没有对应卡时，“同步云端”和本地导入都给出明确提示，不静默创建错误卡关联。
- [ ] 删除有关联云端备份的本机存档时，玩家可以选择同时删除云端备份或只删除本机存档；两种选择都按文案执行。
- [ ] 控制面板云端备份列表可以删除云端备份，并刷新空间使用量。
- [ ] 本地存档可以导出为支持二进制文件的备份 zip；导出内容与云备份范围一致且不包含游戏卡或 checkpoint。
- [ ] 本地存档备份 zip 可以从启动器导入；导入默认创建新的本地 save，卡不匹配时给出明确提示。
- [ ] 玩家界面不出现 `manifest`、`blob`、`revision`、`checkpoint`、`workspace`、`runtime state` 等工程术语。
