# Design: 规则拼接系统 — contextPaths 增强 + 宏变量引擎

## Overview

增强 `contextPaths` 从扁平 `string[]` 升级为支持 role 控制、`{{file:...}}` 宏展开、条件包含（`?enabled` + `enabledModules`）和通配引用（`*.md`）的注入系统。改动涉及 contracts 类型、registry 解析、context 组装、index 消息构建四个层。

## 改动地图

```
packages/contracts/src/runtime.ts          — ContextPathEntry 类型 + AgentConfig.enabledModules
apps/platform-web/src/agent-runtime/
  context.ts                               — 宏展开引擎 + contextFiles 组装改为 ContextInjection[]
  registry.ts                              — contextPaths 解析支持对象形式 + enabledModules
  index.ts                                 — buildAgentContextMessages_split 消费 ContextInjection[]
apps/platform-web/src/storage/
  workspace-templates.ts                   — agentConfigContent 兼容新类型（如有需要）
  local-assistant-files.ts                 — assistant skeleton 验证兼容新类型
```

## 1. Contracts 类型变更

### 1.1 新增 ContextPathEntry 联合类型

```ts
// packages/contracts/src/runtime.ts

/** contextPath 条目：纯字符串（向后兼容）或对象形式（支持 role/template）。 */
export type ContextPathEntry =
  | string
  | ContextPathObject

export interface ContextPathObject {
  /** workspace 文件路径。与 template 互斥。 */
  path?: string
  /** 内联模板字符串。与 path 互斥。 */
  template?: string
  /** 注入消息角色。默认 "user"。 */
  role?: "system" | "user" | "assistant"
}
```

### 1.2 AgentConfig 变更

```ts
export interface AgentConfig {
  // ...
  contextPaths: ContextPathEntry[]    // 从 string[] 扩展
  /** 启用的规则模块名列表（文件名 stem）。用于 {{file:...?enabled}} 条件检查。 */
  enabledModules?: string[]
  // ...
}
```

### 1.3 AgentRegistryEntry 变更

```ts
export interface AgentRegistryEntry {
  // ...
  contextPaths: ContextPathEntry[]    // 同步扩展
  enabledModules: string[]            // 解析后（默认空数组）
  // ...
}
```

### 1.4 AgentContextEntry 变更

```ts
/** 编译后的注入条目（宏已展开）。 */
export interface ContextInjection {
  role: "system" | "user" | "assistant"
  content: string
  /** 来源描述（用于 meta 信息显示，如文件路径或 "inline template"）。 */
  source: string
}

export interface AgentContextEntry {
  // ...
  contextInjections: ContextInjection[]   // 替代 contextFiles
  missingContextPaths: string[]
  // ...
}
```

`contextFiles: WorkspaceFile[]` 被 `contextInjections: ContextInjection[]` 替代——后者是宏展开后的编译产物，携带 role 和最终内容。

## 2. Registry 解析变更

### 2.1 contextPaths 解析

`registry.ts` 的 `jsonStringArray` 替换为新的 `parseContextPathEntries`：

```ts
function parseContextPathEntries(value: unknown): ContextPathEntry[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const items: ContextPathEntry[] = []
  for (const entry of value) {
    if (typeof entry === "string") {
      const trimmed = entry.trim()
      if (!trimmed || seen.has(trimmed.toLowerCase())) continue
      seen.add(trimmed.toLowerCase())
      items.push(trimmed)
      continue
    }
    if (isRecord(entry)) {
      const obj: ContextPathObject = {}
      const path = jsonString(entry.path)
      const template = jsonString(entry.template)
      if (path && !template) {
        obj.path = path
      } else if (template && !path) {
        obj.template = template
      } else {
        continue  // path 和 template 互斥，或都没提供 → 跳过
      }
      const role = entry.role
      if (role === "system" || role === "user" || role === "assistant") {
        obj.role = role
      }
      // 去重 key：path 或 template 的 lowercased 值
      const key = (obj.path ?? obj.template ?? "").toLowerCase()
      if (!key || seen.has(key)) continue
      seen.add(key)
      items.push(obj)
    }
  }
  return items
}
```

### 2.2 enabledModules 解析

```ts
// 在 buildAgentRegistryEntry 中：
const enabledModules = jsonStringArray(config.enabledModules)
```

`jsonStringArray` 复用现有函数（trim + 去重）。未提供时返回 `[]`。

## 3. 宏展开引擎

新建 `apps/platform-web/src/agent-runtime/macro-engine.ts`。

