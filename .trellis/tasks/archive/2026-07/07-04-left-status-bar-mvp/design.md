# Design: 左侧状态栏 MVP

## 1. Problem

主游玩态左侧目前是空白（`StoryView` 的 `padding-left: 0`）。玩家在阅读剧情时无法快速扫读当前地点、时间、角色状态等关键信息，只能从长对话历史中回忆。本任务在左侧实现 240px 常驻状态栏，折叠成 48px 极简头像，让玩家扫读零交互成本，展开后有结构地呈现 runtime 当前局面。

## 2. Existing Contract Summary

### 2.1 布局现状

- `App.vue`：`stage-play` 包含 `AppHeader`（fixed top, 52px, z:20）+ `AppNav`（fixed right, 180px/56px, z:19）+ `StoryView`。
- `StoryView.vue:480`：`margin-top: 52px`，`padding-right: 180px`，`padding-left: 0`。
- `AppNav`：GSAP width 动画（180↔56），折叠偏好 localStorage `tsian.navCollapsed`。
- `AppHeader`：右侧有 nav 折叠按钮；左侧有 Logo + 连接状态点。
- `App.vue:180`：`.app-root:has(.app-nav.collapsed) .view-stage { padding-right: 56px }` — 折叠态通过 `:has()` 选择器联动 padding。

### 2.2 runtime 数据层（已归档基础设施）

- `useRuntime()`：模块级单例，返回 `runtimeData`（readonly ref）+ `refresh()`。
- `RuntimeData`：`{ runtime: Runtime | null, error: "load-failed" | "not-found" | null, displayItems: DisplayItems, itemErrors, status }`。
- `Runtime` 固定字段：`turn`, `worldTime`, `activeSceneIds`, `activeScene`, `player`, `inventory`, `status`, `extensions`, `updatedAtTurn`, `updatedBy`。
- `DisplayItems` 四桶：`metrics`（progress/number）、`tags`（tag/tags/text）、`refs`（ref/cards/list）、`sections`。
- `useEntity(ref)` / `useScene(id)`：按需读取实体/场景。
- runtime 缺失时 `runtime: null` + `error: "not-found" | "load-failed"`，不抛错。

### 2.3 视图切换机制

- `App.vue`：`navCurrent = ref<"story" | "settings">("story")`。
- `<StoryView v-show="navCurrent === 'story'" />` — v-show 保留滚动位置 + stream 状态。
- `<div v-if="navCurrent !== 'story'" class="view-stage">` — 非故事视图走 view-stage 占位。

### 2.4 主题 token（tokens.css）

- 底色：`--void #060608` / `--void-deep #0a0506` / `--ember-glow #2b0404`
- 强调：`--ember #b5893d` / `--ember-bright #e8a948` / `--blood #9b3a2e`
- 文字：`--prose #d4c9b4` / `--prose-dim #8a8073` / `--whisper #5c5347`
- 线：`--line rgba(181,137,61,0.15)` / `--line-strong rgba(181,137,61,0.4)`
- 字体：`--font-display` Cinzel / `--font-serif` Noto Serif SC / `--font-mono` JetBrains Mono

## 3. Design Decisions（brainstorm 已确认）

| # | 决策 | 选定方案 | 拒绝的替代 |
|---|---|---|---|
| D1 | 栏形态 | 固定常驻 240px ↔ 48px，GSAP width 动画，localStorage 持久化 | 抽屉式 hover 拉出（默认不可见）/ 320px（过宽） |
| D2 | 分区组织 | 地点时间 → 角色 → 状态 → 数值；背包移角色卡 | 每项独立分区（跳跃多）/ 两大块（无子分区） |
| D3 | 角色卡形态 | 全屏视图切换，nav 项扩展为 故事/角色/设置 | 侧边抽屉（空间挤）/ 模态弹窗（深度浏览不合适） |
| D4 | 折叠态显示 | 仅角色头像，极简图腾风（方圆角+首字渐变蒙层） | 分区图标（徒增麻烦）/ 仅首字（不够精致） |
| D5 | 展开态分区分隔 | 小标题 + 渐变细线 | 仅细线（类别难辨认）/ 留白+背景色微差（边界模糊） |

## 4. Architecture

### 4.1 组件布局

```
apps/play-frontend-dev/src/
├── components/
│   ├── StatusBar.vue          # 新增：左侧状态栏容器（fixed, width 动画）
│   ├── status-bar/
│   │   ├── StatusBarScene.vue     # 新增：地点时间区
│   │   ├── StatusBarCharacter.vue # 新增：角色区（头像+名字，点击进角色卡）
│   │   ├── StatusBarStatus.vue    # 新增：状态区（runtime.status + tags）
│   │   ├── StatusBarMetrics.vue   # 新增：数值区（displayItems.metrics）
│   │   └── StatusBarRefs.vue      # 新增：关联区（displayItems.refs，可选）
│   └── ...（既有组件不动）
├── composables/
│   └── useStatusBarCollapsed.ts   # 新增：折叠态 localStorage 持久化
└── ...（既有不动）
```

