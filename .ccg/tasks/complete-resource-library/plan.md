# 补全资源库功能 — Implementation Plan

## 当前决策摘要

本批采用“本地全局资源库最小闭环”方案：

- 资源类型：提示词预设、世界书、工作流预设。
- 持久层：IndexedDB / Dexie。
- UI：保留 `/resources` 三 tab，补真实列表 + 创建 + 编辑 + 删除。
- 工作流预设：复用 `WorkflowEditorCanvas` 作为可视化编辑器。
- 提示词预设 / 世界书：第一版用 `name + description + tags + JSON textarea`，避免过早做高级编辑器。
- 旧 `ModManifest.workflow/presets/worldBooks` 不删除，只标记 deprecated，保留 fallback。

## 关键架构选择

### 1. 资源表结构

采用三张 Dexie 表，而不是单张 `resources` 表：

- `promptPresets`
- `worldBooks`
- `workflowPresets`

原因：三类资源语义不同，三张表类型更清晰，和现有 storage 按业务切片的风格一致。

### 2. Contracts 层

在 `packages/contracts/src/workflow.ts` 补平台资源类型：

- `PlatformResourceKind`
- `PlatformResourceBase`
- `PromptPresetResource`
- `WorldBookResource`
- `WorkflowPresetResource`
- `PlatformResource`

在 `packages/contracts/src/mod.ts` 增加：

- `workflowPresetId?: string`

并把旧字段标注 deprecated：

- `workflow?: WorkflowDefinition`
- `presets?: Record<string, unknown>`
- `worldBooks?: Record<string, unknown>`
- `ModStaticContent.worldBooks?`

### 3. 运行链路接入范围

本计划建议本批先完成资源库 CRUD 与类型/存储，不强制深改运行主链。

但为了不让资源库成为“死数据”，预留一个轻量接线点：

- `platform-host` 的 `resolveWorkflowForMod` 后续按：
  1. `workflowPresetId`
  2. 本地 workflow preset
  3. deprecated `manifest.workflow`
  4. `defaultWorkflow`

本批是否实际接入运行链路，由主人审批时确认。

推荐本批执行模式：先不深接 `platform-host`，只做资源库本地 CRUD + 引用检查。原因是这样能先把资源库页面做可用，避免同时改 AI 主链导致验收面过大。

## 文件级实施步骤

### Step 1：Contracts

#### `packages/contracts/src/workflow.ts`

- 新增平台资源契约类型。
- 更新 `AiCallNodeConfig.presetId` 注释：引用平台 prompt preset id 或 `builtin.*`。
- 更新 `AiCallNodeConfig.worldBookKeys` 注释：引用平台 world book id。
- 不引入 `@tsian/prompt-engine` 类型，避免 contracts 反向依赖。

#### `packages/contracts/src/mod.ts`

- `ModManifest` 新增 `workflowPresetId?: string`。
- 旧 `workflow/presets/worldBooks` 加 `@deprecated` 注释。
- `ModStaticContent.worldBooks` 加 `@deprecated` 注释。

### Step 2：Dexie Schema

#### `apps/platform-web/src/storage/db.ts`

- 引入 `WorkflowDefinition` 类型。
- 新增三类本地资源 record interface：
  - `LocalPromptPresetResourceRecord`
  - `LocalWorldBookResourceRecord`
  - `LocalWorkflowPresetResourceRecord`
- `TsianLocalDb` 新增三张 table。
- 库名从 `tsian-local-v7` 改为 `tsian-local-v8`。
- stores 新增：
  - `promptPresets: "&id, name, updatedAt"`
  - `worldBooks: "&id, name, updatedAt"`
  - `workflowPresets: "&id, name, updatedAt"`

### Step 3：Storage CRUD

#### 新建 `apps/platform-web/src/storage/resources.ts`

导出：

- `listPromptPresetResources()`
- `getPromptPresetResource(id)`
- `upsertPromptPresetResource(input)`
- `deletePromptPresetResource(id)`
- `listWorldBookResources()`
- `getWorldBookResource(id)`
- `upsertWorldBookResource(input)`
- `deleteWorldBookResource(id)`
- `listWorkflowPresetResources()`
- `getWorkflowPresetResource(id)`
- `upsertWorkflowPresetResource(input)`
- `deleteWorkflowPresetResource(id)`

规则：

- `id` 缺省时使用 `crypto.randomUUID()`。
- 禁止空 `name`。
- 禁止用户资源 id 以 `builtin.` 开头。
- `tags` trim、去空、去重。
- 新建时写 `createdAt/updatedAt`，更新时保留 `createdAt`。
- list 按 `updatedAt` 倒序。

额外提供引用检查 helper：

- `findWorkflowPresetReferencesToPromptPreset(promptPresetId)`
- `findWorkflowPresetReferencesToWorldBook(worldBookId)`

