# Design: 前端 runtime 读取与渲染基础设施

## 1. Problem

`apps/play-frontend-dev` 目前没有读取 `save/playthrough/runtime.json` 与实体文件、并把它们解析成前端可渲染结构的数据层。后续 4 个 UI 子任务（左侧状态栏、角色卡、容器/物品详情、runtime injection）都需要这份数据，若各自实现读取 + extensions 解析 + 刷新，会重复 4 遍且降级不一致。

本任务建立一层共享的 runtime/实体读取 + 解析 + 响应式刷新基础设施，只输出 display item 数据与 TypeScript 类型，**不提供 renderer 组件、不做 UI 视觉设计**。

## 2. Existing Contract Summary

### 2.1 数据约定（已落地）

`runtime.json` 默认模板（`apps/platform-web/src/storage/workspace-templates.ts:1387`）：

```json
{
  "turn": 0,
  "activeSceneIds": [],
  "activeScene": null,
  "player": { "character": null, "location": null },
  "inventory": null,
  "status": [],
  "extensions": {},
  "updatedAtTurn": 0,
  "updatedBy": null
}
```

Schema（`save/schema/current.md`，模板内嵌于 `workspace-templates.ts:1371`）明确：

- 前端可读字段：`name / brief / gender / tags / status / fields / sections / extensions`。
- 扩展字段公共形状：`{ render, value, label?, tone?, description?, visibility?, group?, order?, priority? }`。
- 预设 render 类型（9 种）：`text / number / progress / tag / tags / list / section / ref / cards`。
- 实体引用结构：`{ ref, name }`，显示优先级 `entity.name → ref.name → id localId`。
- 实体/场景文件路径：`save/entities/<type>/<localId>.json`、`save/scenes/<localId>.json`。

### 2.2 Bridge API（`packages/play-bridge/src/tsian-api.ts`）

- `tsian.workspace.read(path, scope?): Promise<WorkspaceReadResult | null>` — 返回 `{path, content, createdAt, updatedAt, ...}`，`content` 为字符串需 `JSON.parse`。
- `WorkspaceScope` 中 runtime/entity/scene 文件归 `"save-runtime"` scope（`packages/contracts/src/runtime.ts:245`）。`read` 省略 scope 时按路径前缀推断，本任务仍显式传 `"save-runtime"` 以避免歧义。
- `tsian.checkpoints.restore(id): Promise<{turn}>` — 主动调用，无事件广播。

### 2.3 前端现状

- `useTsian` 是模块级单例，提供 `ready` ref 与 `turnCount`。
- `useSyncAfterTurn` 已编排回合后同步，留有 `setOnSynced(cb)` 钩子（注释"待状态栏 composable 接入"）和 `resetSyncPhase()`（checkpoint restore 后调）。
- `composables/` 现有：`useAtmosphere / useSetupState / useSyncAfterTurn / useTsian / useTurnState`，无任何 runtime 解析/renderer 代码。
- App.vue / StoryView.vue 已管理 checkpoint restore 流程（`StoryView.vue:205` 的 `restore(id)`）。

## 3. Design Decisions（brainstorm 已确认）

| # | 决策 | 选定方案 | 拒绝的替代 |
|---|---|---|---|
| D1 | display item 形态 | 按 `category: "metric" \| "tag" \| "ref" \| "section"` 分类的对象，render 保留在 item 内部 | 扁平结构透传（组件各自归类，重复逻辑）／按 render 分 9 类（粒度细，组件仍需合并） |
| D2 | renderer 范围 | 只输出 display item 数据 + TS 类型，不做 renderer 组件 | 提供通用 `<DisplayItem>`（滑向万能 renderer，违反 schema design "不做万能 renderer"） |
| D3 | 实体读取边界 | runtime 全量解析 + `parseEntity/parseScene` 纯函数共享 + 可选 `useEntity/useScene` 薄封装；不预加载所有实体 | 只管 runtime（extensions 解析在 UI 子任务重复 4 遍）／全权管所有实体读取（臃肿、预加载不用的文件） |
| D4 | 刷新机制 | 轻量事件总线 `runtimeStale` + 内部自动订阅 ready/turn/sync + 暴露 `refresh()` 兜底 | 纯内部订阅（checkpoint restore 无事件源）／纯外部显式调用（4 个 UI 子任务重复挂钩子） |
| D5 | 玩家操作触发刷新 | 本任务搭好 `runtimeStale` 事件 + `refresh()` API，未来 UI 子任务按需 emit | 全局包装 `runAction/invokeAgent` 自动 emit（大量无效刷新，读资料/查历史也走这俩） |
| D6 | 未知 render 处理 | 走错误通道 `error: "unknown-render"`，UI 决定错误展示 | 降级成文本（掩盖 schema 约定被突破） |
| D7 | 读取失败处理 | `{ runtime: null, error: "load-failed" \| "not-found" }`，不抛错 | 抛错（要每个 UI try-catch，崩溃风险） |
| D8 | 字段缺失/类型不符 | 按 render 类型尽量降级展示，打 `fallback: true` 标记 | 走错误（常见小问题，错误满天飞掩盖真问题） |