### 4.2 App.vue 集成

新增 `StatusBar` 组件挂载到 `stage-play`，与 `AppHeader`/`AppNav`/`StoryView` 同级：

```vue
<main v-if="..." class="stage-play">
  <AppHeader ... :status-bar-collapsed="statusCollapsed" @toggle-status-bar="onToggleStatus" />
  <AppNav ... />
  <StatusBar
    v-if="phase === 'revealed'"
    :collapsed="statusCollapsed"
    @toggle="onToggleStatus"
    @open-character="onOpenCharacter"
  />
  <StoryView v-show="navCurrent === 'story'" />
  <CharacterView v-if="navCurrent === 'character'" ... />  <!-- MVP 只接通切换，内容由角色卡子任务填充 -->
  <div v-if="navCurrent === 'settings'" class="view-stage">...</div>
</main>
```

`navCurrent` 类型扩展为 `"story" | "character" | "settings"`。

### 4.3 折叠/展开联动

- `StatusBar` fixed left，`top: 52px`，`bottom: 0`，`z-index: 19`（与 AppNav 对称）。
- GSAP width 动画：`collapsed ? 48 : 240`，duration 0.3s，ease `power2.inOut`（同 AppNav）。
- `StoryView` 的 `padding-left` 联动：
  - 展开态：`padding-left: 240px`
  - 折叠态：`padding-left: 48px`
  - 通过 `:has(.status-bar.collapsed) .story-view { padding-left: 48px }` 或 StoryView 接收 prop 控制。
- 折叠按钮位置：`AppHeader` 左侧（Logo 旁），与右侧 nav 折叠按钮对称。新增 `status-bar-collapsed` prop + `toggle-status-bar` emit。

### 4.4 折叠态偏好持久化

`composables/useStatusBarCollapsed.ts`：

```ts
const KEY = "tsian.statusCollapsed"
const statusCollapsed = ref(localStorage.getItem(KEY) === "true")
watch(statusCollapsed, (v) => localStorage.setItem(KEY, String(v)))
export function useStatusBarCollapsed() { return { statusCollapsed, toggle: () => statusCollapsed.value = !statusCollapsed.value } }
```

模块级单例，同 `useTsian`/`useRuntime` 模式。不写入 workspace。

## 5. Component Design

### 5.1 StatusBar.vue（容器）

- fixed left, top 52px, bottom 0, z 19。
- GSAP width 动画 240↔48。
- 背景：`rgba(10, 5, 6, 0.7)` + `backdrop-filter: blur(8px)`（同 AppNav）。
- 右边框：`1px solid var(--line)`。
- 展开态：垂直排列子分区组件。
- 折叠态：只渲染 `StatusBarCharacter` 折叠态（头像），其他隐藏。
- 数据：`useRuntime()` 获取 `runtimeData`。
- 错误态：`error !== null` 时显示降级文案（"状态暂不可用"或空态）。
- emit `toggle`（点击折叠态头像展开）、`open-character`（点击展开态头像进角色卡）。

### 5.2 StatusBarScene.vue（地点时间）

展开态内容：

```
青玄门山门
赤明纪十二年三月初七，黄昏
```

- 数据来源：`runtime.activeScene?.name`（fallback `runtime.activeSceneIds[0]` / "未知场景"）+ `runtime.worldTime`（空字符串显示"时间未知"）。
- 第一行场景名：`--font-serif`，`--prose`，稍大。
- 第二行时间：`--font-mono`，`--prose-dim`，小字。
- 折叠态：不渲染。

### 5.3 StatusBarCharacter.vue（角色区）

**展开态**：

```
┌──────────┐
│  [头像]   │  萧玄
│          │  青玄门外门弟子
└──────────┘
```

- 头像方形圆角 56×56px，单线边框 `1px solid var(--line-strong)`。
- MVP 无图片时：默认头像底色 `--void-deep` + 角色名首字居中（`--font-display`，`--ember-bright`）。
- 头像右侧：角色名（`--prose`，稍大）+ brief（`--prose-dim`，小字，1 行截断）。
- 数据来源：`runtime.player.character`。有 ref 时 `useEntity(ref)` 读取实体获取 `name`/`brief`；ref 为 null 时显示"未设定角色"。
- 点击头像/角色区 → emit `open-character`。

**折叠态**（极简图腾风）：

```
┌────────┐
│        │
│  [头像] │   ← 方形圆角 40×40px
│        │      单线边框
│ ▓▓▓▓▓▓ │   ← 底部渐变蒙层
│  萧     │   ← 角色名首字叠加
└────────┘
```

