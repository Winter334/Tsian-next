# Design — 控制面板分层重构与下拉统一

## 架构与边界

### 控制面板单窗口三屏（本地导航状态）
```
SettingsView.vue（壳 + 导航状态 + draft 持有 + 保存/重置 handler）
  screen: { kind:"hub" } | { kind:"providers" } | { kind:"models", providerId }
  ├─ SettingsHub.vue            （枢纽卡片网格）
  ├─ ProviderManagementScreen   （左提供商侧栏 | 右详情）
  └─ ModelConfigScreen          （左模型表 | 右参数侧栏）
```
- 导航为纯本地 `ref`，不进路由；面包屑 + 返回按钮逐级 pop。
- `platformConfigDraft`/`settingsFeedback`/`settingsError`/保存/重置仍由 `SettingsView` 持有，通过 props 下传、事件上抛；保存/重置在提供商管理屏与模型配置屏头部都可达（同一 draft、同一 handler）。

### 信息架构
```
Screen 1 枢纽：配置类别卡片网格（当前仅「AI 提供商」）
  → Screen 2 提供商管理：[左 提供商预设列表 | 右 选中提供商详情]
       右详情 = 身份字段(名称/接口地址/API密钥) + 模型摘要(主模型/模型数/回退策略) + [进入模型配置]
       → Screen 3 模型配置：[左 模型表 | 右 选中模型参数侧栏]
            头部 = 返回 + "{name}·模型配置" + 拉取/添加 + 回退策略 Select + 保存/重置
```
同一屏只一个侧栏，避免嵌套。

## 数据模型与契约（config/ai.ts）

### 新增/变更类型
```ts
interface BrowserAiModelConfig {
  id: string
  label?: string
  parameters: BrowserAiModelParameters
  enabled: boolean
}
type BrowserAiFallbackStrategy = "primary-only" | "ordered"

interface BrowserAiProviderPreset {
  id: string
  name: string
  kind: BrowserAiProviderKind
  baseUrl: string
  apiKey: string
  models: BrowserAiModelConfig[]          // 有序；首个 enabled 为主模型
  fallbackStrategy: BrowserAiFallbackStrategy
  fetchedModels: BrowserAiModelEntry[]
  modelsFetchedAt: string
}
```
- 移除 `defaultModel`、顶层 `parameters`（由 `models[0]` 承载）。
- `BrowserAiConfig` 增 `fallbacks?: Array<{ model: string; parameters: BrowserAiModelParameters }>`（前向兼容，本轮运行时不读）。

### 解析/迁移/校验
- `normalizeProviderPreset`：若 `record.models` 缺失但 `defaultModel`/`parameters` 存在 → 合成单模型 `models:[{id,parameters,enabled:true}]`，`fallbackStrategy:"primary-only"`；`normalizeModelConfig` 新增（normalize 参数 + enabled 默认 true）。
- `normalizeModelParameters` 仍复用；每模型独立调用。
- `resolveProviderConfig`：`primary = models.find(enabled) ?? models[0]`；若 `baseUrl/apiKey/primary.id` 齐全则返回 `{providerId,providerName,baseUrl,apiKey,model:primary.id,parameters:primary.parameters, fallbacks}`；`fallbacks` 仅 `ordered` 策略下、enabled 且非 primary 的余项。
- `validateBrowserPlatformConfigDraft`：`for provider of providers: for model of provider.models: validateBrowserAiModelParameters(model.parameters)`。
- `createBrowserAiProviderPreset`：默认 `models:[]`、`fallbackStrategy:"primary-only"`；新增 `createBrowserAiModelConfig(seed)` 工厂（默认参数、enabled）。
- `fetchBrowserAiProviderModels` 不变（仍用 baseUrl/apiKey）。
- `listBrowserAiProviderPresetOptions` 不变（仍 `{id,name}`）。

### 运行时契约不变
- `runtime-host/ai.ts` 仍只读 `config.model`/`config.parameters`（主模型）。
- `getBrowserAiConfig`/`resolveBrowserAiConfigForProviderId` 行为不变。
- Studio/Assistant 的 `providerPresetId` 选择不变。

## 下拉统一（Stage 1）
- `SelectTrigger.vue`：去 `rounded-md border-input bg-transparent shadow-sm ring-ring`，改 `h-9 w-full border border-neon-deep/55 bg-elevated px-3 font-mono text-xs text-text-main` + retro 内阴影；ChevronDown `text-text-dim`。
- `SelectContent.vue`：`rounded-md border bg-popover shadow-md` → `border border-neon-deep/55 bg-[#2d2a23]` + retro 内阴影 + 直角。
- `SelectItem.vue`：`rounded-sm focus:bg-accent` → 选中/聚焦 `bg-neon/12 text-neon`，Check `text-neon`，直角，等宽。
- 原生 `<select>` 替换：reka Select 用 `modelValue`（非 `@change`），改写为 computed get/set 或 `@update:modelValue`。
- 仅改呈现类，不改 reka-ui 行为。

## 兼容性与迁移
- localStorage 旧格式（`defaultModel`/`parameters`）经 `normalizeProviderPreset` 迁移为单模型预设，无破坏升级。
- 迁移后 UI 显示为单模型，可进入模型配置继续编辑/追加。
- 保存回写为新格式（`models`/`fallbackStrategy`）；旧客户端读新格式也能迁移（向后兼容）。

## 权衡
- 内联多屏 vs 子路由：选内联，避免新增桌面应用/路由复杂度，满足用户「不多塞桌面应用」；代价是无 URL/后退键支持，未来可升级。
- 每模型自带参数 vs 共享参数：选每模型自带，贴合现实（不同模型上下文窗口不同）；代价是数据量略大、UI 需每模型编辑。
- 运行时不做回退执行：本轮只存配置（`fallbacks` 前向兼容），避免把配置重构与运行时回退逻辑混在一轮；代价是回退策略 UI 本轮无运行时效果（明确告知用户）。

## 回滚
- Stage 1：回滚 `SelectTrigger/Content/Item` 三个文件 + 三视图的 `<select>` 替换。
- Stage 2：回滚 `config/ai.ts` + `SettingsView.vue` + 新增组件目录；localStorage 旧数据未被新代码写入破坏（新代码只在保存时写新格式，回滚后旧客户端仍可读旧格式或迁移）。