扫描 workflow preset 中 `ai-call` 节点的：

- `config.presetId`
- `config.worldBookKeys`

#### `apps/platform-web/src/storage/index.ts`

- 新增 `export * from "./resources"`。

### Step 4：资源库 UI

#### `apps/platform-web/src/views/ResourceLibraryView.vue`

把当前占位页改为完整本地 CRUD 页面：

- 保留三 tab：提示词预设 / 世界书 / 工作流预设。
- tab 数量从真实数据计算。
- 顶部提供“新建资源”。
- 主体采用“左侧列表 + 右侧编辑区”或宽屏 grid：
  - 左侧：资源列表，展示名称、id、tags、更新时间。
  - 右侧：编辑表单。

Prompt preset / World book 编辑：

- `name`
- `description`
- `tagsText`
- JSON textarea
- JSON parse 错误红字显示，禁止保存。
- 提供“格式化 JSON”按钮。

Workflow preset 编辑：

- `name`
- `description`
- `tagsText`
- `WorkflowEditorCanvas`
- 通过 `@change` 接收 `WorkflowDefinition`，保存到 `workflowPresets` 表。

删除流程：

- 不直接删除，进入确认态。
- prompt/world book 若被 workflow preset 引用，阻止删除或要求明确二次确认。
- workflow preset 删除先提示不可恢复。

无障碍要求：

- tab button 加 `role="tab"` / `aria-selected`。
- JSON 错误用 `role="alert"`。
- input/textarea 配 label。
- 删除确认区域用 `role="alertdialog"` 或明确警告文本。

### Step 5：WorkflowEditorCanvas 轻量增强（可选）

#### `apps/platform-web/src/components/workflow/WorkflowEditorCanvas.vue`

如果现有嵌入资源库显示不合适，再加可选 prop：

- `embedded?: boolean`
- `showSourceLabel?: boolean`

父组件负责保存，Canvas 不直接写 storage。

### Step 6：可选运行链路接线（审批时确认）

#### `apps/platform-web/src/platform-host/index.ts`

可选改动：

- `resolveWorkflowForMod` 改为 async。
- 解析顺序：`workflowPresetId -> local workflow preset -> manifest.workflow -> defaultWorkflow`。
- 执行前读取本地 prompt presets / world books，合并进 workflow execution context。
- 保留 `builtin.*` 优先级，用户资源禁止覆盖。

## 验证计划

实现后建议执行：

```bash
npm run build:contracts
npm run build:web
npm run build:workflow-engine
```

手工验收：

1. 打开 `/resources`，三类 tab 均显示真实数量。
2. 新建 prompt preset，刷新后仍存在。
3. 新建 world book，刷新后仍存在。
4. 新建 workflow preset，刷新后仍存在。
5. 修改资源名称/描述/tags/JSON 后保存成功。
6. JSON 无效时禁止保存并显示错误。
7. 删除被 workflow preset 引用的 prompt/world book 时有明确阻止或警告。
8. workflow preset 使用画布编辑后保存不影响模组工作流草稿。

## 风险与缓解

1. Dexie 库名升级会让旧本地数据不可见。
   - 原型期允许破坏性调整；实现说明中明确。
2. prompt/world book payload 第一版是 `unknown` JSON。
   - 保存前至少校验必须是 JSON object。
3. ResourceLibraryView 单文件可能变大。
   - 本批先 KISS 落地；超过明显可维护边界再拆组件。
4. 运行链路若本批接入，会扩大验收范围。
   - 默认先完成 CRUD；接线作为可选项。
5. 删除引用检查只能覆盖本地 workflow presets。
   - 旧 manifest workflow / 存档内引用后续再补，不做 silent fallback。

## 推荐执行拆分

Layer 1：底层类型与存储

- `packages/contracts/src/workflow.ts`
- `packages/contracts/src/mod.ts`
- `apps/platform-web/src/storage/db.ts`
- `apps/platform-web/src/storage/resources.ts`
- `apps/platform-web/src/storage/index.ts`

Layer 2：资源库页面

- `apps/platform-web/src/views/ResourceLibraryView.vue`
- 可选 `apps/platform-web/src/components/workflow/WorkflowEditorCanvas.vue`

Layer 3：可选运行链路接线

- `apps/platform-web/src/platform-host/index.ts`

## 审批问题

请主人确认两点：

1. 本批是否接入 `platform-host` 运行链路？
   - A：不接，只做资源库 CRUD（推荐，验收面小）
   - B：接入，让运行时实际消费 workflow preset / prompt preset / world book（更完整，但风险更高）

2. 执行模式：
   - 1：Agent Teams 并行写，多文件同时进行
   - 2：Codex 写代码，Claude 监控审查
