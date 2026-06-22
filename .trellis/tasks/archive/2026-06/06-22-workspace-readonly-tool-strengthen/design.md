# Design: Workspace Read-Only Tool Strengthening

## Boundaries

改三处:
- **contracts** `packages/contracts/src/runtime.ts`:扩 `WorkspaceOperationRequest` 字段、升级 `WorkspaceSearchResult`、新增 read 切片返回类型。
- **agent-runtime 计算** `apps/platform-web/src/agent-runtime/workspace-operations.ts`:`readWorkspaceFile`/`searchWorkspaceFiles` 实现 + 辅助 helper。
- **agent-runtime 工具层** `apps/platform-web/src/agent-runtime/tool-schemas.ts` + `workspace-tools.ts`:schema 参数声明 + trace summarize 适配新返回形态。
- **SDK** `apps/platform-web/src/platform-host/browser-skill-script-executor.ts`:read 透传 offset/limit(验证)、search 签名升级(object 优先 + 位置参数兼容)、新增 `tsian.workspace.glob` 方法。
- **prompt** `apps/platform-web/src/agent-runtime/index.ts`:read/search 示例文案。

不改:host 路由层、存储层、scope 路由、权限矩阵、写操作、事务语义。与 `06-21-workspace-storage-volume-abstraction` 正交(该任务改 host 路由 + 存储层)。

## 契约改动(`packages/contracts/src/runtime.ts`)

### `WorkspaceOperationRequest`(L106-119)扩字段

现有 `query?/pattern?/limit?` 已在,新增:

```ts
export interface WorkspaceOperationRequest {
  operation: WorkspaceOperationName
  scope: WorkspaceScope
  path?: string
  targetPath?: string
  query?: string
  pattern?: string
  limit?: number
  // 新增(read 用)
  offset?: number        // 起始行号,1-based,默认 1
  // 新增(search 用)
  contextLines?: number  // 每命中前后上下文行数,默认 0
  ignoreCase?: boolean   // query 默认 true(兼容);pattern 默认 false(正则惯例)
  // 以下不变
  content?: string | Blob
  expectedContent?: string
  validator?: "json" | "frontmatter"
  autoFix?: boolean
}
```

### read 返回:新增 `WorkspaceReadResult`

read 现状返回 `WorkspaceFile`(`runtime.ts:72-85`,含 path/content/binary/createdAt/updatedAt)。为带切片元数据,新增结果类型。**不传 offset/limit 时仍返回完整 `WorkspaceFile`(向后兼容);传了 offset/limit 返回 `WorkspaceReadResult`**——用 discriminated union 或单一类型加可选切片字段。

选 **单一类型加可选切片字段**(更简单,trace 消费方不用做 union 分支):

```ts
export interface WorkspaceReadResult {
  path: string
  /** 切片后的内容(不传 offset/limit 时是完整 content)。 */
  content: string
  /** 二进制 placeholder 标记:binary 文件的 content 是描述串,未切片。 */
  binary?: Blob
  createdAt: number
  updatedAt: number
  // 切片元数据(仅在传了 offset/limit 时有意义;不传时 omitted 或全量标记)
  totalLines?: number
  returnedLines?: number
  offset?: number
  truncated?: boolean
  /** binary 文件标记:content 是 placeholder,offset/limit 未生效。 */
  isBinaryPlaceholder?: boolean
}
```

消费方影响:
- `summarizeWorkspaceReadResult`(`workspace-tools.ts:344-354`)读 `result.path/content/updatedAt`——新类型这些字段都在,不破。可顺带把切片元数据加进 trace summary(offset/totalLines/truncated)。
- 顶层 read 工具返回给 agent 的 observation 是整个 result 对象,agent 能直接读切片元数据。
- `countResultItems`(L338-342)对非数组非 entries record 返回 undefined——read 返回单个对象,resultCount 仍是 undefined,不变。

### search 返回:升级 `WorkspaceSearchResult`(L286-292)

现状:
```ts
export interface WorkspaceSearchResult {
  path: string
  name: string
  updatedAt: number
  score: number
  preview: string
}
```

升级为每文件一条 + 内含命中列表:
```ts
export interface WorkspaceSearchMatch {
  lineNumber: number      // 1-based
  line: string            // 命中行全文
  contextBefore: string[] // 前 contextLines 行(不含命中行)
  contextAfter: string[]  // 后 contextLines 行(不含命中行)
  /** pattern 模式下的匹配子串;query 模式下是命中的 query 子串。 */
  match: string
}

export interface WorkspaceSearchResult {
  path: string
  name: string
  updatedAt: number
  score: number               // 保留路径匹配打分(2=路径命中,0=仅内容)
  matches: WorkspaceSearchMatch[]
  /** 该文件命中数是否被截断(超过每文件命中上限)。 */
  matchesTruncated: boolean
  /** 兼容字段:首个命中的 preview 片段(供旧消费方/trace 用),新消费方用 matches。 */
  preview: string
}
```

