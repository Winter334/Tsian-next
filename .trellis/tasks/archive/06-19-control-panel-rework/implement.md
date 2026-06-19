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

## Stage 3：UI 收敛调整（验证阶段发现的问题）

> 背景：Stage 1-2 已实现并构建通过。用户在验证阶段对 UI 不满意，要求调整。
> 此次调整接续中断会话，继续这版 ProviderType 分层 + 对话框化 + 自动保存 的重构方向。

### 调整项
16. **上边栏太高**：`SettingsView.vue` 头部当前双行（eyebrow `text-[11px]` + title `text-base`）+ `py-2`，比其他 view 的单行 `retro-toolbar` 高一截。改为单行布局：去 eyebrow，title 缩为 `text-sm`，`py-1.5`。**不改 `retro-toolbar` 全站类**（影响 7 个其他 view），只在 SettingsView 局部收紧。ModelConfigScreen 头部同理核查。
    - **根因（Playwright 量测发现）**：header 撑高到 157px 不是 padding/双行所致，而是 `<section>` grid 容器**缺 `grid-rows-[auto_minmax(0,1fr)]` 行定义**——缺省 grid 行均分高度，header 被拉到与 main 等高。修复：section 绑定动态 class，枢纽页（无 header）`grid-rows-[minmax(0,1fr)]`、非枢纽页 `grid-rows-[auto_minmax(0,1fr)]`。修后 header 从 157px → 37px（内容 24px + padding 12px），与桌面窗口标题栏（50px）量级一致。
17. **提供商类型常驻**：当前类型由用户 `addType` 添加，空状态显示"尚未添加类型"。改为三个内置类型（openai-compatible 可用 / gemini·claude 敬请期待）常驻侧栏，**移除"添加类型"操作**。在 `ai.ts` `normalizeProviderTypes` 末尾按 `PROVIDER_TYPE_KINDS` 补齐缺失的内置类型（type.id = kind）。移除 `ProviderManagementScreen` 底部添加类型按钮区 + `SettingsView` 的 `handleAddType`/`addType` 事件链。不可用类型选中时右侧禁用"添加预设"并提示"敬请期待"。
18. **移除冗余"添加预设"入口**：`ProviderManagementScreen` 当前列表头部工具栏有"添加预设"按钮，空状态块又有第二个"添加预设"按钮——空时两个并列。保留头部常驻按钮，空状态块只留引导文字、移除其按钮。
19. **预设卡片样式**：当前卡片删除按钮用 `-mr-1 -mt-1` 负 margin 向右上溢出卡片边界；"模型配置"按钮独占一行、删除按钮挤在标题行，排版乱。重构卡片为：标题行（名称 + baseUrl 截断，无溢出按钮）→ 信息行（主模型/模型数/策略）→ 底部操作行（"模型配置"主按钮 + "删除"图标按钮同行右对齐，均在卡片内）。

### 验证
- `npm run build`（apps/platform-web）通过。
- Playwright 无视觉验证：枢纽→提供商管理→选中 openai-compatible→添加预设（对话框）→预设卡片显示正常、按钮不溢出→进入模型配置→返回；gemini/claude 类型常驻、选中显示"敬请期待"、不可添加预设。
- 回归：`listBrowserAiProviderPresetOptions` / `getBrowserAiConfig` 行为不变（常驻类型 presets 为空时不影响）。