### 3.1 宏语法

```
{{file:相对路径}}              — 无条件引用
{{file:相对路径?enabled}}      — 条件引用（stem 在 enabledModules 中）
{{file:目录/*.md?enabled}}     — 通配引用（展开通配符 + 条件检查）
{{random:A,B,C}}               — 随机选择（从逗号分隔候选中随机选一个）
```

**隐式空白清理**：不提供 `{{trim}}` 显式宏。`expandMacros` 展开完所有宏后自动清理：压缩连续空行为单个、去除首尾空白。

### 3.2 正则解析

三个正则（`{{trim}}` 无显式宏，不需要正则）：

```ts
const FILE_MACRO_PATTERN = /\{\{file:([^}?]+)(\?enabled)?\}\}/g
const RANDOM_MACRO_PATTERN = /\{\{random:([^}]+)\}\}/g
```

`FILE_MACRO_PATTERN` 捕获组 1 = 路径（可能含 `*`），捕获组 2 = 可选 `?enabled` 后缀。
`RANDOM_MACRO_PATTERN` 捕获组 1 = 逗号分隔的候选列表。

### 3.3 展开函数

```ts
interface MacroExpandOptions {
  /** 相对路径的基准目录（被注入文件所在目录，或 agent 目录）。 */
  baseDir: string
  /** workspace 文件 Map。 */
  filesByPath: Map<string, WorkspaceFile>
  /** 启用模块列表。undefined = 全部包含（向后兼容）。 */
  enabledModules: string[] | undefined
}

interface MacroExpandResult {
  /** 展开后的文本。 */
  content: string
  /** 引用但缺失的文件路径（用于 missingContextPaths）。 */
  missing: string[]
}

function expandMacros(text: string, options: MacroExpandOptions): MacroExpandResult
```

展开逻辑：
1. **`{{file:...}}` 展开**：用 `FILE_MACRO_PATTERN` 找到所有文件引用宏
   a. 解析路径：相对于 `baseDir` 拼接，然后 `normalizeWorkspaceFilePath` 校验
   b. 如果路径含 `*`：展开通配符——遍历 `filesByPath`，匹配 glob 模式，得到文件列表
   c. 如果有 `?enabled`：
      - `enabledModules` 为 undefined → 包含（向后兼容）
      - 文件 stem 在 `enabledModules` 中 → 包含
      - 不在 → 跳过（替换为空字符串）
   d. 如果无 `?enabled`：无条件包含
   e. 包含的文件：读取 `.content`，原样插入（不递归展开）
   f. 缺失的文件（路径不含 `*` 且 `filesByPath` 中无）：记录到 `missing`
2. **`{{random:A,B,C}}` 展开**：用 `RANDOM_MACRO_PATTERN` 找到所有随机宏
   a. 解析候选列表：按逗号分割，trim 每个候选，跳过空候选
   b. 从非空候选中随机选一个替换（`Math.random()`）
   c. **缓存警告**：每次展开结果可能不同，该消息会 cache miss
3. **隐式空白清理**：所有宏替换完成后，执行全局清理
   a. 压缩连续 3+ 空行为 2 空行
   b. 去除整体首尾空白
4. 返回展开后的文本 + missing 列表

### 3.4 通配符展开

```ts
function expandGlob(pattern: string, filesByPath: Map<string, WorkspaceFile>): WorkspaceFile[]
```

- 将 glob 模式转为正则：`*.md` → `[^/]*\.md`，`**` 不支持（1 层目录）
- 遍历 `filesByPath`，匹配路径（完整路径，不是相对路径）
- 返回匹配的文件列表，按路径排序

### 3.5 stem 提取

```ts
function fileStem(path: string): string {
  const base = path.split("/").pop() ?? path
  const dotIdx = base.lastIndexOf(".")
  return dotIdx > 0 ? base.slice(0, dotIdx) : base
}
```

`save/agents/storyteller/modules/禁用词表.md` → `禁用词表`

### 3.6 路径解析

```ts
function resolveRelativePath(baseDir: string, relativePath: string): string | null {
  // baseDir 示例: "agents/storyteller" 或 "save/agents/storyteller"
  // relativePath 示例: "modules/禁用词表.md"
  // 拼接后 normalizeWorkspaceFilePath 校验
  const joined = `${baseDir}/${relativePath}`
  return normalizeWorkspaceFilePath(joined)
}
```

