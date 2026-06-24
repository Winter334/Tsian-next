# Design — Skill 配置机制

## 0. 设计总纲

给 skill 加 `.env` 风格的声明式配置：skill 目录放 `skill.config`（key-value + 注释）→ registry 解析配置项 → 玩家在 UI 填值 → 存 Dexie meta 表 → skill 脚本运行时 `tsian.config` 注入。

四层改动，每层最小化：

1. **声明解析**：registry 识别 `skill.config` 文件，解析出配置项列表
2. **值存储**：Dexie meta 表存玩家配置值（key=`skill-config:<skillPath>`）
3. **SDK 注入**：Worker execute 消息带 config，`tsian.config` 平铺对象
4. **UI 渲染**：skill 详情页根据配置项渲染输入框

## 1. skill.config 文件格式

### 1.1 格式规范

`.env` 风格，放在 skill 目录下与 SKILL.md 平级：

```
# Tavily API key, register at https://tavily.com
TAVILY_API_KEY=

# Max search results per query
MAX_RESULTS=5

# SearXNG instance URL (self-hosted search backend)
SEARXNG_URL=http://localhost:8080
```

规则：
- `#` 开头是注释，描述**紧随其后的** key
- `KEY=VALUE` 是配置项，VALUE 是默认值
- 空行忽略
- key 大写蛇形（约定，不强制）
- VALUE 始终是字符串（脚本自己 `Number()` 转换）

### 1.2 解析逻辑

新增 `parseSkillConfig(source: string): SkillConfigItem[]`：

```ts
interface SkillConfigItem {
  key: string       // "TAVILY_API_KEY"
  description: string // "Tavily API key, register at https://tavily.com"
  defaultValue: string // "" 或 "5"
}
```

解析规则：
- 按行遍历
- `#` 开头 → 记为 pendingDescription
- `KEY=VALUE` → 产出 item，description 用 pendingDescription（然后清空）
- 空行 → 清空 pendingDescription
- 其他行忽略

### 1.3 registry 集成

`buildSkillRegistry` 遍历 workspace 文件时，除了识别 SKILL.md，还要识别 `skill.config`：

- `skillPathInfo` 的正则只匹配 SKILL.md。新增 `SKILL_CONFIG_FILE_PATH_PATTERN` 识别 `<directoryPath>/skill.config`。
- `buildSkillRegistry` 先扫一遍建立 `directoryPath → configFileContent` 映射，再在 `buildSkillRegistryEntry` 里查配。
- `SkillRegistryEntry` 加可选字段 `configItems?: SkillConfigItem[]`。

## 2. 配置值存储（玩家覆盖值）

### 2.1 专门表（DB schema 升级）

用户明确允许破坏性变更/DB 升级。新增 `skillConfigs` 表比塞 meta 表更清晰：

```ts
// db.ts
export interface LocalSkillConfigRecord {
  skillPath: string  // 主键，如 "skills/web-search"
  values: string     // JSON.stringify 的配置值对象
  updatedAt: number
}

// TsianLocalDb
skillConfigs!: Table<LocalSkillConfigRecord, string>

// version 升级（v9 → v10，加 skillConfigs 表）
this.version(2).stores({
  // ...现有表不变...
  skillConfigs: "&skillPath, updatedAt",
})
```

破坏性变更：旧 v9 数据库抛弃，新建 v10（和之前 v8→v9 同模式，项目 prototype 不做迁移）。

### 2.2 存储 API

新增 `skill-config-storage.ts`：

```ts
export async function readSkillConfig(skillPath: string): Promise<Record<string, string>>
export async function writeSkillConfig(skillPath: string, values: Record<string, string>): Promise<void>
export async function deleteSkillConfig(skillPath: string): Promise<void>
```

内部用 `db.skillConfigs` 表读写，JSON 序列化 values 字段。

## 3. tsian.config 注入

### 3.1 Worker 消息协议扩展

现有 execute 消息：`{type:"execute", source, input}`

扩展为：`{type:"execute", source, input, config?}`

- `config` 是平铺对象 `{KEY: value}`，可选（无配置的 skill 不传）
- 值 = 玩家配置值覆盖默认值后的合并结果

### 3.2 Worker 源码改动

`BROWSER_SCRIPT_WORKER_SOURCE` 的 `tsian` 对象加 `config`：

```js
const tsian = Object.freeze({
  workspace: Object.freeze({ ... }),
  log(message, data) { ... },
  trace(label, data) { ... },
  config: Object.freeze(message.config ?? {})  // 新增
});
```

`Object.freeze` 防脚本篡改。无 config 时是空对象 `{}`（skill 脚本 `config.API_KEY` 返回 undefined，脚本自己处理缺失）。

### 3.3 配置值合并

`createBrowserSkillScriptRunner` 调 `runWorkerScript` 前，读玩家配置值 + 合并默认值：

