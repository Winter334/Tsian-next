# 创意工坊游戏卡更新检测

## Goal

让玩家在不主动打开创意工坊的情况下，也能发现已安装的创意工坊游戏卡存在作者发布的新版本。更新检测以作者明确发布的 `resourceVersion` 为准，避免因为简介、标签、封面等元数据变化造成频繁误提示。

## Background / Evidence

- 创意工坊包契约 `MarketPackage` 已包含 `id`、`resourceId`、`resourceVersion`、`createdAt`、`updatedAt`；本任务只使用 `resourceVersion` 判断更新，不使用 `updatedAt`。证据：`packages/contracts/src/market.ts:11`。
- 后端 `market_packages` 表已保存 `resource_id`、`resource_version`、`updated_at` 等字段，当前无需新增 content hash。证据：`apps/platform-server/internal/storage/db.go:66`。
- 本地游戏卡记录当前只有 `id`、`manifest`、`source`、`createdAt`、`updatedAt`，且 `source` 只有 `builtin | local | imported`，缺少工坊来源 package id 和安装时版本。证据：`apps/platform-web/src/storage/db.ts:28`。
- 当前创意工坊下载游戏卡流程在下载并检查同 `manifest.id` 后调用 `importPlatformGameCardPackage`，导入层统一保存为 `source: "imported"`，因此安装后丢失工坊来源。证据：`apps/platform-web/src/views/AppMarketView.vue:805`、`apps/platform-web/src/storage/game-card-packages.ts:625`。
- 桌面应用入口包括「创意工坊」「我的应用」「开始游戏」；本功能的全局提示归属「我的应用」。证据：`apps/platform-web/src/desktop-apps.ts:98`、`apps/platform-web/src/desktop-apps.ts:114`、`apps/platform-web/src/desktop-apps.ts:178`。
- 桌面图标由 `DesktopShell.vue` 渲染，公告中心已有任务栏未读数样式可作为桌面状态提示参考。证据：`apps/platform-web/src/components/desktop/DesktopShell.vue:12`、`apps/platform-web/src/components/desktop/DesktopShell.vue:94`。
- 「我的应用」内部已有游戏卡图标网格和 loaded 标记位置，适合增加每张卡的 `更新` 标记。证据：`apps/platform-web/src/views/GameCardLibraryView.vue:72`、`apps/platform-web/src/views/GameCardLibraryView.vue:111`。

## Requirements

### R1. 更新判断语义

- 只使用远端 `MarketPackage.resourceVersion` 与本地记录的工坊来源版本比较。
- 不使用 `updatedAt` 判断更新。
- 不做 content hash。
- 不用 `manifest.version` 判断工坊更新状态；`manifest.version` 仍作为游戏卡自身版本显示。
- 比较语义为修剪后的字符串相等性；不推断 semver 顺序。

### R2. 本地工坊来源记录

- 后续从创意工坊安装 / 更新的游戏卡需要记录安装来源。
- 来源记录必须至少包含：
  - `packageId`: 安装时的 `MarketPackage.id`
  - `resourceId`: 安装时的 `MarketPackage.resourceId`
  - `resourceVersion`: 安装时的 `MarketPackage.resourceVersion`
- 更新检测只跟踪安装时的 `packageId`。
- 不按 `resourceId` 搜索同 ID 的最新包。
- 不处理作者重新上传成新工坊条目的情况。
- 不追溯旧卡；旧的本地卡 / 旧的 imported 卡没有来源记录时不参与检测。
- 更新成功后，本地来源记录同步为远端最新 `resourceVersion`。

### R3. 检测时机

- 进入网页后，在平台初始化完成后后台检测一次。
- 打开「我的应用」时刷新一次。
- 从创意工坊安装游戏卡成功后刷新一次。
- 在「我的应用」确认更新并覆盖成功后刷新一次。
- 页面从不可见重新可见，且距离上一次成功检测超过 10 分钟时刷新一次。
- 检测失败不弹窗、不 toast、不清空上一次成功检测到的更新状态。

### R4. 桌面全局提示

- 只在桌面「我的应用」图标显示全局更新提示。
- 不在「创意工坊」图标显示全局更新提示。
- 不在「开始游戏」图标显示全局更新提示。
- 有任意已安装游戏卡存在更新时，桌面「我的应用」图标右上角显示固定短角标：`更新`。
- 不显示数量，不显示版本号。
- 没有更新时不显示角标。
- 角标应简短、清晰、醒目，并与「我的应用」内部卡片角标视觉一致。

