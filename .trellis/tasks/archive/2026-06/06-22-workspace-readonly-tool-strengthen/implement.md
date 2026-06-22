# Implement: Workspace Read-Only Tool Strengthening

## 执行顺序总览

```
Step 1 契约 → Step 2 read 实现 → Step 3 search 实现 → Step 4 入口透传
→ Step 5 schema + trace → Step 6 SDK 同步(read 验证 + search 签名升级 + 补 glob) → Step 7 prompt → Step 8 构建验证
```

每步独立可验证。Step 1-4 是核心逻辑,5-7 是接入层,8 是质量门。Step 6 含三子项(6a/6b/6c),6a 仅验证,6b/6c 有代码改动。

## Step 1: 契约改动(`packages/contracts/src/runtime.ts`)

- [ ] `WorkspaceOperationRequest`(L106-119)加 `offset?: number`、`contextLines?: number`、`ignoreCase?: boolean`(`pattern?` 已在 L112,不动)。
- [ ] 新增 `WorkspaceSearchMatch` 接口(`lineNumber/line/contextBefore/contextAfter/match`)。
- [ ] `WorkspaceSearchResult`(L286-292)加 `matches: WorkspaceSearchMatch[]`、`matchesTruncated: boolean`(`preview` 保留)。
- [ ] 新增 `WorkspaceReadResult` 接口(`extends WorkspaceFile` 加 `totalLines?/returnedLines?/offset?/truncated?/isBinaryPlaceholder?`,或独立类型——实现时按 design tradeoff 选 extends)。
- [ ] 验证:`cd packages/contracts && npm run build`(`tsc -p tsconfig.json`),确认契约文件自身类型无误。

**Review gate**:契约是跨包公共接口,改完先 review 字段命名和可选性是否合理,再往下走。

## Step 2: read 实现(`workspace-operations.ts`)

- [ ] 加常量 `DEFAULT_READ_LIMIT = 2000`、`MAX_READ_LIMIT = 5000`。
- [ ] 加 `normalizeReadOffset(value): number`(默认 1,最小 1,非有限数回退默认)。
- [ ] 加 `normalizeReadLimit(value): number`(默认 2000,最小 1,上限 5000,仿 `normalizeSearchLimit` L243-249)。
- [ ] 改 `readWorkspaceFile`(L527-545)签名加 `options: { offset?: number; limit?: number }`,返回 `WorkspaceReadResult`。
- [ ] 实现四种路径:binary 文件(不切片 + isBinaryPlaceholder)、文本未传 offset/limit(全量 + 元数据)、文本传 offset/limit(切片)、offset 超出(空 content + truncated:false)。
- [ ] 保留现有 `WORKSPACE_FILE_NOT_FOUND` 抛错和 `assertReadAccess` 权限校验不动。

**验证**:单测或手动构造 `WorkspaceFile[]` 调 `executeWorkspaceOperation({operation:"read",scope,path,offset,limit})`,确认切片 content 和元数据正确。

## Step 3: search 实现(`workspace-operations.ts`)

- [ ] 加常量 `MAX_MATCHES_PER_FILE = 50`。
- [ ] 改 `searchWorkspaceFiles`(L547-599):
  - [ ] query/pattern 互斥校验(都传抛 `WORKSPACE_QUERY_PATTERN_MUTEX`)。
  - [ ] ignoreCase 默认值:query 模式 true、pattern 模式 false。
  - [ ] pattern 正则编译(`RegExp(pattern, ignoreCase?"i":"")`),失败抛 `WORKSPACE_PATTERN_INVALID`。
  - [ ] 行级匹配:`lines = content.split("\n")`,query 用行级子串、pattern 用 `regex.test(line)`。
  - [ ] 路径匹配打分保留(score=2 路径、1 内容,可叠加)。
  - [ ] `buildSearchMatches` helper:返回 `WorkspaceSearchMatch[]`,含 lineNumber/line/contextBefore/contextAfter/match。
  - [ ] 每文件命中截断到 50 + `matchesTruncated` 标志。
  - [ ] binary 文件:跳过内容匹配,`matches: []`。
  - [ ] `preview` 兼容字段:首个命中简短 preview(复用 `createPreview` L256-266 或行级简版),无命中填 `file.path`。
  - [ ] 排序 + slice(limit) 保持现状逻辑。
