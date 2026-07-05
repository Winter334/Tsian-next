# implement.md — 左侧状态栏角色字段钉选机制

对齐 design.md。所有路径以 `F:/workspace/Tsian` 为根。

## Step 1 — 新建 `lib/pin-types.ts`

- 定义 `PinPathKind` union、`PinTarget`、`PinnedStore`、`PinValue` 与 `readPinValue`。
- `readPinValue` 覆盖 6 种 kind + missing 分支（design §6）。
- 静态类型不能出现 `any`；用 `CharacterEntity | null` + `undefined` narrow。
- 验证：`npm run build --workspace play-frontend-dev` 通过（此时无 consumer，仅编译）。
- **Gate 1**：类型对齐 design §5–§6。

## Step 2 — 新建 `composables/useStatusBarPins.ts`

- 仿 `useStatusBarCollapsed.ts` 结构：模块级 `pinsRef`、`ensureWatch`、`load/save`。
- localStorage 键 `tsian.statusBarPins`；读写异常静默兜底。
- 导出 `useStatusBarPins()` API（design §7）。
- 验证：build 通过。
- **Gate 2**：核对 API 与副作用行为。

## Step 3 — 新建 `components/character/PinButton.vue`

- Props `target: Omit<PinTarget, "addedAt">`。
- 使用 `useStatusBarPins`。
- 样式满足 design §8：absolute 定位、hover 显示、active 常显。
- 组件本身不设 `position: relative` — 父容器负责。
- 验证：build 通过。
- **Gate 3**：单独渲染 PinButton 到测试页确认视觉（可跳过，直接进 Step 4 集成验证）。

## Step 4 — 在 6 处字段渲染点集成 PinButton

按顺序：

1. **StatusChips.vue**（角色卡 概况→当前状态）：
   - 每个 `.status-chip` 内加 `<PinButton :target="{ entityRef, kind: 'status', key: status.id, label: status.name ?? status.id }" />`。
   - `entityRef` 从父组件传入或 inject。
   - 父 `.status-chip { position: relative; }`（若未设，补上）。

2. **IdentityFacts.vue**（角色卡 概况→身份/门派/境界）：
   - 每个 `.fact-chip` 内加 PinButton；`kind: 'identity'`，`key` 为对应字段名（age|gender|role|affiliation|realm），`label` 用中文标签（"年龄"/"性别"…）。

3. **AttributeCard.vue**（角色卡 属性→六维卡）：
   - 每张卡右上角加 PinButton；`kind: 'attribute'`，`key` 为中文键（体魄|悟性|气运|根骨|法力|魅力），`label` 用同样中文键。

4. **GaugeBar.vue**（角色卡 属性→特殊量表）：
   - 每行右侧加 PinButton；`kind: 'gauge'`，`key: gauge.id`，`label: gauge.name`。

5. **OverviewPane.vue "当前形象" section**：
   - section header 或 narrative block 右上角加 PinButton；`kind: 'appearance'`，无 key，`label: "外貌"`。

6. **GoalsBlock.vue**（角色卡 概况→意图与目标）：
   - 每 `.target-row` 加 PinButton；`kind: 'goals'`，`key`（current|shortTerm|longTerm），`label`（"当前目标"/"近期"/"长期"）。

`entityRef` 统一从最近的 CharacterView / CharacterCard 层传入 prop 或 provide/inject。若这些组件已有 `entity` prop，直接从 `entity.id` 或外层传入的 `ref` 派生。

- 验证：build 通过；在 dev 里逐个 hover 检查 pin 显示、点击 toggle、click.stop 不冒泡触发其它 chip 行为。
- **Gate 4**：6 处均能钉选/取消，且父容器视觉不错位。

## Step 5 — 新建 `components/status-bar/StatusBarPinned.vue`

