# Implement: 前端 runtime 读取与渲染基础设施

## Scope

按 `design.md` 落地 runtime/实体读取与解析的数据层基础设施。纯新增模块，不改现有文件逻辑（仅在 `useSyncAfterTurn` 既有的 `setOnSynced` 钩子上注册一个回调，不改其代码）。

## Implementation Steps

### 1. 类型层：`lib/runtime-types.ts`

- [ ] 定义 `RenderPreset` union（9 种）。
- [ ] 定义 `DisplayCategory`（4 种）。
- [ ] 定义 `DisplayItem`、`DisplayItemError`、`DisplayItems`、`RuntimeData`、`Runtime`。
- [ ] 字段对齐 `design.md §4.2` 与 `workspace-templates.ts:1387` 的 runtime 形状。

**验证**：`npm run build --workspace play-frontend-dev` 通过类型检查。

### 2. render 映射表：`lib/render-mapping.ts`

- [ ] 导出 `RENDER_TO_CATEGORY: Record<RenderPreset, DisplayCategory>` 常量表（`design.md §3.1`）。
- [ ] 导出 `KNOWN_RENDERS: ReadonlySet<string>`（9 种预设，用于未知 render 判定）。

### 3. 解析纯函数：`lib/parse-runtime.ts`

- [ ] `parseRuntime(raw: unknown): RuntimeData`。
- [ ] 校验 `raw` 是对象且含 `turn`/`activeSceneIds`/`player`/`extensions` 等固定字段；不通过 → `{ runtime: null, error: "load-failed", displayItems: 空, itemErrors: [], status: "error" }`。
- [ ] 遍历 `extensions`：子 key 作 `label`，取 `render`。
  - `render` 不在 `KNOWN_RENDERS` → 推入 `itemErrors`，`error: "unknown-render"`，保留原 `render` 字符串。
  - `render` 在预设 → 按 `RENDER_TO_CATEGORY` 取 category，按 `design.md §3.2` 检查字段缺失打 `fallback: true`，构建 `DisplayItem` 推入对应桶。
- [ ] 固定字段（`turn/activeScene/player/inventory/status`）原样放进 `runtime`，不转 display item。
- [ ] 返回 `{ runtime, error: null, displayItems, itemErrors, status: "ready" }`。

### 4. 解析纯函数：`lib/parse-entity.ts`

- [ ] `parseEntity(raw: unknown): { displayItems: DisplayItems; itemErrors: DisplayItemError[] }`。
- [ ] 复用 `render-mapping.ts` 与 `parse-runtime.ts` 内的 extensions 解析逻辑（抽 `parseExtensions(ext: Record<string, unknown>)` 共享函数，放 `parse-runtime.ts` 或独立 `lib/parse-extensions.ts`，按实现时手感定）。
- [ ] 实体的 `fields/sections/status` 不在此处理（UI 子任务专门渲染），只解析 `extensions`。
- [ ] `parseScene(raw)` 同构（scene 也有 extensions），可复用同一函数或薄封装。

### 5. 事件总线：`composables/useRuntimeStaleBus.ts`

- [ ] 模块级 `Set<() => void>` 订阅者集合。
- [ ] 导出 `emitRuntimeStale()`、`onRuntimeStale(cb): () => void`。
- [ ] callback 异常 try-catch + `console.error`，不传播。
- [ ] 本任务不挂任何 emit 点。

### 6. `useRuntime()`：`composables/useRuntime.ts`

- [ ] 模块级单例：`runtimeData` ref（共享）、`refresh()` 函数（共享）。
- [ ] `refresh()`：
  1. `status = "loading"`。
  2. `await tsian.workspace.read("save/playthrough/runtime.json", "save-runtime")`。
  3. `file === null` → `error: "not-found"`，`runtime: null`，`status: "error"`。
  4. `JSON.parse(file.content)` 失败 → `error: "load-failed"`，`runtime: null`，`status: "error"`。
  5. `parseRuntime(parsed)` 填充结果，`status: "ready"`。
  6. `read` 抛错 → 同 4，不向上抛。
- [ ] 刷新触发注册：
  - `watch(ready, (v) => v && refresh(), { immediate: true })`（首次 ready 后加载）。
  - `useTsian().onTurnEnd(() => refresh())`（turn 完成自动刷新）。
  - `setOnSynced(() => refresh())`（sync 完成自动刷新，`useSyncAfterTurn` 已有钩子）。
  - `onRuntimeStale(() => refresh())`（事件总线）。
