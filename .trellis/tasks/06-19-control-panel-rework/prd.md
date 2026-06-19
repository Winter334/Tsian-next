# PRD — 控制面板分层重构与下拉统一

## 目标与用户价值
- 把控制面板从「打开即提供商配置」重构为卡片枢纽 + 内联多屏导航，为未来配置类别（如桌面主题）预留入口而不预造假卡片。
- 让一个提供商预设支持多模型（每模型自带参数）+ 有序回退链 + 回退策略，Agent 仍以「提供商预设」为单位选择。
- 统一全站下拉样式：retro 化 shadcn Select，替换散落各处的原生 `<select>`。

## 确认事实（来自代码勘察）
- 现状控制面板 `apps/platform-web/src/views/SettingsView.vue`：单页大 `retro-inset`，左侧服务商详情 + 右侧 360px 模型参数侧栏；保存/重置在窗口标题栏右上角，离字段远。
- 数据模型 `apps/platform-web/src/config/ai.ts`：`BrowserAiProviderPreset` 单 `defaultModel` + 顶层 `parameters` + `fetchedModels`；`BrowserAiConfig` 是运行时取用的扁平配置。
- 下拉：shadcn `SelectTrigger/Content/Item` 用 shadcn 默认类（`rounded-md border-input bg-popover` 等），未 retro 化；`AssistantView`(1)/`StudioView`(2)/`WorkspaceEditorView`(1) 用原生 `<select>`，引用了 CSS 中不存在的死类 `.retro-input`。
- 运行时取用：`runtime-host/ai.ts` 只读 `config.model`/`config.parameters`；`getBrowserAiConfig`/`resolveBrowserAiConfigForProviderId` 解析激活预设；`listBrowserAiProviderPresetOptions` 返回 `{id,name}` 供 Studio/Assistant 的 per-Agent 选择。
- 已有基础设施可复用：`composables/useToast`、`composables/useConfirm`（模型删除用 danger confirm，保存/拉取反馈用 toast）。

## 需求

### R1 控制面板分层（内联多屏导航）
- 枢纽页：配置类别卡片网格，当前仅「AI 提供商」一张卡，点击进入。
- 提供商管理屏：左侧提供商预设列表（选中高亮、模型数徽章、新增/删除）+ 右详情（名称/接口地址/API 密钥 + 模型摘要 + [进入模型配置]）。
- 模型配置屏：头部（返回/拉取模型/添加模型/回退策略/保存/重置）+ 左模型表 + 右参数侧栏。
- 单窗口内 `screen` ref 导航，不新增桌面应用、不动路由；面包屑/返回逐级返回。
- 同一屏只一个侧栏（屏2=提供商侧栏，屏3=模型侧栏）。

### R2 多模型数据模型
- `BrowserAiProviderPreset` 持 `models: BrowserAiModelConfig[]`（有序，`models[0]`=主模型）+ `fallbackStrategy: "primary-only"|"ordered"`。
- `BrowserAiModelConfig = { id, label?, parameters: BrowserAiModelParameters, enabled }`（每模型自带参数）。
- 移除顶层 `defaultModel` 与 `parameters`，由 `models[0]` 承载。
- 旧记录迁移：无 `models` 但有 `defaultModel`/`parameters` → `models:[{id:defaultModel, parameters, enabled:true}]`，`fallbackStrategy:"primary-only"`，已存配置无破坏升级。
- `resolveProviderConfig` 取首个 `enabled` 模型为主模型；`BrowserAiConfig` 增可选 `fallbacks?: Array<{model,parameters}>`（ordered 策略下、enabled 且非主模型的余项，前向兼容）。
- 运行时本轮仍只用主模型（`config.model`/`config.parameters`），回退执行留下一轮。
- `validateBrowserPlatformConfigDraft` 遍历每个 provider 的每个 model 的 parameters 校验。

### R3 模型配置页交互
- 添加模型：从 `fetchedModels` 选或手动输入 → 追加 `models[]`（默认参数、enabled）。
- 重排序：▲▼ 调整 `models[]` 顺序 → 角色徽章随之更新（主模型/回退#n）。
- 删除模型：用 `confirm({severity:"danger", confirmText:"删除"})` 确认后移除。
- 回退策略切换：`primary-only` 时余模型灰显标记"回退(未启用)"；`ordered` 时为回退#n。运行时本轮忽略。
- 右参数侧栏：选中模型的 6 数值字段（上下文窗口/最大输出/温度/top_p/频率惩罚/存在惩罚）+ 推理程度 Select + 自定义请求参数 textarea；复用 `ModelNumberField`。无选中时侧栏占位。

### R4 下拉统一
- retro 化 `SelectTrigger/SelectContent/SelectItem` 默认类：直角、`border-neon-deep/55`、`bg-elevated`/`bg-[#2d2a23]`、retro 内阴影、等宽字体、选中/聚焦 `bg-neon/12 text-neon`、Check 图标 `text-neon`。
- 替换 `AssistantView`/`StudioView`/`WorkspaceEditorView` 原生 `<select>` 为 `<Select>`；去掉 `retro-input` 死类引用。
- 仅改呈现类，不改 reka-ui 行为。

### R5 兼容性
- `listBrowserAiProviderPresetOptions` 仍返回 `{id,name}`；Studio/Assistant 的 `providerPresetId` 选择不受影响。
- `getBrowserAiConfig`/`resolveBrowserAiConfigForProviderId` 行为不变（取主模型）。
- 旧 localStorage 配置迁移后可解析、可显示为单模型预设。

## 验收标准
- [ ] `npm run build`（vue-tsc + vite build）通过，无新增类型错误。
- [ ] 控制面板打开为枢纽卡片页；点「AI 提供商」进入提供商管理；选中预设后 [进入模型配置] 进入模型配置；返回逐级回到枢纽。
- [ ] 提供商管理屏可新增/删除预设、编辑身份字段、看到模型摘要。
- [ ] 模型配置屏可添加/排序(▲▼)/删除模型、编辑选中模型参数、切换回退策略；保存后刷新仍保留。
- [ ] 删除模型弹出 danger 确认弹窗；保存成功/拉取失败有 toast 反馈。
- [ ] 旧格式 localStorage 配置迁移后正常显示为单模型预设，可进入模型配置继续编辑。
- [ ] AssistantView/StudioView/WorkspaceEditorView 下拉为新统一 retro Select 样式，功能正常；全站无原生 `<select>`。
- [ ] 无视觉 Playwright 验证以上流程（不截图）。

## 明确不做
- 不做指标/埋点/可用率（AIRP 平台非模型中转，调用频率不支持，过度设计——用户已收回）。
- 不做多密钥。
- 运行时回退执行（留 `fallbacks` 前向兼容字段，下一轮）。
- 不动路由、不加桌面应用、不预造假卡片（如主题）。
- 不重构 AssistantView 既有的重命名弹窗。

## 开放问题
- 无（需求已与用户收敛）。