```ts
const configValues = await readSkillConfig(request.skillPath)
const mergedConfig = mergeConfig(configItems, configValues)
// configItems 是 skill 声明的配置项（含默认值），configValues 是玩家填的值
// mergedConfig = { ...defaults, ...playerValues }
```

合并后传给 `runWorkerScript`，worker.postMessage 时带上 config。

## 4. UI 渲染

### 4.1 skill 详情页配置区域

skill 详情页（现有的 skill 列表/详情组件）根据 `SkillRegistryEntry.configItems` 渲染配置区域：

- 无 `configItems` → 不显示配置区域
- 有 `configItems` → 渲染输入框列表：
  - 每个 item 一个 label（description）+ input
  - key 名含 `KEY`/`SECRET`/`TOKEN`/`PASSWORD` → `<input type="password">`
  - 其他 → `<input type="text">`
  - 初始值 = 玩家已存值 ?? 默认值
- 保存按钮 → `writeSkillConfig(skillPath, values)`

### 4.2 密码遮蔽判断

```ts
function isSecretKey(key: string): boolean {
  const upper = key.toUpperCase()
  return ["KEY", "SECRET", "TOKEN", "PASSWORD"].some(s => upper.includes(s))
}
```

不需声明类型——根据 key 名自动判断。

## 5. 数据流

### 5.1 配置声明流

```
skill.config 文件（workspace）
  → buildSkillRegistry 遍历识别
  → parseSkillConfig 解析出 configItems
  → SkillRegistryEntry.configItems
  → skill 详情页 UI 渲染输入框
```

### 5.2 配置消费流

```
玩家在 UI 填值 → writeSkillConfig(skillPath, values) → Dexie meta 表

skill 执行时：
  createBrowserSkillScriptRunner
    → readSkillConfig(skillPath)  # 读玩家值
    → mergeConfig(configItems, playerValues)  # 合并默认值
    → runWorkerScript(..., config: mergedConfig)
      → worker.postMessage({type:"execute", source, input, config})
      → Worker 内 tsian.config = Object.freeze(config)
      → 脚本 config.API_KEY 取值
```

## 6. 契约不变项

- `AgentPlatformToolName` 不变（不加工具）
- `RUNTIME_WORKSPACE_TOOL_NAMES` 不变
- `buildEnabledToolSchemas` 不变
- skill 加载/执行机制（use_skill/run_script）不变
- Worker 消息协议向后兼容（config 可选，旧消息无 config 时 tsian.config = {}）
- `SkillRegistryEntry` 加可选字段（向后兼容，现有 skill 无 configItems）

## 7. 兼容性与破坏性变更

- **现有 skill（无 skill.config）**：`configItems` 为 undefined，UI 不显示配置区域，`tsian.config` 是空对象，行为不变。
- **DB schema 升级**：v9 → v10，加 `skillConfigs` 表。破坏性变更——旧 v9 数据库抛弃，新建 v10（项目 prototype 不做迁移，和之前 v8→v9 同模式）。
- **Worker 消息向后兼容**：config 字段可选，无 config 时 `tsian.config = {}`。
- **skill.config 是 workspace 文件**：自动满足"资源管理器可见 + 玩家可编辑 + agent 可 read/write + 随包导出"——因为它是 card-content scope 的普通 workspace 文件，和 SKILL.md/scripts 走完全相同的路径，不需要额外接入。
- **玩家覆盖值不进 workspace**：存 Dexie `skillConfigs` 表，不进 workspace 文件系统，不随 skill 包导出。

## 8. 权衡

### 8.1 .env 格式 vs JSON schema

选 .env：简单、平铺、注释自然、不需类型系统。代价：无类型校验、无嵌套——但 skill 配置就是几个 key-value，不需要这些。

### 8.2 专门表 vs meta 表

选专门表 `skillConfigs`：用户允许破坏性变更/DB 升级，专门表比塞 meta 表更清晰（独立 schema、独立索引、不和其他杂项混）。代价：DB version 升级——但项目 prototype 本就是破坏性升级模式，可接受。

### 8.3 配置不进 agent context

配置声明不随 SKILL.md 注入 agent——零噪声。代价：agent 不知道 skill 需要配置，use_skill 后可能因缺配置失败。但"第一次出错再配"是正常流程，且 skill 脚本能给清晰报错（`if (!config.API_KEY) throw new Error("请先配置 Tavily API key")`）。

## 9. 回退

改动集中在：
- `registry.ts`（config 解析 + registry entry）
- `skill-config-storage.ts`（新增，存储 API）
- `browser-skill-script-executor.ts`（tsian.config 注入）
- skill 详情页组件（UI 渲染）

出问题 revert 这几处，skill 加载/执行回旧版，meta 表里的 `skill-config:*` 记录是死数据（不影响功能）。