- [ ] 导出 `useRuntime()` 返回 `{ runtimeData: Readonly<Ref<RuntimeData>>, refresh, status: Readonly<Ref<string>> }`。
- [ ] **注意**：`setOnSynced` 是幂等"只保留最后一个"的回调（见 `useSyncAfterTurn.ts` 注释）。本任务注册的 refresh 回调是当前唯一消费者，无冲突；但需在代码注释中标注"若未来有其他消费者，需改 `setOnSynced` 为支持多回调"，避免后续踩坑。

### 7. `useEntity(ref)` / `useScene(id)`：薄封装

- [ ] `lib/ref-path.ts` 或 inline：`refToEntityPath(ref)`（`character:萧玄` → `save/entities/character/萧玄.json`）、`sceneIdToPath(id)`（`scene:山门冲突` → `save/scenes/山门冲突.json`）。
- [ ] `useEntity(ref: string)`：返回 `{ data: Ref<EntityData | null>, error: Ref<"load-failed" | "not-found" | null>, load: () => Promise<void> }`。
  - `load()` 内部 `workspace.read(path, "save-runtime")` + `JSON.parse` + `parseEntity`。
  - 非模块级单例（按需，每个调用方独立）。
- [ ] `useScene(id: string)` 同构，用 `parseScene`。
- [ ] 不自动 `onMounted` 加载——由 UI 子任务决定何时调 `load()`（展开/点击时）。

### 8. 接入 checkpoint restore 刷新

- [ ] 在 App.vue 或 StoryView.vue 的 checkpoint restore 流程成功后，调 `useRuntime().refresh()`。
- [ ] **定位 restore 完成点**：`StoryView.vue:205` `await restore(id)` 之后，或 App.vue 层。按实现时手感定，优先选最靠近"restore 已完成、history 已重建"的位置。
- [ ] 仅加一行 `refresh()` 调用 + import，不改 restore 流程逻辑。

### 9. 单测（可选但推荐）

- [ ] `lib/parse-runtime.test.ts`：
  - 正常 runtime.json → displayItems 分桶正确。
  - 未知 render → itemErrors。
  - 字段缺失 → `fallback: true`。
  - 非对象/缺固定字段 → `error: "load-failed"`。
- [ ] `lib/parse-entity.test.ts`：extensions 解析与 runtime 一致。
- [ ] 若项目已有 vitest 配置则补；无配置则跳过测试步骤，靠手动验证 + build。

### 10. 构建验证

- [ ] `npm run build --workspace play-frontend-dev` 通过。
- [ ] `npm run lint --workspace play-frontend-dev`（若有）通过。
- [ ] 无 TS 类型错误。

## Validation Commands

```bash
npm run build --workspace play-frontend-dev
# 若有 lint:
npm run lint --workspace play-frontend-dev
# 若有单测:
npm run test --workspace play-frontend-dev
```

## Risky Files / Rollback Points

- **新增文件**（无风险）：`lib/runtime-types.ts`、`lib/render-mapping.ts`、`lib/parse-runtime.ts`、`lib/parse-entity.ts`、`composables/useRuntime.ts`、`composables/useEntity.ts`、`composables/useScene.ts`、`composables/useRuntimeStaleBus.ts`。
- **修改文件**（低风险）：
  - `App.vue` 或 `StoryView.vue`：仅加 restore 后 `refresh()` 调用，1-2 行 + import，不改流程。
- **回滚**：删除上述新增文件，移除 App.vue/StoryView 的 refresh 调用。`useSyncAfterTurn` 的 `setOnSynced` 回调因是运行时注册，删文件即失效，无需改 `useSyncAfterTurn` 代码。

## Review Gates

- [ ] design.md 的 8 个决策（D1-D8）在实现中均落实。
- [ ] `useRuntime` 不抛错（D7），所有错误走 `error` 字段。
- [ ] 未知 render 进 `itemErrors` 不降级（D6），字段缺失打 `fallback` 不进 `itemErrors`（D8）。
- [ ] 不创建任何 renderer 组件（D2）。
- [ ] 不预加载所有实体（D3）。
- [ ] 不全局包装 `runAction/invokeAgent`（D5）。
- [ ] `npm run build --workspace play-frontend-dev` 通过。

## Follow-up Before task.py start

- [ ] 用户审阅 design.md + implement.md。
- [ ] PRD convergence pass（若 prd.md 需要补充已确认的技术决策则更新）。