### 3.1 render → category 映射

固定映射（schema design §3.3 已给出槽位建议）：

| render | category |
|---|---|
| `progress`, `number` | `metric` |
| `tag`, `tags`, `text` | `tag` |
| `ref`, `cards`, `list` | `ref` |
| `section` | `section` |

`text` 归 `tag`（单段文本在状态标签区展示最自然）；`list` 归 `ref`（轻量项列表多用于关联入口）。未在表中的 render → `itemErrors`（D6）。

### 3.2 降级规则（D8 字段缺失）

按 render 类型尽量降级，标记 `fallback: true`：

- `progress` 缺 `value` → 当作 0；缺 `max` → 默认 100。
- `number` 缺 `value` → 不展示该项（数字无法猜）但记 `fallback`。
- `tag/tags` 缺 `value`/`items` → 展示 `label` 单标签。
- `ref` 缺 `ref` → 降级成纯文本展示 `name` 或 `label`。
- `cards` 缺 `items` → 空卡片组或省略。
- `section` 缺 `body` → 省略该项；缺 `title` → 用 `label` 作标题。

UI 子任务见 `fallback: true` 可选择朴素渲染或省略，由 UI 决定。

## 4. Architecture

### 4.1 模块布局

```
apps/play-frontend-dev/src/
├── composables/
│   ├── useRuntime.ts          # 新增：runtime 响应式读取 + 刷新
│   ├── useEntity.ts           # 新增：实体按需读取（薄封装）
│   ├── useScene.ts            # 新增：场景按需读取（薄封装）
│   └── useRuntimeStaleBus.ts  # 新增：轻量事件总线
├── lib/
│   ├── runtime-types.ts       # 新增：Runtime / DisplayItem / RuntimeData 类型
│   ├── parse-runtime.ts       # 新增：runtime JSON → RuntimeData 纯函数
│   ├── parse-entity.ts        # 新增：entity/scene JSON → display items 纯函数
│   └── render-mapping.ts      # 新增：render → category 映射表
└── types.ts                   # 既有，不动
```

`lib/` 放纯函数与类型（可被 composable 与未来 UI 组件复用，也可被单测直接 import），`composables/` 放 Vue 响应式封装。这是前端现有目录惯例（`lib/source.ts`、`composables/useSetupState.ts` 已遵循）。

### 4.2 类型契约（`lib/runtime-types.ts`）

