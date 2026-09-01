# design.md — 左侧状态栏角色字段钉选机制

对齐 PRD `.trellis/tasks/07-05-status-bar-character-field-pinning/prd.md`。
依赖：`07-04-left-status-bar-mvp`、`07-04-present-characters-character-cards`、
`07-05-runtime-scene-character-schema-ui-align` 均已归档。

## 1. 目标与范围

- 让玩家在角色卡上把少量字段钉选到左侧状态栏，个性化补充 MVP。
- 未钉选时状态栏保持 MVP 行为（主角入口 + runtime 世界变量 + 主角 entity.status）。
- 钉选配置纯前端偏好，走 localStorage，不入 workspace，不做剧情权威。
- 钉选项只存字段引用，不存值快照；渲染时重新读 entity。
- 首版覆盖 6 类字段：status / attribute / gauge / identity / appearance / goals。

## 2. 非目标

- 不做钉选配置导入/导出/分享。
- 不做多存档同步。
- 不做钉选字段的历史/图表。
- 不做状态栏布局自定义（拖拽顺序、分区大小）。
- 不做按 characterRef 分组（MVP 全局一份）。

## 3. 涉及模块

| 层 | 文件 | 作用 |
|---|---|---|
| lib（新增） | `apps/play-frontend-dev/src/lib/pin-types.ts` | 类型 + `readPinValue` 纯函数 |
| composables（新增） | `apps/play-frontend-dev/src/composables/useStatusBarPins.ts` | 模块级单例 + localStorage 读写 |
| 共享组件（新增） | `apps/play-frontend-dev/src/components/character/PinButton.vue` | hover 显示的 pin 按钮 |
| 状态栏（新增） | `apps/play-frontend-dev/src/components/status-bar/StatusBarPinned.vue` | 钉选分区，6 种 kind 分支渲染 |
| 状态栏（改动） | `apps/play-frontend-dev/src/components/StatusBar.vue` | 插入钉选分区 |
| 角色卡（改动） | `components/character/panes/overview/StatusChips.vue` | 集成 PinButton |
| 角色卡（改动） | `components/character/panes/overview/IdentityFacts.vue` | 集成 PinButton |
| 角色卡（改动） | `components/character/panes/attributes/AttributeCard.vue` | 集成 PinButton |
| 角色卡（改动） | `components/character/panes/attributes/GaugeBar.vue` | 集成 PinButton |
| 角色卡（改动） | `components/character/panes/overview/OverviewPane.vue` | 集成 PinButton（appearance section）|
| 角色卡（改动） | `components/character/panes/overview/GoalsBlock.vue` | 集成 PinButton |
| 类型复用 | `lib/character-types.ts::CharacterEntity` | 字段读取 |
| 类型复用 | `lib/runtime-types.ts::Runtime` | protagonistRef |
| composable 复用 | `composables/useEntity.ts` | 读主角 entity |

> 注：以上"角色卡子组件"路径需按实际项目位置调整；参考探查报告，具体路径由 Step 4 落地时以 `git grep` 定位。

## 4. 关键决策

- **D1** pin 图标 hover 显示；共享 `PinButton` 组件（用户确认）。
- **D2** 全局单一钉选集合，localStorage 键 `tsian.statusBarPins`（用户确认）。
- **D3** 状态栏新增独立"钉选"分区（用户确认），插入到 Status 之后、Metrics 之前，保持角色相关信息聚合。
- **D4** 只存 `{ kind, key, label, entityRef, addedAt }`，不存值快照——每次渲染重新读 entity（R5）。
- **D5** 钉选与 Status 分区允许重复；用户主动钉选即偏好，不去重。
- **D6** 首版一并支持 identity/appearance/goals；紧凑单值渲染。
- **D7** 直接 `localStorage` + `watch(deep)`，仿 `useStatusBarCollapsed`；不引 pinia/vueuse。
- **D8** 点击 pin 立即 toggle，无二次确认；撤销即再点一次。
- **D9** 未钉选任何项时钉选分区整段 `v-if` 隐藏，回到 MVP 视觉。

## 5. 数据模型

```ts
export type PinPathKind =
  | "status"       // key = status.id
  | "attribute"    // key = attributes 的中文键（体魄/悟性/气运/根骨/法力/魅力）
  | "gauge"        // key = gauge.id
  | "identity"     // key = age|gender|role|affiliation|realm
  | "appearance"   // 无 key
  | "goals"        // key = current|shortTerm|longTerm

export interface PinTarget {
  entityRef: string           // 首版恒为主角 protagonistRef.ref
  kind: PinPathKind
  key?: string                // appearance 缺省
  label: string               // UI 显示名（去实体化）
  addedAt: number             // Date.now()，稳定排序用
}

export interface PinnedStore {
  version: 1
  targets: PinTarget[]
}
```

`localStorage` 键：`tsian.statusBarPins`。写入格式：`JSON.stringify(PinnedStore)`。
读取失败 / JSON 解析失败 / version 不匹配 → 视为空钉选集，静默重置。

## 6. `readPinValue` 纯函数

```ts
export type PinValue =
  | { kind: "status"; name: string; polarity?: Polarity; description?: string }
  | { kind: "attribute"; label: string; value: number }
  | { kind: "gauge"; name: string; value: number; max?: number; unit?: string; tone?: GaugeTone }
  | { kind: "identity"; label: string; value: string }
  | { kind: "appearance"; text: string }
  | { kind: "goals"; label: string; value: string }
  | { kind: "missing"; target: PinTarget; label: string }
```

