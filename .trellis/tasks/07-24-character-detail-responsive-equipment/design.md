# Technical Design

## Scope And Boundaries

本任务只修改 `apps/play-frontend-dev`，分为三条相互衔接的实现边界：

1. **数据读取边界**：扩充开发前端的角色/物品强类型与容错解析，保留装备槽、装备描述和实际贡献。
2. **角色页边界**：把既有“列表 + 独立立绘列 + 三标签详情”重组为“人物选择 + 顶部模式控制 + 共享角色舞台 + 模式内容”。
3. **正式游戏壳层边界**：通过响应式 CSS 和少量展示状态，把左右桌面 rail 在手机上转换为状态抽屉与底部导航。

不修改 Play Bridge、平台存储、卡内 packaged frontend、卡清单或装备写盘协议。开发前端仍只通过 `PlayFrontendBridge` 读取/写入 save-runtime workspace。

## Aesthetic Direction

采用“**烟墨角色卷宗**”方向：保留现有深色、余烬金与古卷气质，但把厚重矩形卡片降到最低。记忆点是无框人物立绘的烟墨消散边缘，以及围绕立绘排列、以斜线和短签表达信息的双轨舞台。

- 立绘是最大、最稳定的视觉体；属性和装备只作为轨道符号补充。
- 属性使用方形无框印记和真实对角线，装备使用同尺度紧凑槽位。
- 滚动提示以边缘淡化、末端内容轻微露出实现，不恢复可见滚动条。
- 动效集中在模式切换、移动 Hero 收束及抽屉/模态进入；`prefers-reduced-motion` 下取消位移和缩放。
- 烟墨边缘使用 CSS/SVG 静态滤镜或 mask 组合；不引入逐帧噪声动画，也不要求新增运行时依赖。

## Data Contracts And Normalization

### Character equipment

在 `character-types.ts` 增加：

```ts
interface CharacterEquipmentSlot {
  ref: string | null
  applied?: Record<string, number>
}

type CharacterEquipment = Record<string, CharacterEquipmentSlot>
```

`CharacterEntity.equipment?: CharacterEquipment`。`parse-character.ts` 在边界完成归一：

- `equipment` 必须是普通对象。
- 每个槽值必须是对象，`ref` 只接受非空字符串或显式 `null`。
- `applied` 只保留有限数值；空对象不附加。
- 单个非法槽被丢弃，不使整个角色解析失败。
- 通过顺序遍历和逐项赋值保留 JSON 对象键顺序；渲染使用 `Object.entries()`，不排序。

### Item equipment metadata

在 `item-types.ts` 增加 `ItemEquipment`，包含可选的 `slot`、`mods`、`effects`，并挂到 `ItemEntity.equipment?`。`parse-item.ts`：

- `slot` 只接受非空字符串。
- `mods` 只保留字符串值。
- `effects` 复用字符串数组归一逻辑。
- 至少一个字段有效时才附加 `equipment`。

UI 不解释 `mods` 表达式。`attributes` 继续作为当前有效值显示；详情中的“实际贡献”只来自角色装备槽 `applied`。

### Inventory view model

容器读取继续在前端按 ref 延迟进行，但将“当前容器”和“单物品详情”拆开：

- 容器面板维护 `path: Array<{ ref, name }>`、当前网格槽位和请求版本号。
- 点击容器：验证目标不在当前 path 中，再替换当前容器内容并 push 面包屑；发现环时显示不可进入状态。
- 点击物品：设置单一 `selectedItem`，不改变容器 path。
- 顶层角色容器作为统一方格入口；进入容器后仍在同一面板展示 contents。
- 由 `equipment` 生成 `Map<itemRef, slotContext[]>`，为网格徽标、槽位联动和详情上下文提供单一来源。即使同一 ref 被异常地用于多个槽位，也按数组容错展示。

读取辅助逻辑从现有 `InventoryPane.vue` 的混合职责中抽到小型 helper/composable，避免新面板同时承担实体读取、递归导航、模态和大段呈现。

## Component Architecture

### State ownership

`CharacterView.vue` 持有不会因 `CharacterSlot :key=selectedRef` 重挂而丢失的页面偏好：

- `activeMode: "character" | "items"`；
- 每个模式的桌面轨道 `scrollTop`；
- 移动人物抽屉开关；
- 当前选择角色；
- 角色页主滚动位置/Hero 收束状态。

