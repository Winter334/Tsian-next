# 工作区路径支持 `.` 与相对路径段

## Goal

让工作区路径规整器接受 `.` 和 `..` 相对路径段,消除模型调用 `list(".")` 这类符合训练习惯却撞 `WORKSPACE_PATH_INVALID` 的无谓报错,并把三份重复的路径规整逻辑收敛到一个共享 helper。

具体三件事:

1. **接受 `.`**:`.` 规整为当前目录(根),`./` 同义。符合主流 agent 工具(Claude/OpenAI file tools、各 agent 框架)`.`=根 的训练约定,比在提示词里提醒"别用点"更自然。
2. **接受 `..` 相对段**:`a/../b`→`b`、`..` 在根处自然 clamp(虚拟 FS 根定,无父目录可逃越)。
3. **抽共享 helper**:三份逐字节同构的 `normalizePathBase` 副本(storage/agent-runtime 两层)合并为 `lib/workspace-path.ts` 单一来源,各调用方用各自的错误类型包裹。

## Background

勘察确认的现状:

- **三份同构副本**:
  - `storage/workspace.ts:935-980` `normalizePathBase` → 导出 `normalizeWorkspaceFilePath`(L989)、`normalizeDirectoryPath`(L982)、`normalizeWorkspaceTargetPath`(L996)。被 platform-host 多处 import(game-cards/index/local-assistant/studio-agents/workspace-ops)。
  - `agent-runtime/workspace-operations.ts:156-208` 自有副本 → 导出 `normalizeWorkspaceOperationFilePath/TargetPath/DirectoryPath`。模型工具(list/read/search/glob/diff/write/move/delete/validate)经此层命中。比其余两份多一个 NUL 字节检查(L192-197)。
  - `agent-runtime/workspace-tools.ts:284-326` 自有副本 → `normalizeWorkspaceFilePath`(L328)。工具层校验。
- **第 4 份、不同域**:`agent-runtime/context.ts:21-44` `normalizeWorkspaceFilePath` 返回 `null`(非抛错),用于 agent.json `contextPaths`/`agentPath` 等 **authored-config** 校验,语义是"丢弃非法路径"。`.`/`..` 在该域无意义(作者写的配置路径不该含相对段,含了多半是笔误)。
- **第 5 份、专用白名单**:`storage/workspace.ts:171-196` 内嵌在 `MEMORY_MAINTENANCE_SCRIPT_JS` 字符串里的 `normalizePath`,带显式目标白名单(`save/agents/<a>/notes.md` 等),`.`/`..` 对它无意义。
- **AI-facing 缺口**:`tool-schemas.ts:154` `list` 的 path 描述写 "Empty or omitted means the workspace root"——没说 `.` 可用,也没说 `.` 被禁。模型凭训练习惯用 `list(".")`,实现层却抛 `WORKSPACE_PATH_INVALID`("must not contain empty, current, or parent directory segments")。一轮上下文浪费在"踩坑→读错误→换写法"。
- **无测试锁死**:项目无 `.test.ts`/`.spec.ts`/vitest 配置,路径规整契约仅由实现和错误码字符串约束,改可观察行为无测试断言阻碍。
- **项目先例支持抽 helper**:`.trellis/spec/platform-web/frontend/quality-guidelines.md` "Known Tech Debt" 明确:当出现第二个消费者时,把重复 helper 抽到 `apps/platform-web/src/lib/workspace-<x>.ts` "rather than copying them again"。`lib/` 已有 `workspace-file-types.ts`/`media-type.ts` 等,`lib/workspace-path.ts` 符合约定。

AIRP 场景特性(影响方案):

- 工作区是**根定虚拟 FS**——root 之上没有父目录。`..` 的"越界"风险在物理 FS 上真实,在这里不存在:pop 空数组是无操作,自动 clamp 在根。安全性质天然保持。
- 模型注意力有限,每一条它要遵守的"别用 X"都是决策噪声。让 `.` "就是能用"比"教它别用"省 token 且更稳。

## Requirements

### R1: 共享路径规整核心(`lib/workspace-path.ts`)