- entity 为 null 或字段缺失 → 返回 `{ kind: "missing", target, label: target.label }`。
- `attribute` 类：`entity.attributes?.[target.key]` 为 number 才成立，否则 missing。
- `gauge`：`entity.gauges?.find(g => g.id === target.key)` 命中且 `value: number` 才成立。
- `status`：`entity.status?.find(s => s.id === target.key)`；`name` 取 `s.name ?? target.label`。
- `identity`：`entity.identity?.[target.key]`（number 走 String 转换）。
- `appearance`：`entity.appearance` 有值就成立。
- `goals`：`entity.goals?.[target.key]`。

## 7. useStatusBarPins composable（模块单例）

```ts
const STORAGE_KEY = "tsian.statusBarPins"

const pinsRef = ref<PinTarget[]>(loadFromStorage())

let watching = false
function ensureWatch() {
  if (watching) return
  watching = true
  watch(pinsRef, (v) => { saveToStorage(v) }, { deep: true })
}

export function useStatusBarPins() {
  ensureWatch()
  return {
    pins: readonly(pinsRef),
    isPinned(kind: PinPathKind, key?: string): boolean,
    togglePin(target: Omit<PinTarget, "addedAt">): void,     // 存在则删，不存在则添加（addedAt = Date.now()）
    removePin(kind: PinPathKind, key?: string): void,
    clearPins(): void,
  }
}
```

- `isPinned` 用 `kind + (key ?? "")` 唯一标识。
- `togglePin` 语义：同 kind+key 已存在则移除；否则 push。
- 读写异常静默兜底：`load` 抛错→ `[]`；`save` 抛错→ `console.warn`。

## 8. PinButton 组件契约

`components/character/PinButton.vue`：

```vue
<template>
  <button
    type="button"
    class="pin-btn"
    :class="{ active }"
    :aria-label="active ? '取消钉选到状态栏' : '钉选到状态栏'"
    :title="active ? '取消钉选' : '钉选到状态栏'"
    @click.stop="onClick"
  >
    <!-- 📌 SVG or Unicode -->
    <span aria-hidden="true">📌</span>
  </button>
</template>

<script setup lang="ts">
const props = defineProps<{ target: Omit<PinTarget, "addedAt"> }>()
const { isPinned, togglePin } = useStatusBarPins()
const active = computed(() => isPinned(props.target.kind, props.target.key))
function onClick() { togglePin(props.target) }
</script>
```

样式关键：
- `position: absolute; top: 4px; right: 4px; opacity: 0`
- 父容器 `:hover .pin-btn { opacity: 0.7 }`
- `.pin-btn.active { opacity: 1; color: var(--ember-bright); }`
- 父容器必须 `position: relative`（若尚未，改动时补上）。

## 9. StatusBarPinned 分区

- Props：`protagonistRef: string | null`。
- 用 `useEntity(protagonistRef)` 读主角实体（在 setup 阶段 `.load()`）。
- `useStatusBarPins()` 拿钉选清单。
- `pinValues = computed(() => pins.value.map((t) => readPinValue(entity, t)))`。
- 分区整体 `v-if="pins.length > 0"`：无钉选不占位（R7）。
- 每项渲染分支：
  - `status`：`.pin-status-chip` + polarity tone。
  - `attribute`：`.pin-attribute-row`：`<span class="label">体魄</span><span class="value">12</span>`。
  - `gauge`：`.pin-gauge-row`：label + bar + `value/max unit`。
  - `identity`：`.pin-chip`：`身份：外门弟子`。
  - `appearance`：`.pin-appearance`：1 行 ellipsis + `:title` 完整文本。
  - `goals`：`.pin-chip`：`当前：<value>`。
  - `missing`：`.pin-missing`：`<label> —`（italic muted）。
- 复用现有 `.sb-section-head/.sb-section-title/.sb-section-line` 样式（与 Status/Metrics/Refs 一致）。

## 10. StatusBar.vue 集成

在 `Status` 分区渲染 slot 之后、`Metrics` 之前插入：

```vue
<StatusBarPinned :protagonist-ref="protagonistRefStr" :key="protagonistRefStr" />
```

`protagonistRefStr` 已存在（Status 分区在用）。

## 11. 主角切换 / 回合刷新

- `useRuntime` 单例在 turn end / sync / stale 自动 refresh，protagonistRef 若变化：
  - `StatusBar.vue` 的 `:key="protagonistRefStr"` 会使 `StatusBarPinned` remount。
  - `useEntity(newRef).load()` 重新读实体。
  - `readPinValue` 用新 entity 重新计算所有钉选值。

## 12. 边界与降级

| 情况 | 处理 |
|---|---|
| localStorage 不可用 / 读写异常 | `pinsRef` 空；后续 write 静默失败 |
| JSON parse 失败 | 静默重置为 `[]` |
| `pins.length === 0` | 分区整体隐藏，回归 MVP 视觉 |
| protagonistRef === null | StatusBarPinned 内 entity 读取 skip；所有 pins 都进 missing 状态 |
| 字段类型不对 / 缺失 | 单项走 missing 分支 |

## 13. 兼容性 / 回滚

- localStorage 只加新 key，不影响现有 `tsian.statusCollapsed` / nav。
- 代码全部为 additive：删除 `StatusBarPinned` 引用 + 6 处 PinButton 即回滚。
- 无 workspace 契约变化，无 platform-web 改动。

## 14. 风险

- pin 图标绝对定位可能被现有 hover 状态样式覆盖。要在 6 处逐一验证 z-index。
- gauge/attribute chip 面积小，pin 图标必须小且不遮挡主内容。
- 首版不迁移旧 localStorage 结构（本项目此前无该 key），version=1 直接生效。

## 15. 后续（Out of Scope）

- 按 characterRef 分组配置。
- 拖拽排序。
- 状态栏其它字段（scene / relationship 等）纳入钉选。
- 钉选导入/导出。