### R5. 我的应用内提示与更新确认

- 「我的应用」内有更新的游戏卡卡片显示固定短角标：`更新`。
- 玩家点击更新入口后，在「我的应用」内弹确认框。
- 不跳转创意工坊详情。
- 不提供“查看详情”按钮。
- 确认框 MVP 内容包括：
  - 标题：发现新版本
  - 当前版本：本地来源记录的 `resourceVersion`
  - 最新版本：远端 `resourceVersion`
  - 说明：更新会替换本地游戏卡内容，已有存档会保留。
- 按钮为：`更新` / `取消`。

### R6. 更新执行行为

- 玩家确认后，按本地来源记录的 `packageId` 下载当前工坊包。
- 导入并覆盖同 `manifest.id` 的本地游戏卡内容。
- 已有存档保留。
- 不做合并。
- 不做 diff。
- 不做另存为副本。
- 不提示玩家备份。
- 更新成功后：
  - 该卡本地工坊来源版本更新为远端 `resourceVersion`
  - 该卡 `更新` 标记消失
  - 桌面「我的应用」角标重新计算

### R7. 忽略版本

- MVP 不做“忽略此版本”。
- 只要本地 `resourceVersion` 与远端不同，就持续显示 `更新`。
- 更新成功后才消失。

### R8. 更新日志后续方向

- 当前任务不实现更新日志。
- 后续任务可让作者更新资源时选填更新日志，并在创意工坊详情页与我的应用更新确认框展示。
- 当前任务不得新增后端 changelog 字段、接口和 UI 表单。

## Out of Scope

- 用 `updatedAt` 触发更新提示。
- content hash / zip hash。
- 旧卡自动匹配或追溯工坊来源。
- 同 `resourceId` 多工坊条目的最新版选择。
- 作者迁移工坊条目后的继承 / 转移关系。
- 忽略某个版本。
- 更新日志字段、版本历史、作者更新日志表单。
- 本地修改 diff、合并、三方合并、另存为新版副本。
- 批量更新。
- 后端批量 metadata endpoint；MVP 可逐个按 `packageId` 查询。

## Acceptance Criteria

- [ ] 从创意工坊安装游戏卡成功后，本地游戏卡记录保存该工坊包的 `packageId`、`resourceId`、`resourceVersion`。
- [ ] 旧的本地卡 / 旧的 imported 卡没有来源记录时，不参与更新检测，也不会被自动绑定到工坊条目。
- [ ] 当远端 `resourceVersion` 与本地来源记录不同，系统判定该卡有更新；当二者相同，判定无更新。
- [ ] 修改远端 `updatedAt` 但不改变 `resourceVersion` 时，不应触发更新提示。
- [ ] 进入网页后后台检测一次，检测失败不弹窗、不 toast、不清空上一次成功状态。
- [ ] 打开「我的应用」会刷新更新状态，并避免刚启动后立即产生无意义重复请求。
- [ ] 页面重新可见且距离上次成功检测超过 10 分钟时会刷新更新状态。
- [ ] 任意游戏卡有更新时，桌面「我的应用」图标显示固定角标 `更新`；无更新时不显示。
- [ ] 桌面「创意工坊」与「开始游戏」图标不显示该全局更新角标。
- [ ] 「我的应用」内有更新的卡显示固定角标 `更新`。
- [ ] 在「我的应用」点击更新入口弹出确认框，显示当前版本、最新版本和“更新会替换本地游戏卡内容，已有存档会保留。”
- [ ] 用户取消更新时，不下载、不覆盖、不改变本地来源记录。
- [ ] 用户确认更新时，按来源 `packageId` 下载并覆盖本地游戏卡内容，已有存档仍保留。
- [ ] 更新成功后，该卡更新标记消失，全局「我的应用」角标重新计算。
- [ ] MVP 不提供忽略版本、更新日志、diff、合并、另存为副本或备份提示。

## Validation

- Run `npm run build:web` because this task changes `apps/platform-web` frontend and storage code.
- Run `git diff --check` before finish.
- If the Dexie schema changes, bump the IndexedDB name in both `apps/platform-web/src/storage/db.ts` and `apps/platform-web/public/tsian-game-card-frontend-sw.js` per storage spec.