角色切换只重挂当前角色的数据槽，模式不变。若新角色没有对应内容，展示该模式的空态而不强制切换。

当前场景读取不再依赖模板根节点 `:key` 触发 setup。`CharacterView` 显式 watch `currentSceneRef` 并加载新场景，以请求版本或 ref 校验忽略过期结果；选中角色在 scene 更新后优先选择仍在场的原角色，否则选择在场主角，再否则首个在场角色。

### Character selection

`CharacterList.vue` 只消费 `scene.present`。删除关联人物派生分组，复用 `CharacterListItem.vue` 的实体/头像读取核心：

- 桌面变体宽 156–176px，列表项只显示头像、姓名和主角/当前标记。
- 移动变体放入左侧 Dialog/Drawer，同样只显示头像和姓名。
- 角色选择后关闭移动抽屉；桌面不受影响。

### Page control and shared stage

`CharacterCard.vue` 由旧两列壳改为响应式页面骨架：

- 顶部 `CharacterModeBar`：桌面显示模式切换；移动同时显示人物抽屉触发头像。
- 中部 `CharacterStage`：共享立绘、身份、量表，以及根据模式切换的 `AttributeTrack` / `EquipmentTrack`。
- 右侧 `CharacterDossierPanel` 或 `InventoryPanel`：各自拥有独立内容滚动。

`CharacterStage` 始终挂载同一个 `CharacterPortrait`。属性/装备轨道作为舞台信息层切换，而不是替换整个舞台。

### Desktop stage scroll

舞台内部拆为固定中心层和轨道滚动层：

- 中心立绘/身份/量表使用固定 grid 区域。
- 两条轨道位于同一个滚动容器中的左右列，因此天然共享一个 `scrollTop`，无需监听两个容器互相同步，避免反馈循环和像素漂移。
- 轨道容器隐藏滚动条，并在上下边缘放置 pointer-events:none 的渐隐遮罩。
- `CharacterView` 在模式切换前记录容器 scrollTop，切换后在 next tick 恢复对应模式位置。

属性和槽位按原始顺序交替分配左右列。额外条目继续向下排列，不缩小立绘。

### Mobile stage scroll

手机断点下不保留桌面轨道滚动容器：

- 角色页自身成为 header 与 bottom nav 之间的唯一主滚动容器。
- 立绘先作为 34–40dvh Hero；属性/装备条目在其后按两列排布。
- 使用主滚动容器的 `scroll` 事件或 `IntersectionObserver` 判断 Hero 锚点是否离开，切换紧凑角色条。
- 紧凑角色条和模式控制位于全局 Header 下方的 sticky 层；底部 padding 包含 bottom nav 高度与 safe-area。
- 断点切换时不复制数据逻辑；相同条目 DOM 由 CSS grid 重排。

## Portrait Flow

`CharacterPortrait.vue` 负责读取 binary、object URL 生命周期和上传，但展示改为可点击的无框舞台：

1. 点击立绘打开新的 Reka `Dialog`。
2. Dialog 中以 `object-fit: contain` 展示同一个完整资源，并提供上传/替换操作。
3. 隐藏 file input 仍由该组件触发；上传状态和错误显示在 Dialog 内。
4. 上传成功沿用现有 workspace 写入及 portrait metadata patch，再刷新立绘并通知人物列表。

`preparePortraitBlob()` 取消中心裁切：源图按比例缩放，使最大边不超过 1024；小图不强制放大；导出 WebP 0.9。舞台 `object-fit: cover`/mask 只负责显示裁切。已有已裁切文件不作迁移。

## Dossier And Pinning

现有 `OverviewPane.vue` 作为档案内容基础，但移除重复的页面级姓名标题，并接收 `canPin`：

- `entityRef === protagonistRef` 时，身份、外貌、状态、目标、属性和量表等现有 PinButton 才可出现。
- NPC 传 null/false 给可钉选子组件，不修改本轮状态栏 pin 存储协议。
- 档案面板独立滚动；字段空态和 extensions 解析继续沿用现有容错边界。

旧 `CharacterDetail.vue` 和 `AttributesPane.vue` 不再作为标签页入口；可删除或缩减为新面板组合，避免同时保留两套信息架构。

