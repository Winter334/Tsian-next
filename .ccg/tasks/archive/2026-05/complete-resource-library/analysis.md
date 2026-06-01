# 补全资源库功能 — Analysis

## 外部分析状态

- Backend/Codex analyzer：完成，Session-ID: `019e437f-b07e-77a2-854b-970b40983f25`。
- Frontend/Gemini analyzer：连续 3 次失败，均为 `401 无效 API Key`。按 CCG 重试规则降级为本地前端规划代理分析。

## 后端/契约侧结论

Codex 建议把资源库建成平台级本地数据源，而不是继续塞进 `ModManifest.workflow/presets/worldBooks`：

1. `packages/contracts/src/workflow.ts` 或独立契约文件新增平台资源类型：
   - `prompt-preset`
   - `world-book`
   - `workflow-preset`
2. `packages/contracts/src/mod.ts` 新增 `workflowPresetId?: string`，旧 `workflow/presets/worldBooks` 先标记 deprecated，不立即删除。
3. `apps/platform-web/src/storage/db.ts` 新增资源表。Codex 推荐三张表：
   - `promptPresets`
   - `worldBooks`
   - `workflowPresets`
4. 新增 `apps/platform-web/src/storage/resources.ts` 提供 CRUD。
5. 后续 `platform-host` 执行期应按 `workflowPresetId -> manifest.workflow -> defaultWorkflow` 解析工作流，并从资源库读取 prompt/world book。

## 前端/UI 侧结论

本地规划代理建议采用“当前 tabs + 列表卡片 + 编辑面板/全屏工作区”方案：

1. 保留 `/resources` 现有三 tab。
2. 每个 tab 都显示真实资源列表、数量、新建按钮。
3. prompt preset / world book 第一版用 `name + description + JSON textarea` 编辑。
4. workflow preset 复用 `WorkflowEditorCanvas`，但作为资源库资源保存，不再作为 mod draft 保存。
5. 删除资源前做最小引用检查：prompt/world book 若被 workflow preset 引用则阻止删除；workflow preset 若被 mod 绑定则阻止删除或提示。

## 方案对比

### 方案 A：三张资源表 + 三类 CRUD（推荐）

优点：类型清晰，符合现有 storage 风格，避免把资源库做成过度抽象平台。
缺点：CRUD 有少量重复。

### 方案 B：单张 `resources` 表 + discriminated union

优点：统一查询方便，导入导出自然。
缺点：payload 更宽，类型更容易误传，后续不同资源索引会受限。

## 推荐方向

采用方案 A，但 UI 层可用统一的 tab/list/editor 模式减少重复。

本批建议先完成：

1. contracts 资源类型与 `workflowPresetId`。
2. Dexie 三张资源表与 storage CRUD。
3. `/resources` 三类资源的本地 CRUD。
4. 暂不深改 `platform-host` 执行期接线，除非计划审批时主人确认本批要把运行链路也接上。

## 主要风险

- 旧内置模组仍依赖 `manifest.workflow`，必须保留 fallback。
- 删除资源会产生 workflow 悬空引用，需要 UI 阻止或 fail loud。
- prompt/world book payload 用 `unknown`/JSON 灵活但缺 schema，后续需要更强校验。
- `workflow-drafts.ts` 是 mod 草稿，不应继续作为全局 workflow preset 的主存储。
