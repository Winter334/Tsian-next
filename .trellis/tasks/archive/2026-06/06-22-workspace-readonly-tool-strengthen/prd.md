# Workspace Read-Only Tool Strengthening

## Goal

补齐 AIRP agent 只读工作区工具的两个已确认缺口,让 agent 处理大量剧情/记忆/设定文本时不必"整读烧 token"或"盲搜无行号":

1. **read 加行级 offset/limit**:长文件按行切片读取,返回切片元数据(总行数、已返回行数、是否截断)。
2. **search 升级为带行号+上下文的多命中检索**:保留 `query` 子串语义(自然语言主路径,向后兼容),新增 `pattern` 正则字段(结构化检索如状态表 JSON/frontmatter),返回格式统一升级为每命中带行号、命中行、上下文行。

不在 search 之外单独出 grep 工具——search 与 grep 职责重叠,升级 search 复用现有 scope 路由/权限/binary 跳过逻辑,符合 `airp-workflow-platform-direction.md §5`"工具应尽量通用,避免窄工具"原则。

## Background

勘察确认的现状缺口:

- **read**(`tool-schemas.ts:128-147`):只有 `scope + path`,无 offset/limit。长剧情/长设定文件要么整读(烧 token)要么不读。`readWorkspaceFile`(`workspace-operations.ts:527-545`)直接返回完整 `WorkspaceFile` clone。
- **search**(`workspace-operations.ts:547-599`):纯 `toLowerCase().indexOf()` 子串匹配,打分=路径2+内容1,**只返回单个 preview 片段**(`createPreview` L256-266 是字符级 48/96 切片),无正则、无行号、无上下文行、无多命中。agent 搜到文件后仍要 `read` 整文件才能看到命中行上下文。
- **契约已预留**:`WorkspaceOperationRequest`(`runtime.ts:106-119`)已有 `pattern?: string` 字段(L112),但 search 实现没用上——这是此前顶层工具改动收敛时遗留的半成品,本任务把它接通。

AIRP 场景特性(影响方案选择):

- agent 处理的是自然语言文本(剧情/记忆/设定)为主,子串是搜索主路径;正则服务结构化检索(状态表 JSON、frontmatter、skill 声明)。
- LLM 转义不可靠(不会每次记得转正则元字符),所以 `query` 默认正则会误匹配——`query` 保持字面量子串语义是安全的。
- 当前生态早期,无大量已部署 skill/agent 硬依赖现有 search 返回格式,兼容负担轻。

## Requirements

### R1: read 行级 offset/limit

- read 工具新增可选 `offset`(起始行号,1-based,默认 1)和 `limit`(返回行数,有默认值和上限)。
- 不传 offset/limit 时,行为保持现状(返回完整 content),向后兼容。
- 返回带切片元数据:总行数、实际返回行数、起始 offset、是否截断。具体契约形态见 design。
- 二进制文件(binary 字段存在)的 content 是 placeholder 描述串,offset/limit 不对其切片;返回原 placeholder 全量 + 标记其非可切片文本(见 design 边界处理)。
- 行定义:`content.split("\n")`。

### R2: search 升级为带行号+上下文的多命中检索

- `query` 字段保留**子串语义**(向后兼容,大小写不敏感保持现有行为)。
- 新增可选 `pattern` 字段(**正则**),服务结构化检索。`query`/`pattern` 互斥(同时传报错,明确不猜测意图)。
- 返回格式统一升级:无论 query 还是 pattern,都返回每文件一条结果,内含该文件的命中列表(每命中带行号、命中行内容、上下文行)。具体契约形态见 design。
- 新增 `contextLines`(默认 0,每命中前后各 N 行上下文)。
- 新增 `ignoreCase`(对 query 默认 true 保持兼容;对 pattern 默认 false 遵循正则惯例)。
- 保留路径匹配打分(score)和文件级元数据(path/name/updatedAt)。
- limit 语义保持"返回文件数上限"(向后兼容);每文件内命中数给合理上限防巨型文件爆 token,带截断标志。
- 二进制文件:跳过内容匹配,仅路径匹配(保持现有行为)。

### R3: SDK 和 prompt 同步

SDK `tsian.workspace`(`browser-skill-script-executor.ts:170-198`)当前停留在顶层工具第一次改动后的状态,本任务借 read/search 升级之机把它同步到当前只读工具集:

- SDK `tsian.workspace.read`(L172)透传 offset/limit——当前 object 形式已透传,验证确认即可。
- SDK `tsian.workspace.search`(L177-178)升级签名:当前是 `search(query, limit)` 位置参数二参数形态,无法显式传 pattern/contextLines/ignoreCase。升级为 object 优先(传 object 时透传全部字段),保留 `(query, limit)` 位置参数形态向后兼容(内部转 object)。
- SDK **补 `tsian.workspace.glob` 方法**——glob 已是默认只读四件套(`DEFAULT_RUNTIME_WORKSPACE_OPERATIONS = [list, search, read, glob]`),但 SDK 对象缺此方法,skill 脚本无法按文件名模式查找。参照顶层 glob 工具签名 `{scope, pattern, limit}` 补上。
- 平台生成给 agent 的工具 prompt(`index.ts:727-734`)更新 read/search 示例,说明 offset/limit 和 pattern 用法。