## Equipment And Inventory Interaction

- `EquipmentSlot.vue` 显示 ItemIcon、短签、空槽状态和焦点状态；短签通过纯展示 helper 从槽位名生成，保留完整名作 aria-label/title/Tooltip。
- 桌面使用 Reka Tooltip（若集成成本与现有版本匹配）展示槽位、物品名、`applied` 摘要；点击已装备槽打开详情。
- 移动 CSS/媒体能力下不依赖 hover，槽位点击直接打开详情。
- 装备槽聚焦/点击把 `highlightedItemRef` 传给容器面板；若对应物品当前可见，方格获得高亮。容器方格点击物品时反向高亮对应槽位。
- 空槽只显示说明，不打开空的物品详情。

`InventoryGrid.vue` 扩充 metadata props/view model，以同一尺寸支持：容器视效、已装备槽徽标、同引用高亮、循环/缺失状态。容器方格点击导航，物品方格点击详情，语义由父面板基于解析实体决定。

`ItemDetailModal.vue` 改用 Reka Dialog，删除 breadcrumb 和嵌套 grid 职责，只展示单物品及装备上下文。桌面居中，移动端通过媒体查询变为底部近全高 sheet。

## Global Mobile Shell

### State

`App.vue` 新增临时的 `statusDrawerOpen`，不写 localStorage。桌面 `statusCollapsed` 和 `navCollapsed` 偏好保持原语义。导航切换或抽屉内部打开角色页后关闭移动状态抽屉。

不要求 JavaScript 维护一份永久 `isMobile` 业务状态。布局由媒体查询控制；仅当 Header 按钮需要在桌面执行折叠、手机执行开抽屉时，使用可清理的 `matchMedia` composable 或分别暴露桌面/移动按钮。优先采用分别呈现的按钮以避免 resize 状态竞态。

### Header, status drawer, bottom nav

- `AppHeader` 手机高度压缩并处理 `env(safe-area-inset-top)`；左按钮语义变为“打开状态”，右侧隐藏桌面 nav 折叠按钮。
- `StatusBar` 桌面继续执行现有 GSAP 312/48 宽度逻辑；手机覆盖为 fixed drawer，不从 collapsed prop 派生宽度。使用 Reka Dialog/Drawer portal、overlay 和 focus trap，开关由 `open` prop 控制。
- `AppNav` 桌面保持右侧 rail；手机变为底部四项导航，始终展示紧凑图标/标签，宽度动画不参与手机布局。
- `.app-root`、视图 padding 和 `:has()` 规则在手机断点重置左右 padding；增加统一的 Header/BottomNav CSS 变量，使 Story、Character、Timeline、Settings 都获得完整宽度和正确底部留白。
- 视口高度使用 `100dvh`，保留 `100vh` fallback；开发入口 viewport 增加 `viewport-fit=cover`。

## Accessibility

- Portrait、slot、grid cell、mode control 均使用原生 button 或等价语义，提供 aria-label 和 `:focus-visible`。
- Portrait Dialog、Item Dialog、Status Drawer、Character Drawer 采用 Reka Dialog 原语，获得焦点圈定、Escape、焦点恢复与 Portal。
- 装备 Tip 不是移动端获取信息的唯一方式；完整信息始终可通过点击进入 Dialog。
- 隐藏滚动条不移除键盘/触控/滚轮滚动能力；可滚容器可在内容获得焦点后正常滚动。
- 收束动画、模式动画和抽屉动画在 `prefers-reduced-motion` 下关闭位移/缩放。

## Compatibility, Rollback, And Release

- 所有新增字段可选，旧存档、无装备角色和旧裁切立绘继续显示。
- 不改变 workspace 路径、portrait metadata shape、容器/角色写盘协议或 Bridge contract。
- 桌面壳层通过媒体查询保留现有左右 rail；若移动壳层出现回归，可独立回滚 App/Header/Nav/StatusBar 的断点样式，而不回滚装备解析。
- 角色页按数据层、舞台层、容器层分段实现并逐段构建；任一段可通过恢复旧 CharacterCard 入口回滚。
- 本任务不运行前端打包/写回正式卡的脚本；检查 git diff 确保 `cards/沉浸阅读器.tsian-card/frontend/**` 和 `game-card.json` 没有因本任务变化。