- 头像方形圆角 40×40px（48px 栏宽减去左右 padding 各 4px）。
- 底部渐变蒙层：`linear-gradient(transparent, rgba(6,6,8,0.85))`，高度约 40%。
- 角色名首字叠加在蒙层上：`--font-display`，`--ember-bright`，居中。
- 背景径向微光：`radial-gradient(circle at 50% 40%, rgba(181,137,61,0.08), transparent 70%)`。
- 点击 → emit `toggle`（展开状态栏）。
- 无角色时：默认占位"?" + 暗化边框。

### 5.4 StatusBarStatus.vue（状态区）

- 小标题"状态" + 渐变细线。
- 内容：
  - `runtime.status` 数组：每项显示 `description`（`--prose`），有 `level` 时尾部小标签（`--prose-dim`，`--font-mono`）。
  - `displayItems.tags`：tag 类扩展项，每项显示 `label: value` 或仅 `label`（fallback 时）。
- 空态："暂无状态"（`--whisper`，小字斜置）。

### 5.5 StatusBarMetrics.vue（数值区）

- 小标题"数值" + 渐变细线。
- 内容：`displayItems.metrics`，每项：
  - progress：label 左对齐 + 数值条（`--ember` 填充，`--line` 轨道）+ 右侧数字。
  - number：label + 数值 + unit。
- 数值条高度 4px，圆角 2px。
- tone 颜色映射：`danger → --blood`，`warning → --ember-bright`，`success → --ember`，默认 `--ember`。
- 空态："暂无数值"。

### 5.6 StatusBarRefs.vue（关联区，可选）

- 小标题"关联" + 渐变细线。
- 内容：`displayItems.refs`，每项显示 `label` + `name`，点击 emit 打开对应实体（MVP 可只显示不跳转，跳转归角色卡子任务）。
- 若 `refs` 为空且 `sections` 为空，整个关联区不渲染（避免空标题占位）。

## 6. State & Error Handling

| 状态 | 展示 |
|---|---|
| `status: "loading"` | 状态栏显示骨架/淡入态（`--whisper` 占位文案） |
| `status: "ready"` + `runtime: null` + `error: "not-found"` | 各分区显示空态文案；角色区显示"未设定角色" |
| `status: "ready"` + `runtime: null` + `error: "load-failed"` | 顶部统一显示"状态暂不可用"（`--whisper`），不渲染各分区 |
| `status: "error"` | 同 load-failed |
| `runtime` 有值但字段缺失 | 各分区按字段 fallback 展示（场景"未知场景"、时间"时间未知"、角色"未设定角色"） |

## 7. Fold/Unfold Interaction

- 折叠态点击头像 → 展开状态栏（GSAP width 240）。
- 展开态：AppHeader 左侧折叠按钮 → 折叠状态栏（GSAP width 48）。
- StoryView `padding-left` 同步动画（CSS transition 0.3s ease）。
- 折叠态只渲染 `StatusBarCharacter` 折叠模式，其他子组件 `v-if="!collapsed"`。

## 8. Theme & Visual Details

- 延续烛火书卷·重铸暗色仪式系。
- 分区小标题：`--font-mono`，0.65rem，letter-spacing 0.14em，`--whisper`，大写感（中文不转大写但保持紧凑字距）。
- 渐变细线：`linear-gradient(90deg, transparent, var(--line-strong), transparent)`，高度 1px，opacity 0.6。
- 文案：`--font-serif` 主体，`--font-mono` 辅助信息（时间、level、数值单位）。
- 头像边框：`1px solid var(--line-strong)`，hover 时 `--ember` + 微光。
- 数值条轨道：`rgba(181,137,61,0.1)`；填充：按 tone。
- 背景：`rgba(10, 5, 6, 0.7)` + `backdrop-filter: blur(8px)`，同 AppNav。

## 9. Compatibility / Rollback

- 纯新增组件，不修改既有组件逻辑（App.vue / AppHeader.vue / StoryView.vue 只做最小集成改动）。
- `navCurrent` 类型从 `"story" | "settings"` 扩展为 `"story" | "character" | "settings"`，需同步 AppNav items。
- 回滚：删除 `StatusBar.vue` + `status-bar/*` + `useStatusBarCollapsed.ts`，还原 App.vue/AppHeader/StoryView 集成点 + navCurrent 类型。

## 10. Trade-offs

- **折叠态仅头像 vs 分区图标**：仅头像更精简但折叠态看不到状态/数值变化；接受这个代价——展开是零成本动作，且头像本身的边框色可后续扩展暗示状态。
- **角色卡全屏视图 vs 模态**：全屏视图离开剧情流，但承载能力强（背包/物品详情/形象上传）；通过 nav 切换回故事的代价比"返回按钮"稍高但更一致。
- **progress 数值条做在状态栏 vs 留给角色卡**：状态栏放数值条可即时扫读当前关键数值；角色卡放历史/详细数值。两者互补不冲突。