### 调整项（第二批，验证阶段继续发现）
20. **中枢卡片统计口径**：`SettingsHub.vue` 副标题现显示「N 个类型 · M 个预设」，类型已常驻无信息量。改为「M 个预设 · K 个模型」（统计全部预设的 models 总数）。
21. **模型配置两层 header**：`SettingsView` 有 header（返回+标题），`ModelConfigScreen` 又有自己的 header（typeName+拉取+添加）——两层冗余。移除 `ModelConfigScreen` 的 header；「添加模型」按钮上移到 `SettingsView` header 右侧（仅 models 屏显示）；「拉取模型」按钮移除（见 22）；回退策略 Select 留在 body 顶部。
22. **移除冗余拉取按钮**：`ModelConfigScreen` header 的「拉取模型」与 `AddModelDialog` 内的拉取重复，移除前者（随 21 一起完成）。
23. **添加模型时直接配置参数**：现 `AddModelDialog` 只输 modelId，添加后需再点「编辑」配参数。扩展 `AddModelDialog`：选/输 modelId 后下方展开参数表单（6 数值 + 推理程度 Select + 自定义请求参数 textarea，预填默认值），确认时连同参数一起创建 `BrowserAiModelConfig`，省一步操作。
24. **添加预设弹窗加连通性测试**：`handleAddPreset` 的 `openDialogForm` 加「测试连通性」按钮，复用 `fetchBrowserAiProviderModels`（拉模型=带鉴权连通性自检），成功显示「✓ 已连通，发现 N 个模型」，失败显示错误。需扩展 `useDialogForm`/`DialogForm` 支持可选 test 动作 + 异步状态显示。
25. **开放 gemini/claude 协议支持**（架构项，中等偏小）：
    - `ai.ts`：`BrowserAiConfig` 加 `kind: BrowserAiProviderKind` 字段；`resolveProviderConfig` 从 preset 所属 type 反查 kind 填入；`PROVIDER_TYPE_KINDS` gemini/claude `available` 改 `true`。
    - `runtime-host/ai.ts`：引入轻量 provider adapter（openai/gemini/claude），按 `config.kind` dispatch URL/header/body/响应解析。Gemini：`/models/{model}:generateContent`、`x-goog-api-key`、`contents/parts` 格式、`systemInstruction`。Claude：`/v1/messages`、`x-api-key`+`anthropic-version`、`max_tokens` 必填、system 不进 messages。
    - `fetchBrowserAiProviderModels`：加 `kind` 参数，按 kind 分发 models 端点 URL/header/parser（Gemini `models[].name` 带 `models/` 前缀需剥离）。
    - `SettingsView` `handleAddPreset`：按 kind 区分 baseUrl 默认值/placeholder（Gemini `https://generativelanguage.googleapis.com/v1beta`、Claude `https://api.anthropic.com`）。
    - **验证限制**：构建可验证；真实 gemini/claude 调用需用户手动实测（需真实 API key）。`AiChatMessage`（contracts）保持 OpenAI 内部表示，adapter 内部做格式转换，contracts 不动。

### 调整项（第三批，验证阶段继续发现 — 参数控件与下拉遮挡）
26. **滑动条参数控件（RangeSlider）**：温度/top_p/频率惩罚/存在惩罚 等有上下限的参数现用数值输入框，不直观。新增 `src/components/ui/slider/RangeSlider.vue`（retro-range 样式：sunken track + neon thumb，见 `style.css` `.retro-range`）+ `slider/index.ts`。`nullable` 时最左挡位 = null（"不发送"），内部索引 0=null、1..N=min..max。`ModelParamsFields` 4 个有界参数改用 RangeSlider（temperature 0-2 step 0.05、topP 0-2 step 0.05、frequencyPenalty -2~2 step 0.1、presencePenalty -2~2 step 0.1，均 nullable）。
27. **推理程度按提供商类型提示**：`ai.ts` 新增 `reasoningEffortHintForKind(kind)`，在 `ModelParamsFields` 推理程度 Select 下方显示各 kind 的映射说明（OpenAI 直接发 reasoning_effort / Gemini 映射 thinkingConfig / Claude 不发送建议留空用自定义参数）。
28. **抽 ModelParamsFields 共享片段**：`AddModelDialog`（项 23 内联参数表单）与新增 `EditModelParamsDialog`（编辑已有模型参数）共用一份参数表单。抽 `src/components/settings/ModelParamsFields.vue`（2 数值 + 4 RangeSlider + 推理程度 Select + 提示 + 自定义参数 textarea；props `parameters`/`kind`，emit `update:parameters`）。两个对话框均 `<Teleport to="body">` + `z-[60]` + `NO_REASONING="__none"` 哨兵值（reka-ui SelectItem 拒绝空串 value）。
29. **编辑模型参数改为对话框**：模型表"编辑"按钮原打开内联侧栏，改用 `EditModelParamsDialog`（props `open`/`modelId`/`kind`/`initialParameters`，emit `confirm(parameters)`；open 时重置 params 副本以便取消丢弃）。`SettingsView` `handleEditModelParams` 改为驱动该对话框。
30. **下拉被弹窗遮罩遮挡（Bug A，Playwright 量测定位）**：`SelectContent` portal 用 `z-50`，而 `AddModelDialog`/`EditModelParamsDialog` 遮罩用 `z-[60]`，两者均 teleport 到 `<body>` 根堆叠上下文。弹窗内 Select 展开时 `50 < 60` → listbox 被弹窗自身 `bg-black/55` 暗色背景盖住（DOM 存在、hit-test 可命中中心，但视觉被遮）。修复：`SelectContent.vue` `z-50` → `z-[70]`。验证：弹窗内下拉 listbox z=70 > 遮罩 z=60 onTop=true；主窗口内下拉未受影响（桌面窗口 z=100+ 被困在 `.desktop-shell` z=10 堆叠上下文，listbox 70 在根上下文仍胜出）。
31. **聚焦边框被滚动容器裁切（Bug B）**：`retro-focus:focus-visible` 用 `outline-offset: 2px`，弹窗内承载表单的滚动容器仅 `pr-1`（右侧 4px）内边距，上下左无留白，向外偏移 2px 的 outline 被裁。修复：`EditModelParamsDialog`/`AddModelDialog` 三个滚动容器 `pr-1` → `p-1.5`（6px 四向留白）。

