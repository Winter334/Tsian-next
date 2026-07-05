# implement.md — 当前上下文多消息注入 storyteller

对齐 `design.md`。所有路径以仓库根 `F:\workspace\Tsian` 为基准。

## 顺序清单

### Step 1 — 新增 `context-injection.ts` 骨架 + 类型
- 文件：`apps/play-frontend-dev/src/lib/context-injection.ts`
- 内容：
  - `import type { InjectionMessage } from "@tsian/contracts"`
  - `import type { Runtime, RuntimeData } from "./runtime-types"`
  - `import type { CharacterEntity } from "./character-types"`（如需引用 shape）
  - 导出 `BuildInjectionInput` / `BuildInjectionResult` / `buildContextInjection` 声明
- 验证：`npm run build --workspace play-frontend-dev` 通过（stub 函数返回 `{ status: "ok", messages: [] }`）。
- **Review gate 1**：确认类型对齐 design §6。

### Step 2 — 实现 3 个 formatter
- 在同文件内新增：
  - `formatRuntimeBlock(runtime: Runtime): string`
  - `formatSceneBlock(sceneJson: Record<string, unknown>, sceneRef: string): string`
  - `formatProtagonistBlock(characterJson: Record<string, unknown>, characterRef: string): string`
- 文本格式对齐 design §7.1–§7.3。
- 空字段一律以 "未指定/未知/(略)" 占位；不 dump JSON。
- 属性表按固定六维顺序输出（体魄/悟性/气运/根骨/法力/魅力）；缺省整行省略。
- 验证：本地手工 build。
- **Review gate 2**：肉眼检查 3 段样例输出与 storyteller 语气是否一致。

### Step 3 — 实现 `buildContextInjection` 主体
- 顺序：
  1. kill-switch：`runtime?.extensions?.frontendInjection?.enabled === false` → 返回 `{ status: "ok", messages: [] }`。
  2. runtime 未就绪：`runtimeData.status !== "ready" || !runtime` → `{ status: "blocked", reason: "runtime-not-ready" }`。
  3. 拼 runtime/world message。
  4. 对每个 `activeSceneRefs[*]`：`workspace.read("save/scenes/<localId>.json", "save-runtime")`；null / 抛错 / JSON.parse 失败 → 阻断 `scene-load-failed` detail=ref。
  5. 若 `protagonistRef`：`workspace.read("save/entities/character/<localId>.json", "save-runtime")`；同上错误 → 阻断 `protagonist-load-failed` detail=ref。
  6. 返回 `{ status: "ok", messages }`，每条 `role="system"`, `position="before-input"`。
- 路径解析工具函数 inline：`refToLocalId(ref: string, prefix: "scene:" | "character:"): string`。
- 验证：`npm run build --workspace play-frontend-dev` 通过。
- **Review gate 3**：错误分支覆盖 design §9 表格全部行。

### Step 4 — 接线到 `useTsian.send`
- 文件：`apps/play-frontend-dev/src/composables/useTsian.ts`
- 改动：
  - 新增模块内 `lastSendError = ref<{ reason: BuildInjectionBlockedReason; detail?: string } | null>(null)`。
  - `send(text)` 前置状态检查通过后：
    - 清 `lastSendError.value = null`。
    - `import { useRuntime } from "./useRuntime"`；取 `runtimeData` 快照（`.value`）。
    - `const result = await buildContextInjection({ workspace: tsian.workspace, runtimeData: runtimeData.value })`。
    - `if (result.status === "blocked") { lastSendError.value = { reason: result.reason, detail: result.detail }; return }`。
    - push user StreamItem、`turnPhase = "streaming"`。
    - `await tsian.send(text, result.messages.length ? { injection: result.messages } : undefined)`。
  - 在返回对象中新增 `lastSendError: readonly(lastSendError)`。
- 验证：`npm run build --workspace play-frontend-dev` 通过。
- **Review gate 4**：确认阻断分支不推 StreamItem、不切 turnPhase。

### Step 5 — StoryView 显示 banner
- 文件：`apps/play-frontend-dev/src/components/story/StoryView.vue`
- 改动：
  - 从 `useTsian()` 解构 `lastSendError`。
  - reason → 中文文案 map：
    - `runtime-not-ready` → "运行时上下文未就绪"
    - `scene-load-failed` → "场景数据加载失败（<detail>）"
    - `protagonist-load-failed` → "主角数据加载失败（<detail>）"
  - 在输入区上方新增一个 v-if banner；样式复用 `syncPhase === "sync-failed"` 的错误配色 class。
- 验证：`npm run build --workspace play-frontend-dev` 通过。
- **Review gate 5**：banner 位置不遮挡输入框；错误清空条件正确（下次 send 触发前清空，用户没有其他操作前保留）。

### Step 6 — 全量验证
- `npm run build --workspace play-frontend-dev`（AC 显式要求）。
- 手工点测（`npm run dev` 起 play-frontend）：
  - 正常发送：DevTools Network 观察到 `interaction.sendMessage` 载荷含 `injection: [...]` 数组（3+ 条 system message）。
  - 打开新存档还未初始化 runtime：send 触发 banner "运行时上下文未就绪"。
  - 手动在 runtime.json 里加不存在的 scene ref：send 触发 banner "场景数据加载失败"。
  - 手动在 runtime.json 加 `extensions.frontendInjection.enabled = false`：send 成功，无 injection 字段。
- **Review gate 6**：AC 全部 checkbox 打勾（回填 prd.md）。

## 验证命令合集

```bash
cd F:/workspace/Tsian
npm run build --workspace play-frontend-dev
```

`.trellis/scripts/task.py` 相关：进入 in_progress 前不执行。

## 回滚点

| Rollback point | 触发条件 | 操作 |
|---|---|---|
| Step 3 完成后 | build 失败 / 边界条件遗漏 | 保留 Step 1–2，revert Step 3 |
| Step 4 完成后 | send 链路变行为异常 | revert useTsian.send 改动（仍保留 lib 纯函数） |
| Step 5 完成后 | UI banner 样式问题 | revert StoryView 单文件即可 |

## 依赖 / 前置

- 依赖任务已完成，无需等待。
- 分支：任务开始时按 Trellis 常规创建独立分支（走 `task.py start`）。

## 覆盖 AC 映射

| PRD AC | Step |
|---|---|
| 发送时附带多条 injection | Step 4 |
| runtime + scene + protagonist block | Step 2, 3 |
| scene 不递归展开 | Step 2（formatSceneBlock 不解引用 present） |
| protagonist 用角色实体权威信息 | Step 2（formatProtagonistBlock） |
| 内容为文本而非原始 JSON | Step 2（formatter 输出） |
| 某块失败不阻断 → 改为阻断 send（用户决策，PRD 需在实施后回填）| Step 3, 4 |
| 不改 runtime/entity/scene 数据 | 全流程只调用 workspace.read |
| npm run build 通过 | Step 6 |

> 备注：PRD AC "某块失败不阻断" 与用户明确的"降级不如阻断"矛盾。
> Step 6 完成后需在 prd.md 更新此 AC 描述为 "ref 存在但 load 失败阻断 send；
> ref 缺省不阻断" 后再进入 archive 流程（Phase 3.3 spec update 阶段一并处理）。
