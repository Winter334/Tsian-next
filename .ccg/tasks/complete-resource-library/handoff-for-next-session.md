# 资源库补全 — 新会话接续手册

> 生成时间：2026-05-21
> 上一会话：full-collaborate / Phase 4 implementation 已勉强跑通，但**脱离主人预期效果**，需新会话针对优化
> 当前状态：build 通过 / DataCloneError 已修 / 但 UI 体验未达标
> 主人指示：开启新会话进行**针对优化**，本份文档是交接锚点

---

## 1. 当前实施位置（不要重做的部分）

### 1.1 已落地变更（git working tree）

```
M apps/platform-web/src/components/workflow/WorkflowEditorCanvas.vue
M apps/platform-web/src/storage/db.ts
M apps/platform-web/src/storage/index.ts
M apps/platform-web/src/views/ResourceLibraryView.vue
M packages/contracts/src/mod.ts
M packages/contracts/src/workflow.ts
?? apps/platform-web/src/storage/resources.ts   ← 新建
?? .ccg/tasks/complete-resource-library/        ← 任务目录（含 plan/PRD/分析）
```

### 1.2 已实现 / 已验证

- **三张 Dexie 表**：`promptPresets / worldBooks / workflowPresets`（库版本 v7→v8 破坏性升级）
- **CRUD storage 层**：`apps/platform-web/src/storage/resources.ts`，list/get/upsert/delete × 3 + 引用检查 helper
- **路由 / 视图**：`/resources` → `ResourceLibraryView.vue`（592 行 CRUD 页面，三 tab 切换）
- **contracts 契约**：`PlatformResourceKind` / `PlatformResource` 联合类型（`packages/contracts/src/workflow.ts`）
- **mod 字段过渡**：`mod.ts` 加 `workflowPresetId`，旧 `workflow / presets / worldBooks` 标记 `@deprecated`
- **DataCloneError 修复**：`resources.ts` 写入前 `JSON.parse(JSON.stringify())` 净化（fail loud）
- **WorkflowEditorCanvas embedded 模式**：隐藏内置"保存工作流/导入/导出/重置"按钮，由外层资源库统一保存
- **build 验证**：`npm run build:web` ✓ / `build:contracts` ✓ / `build:workflow-engine` ✓

### 1.3 关键设计决策（不要回退）

| 决策 | 理由 |
|------|------|
| **方案 A**：只做本地 CRUD，不接 platform-host 运行链路 | 主人确认"先把资源库本地存得起来"，运行链路接入留作后续工单 |
| **三张表而非单表 discriminated union** | Dexie 上 schema 字段差异大，分表查询/索引更直观；引用检查只扫 `workflowPresets` 一张表 |
| **storage 双写字段**（`preset/content`、`worldBook/content`、`workflow/definition`） | 上个会话两个 Builder 接口未对齐的兼容产物；**新会话可以收敛成单一字段名**（建议保 `preset/worldBook/workflow`，删 `content/definition` 别名） |
| **WorkflowEditorCanvas 加 `embedded: boolean` prop** | 复用比新建组件成本低，但需要严格隐藏所有"保存/导入/导出"按钮 |
| **fail loud > fail silent** | `toCloneable()` 序列化失败抛错；删除有引用的资源直接阻止；JSON 解析错误红字提示 |

---

## 2. 主人不满意的实际问题（新会话核心目标）

### 2.1 UI 设计层面

> 主人原话："UI 很奇怪，工作流编辑 UI 是生搬硬套进去的"
> "世界书和提示词编辑也很简陋"

**现状**：
- 三个 tab 用同一套 `Draft` 类型 + 同一个右侧编辑面板，prompt/world book 直接塞 JSON textarea，workflow 塞 Canvas，**没有针对各资源类型的语义化编辑器**
- WorkflowEditorCanvas 即使加了 embedded 模式，仍是"画布编辑器套在表单里"的别扭组合
- 提示词预设没有结构化编辑（主提示 / 系统提示 / 维护提示分块、参数表、示例对话）
- 世界书没有条目列表 + 关键词触发条件编辑

**新会话方向**（建议）：
- 各资源类型独立编辑器组件，而不是共用 textarea
- 提示词预设：参考 SillyTavern preset 结构做分块编辑
- 世界书：条目列表 + 关键词/优先级编辑
- 工作流预设：要么完全嵌入式 Canvas（去掉外层表单嗅觉），要么把 Canvas 单独路由打开"工作流预设编辑器"页面

### 2.2 工作流预设保存问题（已修但需复测）

> 主人原话："保存失败：Failed to execute 'put' on 'IDBObjectStore': #<Object> could not be cloned"

**已修复**：`resources.ts:upsertWorkflowPresetResource` 加 `toCloneable()` 净化
**待复测**：主人本地需要再保存一次确认不再报 DataCloneError
**潜在风险**：JSON 净化会丢失 Symbol/function 字段；如果未来 workflow definition 引入函数式配置（如 inline expression），需要换 `structuredClone()` + 自定义 transferable 处理