### R4: validate 措辞修正(不扩范围)

PRD 原文"不加 validate 顶层工具(已确认是此前有意移除,不恢复)"与代码现状不符。实际:`validate` 仅从 agent 顶层 prompt 示例移除,底层能力(`validateWorkspaceFile` + `WorkspaceOperationName.validate` + `AUTHORING_WORKSPACE_OPERATIONS` + `validatePlatformWorkspaceFile` host 导出)一直服务于 Studio 编辑器校验功能(`WorkspaceEditorView.vue:273`)。本任务**不动 validate 底层能力**(删了是 UI 回归),仅修正描述。SDK `tsian.workspace.validate` 方法的去留是独立议题(需确认无 skill 依赖 public API),不纳入本任务。

## Acceptance Criteria

- [ ] read 支持 offset/limit(行级,1-based offset),不传时行为不变。
- [ ] read 返回切片元数据(totalLines/returnedLines/offset/truncated),agent 可判断是否需续读。
- [ ] read 二进制文件 offset/limit 边界处理正确(不切片 placeholder,见 design)。
- [ ] search 的 query 子串语义和大小写行为不变,旧调用结果等价(格式升级但命中文件集一致)。
- [ ] search 的 pattern 正则字段生效,query/pattern 互斥校验报错清晰。
- [ ] search 返回每命中带行号、命中行、contextLines 上下文(默认 0)。
- [ ] search 的 ignoreCase 对 query 默认 true、对 pattern 默认 false,显式传值生效。
- [ ] search 二进制文件仅路径匹配,不尝试内容匹配。
- [ ] SDK `tsian.workspace.read` 透传 offset/limit(object 形式)。
- [ ] SDK `tsian.workspace.search` 签名升级:object 形式可传 pattern/contextLines/ignoreCase/limit;`(query, limit)` 位置参数形态保留向后兼容。
- [ ] SDK 新增 `tsian.workspace.glob` 方法,签名 `{scope, pattern, limit}`,行为对齐顶层 glob 工具。
- [ ] 平台 agent 工具 prompt 的 read/search 示例更新。
- [ ] 现有功能不回归(助手 workspace_read/search、run_script SDK 调用、Studio Explorer)。
- [ ] `npm run build:web` 通过。
- [ ] `npm run typecheck`(或等价)通过。

## Constraints

- 只改只读工具(read/search),不改写操作(write/move/delete/patch)和事务语义。
- 不改 scope 路由、权限矩阵、binary 存储模型(06-22 已定的 text+binary 双轨)。
- 不单独出 grep 工具(在 search 上升级)。
- 不加 glob 过滤到 search(已有独立 glob 工具,不重复)。
- 不引入向量检索(属记忆系统/skill 层,不是平台工具职责)。
- 不加受控模型调用(走 skill 路径,已定不在本任务范围)。
- 不向 agent 顶层重新暴露 validate 工具(保持现状:顶层 prompt 无 validate 示例)。validate 底层能力服务于 Studio 编辑器校验,本任务不动。
- key 注入机制不并进本任务(属 skill 安全边界,独立议题)。
- 不与 `06-21-workspace-storage-volume-abstraction`(storage volume 路由收敛)冲突:本任务改 agent-runtime 层的 read/search 计算逻辑和 contracts 契约,不改 host 路由层和存储层。两任务正交,执行顺序见 implement.md。

## Out Of Scope

- 向量检索 / 语义搜索(记忆系统/skill 层)。
- 受控模型调用工具(skill 路径解决)。
- validate 底层能力移除(有 Studio UI 调用方,删了是回归)。
- SDK `tsian.workspace.validate` 方法的去留(独立议题,需先确认无 skill 依赖 public API)。
- key 注入机制(skill 安全边界,独立任务)。
- read 读图 / 多模态(后续单独支持)。
- search 的 glob 文件过滤(已有独立 glob 工具)。
- host 路由层和存储层改动(storage volume 任务范围)。

## Dependencies

- 与 `06-21-workspace-storage-volume-abstraction` 正交:本任务改 agent-runtime 计算层 + contracts,storage 任务改 host 路由层 + 存储层。两任务可并行,但若 storage 任务先合入则本任务 rebase 后验证不回归;若本任务先合入则 storage 任务 rebase 后验证不回归。冲突点仅在 `workspace-operations.ts` 同文件不同函数(read/search vs 路由 dispatch 不直接相交,合并低风险)。