- [ ] 删除旧的整 content `indexOf` 单 preview 逻辑(L576-590 旧 contentIndex 分支)。

**验证**:构造含多行命中、跨行子串、正则元字符 query、binary 文件的测试用例,确认命中文件集、行号、上下文、截断标志、ignoreCase 默认值符合 design。

## Step 4: 入口透传(`workspace-operations.ts` L996-999)

- [ ] `readWorkspaceFile` 调用(L999)加 `requestInput.offset/limit` 透传:`readWorkspaceFile(files, scope, path, level, { offset: requestInput.offset, limit: requestInput.limit })`。
- [ ] 确认 `searchWorkspaceFiles` 调用(L996)传整个 `requestInput`——offset/limit/contextLines/ignoreCase/pattern 已在 input,`searchWorkspaceFiles` 内部直接读。确认 `requestInput` 类型含新字段(Step 1 已加)。
- [ ] 确认 `executeWorkspaceOperation` 的 `requestInput` 从 `normalizeWorkspaceOperationRequest` 解析时新字段透传(检查 L195-210 `normalizeWorkspaceOperationName` 附近是否有字段白名单过滤——若有需加新字段)。

**验证**:`grep -n "requestInput\." workspace-operations.ts` 确认新字段透传链路无遗漏。

## Step 5: schema + trace(`tool-schemas.ts` + `workspace-tools.ts`)

- [ ] `workspaceReadSchema`(tool-schemas.ts L128-147)加 `offset/limit` 参数声明,description 补切片元数据说明。
- [ ] `workspaceSearchSchema`(L170-193)加 `pattern/contextLines/ignoreCase` 参数声明,`required` 从 `["scope","query"]` 改为 `["scope"]`,description 改为"query 子串或 pattern 正则二选一"。
- [ ] `emitWorkspaceToolTrace`(workspace-tools.ts L356-399)加 `pattern/contextLines/ignoreCase/offset` 到 trace data(仿现有 query/limit 模式 L377-383)。
- [ ] `summarizeWorkspaceReadResult`(L344-354)加 `offset/totalLines/returnedLines/truncated/isBinaryPlaceholder`。
- [ ] `countResultItems`(L338-342)对 search 仍返回 `result.length`(数组长度=文件数,不变);可考虑加 totalMatches 但非必需。

**验证**:确认 schema 的 `buildEnabledToolSchemas`(L327-368)仍正常拼装,`workspaceReadSchema`/`workspaceSearchSchema` 都在 canReadWorkspace 分支(L349-356)。

## Step 6: SDK 同步(`browser-skill-script-executor.ts` L170-198)

SDK `tsian.workspace` 对象当前停留在顶层工具第一次改动后状态,本步同步三项。

### 6a: read 透传 offset/limit(验证,预期无代码改动)

- [ ] 确认 `tsian.workspace.read`(L172)`rpc("workspace.read", typeof input === "string" ? {scope,path} : input)`——object 形式已透传 offset/limit。
- [ ] 确认 `handleSdkRequest`(L448-485)把 args 透传给 `executeWorkspaceOperation` 时新字段在内(`...args` 展开,新字段自然透传)。
- [ ] 若透传链路无遗漏,标注"6a 验证确认,无代码改动"。

### 6b: search 签名升级(有代码改动)

- [ ] 改 `tsian.workspace.search`(L177-178)为 `search(queryOrInput, limit)`,内部 `isRecord(queryOrInput) ? queryOrInput : { scope: "effective", query: queryOrInput, limit }` 后 `rpc("workspace.search", input)`。
- [ ] 验证位置参数 `search("关键词", 10)` 仍工作(向后兼容)。
- [ ] 验证 object 形式 `search({scope, pattern, contextLines, ignoreCase, limit})` 透传完整。

### 6c: 新增 `tsian.workspace.glob` 方法(有代码改动)

- [ ] 在 `workspace` 对象(L170-198)加 `glob(input)` 方法:`rpc("workspace.glob", typeof input === "string" ? { scope: "effective", pattern: input } : input)`。
- [ ] 验证 `handleSdkRequest` 的 method 路由无白名单过滤(确认 `workspace.glob` 能路由到 `executeWorkspaceOperation({operation:"glob",...})`)——若有 method 白名单需加 `"workspace.glob"`。
- [ ] 验证 string 简写 `glob("**/agent.json")` 和 object 形式 `glob({scope, pattern, limit})` 都工作。

