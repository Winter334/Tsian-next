# Implement — 控制面板分层重构与下拉统一

## 分阶段执行（Stage 1 独立交付验证后再做 Stage 2）

### Stage 1：下拉统一
1. retro 化 `src/components/ui/select/SelectTrigger.vue` 默认类（直角/neon-deep 边框/bg-elevated/retro 内阴影/等宽/ChevronDown text-text-dim）。
2. retro 化 `src/components/ui/select/SelectContent.vue`（border-neon-deep/55 + bg-[#2d2a23] + retro 内阴影 + 直角）。
3. retro 化 `src/components/ui/select/SelectItem.vue`（选中/聚焦 bg-neon/12 text-neon + Check text-neon + 直角 + 等宽）。
4. 替换 `src/views/AssistantView.vue` API 服务商原生 `<select>` → `<Select>`（computed get/set 或 @update:modelValue），去 `retro-input` 引用。
5. 替换 `src/views/StudioView.vue` 权限等级、服务商预设两个原生 `<select>` → `<Select>`，去 `retro-input`。
6. 替换 `src/views/WorkspaceEditorView.vue` 文件类型原生 `<select>` → `<Select>`，去 `retro-input`。
7. 验证：`npm run build` 通过；无视觉 Playwright 验 Select 展开样式（直角/neon-deep 边框/选中 neon 高亮）+ 三视图下拉正常工作；确认全站无原生 `<select>`（grep `<select`）。

### Stage 2：数据模型 + 三屏
8. `src/config/ai.ts`：加 `BrowserAiModelConfig`/`BrowserAiFallbackStrategy`；改 `BrowserAiProviderPreset`（models/fallbackStrategy，移除 defaultModel/顶层 parameters）；加 `normalizeModelConfig`/`createBrowserAiModelConfig`；改 `normalizeProviderPreset` 迁移逻辑；改 `resolveProviderConfig`（主模型 + fallbacks）；改 `createBrowserAiProviderPreset`；改 `validateBrowserPlatformConfigDraft`（遍历每模型）；`BrowserAiConfig` 加可选 `fallbacks`。
9. 抽 `src/components/settings/ModelParamEditor.vue`（6 数值字段 + 推理程度 Select + 自定义请求参数 textarea，复用 ModelNumberField；props: modelConfig + emit 更新）。
10. 新增 `src/components/settings/SettingsHub.vue`（卡片网格，当前仅「AI 提供商」卡，点击 emit enter）。
11. 新增 `src/components/settings/ProviderManagementScreen.vue`（左提供商侧栏：选中高亮/模型数徽章/新增/删除；右详情：名称/接口地址/API密钥 Input + 模型摘要 + [进入模型配置]；空状态）。
12. 新增 `src/components/settings/ModelConfigScreen.vue`（头部：返回/拉取/添加/回退策略 Select/保存/重置；左模型表：▲▼排序 + 模型id + enabled Switch + 角色徽章(主模型/回退#n) + 参数数摘要 + 删除；右参数侧栏：ModelParamEditor 或占位）。
13. 重写 `src/views/SettingsView.vue` 为壳 + `screen` ref 导航 + 面包屑/返回；持有 draft/feedback/error/保存/重置 handler；下传 props、上抛事件。
14. 模型删除接 `confirm({severity:"danger",confirmText:"删除"})`；保存成功/拉取失败接 `toast.success/error`。
15. 验证：`npm run build` 通过；无视觉 Playwright 验三屏流转、增删排序模型、参数编辑、回退策略切换、保存/重置、旧 localStorage 迁移后显示为单模型预设可继续编辑。

## 验证命令
- 构建：`cd apps/platform-web && npm run build`（vue-tsc -b && vite build）
- 全站无原生 select：`rg "<select\b" apps/platform-web/src`（应无结果）
- 无视觉浏览器：Playwright `browser_snapshot`/`browser_evaluate`/`browser_click`（不截图）

## 风险文件 / 回滚点
- `config/ai.ts`：数据模型变更 + 迁移，影响运行时取用——保留 `getBrowserAiConfig`/`resolveBrowserAiConfigForProviderId` 行为不变是关键约束。
- `SettingsView.vue`：整页重写——保留对 `platformConfigDraft` 的保存/重置语义。
- `SelectTrigger/Content/Item`：改默认类全局生效——影响所有已有 `<Select>`（控制面板 3 处 + Stage 1 替换的 4 处），需一并验证。
- 旧 localStorage 数据：迁移在 `normalizeProviderPreset`，测试需用旧格式 fixture（或手工写入旧 key）验证迁移。

## task.py start 前检查
- [ ] PRD/design/implement 三文件就绪。
- [ ] 用户已确认方案（去指标版）。
- [ ] Stage 1 与 Stage 2 边界清晰，可独立验证。