```ts
/** 已知 render 预设集合。未知值不入此 union，解析时落 itemErrors。 */
export type RenderPreset =
  | "text" | "number" | "progress" | "tag" | "tags"
  | "list" | "section" | "ref" | "cards"

export type DisplayCategory = "metric" | "tag" | "ref" | "section"

/** 成功解析的扩展项。按 category 分桶存放。 */
export interface DisplayItem {
  /** 槽位分类，UI 组件按此取自己关心的项。 */
  category: DisplayCategory
  /** 原始 render 值，始终为 RenderPreset（未知 render 走 itemErrors）。 */
  render: RenderPreset
  /** 显示名；来自 extensions 子 key 或 item.label。 */
  label: string
  /** 主要值；类型随 render 而定（progress→number, ref→string, …）。 */
  value?: unknown
  /** 字段缺失/类型不符时的降级标记；UI 见此可朴素渲染或省略。 */
  fallback?: true
  // 以下按 render 类型可选，解析时透传：
  max?: number
  min?: number
  unit?: string
  tone?: "neutral" | "accent" | "success" | "warning" | "danger" | "muted"
  description?: string
  items?: unknown[]        // tags / list / cards
  ref?: string             // ref
  name?: string            // ref / cards 内嵌引用的展示快照
  title?: string           // section
  body?: string            // section
}

/** 解析失败的扩展项（仅未知 render；字段缺失走 fallback 不进此列）。 */
export interface DisplayItemError {
  label: string
  /** 原始 render 值，未知字符串原样保留以便 log/感知 schema 演进。 */
  render?: string
  error: "unknown-render"
}

export interface DisplayItems {
  metrics: DisplayItem[]
  tags: DisplayItem[]
  refs: DisplayItem[]
  sections: DisplayItem[]
}

/** useRuntime 返回的数据形态。 */
export interface RuntimeData {
  /** runtime.json 解析结果；读取失败为 null。 */
  runtime: Runtime | null
  /** 读取级错误（非解析级）；null 表示读取成功。 */
  error: "load-failed" | "not-found" | null
  /** 固定字段解析出的扩展项（runtime.extensions）。 */
  displayItems: DisplayItems
  /** 解析失败的项（未知 render）。 */
  itemErrors: DisplayItemError[]
  /** 加载状态。 */
  status: "idle" | "loading" | "ready" | "error"
}

/** runtime.json 结构（与 workspace-templates.ts:1387 对齐）。 */
export interface Runtime {
  turn: number
  activeSceneIds: string[]
  activeScene: { ref: string; name: string } | null
  player: { character: { ref: string; name: string } | null; location: { ref: string; name: string } | null }
  inventory: { primaryContainer: { ref: string; name: string }; state?: string } | null
  status: Array<{ id: string; description: string; level?: string }>
  extensions: Record<string, unknown>
  updatedAtTurn: number
  updatedBy: string | null
}
```

### 4.3 解析纯函数（`lib/parse-runtime.ts` / `lib/parse-entity.ts`）

`parseRuntime(raw: unknown): RuntimeData`：

1. 校验 `raw` 是对象且含 `turn` 等固定字段；不通过 → `error: "malformed"`（并入 load-failed 路径，runtime=null）。
2. 遍历 `extensions`：每个子 key 作为 `label`，取子对象的 `render` 字段。
3. `render` 不在 9 种预设 → 推入 `itemErrors`（D6）。
4. `render` 在预设 → 按 §3.1 映射到 category，按 §3.2 检查字段缺失并打 `fallback`，构建 `DisplayItem` 推入对应桶。
5. 固定字段（`activeScene/player/inventory/status`）原样保留在 `runtime`，不由 parse 层转成 display item——这些由 UI 子任务按各自专门 UI 消费。

`parseEntity(raw: unknown): { displayItems: DisplayItems; itemErrors: DisplayItemError[] }`：

- 实体的 `fields`/`sections`/`status` 是固定 schema，由 UI 子任务专门渲染；parse 层只处理 `extensions`。
- 复用 `render-mapping.ts` 的同一张 render→category 表与同一套 fallback 规则。
- `parseScene` 同构（scene 也有 extensions）。

### 4.4 事件总线（`composables/useRuntimeStaleBus.ts`）

最小实现：模块级 `Set<() => void>` 订阅者集合 + `emitRuntimeStale()` / `onRuntimeStale(cb)` 导出。

```ts
const subscribers = new Set<() => void>()
export function emitRuntimeStale(): void {
  for (const cb of subscribers) {
    try { cb() } catch (e) { console.error("[runtimeStaleBus] subscriber threw", e) }
  }
}
export function onRuntimeStale(cb: () => void): () => void {
  subscribers.add(cb)
  return () => subscribers.delete(cb)
}
```

任何主动操作完成后调 `emitRuntimeStale()` 即可触发刷新；本任务不挂任何 emit 点（D5：未来 UI 子任务按需 emit），只提供总线。

### 4.5 `useRuntime()`（`composables/useRuntime.ts`）

模块级单例（同 `useTsian` 模式），返回 `RuntimeData` 的 readonly ref + `refresh()`。

刷新触发：