保留 `preview` 字段(填首个命中的简短 preview)是为了让 `summarizeWorkspaceReadResult` 之外的潜在旧消费方(trace、debug UI)不立刻崩;新消费方应读 `matches`。生态早期,此兼容字段可在后续任务移除。

消费方影响:
- `countResultItems`(L338-342)对数组返回 `result.length`——search 仍返回数组,文件数不变,不破。
- trace 的 `emitWorkspaceToolTrace`(L356-399)读 `call.arguments.query/limit`——要加 `pattern/contextLines/ignoreCase` 到 trace data。

## 实现改动(`workspace-operations.ts`)

### read:`readWorkspaceFile`(L527-545)

当前签名 `(files, scope, pathInput, actorLevel) → WorkspaceFile`。扩为接收 offset/limit 并返回 `WorkspaceReadResult`:

```ts
function readWorkspaceFile(
  files: WorkspaceFile[],
  scope: WorkspaceScope,
  pathInput: unknown,
  actorLevel: number,
  options: { offset?: number; limit?: number },
): WorkspaceReadResult
```

逻辑:
1. 现有 path 校验 + `findScopedFile` + `assertReadAccess` 不变。
2. 文件未找到仍抛 `WORKSPACE_FILE_NOT_FOUND`(不变)。
3. **binary 文件**(`file.binary` 存在):返回 `{...cloneWorkspaceFile(file), isBinaryPlaceholder: true}`,不切片,content 是 placeholder 描述串全量。不填 totalLines/returnedLines/truncated(或填 `totalLines: 1, returnedLines: 1, truncated: false` 表示未切片语义)——选后者更一致(字段总有值,agent 不用判 undefined)。
4. **文本文件 + 未传 offset/limit**:返回 `{...cloneWorkspaceFile(file), totalLines: <行数>, returnedLines: <行数>, offset: 1, truncated: false}`——content 是完整内容,但带元数据让 agent 知道总行数。这是"向后兼容但增强"形态:返回类型统一为 `WorkspaceReadResult`,旧消费方读 path/content/updatedAt 不破,新消费方多得元数据。
5. **文本文件 + 传了 offset/limit**:
   - `lines = content.split("\n")`
   - 规范化 offset:默认 1,最小 1,超出 totalLines 时返回空 content + `truncated:false` + `returnedLines:0`。
   - 规范化 limit:默认值(见下"默认值与上限")、最小 1、上限 MAX_READ_LIMIT。
   - `slice = lines.slice(offset-1, offset-1+limit)`
   - `content = slice.join("\n")`
   - `truncated = offset + limit - 1 < totalLines`
   - 返回 `{path, content, createdAt, updatedAt, totalLines, returnedLines: slice.length, offset, truncated}`

默认值与上限:
- `DEFAULT_READ_LIMIT = 2000`(对标主流 agent read 工具)
- `MAX_READ_LIMIT = 5000`(防单次爆 token)
- `offset` 无上限(超出返回空,agent 据此停读)

### search:`searchWorkspaceFiles`(L547-599)

当前签名 `(files, scope, input, actorLevel) → WorkspaceSearchResult[]`。签名不变,内部逻辑重写:

1. **参数校验**:`query` 和 `pattern` 互斥(都传抛 `WORKSPACE_QUERY_PATTERN_MUTEX`,消息明确"传 query 或 pattern 之一,不要同时传");都不传返回 `[]`(保持现状空 query 行为)。
2. **ignoreCase 默认值**:`query` 模式默认 `true`(保持现状 toLowerCase 行为);`pattern` 模式默认 `false`(正则惯例)。显式传值覆盖默认。
3. **pattern 正则编译**:用 `RegExp(pattern, ignoreCase ? "i" : "")`。编译失败抛 `WORKSPACE_PATTERN_INVALID`,带原始 pattern 和正则错误消息。
4. **行级匹配**:`lines = content.split("\n")`,对每行做:
   - `query` 模式:行级子串匹配(`ignoreCase` 时 `line.toLowerCase().includes(query.toLowerCase())`)。注意:现状是整个 content 做 indexOf 拿单 preview;改为行级后命中文件集可能略增(跨行子串不再命中,但行内子串覆盖更全)——这是行为微调,写进 design tradeoff,验收以"命中文件集一致"为准(跨行子串极少见,AIRP 文本搜索都是行内词)。
   - `pattern` 模式:`regex.test(line)`。
