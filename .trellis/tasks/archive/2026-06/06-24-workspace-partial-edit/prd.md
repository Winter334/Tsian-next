# workspace 部分编辑能力

## Goal

为 workspace 写工具补齐"部分编辑"能力，消除整文件重写风险。当前 `write`/`patch` 都是整文件替换（`patch` 只是多了乐观锁，不是部分编辑），导致 studio-assistant 编辑前端大文件（HTML/CSS/JS）时必须整文件重写——LLM 重生成大文件易丢段落、错缩进、漏闭合标签，是结构性风险。要补一个 `workspace.edit` 操作（字符串精确替换 + 唯一性约束），让大文件局部编辑成为可能。

## What I Already Know（代码确认）

- **现状 write/patch**：两者走同一个函数 `writeWorkspaceFile`（`workspace-operations.ts:974`），`request.content` 永远是完整新文件内容（`string | Blob`）。`patch` 比 `write` 多一个开关 `checkExpectedContent`（L994-1003）：写前校验 `existing.content === request.expectedContent`，不匹配则抛 `WORKSPACE_EXPECTED_CONTENT_MISMATCH`。这是**乐观锁/冲突检测**，不是字段级/部分编辑。`patch` 命名误导。
- **暴露面有两条路，不对称**：
  - LLM 工具面（`workspace-tools.ts:34-69`）：`RUNTIME_WORKSPACE_TOOL_NAMES` + `WORKSPACE_OPERATION_TOOL_NAMES` 暴露 `read/list/search/glob/diff/write/move/delete`——**有 write 无 patch**（patch 已在 06-19-tool-rename-and-glob 任务 R3 从 LLM 工具面移除）。`call.name` 直接 1:1 映射到 `WorkspaceOperationName`。
  - browser_script 面（`browser-skill-script-executor.ts:150-184`）：Skill 脚本的 `workspace` 对象暴露 `read/list/search/glob/diff/patch/write/move/delete/validate`——**patch 在这条路上**。
- **patch 的活消费者（关键，推翻"纯冗余可直删"假设）**：
  - 人类前端编辑器 `WorkspaceEditorView.vue:321-333`：用户在 textarea 改完点保存，调 `patchPlatformWorkspaceFile({content, expectedContent})`，靠 `expectedContent` 做**陈旧编辑检测**——文件自打开后被别处改了就拒写，防止静默覆盖。这是真实的人类 UX 功能，不是冗余。
  - 平台 action `patchPlatformWorkspaceFile`（`workspace-ops.ts:684-709`）：映射 `operation:"patch"`，给前端编辑器用。
  - browser_script SDK `workspace.patch`（`browser-skill-script-executor.ts:169-171`）：暴露给 Skill 脚本，但**全仓库 .js skill 脚本无一处调用**（grep 确认）——SDK 有这个面，实际无人用。
  - spec `type-safety.md`（L576/626/665/1094/1109）：把 `workspace.patch` 写成前端 bridge 用的平台 action 契约。
- **澄清"冗余"边界**：`edit`（字符串替换）让 **agent 侧**的 patch 冗余——但 agent 侧 patch 早在 06-19 已移除，本次无需再清。`edit` **不让人类编辑器的整文件陈旧检测冗余**——那是 whole-file save + 乐观锁，和 partial string-replace 是两种用途。所以"删 patch"必须把乐观锁能力**折进 `write`**（`write` 加可选 `expectedContent`），否则人类编辑器丢陈旧保护。
- **操作路由是 generic 的**（`browser-skill-script-executor.ts:576-577`）：`op.startsWith("workspace.")` → slice 出 operation 名 → 传给 `executeWorkspaceOperation`。加 `workspace.edit` 只要 worker 侧加 `edit()` 方法 + `executeWorkspaceOperation` 认 `"edit"` 分支，路由层不用改。
- **staged transaction 回滚**：`mutations.write` 接 `workspaceTransaction.write`（L593-600），写入攒在 transaction 里，回合成功才落盘，失败整体丢弃。edit 的实现 = 读 transaction 当前文件内容 → 应用字符串替换 → 调 `workspaceTransaction.write` 写回新完整内容，**与 write 共享回滚语义，无需特殊处理**。
- **痛点定位**：studio-assistant 改前端（HTML/CSS/JS，可能几百几千行）是整文件重写真正咬人的场景——token 浪费是其次，LLM 重生成大文件丢段落/错缩进/漏闭合标签是结构性风险。post agent 改小 JSON（一实体一文件，几百字节~几 KB）反而不疼。
- **contracts 现状**：`WorkspaceOperationName`（`runtime.ts:147-158`）= list/search/read/glob/diff/patch/write/move/delete/validate。`WorkspaceOperationRequest`（L159-184）有 `content`/`expectedContent`，无 oldString/newString。`WorkspacePatchResult`（L203-208）= {path,scope,file,changed}，write 也复用它。
- **diff 工具的 expectedContent 是另一含义**：`tool-schemas.ts:298` 的 `required:["path","expectedContent"]` 属于 **diff** 工具（只读预览，expectedContent=提议内容），不是 patch。不影响本任务。

