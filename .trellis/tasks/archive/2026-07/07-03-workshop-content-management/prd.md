# 创意工坊内容管理

## Goal

补齐创意工坊的内容管理能力：已登录玩家可以在创意工坊内找到自己上传的资源，编辑发布信息、替换资源包并删除发布物，避免资源一旦上传就只能永久公开、无法纠错、无法更新或无法下架。

## User Value

- 玩家可以修正标题、简介、作者、版本、标签等公开元数据。
- 玩家可以用新的本地资源包更新已有发布物，让 Agent、Skill 或游戏卡发布物持续迭代。
- 玩家可以硬删除自己上传错、过期或不想继续公开的资源。
- 玩家可以在创意工坊内通过“我的上传”集中管理自己的发布物，不需要跳到“我的应用”。

## Background / Confirmed Facts

- 当前任务为 `.trellis/tasks/07-03-workshop-content-management/`，状态为 planning。
- 创意工坊现有后端路由包括公开列表、公开计数、公开详情、登录后上传、公开下载、封面和封面缩略图：`apps/platform-server/internal/server/server.go:46-56`。
- 上传端点已通过 `middleware.RequireAuth` 挂载：`apps/platform-server/internal/server/server.go:53`；中间件会把当前用户写入 request context：`apps/platform-server/internal/middleware/auth.go:12-41`。
- 上传 handler 会读取当前用户，缺失时返回 401：`apps/platform-server/internal/market/handler.go:195-200`。
- 上传资源包最大 50MB；后端解析 multipart、校验 `resourceType` / tags、读取 zip 并校验 manifest：`apps/platform-server/internal/market/handler.go:202-238`。
- 游戏卡上传会处理封面，存储 zip、展示封面和缩略图 blob：`apps/platform-server/internal/market/handler.go:246-281`。
- 上传记录写入 `resourceType/resourceId/resourceAuthor/resourceVersion/name/summary/tags/cover*BlobKey/uploaderId`：`apps/platform-server/internal/market/handler.go:301-314`。
- 列表/详情响应当前包含 `uploader` 和 `createdAt`，但没有 `updatedAt` 或管理态字段：`apps/platform-server/internal/market/handler.go:82-95`、`apps/platform-server/internal/market/handler.go:770-800`。
- 共享 contract `MarketPackage` 当前没有 `updatedAt`：`packages/contracts/src/market.ts:9-23`。
- `market.Repository` 当前只有列表、计数、详情、创建和下载计数递增，没有更新、删除或 owner 过滤接口：`apps/platform-server/internal/market/market.go:56-62`。
- SQLite 列表查询已有 resourceType / q / tag / sort / cursor / limit，但没有 uploader 过滤：`apps/platform-server/internal/market/sqlite_repo.go:21-89`、`apps/platform-server/internal/market/sqlite_repo.go:163-178`。
- SQLite 创建记录和下载计数更新已存在，但没有更新发布物或删除发布物的方法：`apps/platform-server/internal/market/sqlite_repo.go:134-159`。
- `marketApi` 当前提供 `list/counts/get/upload/download`，没有“我的上传”、update 或 delete API：`apps/platform-web/src/platform-host/api-client.ts:74-165`。
- 创意工坊页面当前使用左侧资源类型栏，详情页只向详情组件传递安装状态和 install 事件：`apps/platform-web/src/views/AppMarketView.vue:47-53`、`apps/platform-web/src/views/AppMarketView.vue:81-93`。
- 未登录上传页已经在创意工坊内显示登录提示和“打开账号中心”入口：`apps/platform-web/src/views/AppMarketView.vue:96-119`。
- 上传资源的本地来源范围已经确定：游戏卡使用所有本地非内置卡，Agent/Skill 使用当前加载卡与桌面助手资源：`apps/platform-web/src/views/AppMarketView.vue:423-436`、`apps/platform-web/src/views/AppMarketView.vue:753-758`、`apps/platform-web/src/views/AppMarketView.vue:236-285`。
- `MarketInstallDialog` 已有适合资源选择类弹窗的 FloatingWindow + 列表按钮形态，可作为替换资源选择弹窗的交互参考：`apps/platform-web/src/components/market/MarketInstallDialog.vue:1-36`。
- 前端登录状态能拿到当前用户 ID，可用于本地判断 `pkg.uploader.id === currentUser.id` 后展示 owner-only UI：`apps/platform-web/src/composables/useAuth.ts:9-53`、`packages/contracts/src/user.ts:3-9`。
- 现有市场集成测试覆盖上传、列表、详情、下载和下载计数，但尚无修改/删除权限测试：`apps/platform-server/internal/server/market_test.go:97-227`。

## Requirements