5. **路径匹配**:保留现有路径打分(`lowerPath.includes(query)` 或 pattern 对 path test),路径命中 score=2,内容命中 score=1,可叠加。路径命中但内容无命中的文件,`matches: []`,仍出现在结果里(让 agent 知道"文件名匹配但内容无命中")——保持现状行为。
6. **contextLines**:默认 0。每命中填 `contextBefore = lines.slice(lineIndex - contextLines, lineIndex)`、`contextAfter = lines.slice(lineIndex + 1, lineIndex + 1 + contextLines)`。越界取可用部分。
7. **match 字段**:query 模式填 query 子串本身;pattern 模式用 `line.match(regex)?.[0]` 取首个匹配子串。
8. **每文件命中上限**:`MAX_MATCHES_PER_FILE = 50`。超过则 `matchesTruncated: true` 并截断到 50。
9. **limit**:`normalizeSearchLimit`(L243-249)不变,仍是返回文件数上限(DEFAULT 50 / MAX 200)。
10. **binary 文件**:保持现状——跳过内容匹配,仅路径匹配,`matches: []`,`preview: file.path`。
11. **preview 兼容字段**:首个命中的 `createPreview` 风格简短片段(复用现有 `createPreview` 或改为行级简版),无命中时填 `file.path`。
12. **排序**:保持现状(score 降序 → updatedAt 降序),slice 到 limit。

### 辅助 helper

- `createPreview`(L256-266)保留(给 preview 兼容字段用)。
- 新增 `normalizeReadOffset`/`normalizeReadLimit`(对标 `normalizeSearchLimit` L243-249)。
- 新增 `buildSearchMatches(content, matcher, contextLines)` 抽出匹配逻辑,query/pattern 共用行遍历,matcher 是 `(line: string) => string | null`(返回 match 子串或 null)。

## 工具层改动

### `tool-schemas.ts`

**`workspaceReadSchema`(L128-147)** 加参数:
```ts
parameters: {
  type: "object",
  required: ["scope", "path"],
  properties: {
    scope: { ... },  // 不变
    path: { ... },   // 不变
    offset: { type: "integer", description: "起始行号(1-based,默认 1)。读长文件时配合 limit 分段读取。" },
    limit: { type: "integer", description: "返回行数(默认 2000,上限 5000)。不传则返回完整内容。" },
  },
}
```
description 补一句:"传 offset/limit 时返回切片内容和行数元数据(totalLines/returnedLines/truncated)。"

**`workspaceSearchSchema`(L170-193)** 加参数:
```ts
parameters: {
  type: "object",
  required: ["scope"],
  properties: {
    scope: { ... },     // 不变
    query: { type: "string", description: "子串搜索(大小写不敏感默认开启)。与 pattern 互斥。" },
    pattern: { type: "string", description: "正则搜索(默认大小写敏感)。与 query 互斥。用于结构化检索如 JSON/frontmatter。" },
    limit: { ... },     // 不变(返回文件数上限)
    contextLines: { type: "integer", description: "每命中前后上下文行数(默认 0)。" },
    ignoreCase: { type: "boolean", description: "忽略大小写。query 默认 true,pattern 默认 false。" },
  },
}
```
description 改为:"搜索工作区文件,返回每文件命中列表(行号+命中行+上下文)。query 子串或 pattern 正则二选一。"

required 从 `["scope", "query"]` 改为 `["scope"]`(因为 pattern 可替代 query,二者只需一个;都不传返回空)。校验逻辑在实现层做互斥 + 至少一个的判断(query/pattern 都不传时返回 `[]`,不报错——保持现状"空 query 返回空"语义)。

### `workspace-tools.ts` trace

`emitWorkspaceToolTrace`(L356-399):
- 加 `pattern/contextLines/ignoreCase/offset` 到 trace data(仿现有 query/limit 模式)。
- `summarizeWorkspaceReadResult`(L344-354)加切片元数据:`offset/totalLines/returnedLines/truncated/isBinaryPlaceholder`。
- search 的 trace 可加 `totalMatches`(所有文件 matches 长度之和)。

## SDK 改动(`browser-skill-script-executor.ts`)

SDK `tsian.workspace` 对象(L170-198)当前停留在顶层工具第一次改动后的状态:缺 `glob` 方法、search 签名是位置参数二参数形态。本任务借 read/search 升级同步三项。

### 6a: read 透传 offset/limit(验证,预期无需改代码)