- Props `protagonistRef: string | null`。
- setup 里：
  - `const { pins } = useStatusBarPins()`
  - `const { data: entityData, load } = useEntity(protagonistRef)`（protagonistRef 为 null 时 skip load）
  - `onMounted(() => { if (protagonistRef) load() })`
  - `const pinValues = computed(() => pins.value.map((t) => readPinValue(entityData.value?.entity, t)))`
- 模板：
  - `v-if="pins.length > 0"` 整段渲染。
  - `.sb-section-head`（复用样式）：`<h3 class="sb-section-title">钉选</h3><span class="sb-section-line"></span>`。
  - `v-for pinValues`，用 `v-if v.kind === "..."` 分支渲染 6 类 + missing。
- 样式：
  - `.pin-list { display: flex; flex-direction: column; gap: 6px; }`
  - `.pin-status-chip`：紧凑 chip，polarity 颜色。
  - `.pin-attribute-row / .pin-chip`：单行 label/value。
  - `.pin-gauge-row`：micro bar 用 `--ember` fill on `rgba(181,137,61,0.1)` track。
  - `.pin-appearance`：`text-overflow: ellipsis; white-space: nowrap; overflow: hidden;`
  - `.pin-missing`：italic `--whisper`。
- 验证：build 通过。
- **Gate 5**：模板分支覆盖 6 kind + missing。

## Step 6 — 修改 `StatusBar.vue`

- 在 `StatusBarStatus` 之后、`StatusBarMetrics` 之前插入：
  ```vue
  <StatusBarPinned
    :protagonist-ref="protagonistRefStr"
    :key="protagonistRefStr"
  />
  ```
- 保持 `v-if="!collapsed"` 分区包裹。
- 验证：build 通过。
- **Gate 6**：钉选分区位置正确，与其它分区间距一致。

## Step 7 — 全量验证

```bash
cd F:/workspace/Tsian
npm run build --workspace play-frontend-dev
```

手工点测（`npm run dev`）：

1. 打开角色卡，逐 tab 悬停：状态 chip / 身份 chip / 属性卡 / 量表行 / 外貌 header / 目标行 都能显示 pin 图标。
2. 点击一个 status pin → 状态栏"钉选"分区出现，显示该 status。
3. 再点一个 attribute / gauge → 分区继续 append。
4. 打开 identity / appearance / goals 各一项 → 全部渲染并降级正常。
5. 状态栏钉选项上点 pin 图标 → 从状态栏消失、角色卡对应字段恢复未 active。
6. 刷新页面 → localStorage 恢复钉选列表。
7. 主角切换（若手工改 runtime.json） → 钉选项按新主角 entity 值刷新，字段缺失走 `—`。
8. 清空所有钉选 → 分区隐藏，回到 MVP 布局。
9. localStorage 手动置为非法 JSON → 应用启动仍然工作，钉选空。

- **Gate 7**：AC 全部打勾。

## AC 映射

| PRD AC | Step |
|---|---|
| 玩家可以在角色卡上把至少 3 类字段钉选 | Step 4 (6 类都覆盖) |
| 钉选配置存 localStorage，不写 workspace | Step 2 |
| 钉选配置只保存字段引用/路径 | Step 1（PinTarget 无值快照） |
| 状态栏在 entity 变化时刷新 | Step 5（useEntity + protagonistRef 触发） |
| 玩家可以取消钉选 | Step 3 + Step 5（两处 PinButton toggle） |
| 未配置时保持 MVP | Step 5 (`v-if pins.length > 0`) |
| npm run build 通过 | Step 7 |

## 回滚点

| 点 | 触发 | 操作 |
|---|---|---|
| Step 4 完成 | 6 处集成引发视觉/交互回归 | 逐处 revert PinButton 插入行 |
| Step 6 完成 | StatusBarPinned 与 StatusBar 布局冲突 | revert StatusBar.vue 单文件 |
| Step 7 完成 | build 失败 | 回退到最近可 build commit，二分排查 |

## 依赖

- 依赖任务全部已归档，无阻塞。
- 分支：继续用 `feat/play-frontend-status-bar`（与父任务及前后子任务一致）。