### 验证（第三批）
- `npx vue-tsc -b && npx vite build`（apps/platform-web，bash 下用 npx 绕过 PATH）通过。
- Playwright 无视觉验证：添加模型/编辑参数对话框内 4 个滑动条渲染、最左"不发送"、推理程度提示显示；弹窗内推理程度下拉展开 listbox 在遮罩之上（z-70>60）；主窗口回退策略下拉仍正常。
- dev server HMR 无法热加载本次新建目录（slider/、ModelParamsFields.vue、EditModelParamsDialog.vue），需重启 `npm run dev`（非代码问题，vite 模块图缓存限制）。

### 调整项（第四批，推理程度统一化）
32. **推理程度统一为快捷挡位 + 透传**：
    - **背景**：原 Gemini 把 effort 映射成 `thinkingConfig.thinkingBudget`（且 medium=high 都映射 -1，是 bug），Claude 完全不发送。三家协议的真实挡位/预算语义不同，离散枚举套不下。决定降级为"OpenAI 风格快捷挡位 + 全家透传 reasoning_effort 字符串"，各家的精细差异交自定义请求参数。
    - `ai.ts`：`BrowserAiReasoningEffort` 扩为 `"" | "minimal" | "low" | "medium" | "high" | "xhigh"`（补"最低"minimal、"最高"xhigh）；`normalizeReasoningEffort`/`validateBrowserAiModelParameters` 同步扩挡位。
    - `runtime-host/ai.ts`：Gemini adapter 移除 `thinkingConfig.thinkingBudget` 映射，改为 `generationConfig.reasoning_effort = effort`（与 OpenAI 一致透传）；Claude adapter 补 `body.reasoning_effort = effort`（原先不发，现透传）。三家行为统一：留空不发送、有值就透传字符串。
    - `reasoningEffortHintForKind(kind)` 简化为单一提示（不再按 kind 分述映射）：「以 reasoning_effort 字段发送；请确保你的 API 支持该参数，不支持时选「不发送」并通过自定义请求参数手动指定。」参数 `_kind` 保留签名兼容但不再分支。
    - `ModelParamsFields.vue` 推理程度 Select 补「最低」(minimal)、「最高」(xhigh) 两个 SelectItem。
    - **验证限制**：HMR 不热加载 ModelParamsFields 的 SelectItem 静态列表（hint 是 computed 能热更、SelectItem 是模板静态内容不热更），dev 需重启或刷新；构建产物 `dist/assets/SettingsView-*.js` grep `minimal/xhigh/最低/最高` 各 1 次确认已编译。真实各家 API 对 reasoning_effort 的支持需用户实测。

### 调整项（第五批，新增 DeepSeek 提供商 + 流式落后续）
33. **新增 DeepSeek 内置提供商类型**：
    - DeepSeek 是 OpenAI 兼容协议（`https://api.deepseek.com/v1`、`Authorization: Bearer`、标准 `/models` + `/chat/completions`、body 直接接受 `reasoning_effort`），因此**复用 `openaiAdapter`，无需新 adapter**。
    - `ai.ts`：`BrowserAiProviderKind` 加 `"deepseek"`；`PROVIDER_TYPE_KINDS` 加 `{ kind: "deepseek", name: "DeepSeek", available: true }`；`normalizeProviderType` 的 kind 白名单加 `deepseek`。`normalizeProviderTypes` 去重循环自动把它常驻进侧栏。`buildModelsUrlForKind`/`buildProviderHeadersForKind`/`extractModelEntriesForKind` 均走 OpenAI 默认分支（`/models` + `Bearer` + `{data:[{id}]}`），无需特判。
    - `runtime-host/ai.ts`：`selectAdapter` 注释标明 deepseek 复用 openaiAdapter（走默认分支 return openaiAdapter）。
    - `SettingsView.vue`：`baseUrlPlaceholderForKind` 加 `deepseek → "https://api.deepseek.com/v1"`。
    - 验证：`vue-tsc -b && vite build` 通过；Playwright 实测侧栏出现「DeepSeek 0 个预设」常驻类型、无「敬请期待」徽章、添加预设弹窗接口地址 placeholder 为 `https://api.deepseek.com/v1`。真实 DeepSeek API 调用需用户实测（需真实 key）。
34. **流式输出落为后续任务**：确认当前不支持流式（`generateAssistantReply` 返回 `Promise<string>`、`stream` 在 `PROTECTED_CUSTOM_REQUEST_KEYS` 被禁）。新建后续任务 `06-19-ai-streaming-response`（含 task.json + prd.md，记录 adapter 三家 SSE 解析、fetch 改 ReadableStream、调用方/UI 增量消费、stream 解禁等范围），本期不做。