`tsian.workspace.read`(L172):当前 `rpc("workspace.read", typeof input === "string" ? {scope,path} : input)`。object 形式已透传——若 input 含 offset/limit 会自然透传进 RPC args,`handleSdkRequest`(L448-485)把 args 透传给 `executeWorkspaceOperation`。**预期无需改代码**,验证透传链路即可。

### 6b: search 签名升级(object 优先 + 位置参数兼容)

`tsian.workspace.search`(L177-178)当前:
```ts
search(query, limit) {
  return rpc("workspace.search", isRecord(query) ? query : { scope: "effective", query, limit });
}
```
问题:位置参数形态 `(query, limit)` 无法传 pattern/contextLines/ignoreCase。虽然 `isRecord(query) ? query : ...` 的 object 分支能透传,但签名脱节。

升级方案:保留 `(query, limit)` 位置参数向后兼容,object 形式优先:
```ts
search(queryOrInput, limit) {
  const input = isRecord(queryOrInput)
    ? queryOrInput
    : { scope: "effective", query: queryOrInput, limit };
  return rpc("workspace.search", input);
}
```
- 位置参数 `(query, limit)`:仍可用,默认 scope "effective",query 子串模式(向后兼容)。
- object 形式 `{scope, query|pattern, contextLines, ignoreCase, limit}`:透传全部新字段。
- 不破坏现有 skill 脚本的位置参数调用。

### 6c: 新增 `tsian.workspace.glob` 方法

顶层 glob 工具已是默认只读四件套之一(`DEFAULT_RUNTIME_WORKSPACE_OPERATIONS`),但 SDK 对象(L170-198)无 `glob` 方法。skill 脚本无法按文件名模式查找文件。补上:

```ts
glob(input) {
  return rpc("workspace.glob", typeof input === "string" ? { scope: "effective", pattern: input } : input);
}
```
- 签名对齐顶层 glob 工具:`{scope, pattern, limit}`。
- string 简写形态:`glob("**/agent.json")` → `{scope:"effective", pattern:"**/agent.json"}`(仿 read 的 string 简写)。
- RPC method `"workspace.glob"`:`handleSdkRequest` 已有 `workspace.*` 透传分支(L448-485),`workspace.glob` 自然路由到 `executeWorkspaceOperation({operation:"glob",...})`。验证 `handleSdkRequest` 的 method 匹配表无白名单过滤。

### 入口透传验证(`executeWorkspaceOperation` L979-1024)

确认 `requestInput` 的 offset/limit/contextLines/ignoreCase 透传:
- `readWorkspaceFile` 调用(L999):当前 `readWorkspaceFile(files, scope, requestInput.path, actorLevel)`——要加 `requestInput.offset/limit`。
- `searchWorkspaceFiles` 调用(L996):当前传整个 `requestInput`——offset/limit/contextLines/ignoreCase/pattern 已在 input 里,`searchWorkspaceFiles` 内部直接读。需确认 `requestInput` 类型是 `WorkspaceOperationRequest`(含新字段)。

## prompt 改动(`index.ts:727-734`)

现有示例:
```
- read arguments={"scope":"effective","path":"world/canon.md"}
- list arguments={"scope":"effective","path":"skills"}
- search arguments={"scope":"effective","query":"关键词","limit":10}
- glob arguments={"scope":"effective","pattern":"**/agent.json","limit":50}
```

更新为:
```
- read arguments={"scope":"effective","path":"world/canon.md"}
- read arguments={"scope":"effective","path":"save/history/timeline.md","offset":1,"limit":200}
- list arguments={"scope":"effective","path":"skills"}
- search arguments={"scope":"effective","query":"关键词","limit":10}
- search arguments={"scope":"effective","pattern":"\"state\":\\s*\\{","contextLines":2}
- glob arguments={"scope":"effective","pattern":"**/agent.json","limit":50}
```

并在说明文字补一句:read 长 文件用 offset/limit 分段;search 支持 query 子串或 pattern 正则,返回每命中行号和上下文。

## 数据流