注意：`normalizeWorkspaceFilePath` 拒绝 `.`/`..` 段（context.ts:49）。相对路径解析时需要先拼接再校验。如果用户在 `{{file:...}}` 里写了 `../` 会被拒绝——这是安全约束，防止路径穿越。

## 4. Context 组装变更

### 4.1 assembleAgentContext 改造

`context.ts` 的 `assembleAgentContext` 中，contextPaths 解析从"直接查找文件"改为"编译注入条目"：

```ts
// 替代现有 lines 115-127
const contextInjections: ContextInjection[] = []
const missingContextPaths: string[] = []

for (const entry of agent.contextPaths) {
  // 1. 解析条目形式
  let rawContent: string
  let role: "system" | "user" | "assistant"
  let source: string
  let baseDir: string

  if (typeof entry === "string") {
    // 纯字符串：读文件，role=user
    const path = normalizeWorkspaceFilePath(entry)
    const file = path ? filesByPath.get(path) : undefined
    if (!file) {
      missingContextPaths.push(path ?? entry)
      continue
    }
    rawContent = file.content
    role = "user"
    source = file.path
    baseDir = path!.includes("/") ? path!.slice(0, path!.lastIndexOf("/")) : ""
  } else if (entry.path) {
    // path 对象：读文件，role 可指定
    const path = normalizeWorkspaceFilePath(entry.path)
    const file = path ? filesByPath.get(path) : undefined
    if (!file) {
      missingContextPaths.push(path ?? entry.path)
      continue
    }
    rawContent = file.content
    role = entry.role ?? "user"
    source = file.path
    baseDir = path!.includes("/") ? path!.slice(0, path!.lastIndexOf("/")) : ""
  } else if (entry.template) {
    // template 对象：内联模板，role 可指定
    rawContent = entry.template
    role = entry.role ?? "user"
    source = "inline template"
    baseDir = agentDirectory ?? ""
  } else {
    continue
  }

  // 2. 展开宏
  const expanded = expandMacros(rawContent, {
    baseDir,
    filesByPath,
    enabledModules: agent.enabledModules.length > 0 ? agent.enabledModules : undefined,
  })
  missingContextPaths.push(...expanded.missing)

  // 3. 空内容跳过
  const content = expanded.content.trim()
  if (!content) continue

  contextInjections.push({ role, content, source })
}
```

**关键设计点**：
- `enabledModules` 为空数组时传 `undefined` 给 `expandMacros`——`?enabled` 条件默认包含（向后兼容）
- `baseDir` 从文件路径推导（去掉文件名部分），template 对象用 agent 目录
- 空内容（trim 后为空）跳过，不注入空消息

### 4.2 AgentContextEntry 返回值

```ts
const entry: AgentContextEntry = {
  agent,
  agentFile,
  skillIndex: ...,
  toolIndex,
  contextInjections,    // 替代 contextFiles
  knowledgeFiles,
  missingContextPaths,
}
```

## 5. Index 消息构建变更

### 5.1 buildAgentContextMessages_split 改造

`index.ts` 的 `buildAgentContextMessages_split` 从遍历 `contextFiles` 改为遍历 `contextInjections`：

```ts
function buildAgentContextMessages_split(
  context: AgentContextEntry,
  label: "Workspace Agent 上下文" | "目标 Agent 上下文",
): RuntimeChatMessage[] {
  const messages: RuntimeChatMessage[] = [
    { role: "user", content: `${label}（元信息）：\n${formatAgentRuntimeContextMeta(context)}` },
  ]
  for (const injection of context.contextInjections) {
    messages.push({
      role: injection.role,
      content: `Workspace 注入 ${injection.source}：\n${injection.content}`,
    })
  }
  return messages
}
```

**变化**：
- 消息 role 从固定 `"user"` 改为 `injection.role`（支持 system/user/assistant）
- 消息前缀从 `"Workspace 文件 <path>："` 改为 `"Workspace 注入 <source>："`（兼容 inline template 来源）
- `RuntimeChatMessage` 的 role 类型需确认是否支持 "system"（当前 `buildAgentContextMessages_split` 返回 `{role: "user"}[]`，需改为 `RuntimeChatMessage[]`）

### 5.2 RuntimeChatMessage role 类型

检查 `RuntimeChatMessage` 是否已支持 `system`/`assistant`。根据 `buildEntryAgentMessages` 的返回类型 `RuntimeChatMessage[]` 和其内部已构造 `system`/`assistant` 消息来看，类型应该已支持。需确认 `buildAgentContextMessages_split` 的返回类型从 `{role: "user"}[]` 放宽为 `RuntimeChatMessage[]`。