- R1: 只有资源上传者本人可以修改或删除该资源；未登录用户不能执行管理操作，非上传者不能修改/删除别人的资源。
- R2: 公共列表、公共计数、详情、下载和封面继续对未登录用户可见；管理入口只对资源拥有者执行实际修改/删除。
- R3: 管理主入口留在创意工坊内，不把远程上传内容管理塞进“我的应用”，也不从“我的应用”提供管理跳转。
- R4: 左侧栏底部提供单按钮范围切换：全部资源态下按钮显示“我的上传”，我的上传态下按钮显示“全部资源”。资源类型筛选在当前范围内继续生效。
- R5: 未登录玩家也能看到并点击“我的上传”；点击后仍留在创意工坊内，主内容区显示登录提示与打开账号中心入口。
- R6: “我的上传”只列出当前登录用户上传的资源，并保留 resourceType、搜索、tag、排序、分页和计数能力。
- R7: 资源详情页对拥有者显示 owner-only 管理区，提供“编辑发布”和“删除”。
- R8: “编辑发布”在详情页内联进入编辑模式，不做路由跳转。元信息字段在详情页内联编辑；替换资源包通过“选择资源以替换”按钮打开类似安装目标选择的弹窗完成，选择结果回填到内联编辑表单。
- R9: 默认不选择新资源即表示不替换资源包，不额外提供“不替换”按钮/选项；误选后可清除已选择的替换资源。
- R10: 替换资源选择范围与上传资源保持一致：游戏卡可选所有本地非内置游戏卡；Agent/Skill 只显示当前加载游戏卡与桌面助手中的资源。界面文案保持克制，不额外解释玩家能自然理解的来源限制。
- R11: 编辑发布默认值策略：打开编辑时字段默认填当前发布物信息；未选择替换资源时只保存元信息；选择替换资源后可从新资源包 manifest 补齐标题、版本、作者、简介，但不得覆盖用户已经改动过的字段；Tags 不从资源包推断，保留用户当前输入。
- R12: 修改操作必须支持替换资源包文件；替换包必须继续走现有 50MB、resourceType、manifest、tag 等校验规则。
- R13: 替换资源包只要求 `resourceType` 与原发布物一致，不要求新旧 `resourceId` 一致；替换成功后发布物沿用原 `package.id`，但 `resourceId/resourceAuthor/resourceVersion` 等资源身份元数据可随新包更新。
- R14: 资源包替换成功后，后续下载应返回新包；列表/详情应展示新元数据、版本和更新时间；旧 zip blob 与旧封面 blob 应被清理或有明确失败处理。
- R15: 删除采用硬删除：删除后公共列表/搜索/详情/下载/封面不再能访问该资源，数据库记录与资源 blob 都应移除。
- R16: 删除确认使用现有确认弹窗，保留 danger 样式与“无法撤销”提示；不要求输入资源名，不使用多段警告。
- R17: API、contracts、后端测试和前端 API client 需要同步更新，避免权限和类型边界只存在于 UI。

## Acceptance Criteria

- [ ] 左侧栏底部提供单一范围切换按钮：全部资源态显示“我的上传”，我的上传态显示“全部资源”；资源类型筛选在当前范围内继续生效。
- [ ] 未登录玩家也能切换到“我的上传”；主内容区显示登录提示与打开账号中心入口，不离开创意工坊。
- [ ] 已登录玩家切换到“我的上传”后，只看到自己上传的资源；搜索、tag、排序、分页、资源类型筛选和侧栏计数按“我的上传”范围生效。
- [ ] 资源详情页只对拥有者显示“编辑发布”和“删除”管理操作；非拥有者和未登录用户不显示 owner-only 管理区。
- [ ] “编辑发布”在详情页内联展开元数据编辑；替换资源通过弹窗选择，并在保存前回填到内联表单。
- [ ] 不选择替换资源时，保存只更新元信息；选择替换资源时，保存同时替换资源包。
- [ ] 选择替换资源后，manifest 默认值只补齐未被用户改动过的标题、版本、作者、简介；Tags 保持当前输入。
- [ ] 替换资源包只允许同 `resourceType`；允许 `resourceId` 随新包变化；替换后下载返回新包，列表/详情展示新 `resourceId/resourceAuthor/resourceVersion` 和 `updatedAt`。
- [ ] 删除操作使用 danger 确认弹窗，明确删除后无法撤销，但不要求输入资源名或经过多段确认。
- [ ] 上传者可以硬删除自己资源；删除后列表、详情、下载、封面和封面缩略图均不可再访问。
- [ ] 未登录用户修改/删除返回 401；非上传者修改/删除返回 403 或等价权限错误。
- [ ] 修改/替换资源包时沿用 50MB、resourceType、manifest、tag 等校验规则。
- [ ] 删除和替换会清理对应 zip blob、展示封面 blob、封面缩略图 blob，且不会删除其他资源的 blob。
- [ ] 后端集成测试覆盖 owner 更新元信息、owner 替换资源包、owner 删除、非 owner 拒绝、未登录拒绝、删除后访问失败。
- [ ] `npm run build:contracts`、`npm run build:web`、`go -C ./apps/platform-server test ./...` 通过。

## Out of Scope

- 管理员审核、管理员代删、举报/申诉系统。
- 软删除、恢复已删除资源、审计后台。
- 资源版本历史、回滚到旧版本、下载旧版本。
- 删除前通知已下载用户或追踪安装者。
- 跨资源依赖影响分析（例如某 Skill 被其他资源引用）。
- 批量管理、批量删除、复杂仪表盘统计。
- 从“我的应用”跳转到上传管理，或在“我的应用”里直接管理远程发布物。
- 替换资源包时强制 `resourceId` 不变。
- 替换 Agent/Skill 时扫描所有本地游戏卡里的 Agent/Skill。
- 对玩家能自然理解的来源限制添加冗长说明文案。

## Open Questions

None.