### 2.3 误触导出 JSON

> 主人原话："进行工作流编辑的时候很容易误触导出工作流 json"

**已规避**：embedded 模式下 `导出 JSON / 导入 JSON` 按钮整块不渲染
**根因未查清**：`useWorkflowEditor.exportToJson` 只能由按钮触发（grep 确认无键盘监听），主人原始触发场景未能复现
**新会话建议**：如果 embedded 模式下仍有误触，需要主人提供具体复现步骤（什么操作触发、是否下载了 JSON 文件）

---

## 3. 新会话接手前必读清单

按顺序读以下文件即可掌握全部上下文：

1. **本文档** — 你正在读
2. `F:\workspace\Tsian\.ccg\tasks\complete-resource-library\requirements.md` — PRD（方案 A 范围）
3. `F:\workspace\Tsian\.ccg\tasks\complete-resource-library\plan.md` — 上轮实施计划
4. `F:\workspace\Tsian\.ccg\tasks\complete-resource-library\analysis.md` — 架构分析
5. `F:\workspace\Tsian\apps\platform-web\src\views\ResourceLibraryView.vue` — 当前实现（592 行）
6. `F:\workspace\Tsian\apps\platform-web\src\storage\resources.ts` — 当前 storage 层
7. `F:\workspace\Tsian\apps\platform-web\src\components\workflow\WorkflowEditorCanvas.vue` — 已加 embedded 模式
8. `C:\Users\流莺白沙\.claude\projects\F--workspace-Tsian\memory\project_resource_library_completion_progress.md` — auto-memory 进度记录

---

## 4. 新会话推荐策略

主人说"针对优化"，建议新会话用 **guided-develop** 或 **direct-fix**（不要再走 full-collaborate 多 Agent 路线，避免 Builder 接口对不齐的麻烦）。

### 4.1 优化优先级（建议）

| P | 项 | 影响 | 复杂度 |
|---|---|------|-------|
| P0 | 工作流预设编辑体验：要么彻底嵌入式 Canvas，要么独立路由 | UI 直觉 | M |
| P1 | 提示词预设结构化编辑器（分块 / 参数 / 示例） | 实用性 | M |
| P2 | 世界书条目编辑器（关键词 / 优先级 / 启用开关） | 实用性 | M |
| P3 | storage.ts 双写字段收敛（删除 `content/definition` 别名） | 代码整洁 | S |
| P4 | 资源导入/导出（JSON 文件） | 数据迁移 | S |
| P5 | 资源被引用时的反向跳转链接（点击引用列表跳到对应工作流预设） | 体验 | S |

### 4.2 不要做的事

- ❌ 不要重写 storage 层（CRUD 已稳定）
- ❌ 不要回退 `embedded` 模式（这是修复 #1 的关键）
- ❌ 不要去掉 `toCloneable()`（这是修复 DataCloneError 的根因防护）
- ❌ 不要在未明确得到主人确认前接 platform-host 运行链路（方案 A 边界）
- ❌ 不要主动 git commit（主人未要求）

---

## 5. 当前 git 未提交变更明细（如果新会话想先提交一版稳定态）

如果主人在新会话开头同意先把当前"勉强跑通"的版本提交保存，建议拆两个 commit：

**Commit 1：`feat(platform-web): 资源库本地全局 CRUD（提示词/世界书/工作流预设）`**
- `apps/platform-web/src/storage/db.ts`（v7→v8）
- `apps/platform-web/src/storage/index.ts`
- `apps/platform-web/src/storage/resources.ts`
- `apps/platform-web/src/views/ResourceLibraryView.vue`
- `packages/contracts/src/workflow.ts`
- `packages/contracts/src/mod.ts`

**Commit 2：`fix(platform-web): WorkflowEditorCanvas 嵌入式模式 + DataCloneError 防护`**
- `apps/platform-web/src/components/workflow/WorkflowEditorCanvas.vue`
- （resources.ts 中的 `toCloneable` 部分）

> 如果 commit 1 想拆 storage.ts 出来，需要 `git add -p` 分块。

---

## 6. CCG 任务状态收尾建议

新会话开始时建议：
- 把当前任务 `complete-resource-library` 标记为 `wontfix-as-planned`，新建一个新任务 `optimize-resource-library-ux`
- 或者把 currentPhase 推到 `5-review`，让主人决定要不要直接进 review/final

避免新会话被 "Phase 4 LOOP DETECTED" 继续骚扰。

---

## 7. 一句话总结给新会话

> 资源库 v0 跑通了，CRUD 能存能改能删能引用检查能 fail loud，但 UI 是缝合怪——
> 工作流预设的 Canvas 套表单别扭、提示词/世界书是裸 JSON textarea。
> 主人要的是"语义化、专业级"编辑体验，不是"能存就行"。
> 不要重做底层，只重写上层 UI；不要碰运行链路，方案 A 边界守住。

---

_本文档由浮浮酱在主人指示下生成，供下一会话直接接手喵～ฅ'ω'ฅ_
