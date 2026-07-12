# Implement: 规则拼接系统

## 执行清单

### Step 1: Contracts 类型变更
- [ ] `packages/contracts/src/runtime.ts`：新增 `ContextPathObject` interface + `ContextPathEntry` 联合类型
- [ ] `AgentConfig.contextPaths` 类型从 `string[]` 改为 `ContextPathEntry[]`
- [ ] `AgentConfig` 新增 `enabledModules?: string[]`
- [ ] `AgentRegistryEntry.contextPaths` 类型同步改为 `ContextPathEntry[]`
- [ ] `AgentRegistryEntry` 新增 `enabledModules: string[]`
- [ ] 新增 `ContextInjection` interface（role + content + source）
- [ ] `AgentContextEntry`：`contextFiles: WorkspaceFile[]` 改为 `contextInjections: ContextInjection[]`
- [ ] 验证：`npm run build:contracts`（或 `cd packages/contracts && npx tsc --noEmit`）

### Step 2: 宏展开引擎
- [ ] 新建 `apps/platform-web/src/agent-runtime/macro-engine.ts`
- [ ] 实现 `FILE_MACRO_PATTERN`、`RANDOM_MACRO_PATTERN` 两个正则（`{{trim}}` 无显式宏）
- [ ] 实现 `fileStem(path)` 函数
- [ ] 实现 `resolveRelativePath(baseDir, relativePath)` 函数
- [ ] 实现 `expandGlob(pattern, filesByPath)` 函数
- [ ] 实现 `expandMacros(text, options)` 函数（返回 `{content, missing}`）
- [ ] `{{file:...}}` 展开：路径解析、通配、`?enabled` 条件检查、原样插入不递归
- [ ] `{{random:A,B,C}}` 展开：逗号分割候选、跳过空候选、随机选一个
- [ ] 隐式空白清理：展开完所有宏后自动压缩连续空行、去除首尾空白
- [ ] 处理边界情况：空路径、缺失文件、通配零匹配、`?enabled` 条件、`enabledModules=undefined` 默认包含、random 空候选、random 单候选
- [ ] 验证：`npx tsc --noEmit -p apps/platform-web/tsconfig.json`

### Step 3: Registry 解析变更
- [ ] `apps/platform-web/src/agent-runtime/registry.ts`：新增 `parseContextPathEntries(value)` 函数
- [ ] `buildAgentRegistryEntry`：`contextPaths: jsonStringArray(...)` 改为 `contextPaths: parseContextPathEntries(...)`
- [ ] `buildAgentRegistryEntry`：新增 `enabledModules: jsonStringArray(config.enabledModules)`
- [ ] 验证：`npx tsc --noEmit -p apps/platform-web/tsconfig.json`

### Step 4: Context 组装变更
- [ ] `apps/platform-web/src/agent-runtime/context.ts`：import `ContextInjection`、`expandMacros`
- [ ] `assembleAgentContext`：替换 lines 115-127 的 contextFiles 循环为 contextInjections 编译逻辑
- [ ] 纯字符串分支：读文件 → role=user → baseDir 从路径推导 → expandMacros → 空内容跳过
- [ ] path 对象分支：读文件 → role=entry.role ?? user → expandMacros → 空内容跳过
- [ ] template 对象分支：rawContent=template → role=entry.role ?? user → baseDir=agentDirectory → expandMacros → 空内容跳过
- [ ] `AgentContextEntry` 返回值：`contextFiles` 改为 `contextInjections`
- [ ] 验证：`npx tsc --noEmit -p apps/platform-web/tsconfig.json`

### Step 5: Index 消息构建变更
- [ ] `apps/platform-web/src/agent-runtime/index.ts`：`buildAgentContextMessages_split` 返回类型从 `{role:"user"}[]` 放宽为 `RuntimeChatMessage[]`
- [ ] 遍历 `context.contextInjections` 替代 `context.contextFiles`
- [ ] 消息 role 用 `injection.role`
- [ ] 消息前缀改为 `Workspace 注入 ${injection.source}：`
- [ ] `formatAgentRuntimeContextMeta`：contextFiles 路径列表改为 contextInjections 来源列表
- [ ] 排查其他 `contextFiles` 引用点，全部改为 `contextInjections`
- [ ] 验证：`npx tsc --noEmit -p apps/platform-web/tsconfig.json`

### Step 6: 兼容性修复
- [ ] `apps/platform-web/src/storage/local-assistant-files.ts`：放宽 contextPaths 验证（接受对象形式）+ 新增 enabledModules 验证
- [ ] 搜索全代码库 `contextFiles` 引用，确认无遗漏
- [ ] 搜索全代码库 `.contextPaths` 类型引用，确认无遗漏

### Step 7: Build 验证
- [ ] `cd packages/contracts && npx tsc --noEmit`
- [ ] `cd apps/platform-web && npm run build`
- [ ] 确认无 type error

## 验证命令

```bash
# Contracts 编译
cd packages/contracts && npx tsc --noEmit

# Platform-web typecheck
npx tsc --noEmit -p apps/platform-web/tsconfig.json

# Platform-web build
cd apps/platform-web && npm run build
```

## 风险文件

| 文件 | 风险 | 回滚点 |
|---|---|---|
| `packages/contracts/src/runtime.ts` | AgentConfig/AgentRegistryEntry/AgentContextEntry 类型变更影响所有消费者 | Step 1 完成后立即 typecheck，及早发现消费端断裂 |
| `apps/platform-web/src/agent-runtime/context.ts` | contextFiles→contextInjections 是破坏性改动 | Step 4 完成后 typecheck，Step 5 跟进修复 index.ts |
| `apps/platform-web/src/agent-runtime/index.ts` | buildAgentContextMessages_split 改动影响消息序列 | Step 5 完成后 build 验证 |

## 后续检查

- [ ] 确认现有 `workspace-templates.ts` 中所有 agent.json 的 contextPaths 仍为纯字符串（向后兼容验证）
- [ ] 确认 `buildDelegatedAgentMessages` 中的 `buildAgentContextMessages_split` 调用正常工作
- [ ] 确认 `locateHistorySpan` 和 `locateTaskInteractionSpan` 的边界锚定不被新消息 role 破坏