### 5.3 formatAgentRuntimeContextMeta 调整

meta 信息中 `contextFiles` 路径列表改为 `contextInjections` 来源列表：

```ts
// 现有：contextFiles 路径列表
// 改为：contextInjections 来源列表
const injectionSources = context.contextInjections.map((inj) => inj.source)
```

### 5.4 缓存策略

- **纯字符串条目**（无宏、role=user）：行为与现有完全一致——一条 user 消息，前缀缓存命中不变
- **path 对象条目**（有宏展开、role 可指定）：编译后一条消息。如果引用的文件稳定（非 enabledModules 控制），内容跨轮不变，仍能缓存命中
- **template + ?enabled 条目**：内容随 enabledModules 变化。enabledModules 变化时该消息 miss，但不影响它前面消息的缓存
- **关键不变量**：消息顺序仍按 contextPaths 声明顺序，不重排。稳定条目自然在前缀区，动态条目在尾部

## 6. 兼容性

### 6.1 现有 agent.json 兼容

现有 `contextPaths: ["path1", "path2"]`（纯字符串数组）：
- `parseContextPathEntries` 接受纯字符串 → 不变
- `assembleAgentContext` 纯字符串分支：读文件、role=user、展开宏（但现有文件无 `{{file:...}}`，展开后内容不变）
- 行为与现有完全一致

### 6.2 enabledModules 未提供

`enabledModules` 默认 `[]`。`assembleAgentContext` 中 `[]` 转为 `undefined` 传给 `expandMacros`。`?enabled` 条件在 `undefined` 时默认包含。

### 6.3 现有 contextFiles 消费者

搜索 `contextFiles` 的所有使用点，改为 `contextInjections`：
- `index.ts` 的 `buildAgentContextMessages_split`（主要消费点）
- `index.ts` 的 `formatAgentRuntimeContextMeta`（meta 信息）
- 其他引用点需排查

### 6.4 local-assistant-files.ts 验证

`local-assistant-files.ts:726` 验证 `contextPaths must be an array of strings`。需放宽为接受对象形式。新增 `enabledModules` 验证（可选 string[]）。

## 7. 宏引擎边界情况

| 情况 | 处理 |
|---|---|
| `{{file:不存在的文件.md}}` | 替换为空，记录到 missing |
| `{{file:不存在的文件.md?enabled}}` | 替换为空，不记录到 missing（条件不满足，不算缺失） |
| `{{file:目录/*.md?enabled}}` 匹配 0 个文件 | 替换为空，不记录到 missing |
| `{{file:目录/*.md}}` 匹配 0 个文件 | 替换为空，不记录到 missing（通配无匹配不算缺失） |
| `{{random:}}` 空候选列表 | 原样保留（正则不匹配） |
| `{{random:A}}` 只有一个候选 | 替换为 A（无随机性但合法） |
| `{{random:A,,C}}` 候选含空值 | 跳过空候选，从非空中选 |
| 文件内容里有 `{{` 但不匹配任何宏格式 | 原样保留，不替换 |
| `{{file:}}` 空路径 | 原样保留（正则不匹配） |
| `{{FILE:路径}}` 大写 | 不匹配（大小写敏感） |
| template 对象里没有任何宏 | 原样注入（普通文本模板） |
| 纯字符串条目的文件内容含宏 | 展开宏（统一行为） |

## 8. 不做的事

- 不做 `{{lastusermessage}}`、`{{user}}`、`{{personality}}`、`{{scenario}}` 等酒馆角色卡宏（Tsian 通过其它通道注入这些数据）
- 不做 setvar/getvar 两阶段变量模型
- 不做宏展开深度 >1 的递归
- 不做 `**` 递归通配（只支持单层 `*`）
- 不做前端 UI（玩家可选规则模块选择面板）
- 不做委派 Agent 的 injection 通道
- 不做消息序列可配置化（独立后续任务）

## 9. 验证策略

- contracts build：`AgentConfig`/`AgentRegistryEntry`/`AgentContextEntry` 类型变更后编译通过
- platform-web build：context.ts/registry.ts/index.ts/macro-engine.ts 改动后编译通过
- 向后兼容：现有 `workspace-templates.ts` 中的 agent.json（纯字符串 contextPaths）不需修改
- 宏展开单元测试（如有测试框架）：`{{file:...}}`、`?enabled`、`*.md` 通配、缺失文件、空内容跳过
