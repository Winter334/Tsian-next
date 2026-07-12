# 规则拼接系统：增强 contextPaths 支持角色控制与宏变量

## Goal

增强当前 `contextPaths` 机制，使其从"一个文件 = 一条 user 消息"的粗粒度注入，进化为支持 **role 控制**、**宏变量语法**（引用其它 workspace 文件内容拼接）、**条件包含**（按启用列表决定是否注入）的灵活注入系统。让规则模块可以像酒馆预设那样自由组合拼装，为"玩家可选规则模块"产品特性打下架构基础。

## Background

### 现状

当前 `contextPaths: string[]`（`AgentConfig` contracts line 444）是一条扁平的 workspace 路径数组。每条路径在 `assembleAgentContext`（`context.ts:115-127`）中被解析为一个 `WorkspaceFile`，然后在 `buildAgentContextMessages_split`（`index.ts:695-709`）中变成**一条独立的 `user` 消息**。

局限：
- **角色固定**：所有 contextPath 文件都注入为 `user` 消息，无法指定 `system`/`assistant` 等角色
- **粒度太粗**：一个文件独占一条消息，无法把多个文件/片段拼接成一条消息
- **无宏变量**：文件内容原样注入，不能引用其它 workspace 文件的内容
- **无条件组合**：不能根据条件选择注入哪些内容

### 酒馆预设的参考机制

酒馆预设通过 `{{setvar}}` / `{{getvar}}` 两阶段编译实现规则拼装：
- 阶段 1（setvar）：各开关条目独立设置变量（内容片段），131 个唯一变量
- 阶段 2（getvar）：模板条目用变量组装最终消息（拼接），104 个变量被消费
- 空变量替换后消失（不占位）——实现"可选拼装"
- 多选一靠同变量覆盖 + prompt_order 顺序实现

**酒馆预设无递归引用**：setvar 的值里不含 getvar（0 例嵌套）。所有 getvar 在对应 setvar 之后执行。1 层展开不递归完全覆盖酒馆实际用法。

### Tsian 的适配设计

Tsian 不需要 setvar/getvar 两阶段模型。用更直接的方式实现同样效果：
- **宏变量写在文件内容里**（不在 agent.json）：被 contextPaths 引用的文件内容中可写 `{{file:路径}}` 宏
- **runtime 展开宏**：读取被引用文件内容，替换 `{{file:...}}` 为对应文件内容
- **1 层展开不递归**：被 `{{file:...}}` 引用的文件内容原样插入，不展开其中的宏
- **条件包含**：`{{file:路径?enabled}}` 检查文件是否在 `enabledModules` 列表中，不在则跳过
- **通配引用**：`{{file:dir/*.md?enabled}}` 批量引用目录下文件，逐个检查 enabled 状态

### 已确认事实

- Tsian **无任何现有模板/宏/变量替换机制**（全量搜索确认）
- `buildAgentContextMessages_split` 的"一个文件一条消息"设计是为了 provider prefix cache 命中率——任何改动需保留或改善此特性
- `contextPaths` 在 `registry.ts:758` 用 `jsonStringArray` 解析，在 `context.ts:115-127` 用 `normalizeWorkspaceFilePath` 校验后从 `filesByPath` 查找
- `AgentConfig` 定义在 `packages/contracts/src/runtime.ts:439-474`
- `WorkspaceFile` 定义在 `packages/contracts/src/runtime.ts:234-250`，`filesByPath` 是 `Map<string, WorkspaceFile>`
- 委派 Agent（`buildDelegatedAgentMessages`）也使用 contextPaths，但无 injection 通道

## Requirements

### R1: contextPaths 扩展为支持对象形式

`contextPaths` 从 `string[]` 扩展为 `(string | object)[]`：
- **纯字符串** `"path"`：一条 user 消息，一个文件，内容展开宏
- **path 对象** `{path, role}`：一个文件，指定注入角色，内容展开宏
- **template 对象** `{template, role}`：内联模板字符串（非文件路径），展开宏后注入

### R2: 宏变量语法

在被注入文件内容或 template 字符串中支持以下宏：

**文件引用** `{{file:路径}}`：
- `{{file:禁用词表.md}}` — 无条件引用，读取文件内容替换
- `{{file:禁用词表.md?enabled}}` — 条件引用，文件在 enabledModules 列表中才包含
- `{{file:文风/*.md?enabled}}` — 通配引用，展开通配符为文件列表，逐个检查 enabled
- **展开深度 1 层**：被引用的文件内容原样插入，不递归展开其中的宏
- **路径解析**：相对路径相对于**被注入文件所在目录**；template 对象的相对路径相对于该 agent 目录（`agents/<id>/`）。`{{file:...}}` 中的路径需经过 `normalizeWorkspaceFilePath` 校验