**验证**:6a 预期无改动;6b/6c 改完读 `browser-skill-script-executor.ts` L170-200 确认三个方法(read/search/glob)形态正确,`handleSdkRequest` 路由 `workspace.glob` 通畅。

## Step 7: prompt(`index.ts:727-734`)

- [ ] read 示例加 offset/limit 用法:`- read arguments={"scope":"effective","path":"save/history/timeline.md","offset":1,"limit":200}`。
- [ ] search 示例加 pattern 用法:`- search arguments={"scope":"effective","pattern":"\"state\":\\s*\\{","contextLines":2}`。
- [ ] 说明文字补一句:read 长文件用 offset/limit 分段(返回 totalLines/truncated);search 支持 query 子串或 pattern 正则,返回每命中行号和上下文;ignoreCase 对 query 默认 true、pattern 默认 false。

**验证**:读 `index.ts` L720-760 确认 `availableTools` 数组和说明文字更新,且 `canReadWorkspace` 分支(L727-734)包含新示例。

## Step 8: 构建验证

- [ ] `cd apps/platform-web && npm run build`(含 `vue-tsc -b` 类型检查 + `vite build`)。
- [ ] 类型检查通过(contracts 改动 + agent-runtime 改动 + SDK + prompt 类型一致)。
- [ ] 构建产物生成无报错。

**验证命令**:
```bash
cd apps/platform-web && npm run build
```

## 回滚点

- 每个 Step 是独立回滚点:Step 1 契约改动若类型冲突,回退 Step 1 重新设计字段。
- Step 2/3 实现若行为不符,git checkout 对应函数。
- Step 8 构建失败时,按报错定位到具体 Step 回退。
- 全量回滚:`git checkout packages/contracts/src/runtime.ts apps/platform-web/src/agent-runtime/workspace-operations.ts apps/platform-web/src/agent-runtime/tool-schemas.ts apps/platform-web/src/agent-runtime/workspace-tools.ts apps/platform-web/src/agent-runtime/index.ts apps/platform-web/src/platform-host/browser-skill-script-executor.ts`。纯增量改动无数据迁移,回滚无风险。

## 与 storage volume 任务的协调

- `06-21-workspace-storage-volume-abstraction` 在 in_progress,改同一文件 `workspace-operations.ts` 的 host 路由层和 scope 定义区。
- 本任务改 `workspace-operations.ts` 的 read/search 计算函数(L527-599)和入口(L996-999),与 storage 任务的 dispatch 改动不重叠。
- 若 storage 任务先合入:本任务 rebase,确认 `DEFAULT_SCOPE_ACCESS`/scope 定义无冲突(read/search 不依赖 scope 定义新增,只依赖 `scopedReadableFiles`/`findScopedFile` 已有 helper)。
- 若本任务先合入:storage 任务 rebase,确认其 dispatch 改动不影响 read/search 函数签名。
- 执行顺序无硬依赖,可并行。建议本任务在 storage 任务 review 后再 start,避免同文件并发合并冲突(虽低风险)。

## 已知行为变化(写进 spec / journal)

- search 的 query 模式从"整 content indexOf 单 preview"改为"行级子串多命中":跨行子串不再命中(AIRP 文本搜索极少跨行,影响可忽略);命中文件集对行内子串一致。
- read 不传 offset/limit 时返回类型从 `WorkspaceFile` 变为 `WorkspaceReadResult`(超集,加可选切片元数据字段):旧消费方读 path/content/updatedAt 不破,新消费方多得 totalLines/returnedLines/offset/truncated。
- search 返回加 `matches/matchesTruncated` 字段 + 保留 `preview`:旧消费方读 preview 不破,新消费方读 matches。
- SDK `tsian.workspace.search` 签名从 `(query, limit)` 扩为 `(queryOrInput, limit)`(object 优先 + 位置参数兼容):现有 skill 脚本的位置参数调用不破,新脚本可用 object 传 pattern/contextLines/ignoreCase。SDK 新增 `tsian.workspace.glob` 方法是纯新增能力,无破坏。