- 新增 `apps/platform-web/src/lib/workspace-path.ts`,导出 `normalizeWorkspacePath(value, options): NormalizePathResult`(discriminated result,非抛错——各域自行包裹错误类型)。
- 规整算法:
  1. 非字符串 → `{ok:false, code:"WORKSPACE_PATH_REQUIRED", message:"Workspace path must be a string."}`。
  2. trim、`\`→`/`、strip leading `/`、collapse `//`、strip trailing `/`。记录 `hadTrailingSlash`。
  3. NUL 字节检查(从 #2 提升到核心,三份统一生效)→ `WORKSPACE_PATH_INVALID` "must not contain NUL bytes"。
  4. 规整后为空 + `allowEmpty` → `{ok:true, path:""}`;为空 + 不 allowEmpty → `{ok:false, WORKSPACE_PATH_REQUIRED, "is required"}`。
  5. `rejectTrailingSlash && hadTrailingSlash` → `{ok:false, WORKSPACE_FILE_PATH_REQUIRED, "must not end with a slash"}`。
  6. **段规整**(新行为):split `/`,遍历——`.` 丢弃;`..` pop 末段(栈空则无操作=clamp 根);`""` 丢弃(防御性);其余 push。
  7. join 栈。结果为空 + `allowEmpty` → `{ok:true, path:""}`(如 `.`/`..`/`a/..`→根);为空 + 不 allowEmpty → `{ok:false, WORKSPACE_PATH_REQUIRED, "is required"}`(`read(".")`→`.` 规整成空→"路径必填",比 INVALID 更准确)。
- 三份副本的导出函数改为调用核心 + 各自错误类型包裹:`storage/workspace.ts` 抛 `WorkspaceStorageError`;`workspace-operations.ts` 抛 `workspaceOperationError`;`workspace-tools.ts` 抛 `toolError`。
- NUL 检查统一后,#1/#3 也获得 NUL 防护(此前仅 #2 有)——纯增强,无回归。

### R2: 行为生效范围

- `.`/`..` 在三份规整器中变为合法并按算法解析。
- 影响面:模型工具(list/read/search/glob/diff/write/move/delete/validate,经 #2)+ platform-host studio/local-assistant 等(经 import #1)。全部一致。
- `..` 在根处 clamp,不可逃出工作区(安全性质保持)。

### R3: AI-facing 文案修正(按 AI-Facing Content Changes guide)

- **错误信息**:`WORKSPACE_PATH_INVALID` 的 "must not contain empty, current, or parent directory segments" 文案删除——`.`/`..` 合法后此描述过期。剩余 INVALID 仅 NUL 字节用,文案改为 "must not contain NUL bytes"。
- **`list` schema 描述**(`tool-schemas.ts:154`):"Empty or omitted means the workspace root." → "Empty, omitted, or `.` means the workspace root."。确认模型训练习惯,零机制噪声(不解释 clamp/resolve 原理)。
- **其余工具 schema 描述**(`read`/`write`/`move`/`delete`/`diff` 的 path 描述):不动。模型对这些工具用真实路径,`.` 对文件读写无意义;按 guide 不加噪声。

### R4: 明确不动的两处校验器

- `agent-runtime/context.ts:21-44`(authored-config 域,null 语义):保持 `.`/`..` 严格拒绝。理由:agent.json contextPaths 是作者手写配置,含 `..` 多半是笔误,静默 clamp 会掩盖作者错误。
- `storage/workspace.ts:171-196` maintenance script 内嵌 `normalizePath`(专用目标白名单):保持严格。理由:`.`/`..` 对白名单目标无意义,且该脚本独立于运行时规整链路。

## Acceptance Criteria

- [ ] `list(".")` 返回工作区根条目(等价于 `list("")`/`list()` 省略 path)。
- [ ] `list("./")` 返回工作区根(目录路径不拒绝尾斜杠 + `.` 规整为根)。
- [ ] `list("a/../b")` 等价于 `list("b")`。
- [ ] `list("../..")` 等价于 `list("")`(clamp 在根,不报错、不逃越)。
- [ ] `read(".")` 报 `WORKSPACE_PATH_REQUIRED`("is required"),不报 `WORKSPACE_PATH_INVALID`(`.` 对文件路径无意义,规整成空后走"必填"分支)。
- [ ] `read("a/../b/c.md")` 等价于 `read("b/c.md")`。
- [ ] 含 NUL 字节的路径在三层规整器均报 `WORKSPACE_PATH_INVALID`(此前仅 operation 层有)。
- [ ] `lib/workspace-path.ts` 导出 `normalizeWorkspacePath`,三份副本改为调用它(无残留逐字节重复逻辑)。
- [ ] `WORKSPACE_PATH_INVALID` 错误信息不再含 "current, or parent directory segments" 字样(AI-facing 文本零残留)。
- [ ] `list` schema 的 path 描述含 "`.`" 提示。
- [ ] `context.ts` 与 maintenance script 的校验器行为不变(仍严格拒绝 `.`/`..`)。
- [ ] 现有功能不回归(助手 workspace_read/list、run_script SDK、Studio Explorer、local-assistant skill 解析)。
- [ ] `npm run build:web` 通过。

## Constraints

- 不改 scope 路由、权限矩阵、scopeForPath 前缀判定(`.`/`..` 在规整阶段已解析,scope 判定拿到的是规整后路径)。
- 不改写操作语义(write/move/delete 的事务、权限、platform-metadata 禁令)。
- 不改 `context.ts`(authored-config 域)和 maintenance script(专用白名单)。
- 不向任何工具 schema 新增字段或参数(只改描述文案)。
- 不引入测试框架(项目无 vitest/jest;验证靠 build + 手动/逻辑推演)。
- 不改 contracts 包(路径规整是 platform-web 内部逻辑,不跨包)。

## Out Of Scope

- `context.ts` authored-config 校验器放宽(不同域,不同语义,需独立论证)。
- maintenance script `normalizePath` 放宽(专用白名单,无收益)。
- 为路径规整引入单元测试框架(独立议题,本任务以 build 为质量门)。
- contracts 路径类型变更(规整逻辑不出包)。
- tool schema 参数结构变更(仅文案)。

## Dependencies

- 无跨任务依赖。与近期 storage/assistant 任务正交:本任务只改路径规整入口 + 抽 helper,不动 scope 路由、存储表、事务、UI。
- 共改文件 `workspace-operations.ts`/`workspace-tools.ts`/`storage/workspace.ts`/`tool-schemas.ts` 与其他在途任务的改动函数不重叠(路径规整是各操作的最早入口,下游逻辑不受影响)。