**随机选择** `{{random:A,B,C}}`：
- 从逗号分隔的候选列表中随机选一个替换
- **缓存警告**：每次展开结果可能不同，会导致该消息 prefix cache miss。应避免在稳定常驻文件中使用，仅在按需/低频注入的文件中使用

**空白清理**（隐式，无显式宏）：
- `expandMacros` 展开完所有宏后自动清理：压缩连续空行为单个、去除首尾空白
- 不提供 `{{trim}}` 显式宏——避免使用者忘记写导致空行残留，自动清理更可靠

### R3: 条件包含与 enabledModules

- `AgentConfig` 新增 `enabledModules?: string[]` 字段
- `enabledModules` 列出当前启用的模块名（文件名 stem，不含路径和扩展名）
- `?enabled` 条件：文件 stem 在 `enabledModules` 列表中才包含，否则跳过（替换为空）
- "多选一"是前端软限制——数据层只管"哪些启用了"，同组互斥由前端 UI 保证
- "独立开关"和"多选一"在数据层统一为同一个 `string[]`，不区分

### R4: role 控制

- 对象形式条目可指定 `role: "system" | "user" | "assistant"`
- 纯字符串条目保持默认 `user` 角色（向后兼容）
- 编译后内容为空的条目跳过（不注入空消息）

### R5: 向后兼容

- 现有 `contextPaths: string[]` 格式必须继续原样工作
- 纯字符串条目行为不变：一条 user 消息，一个文件（但内容会展开宏——之前无宏概念，不存在误解析风险）
- 现有 agent.json 不需要修改即可继续工作
- `enabledModules` 为可选字段，未提供时 `?enabled` 条件默认为"包含"（向后兼容）

### R6: 缓存友好

- 纯字符串条目保持现有"一文件一消息"split 行为（缓存命中不变）
- 对象/template 条目编译后作为一条消息注入（合并内容，按 role 放置）
- 稳定的 template 条目（引用的文件不常变）仍能缓存命中
- 动态的 template 条目（引用 enabledModules 控制的文件）单独 miss
- `{{random}}` 宏会导致该消息每轮 cache miss——文档警告，由使用者权衡

### R7: contracts 类型变更

- `AgentConfig.contextPaths` 类型从 `string[]` 扩展为 `ContextPathEntry[]`
- 新增 `ContextPathEntry` 联合类型：`string | { path: string; role?: MessageRole } | { template: string; role?: MessageRole }`
- `AgentConfig` 新增 `enabledModules?: string[]`
- `AgentRegistryEntry` 同步更新

## Acceptance Criteria

- [ ] `AgentConfig.contextPaths` 支持 `(string | {path, role} | {template, role})[]`，纯字符串向后兼容
- [ ] `AgentConfig.enabledModules?: string[]` 新字段，可选
- [ ] `{{file:路径}}` 无条件引用：读取文件内容替换宏
- [ ] `{{file:路径?enabled}}` 条件引用：文件 stem 在 enabledModules 中才包含
- [ ] `{{file:dir/*.md?enabled}}` 通配引用：展开通配符，逐个检查 enabled
- [ ] `{{random:A,B,C}}` 随机选择：从候选列表随机选一个替换
- [ ] 隐式空白清理：展开完所有宏后自动压缩连续空行、去除首尾空白
- [ ] 展开深度 1 层不递归：被引用文件内容原样插入
- [ ] 对象条目 `{path, role}` 支持指定注入角色（system/user/assistant）
- [ ] 编译后内容为空的条目跳过（不注入空消息）
- [ ] 现有 agent.json（纯字符串 contextPaths）不需修改即可继续工作
- [ ] `enabledModules` 未提供时 `?enabled` 默认为"包含"
- [ ] `packages/contracts` build 通过
- [ ] `apps/platform-web` build 通过

## Out of Scope

- 玩家可选规则模块的前端 UI 和持久化逻辑（独立后续任务，本任务只做 runtime/contracts 层的宏展开和注入能力）
- 消息序列可配置化（当前 `buildEntryAgentMessages` 的消息顺序是硬编码的，未来可升级为可配置——独立后续任务）
- 文风系统（独立后续任务）
- 酒馆预设 JSON 直接导入（不做 SillyTavern 宏引擎全适配）
- 委派 Agent 的 injection 通道（当前仅 entry agent 有 injection）
- `{{lastusermessage}}`、`{{user}}`、`{{personality}}`、`{{scenario}}` 等酒馆角色卡宏（Tsian 通过其它通道注入这些数据）
- setvar/getvar 两阶段变量模型（用一阶段 `{{file:...}}` 替代）

## Open Questions

（当前无阻塞问题，设计已确认）