```
agent 调 read(scope,path,offset,limit)
  → parseRuntimeWorkspaceToolCall
  → executeWorkspaceOperation({operation:"read", scope, path, offset, limit})
  → readWorkspaceFile(files, scope, path, level, {offset, limit})
  → WorkspaceReadResult{content(切片), totalLines, returnedLines, offset, truncated}
  → observation → trace(summarizeWorkspaceReadResult 带 offset/totalLines/truncated) → agent

agent 调 search(scope, query|pattern, contextLines, ignoreCase, limit)
  → executeWorkspaceOperation({operation:"search", scope, query|pattern, contextLines, ignoreCase, limit})
  → searchWorkspaceFiles(files, scope, input, level)
  → 对 scopedReadableFiles 逐文件:
      - 路径匹配 → score=2
      - 内容行级匹配 → 每命中 {lineNumber, line, contextBefore, contextAfter, match}
      - 超 MAX_MATCHES_PER_FILE 截断 + matchesTruncated
  → 按 score/updatedAt 排序 → slice(limit)
  → WorkspaceSearchResult[]{path, name, updatedAt, score, matches[], matchesTruncated, preview}
  → observation → trace → agent

SDK: tsian.workspace.read(input) → rpc("workspace.read", input 含 offset/limit) → handleSdkRequest → 同上 read 路径
SDK: tsian.workspace.search(queryOrInput, limit) → 位置参数转 object 或直接透传 object(含 pattern/contextLines/ignoreCase) → rpc → handleSdkRequest → 同上 search 路径
SDK: tsian.workspace.glob(input) → rpc("workspace.glob", input) → handleSdkRequest → executeWorkspaceOperation({operation:"glob",scope,pattern,limit}) → WorkspaceGlobResult
```

## Tradeoffs

- **read 返回类型统一为 WorkspaceReadResult(加可选切片字段) vs discriminated union**:选前者。union 让消费方做分支,而加可选字段让旧消费方读 path/content 不破、新消费方读切片元数据。代价是"不传 offset/limit 时也返回 totalLines/returnedLines"略微冗余,但 agent 拿到总行数对决策有用(知道要不要分段),不算浪费。
- **search 保留 preview 兼容字段 vs 直接删**:选保留。生态早期但 trace/debug UI 可能消费,保留一个首个命中的简短 preview 成本极低,后续可删。`matches` 是新主路径。
- **query 行级匹配 vs 现状整 content indexOf**:选行级。代价是跨行子串不再命中(极少见,AIRP 文本搜索都是行内词);收益是行号 + 上下文 + 多命中。验收以"命中文件集一致"为准,跨行子串差异写进 known behavior change。
- **ignoreCase 对 query/pattern 不同默认值 vs 统一默认**:选不同默认(query true 兼容、pattern false 正则惯例)。代价是 agent 要知道差异;收益是 query 向后兼容、pattern 符合正则预期。文档(prompt + schema description)写清。
- **每文件命中上限 50 vs 无上限**:选 50。巨型设定文件(如 10k 行记忆)单次 search 若每行命中会爆 token。50 足够 agent 判断文件相关性,需更多时 agent 用 read+offset/limit 精读。上限值可调。
- **MAX_READ_LIMIT 5000 vs 更高/低**:5000 行对标主流 agent 工具,约 20-50k token(行长短而定),单次读取可控。agent 需更多时分段。

## Compatibility / Rollback

- 契约字段新增(可选),旧调用不传新字段行为不变。
- `WorkspaceSearchResult` 加 `matches/matchesTruncated` 字段 + 保留 `preview`——旧消费方读 preview 不破,新消费方读 matches。
- `WorkspaceReadResult` 是 `WorkspaceFile` 的超集(加可选切片元数据字段 + `isBinaryPlaceholder`)——可让 `WorkspaceReadResult extends WorkspaceFile` 或独立类型,实现时选 extends 让类型关系清晰。
- SDK `tsian.workspace.search` 升级为 object 优先但保留 `(query, limit)` 位置参数形态——现有 skill 脚本的位置参数调用不破,新脚本可用 object 传 pattern/contextLines/ignoreCase。
- SDK 新增 `tsian.workspace.glob` 方法是纯增量,不破坏现有 SDK 调用。
- 回滚 = git checkout contracts runtime.ts + agent-runtime 四个文件 + SDK + prompt。纯增量改动,无数据迁移,回滚无风险。

## 与 storage volume 任务的合并风险

`workspace-operations.ts` 是两任务共改文件,但:
- 本任务改 `readWorkspaceFile`(L527-545)/`searchWorkspaceFiles`(L547-599)/`executeWorkspaceOperation` 入口(L996-999)的 read/search 分支。
- storage 任务改 host 路由 dispatch(`executeWorkspaceOperationForActiveSave` mutations adapter,在 `index.ts`)+ scope 定义(L93-106 `DEFAULT_SCOPE_ACCESS`)。
- 两任务在 `workspace-operations.ts` 内的改动函数不重叠。合并冲突预期仅在 imports/类型声明区,低风险。
- 执行顺序建议:storage 任务已在 in_progress,若先合入则本任务 rebase;本任务若先合入则 storage rebase。无硬依赖,可并行开发。