## Requirements

### R1 新增 `workspace.edit`（字符串精确替换）

- 基于 `oldString` → `newString` 的字符串替换，格式无关（JSON/MD/HTML/CSS/JS 一视同仁）。
- `oldString` 必须在文件中**唯一匹配**，否则报错并提示扩大上下文（防误伤）。`replaceAll: true` 为显式批量逃生口。
- 二进制文件禁用 edit（与 read 的 `isBinaryPlaceholder` 对齐），报明确错误。
- edit 不带 `expectedContent` 乐观锁——字符串唯一匹配本身就是隐式冲突检测（文件被改了 oldString 就匹配不上）。
- edit 写入走 staged transaction，回合失败自动回滚（与 write 共享回滚语义，无需特殊处理）。
- 暴露到两条路：LLM 工具面（`workspace-tools.ts`）+ browser_script 面（`browser-skill-script-executor.ts`）。

### R2 折乐观锁进 `write` + 完整退役 `patch` operation

- `write` 加可选 `expectedContent`：带它时做写前校验（等价于原 `patch` 的乐观锁），不带时维持现状（整文件覆盖）。
- 人类前端编辑器 `WorkspaceEditorView.vue` + `patchPlatformWorkspaceFile`（`workspace-ops.ts:684`）改走 `write` + `expectedContent`。
- browser_script SDK 移除 `workspace.patch`（全仓库零 skill 脚本调用，零迁移成本）。
- contracts 移除 `"patch"` from `WorkspaceOperationName`；`WorkspacePatchResult` 评估是否保留（write 也复用它，可能只需改名 `WorkspaceWriteResult` 或保留共用）。
- spec `type-safety.md`（L576/626/665/1094/1109）同步：`workspace.patch` 引用改 `workspace.write`（带 expectedContent）。
- `workspace-operations.ts` 的 `patch` 分支（L1242）+ `writeWorkspaceFile` 的 `checkExpectedContent` 开关合并进 write 主路径。

### R3 agent / Skill 文档同步

- studio-assistant / post agent 的 AGENT.md 教何时用 edit vs write（大文件局部改用 edit，小文件/全量重写用 write）。
- Skill 文档（若有提及 patch）同步。

## Acceptance Criteria

- [ ] `workspace.edit` 支持 oldString 唯一匹配替换 + replaceAll 批量模式，格式无关。
- [ ] edit 暴露到 LLM 工具面和 browser_script 面，两条路都能用。
- [ ] oldString 不唯一且未设 replaceAll 时，报清晰错误并提示扩大上下文。
- [ ] 二进制文件 edit 被拒绝并给出明确错误。
- [ ] edit 写入走 staged transaction，回合失败自动回滚（与 write 行为一致）。
- [ ] `write` 支持可选 `expectedContent`，带它时做写前校验（等价原 patch 乐观锁）。
- [ ] 人类前端编辑器保存流程改走 `write` + `expectedContent`，陈旧编辑检测行为不变。
- [ ] contracts 中 `"patch"` 从 `WorkspaceOperationName` 移除；相关类型/spec 同步。
- [ ] browser_script SDK 不再暴露 `workspace.patch`。
- [ ] 全仓库无 `operation: "patch"` / `workspace.patch` 残留引用（除归档任务文档）。
- [ ] studio-assistant / post agent 的 AGENT.md 更新 edit/write 用法指引。
- [ ] `npm run build:web` 通过；相关测试通过。

## Out of Scope

- JSON-Patch（RFC 6902）字段级编辑——明确不做，字符串替换已覆盖需求。
- 平台原生向量索引（独立大议题，不在此任务）。
- edit 的多步事务/原子批量编辑（单次 edit = 单文件单替换/批量替换，不做跨文件原子）。

## Open Questions

- [ ] edit 失败时的错误信息形态（提示 agent 如何修复——扩大 oldString 上下文）。
- [ ] `WorkspacePatchResult` 去留：保留共用、改名 `WorkspaceWriteResult`、还是 write/edit 各自结果类型？