- **ready 初次加载**：`watch(ready, (v) => v && refresh(), { immediate: true })`。
- **turn 完成**：订阅 `useTsian` 的 `onTurnEnd`（已有）→ `refresh()`。
- **sync 完成**：调 `setOnSynced(() => refresh())`（`useSyncAfterTurn` 已有钩子）。
- **runtimeStale 事件**：`onRuntimeStale(() => refresh())`。
- **`refresh()` 兜底**：checkpoint restore 后由 App.vue/StoryView 显式调（restore 无事件源，D4）。

`refresh()` 内部：

1. `status = "loading"`。
2. `const file = await tsian.workspace.read("save/playthrough/runtime.json", "save-runtime")`。
3. `file === null` → `error: "not-found", runtime: null, status: "error"`。
4. `JSON.parse` 失败 → `error: "load-failed", runtime: null, status: "error"`。
5. `parseRuntime(parsed)` → 填充 `runtime/displayItems/itemErrors`，`status: "ready"`。
6. `read` 抛错 → `error: "load-failed", runtime: null, status: "error"`（不向上抛）。

模块级状态共享：同 `useTsian`/`useSyncAfterTurn` 模式，多个组件调 `useRuntime()` 共用同一份 `RuntimeData`，refresh 只触发一次读取。

### 4.6 `useEntity(ref)` / `useScene(id)`（薄封装）

按需读取，不入模块级单例（实体多，按需加载）。形态：

```ts
export function useEntity(ref: string) {
  const data = ref<EntityData | null>(null)
  const error = ref<"load-failed" | "not-found" | null>(null)
  async function load() {
    // ref: "character:萧玄" → path: "save/entities/character/萧玄.json"
    const path = refToEntityPath(ref)
    const file = await tsian.workspace.read(path, "save-runtime")
    if (!file) { error.value = "not-found"; return }
    const parsed = JSON.parse(file.content)   // 失败由调用方 try-catch 或此处置 error
    data.value = { entity: parsed, ...parseEntity(parsed) }
  }
  return { data, error, load }
}
```

UI 子任务可在组件 `onMounted` 或用户点击展开时调 `load()`。`refToEntityPath`：`<type>:<localId>` → `save/entities/<type>/<localId>.json`。`useScene` 同构，路径 `save/scenes/<localId>.json`（scene id 是 `scene:<localId>`）。

## 5. Out of Scope

- UI 视觉设计、布局、样式、具体 UI 组件（状态栏/角色卡/容器面板/物品卡）。
- 通用 `<DisplayItem>` renderer 组件（D2）。
- 预加载所有实体文件（D3）。
- 全局包装 `runAction/invokeAgent` 自动 emit stale（D5）。
- 修改 schema 约定、runtime.json 模板、Agent/Skill 指导（归 `07-04-renderable-runtime-entity-schema` 已完成）。
- runtime 摘要 injection 实现（归 `07-04-runtime-summary-injection`）。

## 6. Compatibility / Rollback

- 纯新增模块，不改任何现有文件，无兼容性风险。
- `useSyncAfterTurn` 的 `setOnSynced` 已留钩子，本任务挂上去即可，不修改其逻辑。
- 回滚：删除 `lib/parse-*.ts`、`lib/runtime-types.ts`、`lib/render-mapping.ts`、`composables/useRuntime.ts`、`composables/useEntity.ts`、`composables/useScene.ts`、`composables/useRuntimeStaleBus.ts`，并移除 `useSyncAfterTurn` 中 `setOnSynced` 的本任务回调注册点。

## 7. Trade-offs

- **按 category 分桶 vs 按 render 分 9 类**：category 粒度对齐 UI 槽位（4 类），UI 子任务最简单；代价是 render→category 映射写死在数据层，新增 render 需改映射表——但这本来就是 schema 演进该走的路径。
- **事件总线 vs 纯响应式**：事件总线精确（只有改 workspace 的操作 emit），但依赖 UI 子任务自觉 emit；若未来某操作忘了 emit 会漏刷新。缓解：`refresh()` 兜底 + dev 模式可加"未刷新检测"日志。
- **不提供 renderer vs 提供基础 renderer**：可能后期发现多个 UI 子任务重复画同一种 render；届时再下沉成共享组件，YAGNI 优先。
