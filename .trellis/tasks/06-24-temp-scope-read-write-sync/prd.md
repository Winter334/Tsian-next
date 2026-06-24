# temp scope 读写同步

## Goal

修复 temp scope 的 write-then-read/edit 不同步问题：agent 往 `temp/` write 一个新文件，返回成功，但紧接着的 read/edit 报 `WORKSPACE_FILE_NOT_FOUND`。根因是 temp write 走 Dexie 落库但不更新 runtime 内存快照（stagedFiles），而 read/edit 读的是这个快照。修复后 temp 应和 save-runtime 一样支持 write-then-read-edit 闭环，让 temp 真正成为 agent 可用的临时草稿区。

## What I Already Know（代码确认）

- **temp 已是 agent 可写的草稿区，不是纯附件通道**：`workspace-volumes.ts:318-357` 的 `tempVolume` 注释明写 "write/delete 支持 agent 通过 workspace_write/workspace_delete 管理 temp/ 文件"，write/delete 实现完整。`state-management.md:34` 旧 spec 说 "TempVolume write/delete throw" 是**过时信息**，实际早已放开。
- **save-runtime write-then-read 能工作的机制**：`createRuntimeWorkspaceTransaction`（`workspace.ts:2132-2165`）持有内部 `stagedFiles` 数组。`transaction.write`（L2141-2144）调 `writeWorkspaceFileToFiles(stagedFiles, ...)` **直接修改 stagedFiles**。后续 read/edit 读同一个 stagedFiles，立刻看到新文件。
- **temp write-then-read 失败的根因**：`assistant-chat.ts:516-524` 的 temp write 走 `executeWorkspaceMutation` → `tempVolume.write` → Dexie 落库（`writeAttachmentRecord`），返回完整 WorkspaceFile（含 content，L340-353）。**但 mutations adapter 拿到返回后没回填 stagedFiles**——所以 transaction 的 `workspaceFiles`（= stagedFiles）不含新文件，后续 read/edit 的 `findScopedFile(files, "temp", path)` 找不到。
- **temp 文件注入快照的既有路径**：`assistant-chat.ts:289-307` 会话启动时从 `listAttachmentsBySession` 注入 temp 附件到 workspaceFiles，但**文本附件 content 是空串**（L297：`isImage ? ... : ""`），agent 需 workspace_read 取真实内容。这是一次性注入，write 之后不刷新。
- **tempVolume.write 返回值已含完整 content**（L347：`input.content ?? ""`）——回填进 stagedFiles 后，read/edit 能直接拿到内容，不需要再查 Dexie。

## Requirements

- temp write 之后，新文件（或更新后的文件）回填进 runtime 内存快照（stagedFiles / `activeWorkspaceTransaction.workspaceFiles`），让同回合后续 read/edit 立刻可见。
- temp delete 之后，对应条目从 stagedFiles 移除，让同回合后续 read/edit 不再可见。
- 回填复用既有的 upsert 机制（`index.ts:244-252` 的 `upsertWorkspaceFile` 模式：findIndex+替换/push+排序），不新建并行机制。
- 不改变 temp 的 Dexie 落库行为（`executeWorkspaceMutation` / `tempVolume.write` 保留），只是在其返回后补一步快照同步。
- save-runtime / card-content / platform-meta / card-frontend 的行为不变（它们已通过 transaction.write 或各自路径同步快照）。
- 同步过时 spec：`state-management.md:34` 的 "TempVolume write/delete throw — attachments managed via saveAssistantAttachment UI path" 改为反映现状（write/delete 已支持 agent 管理）。

## Acceptance Criteria

- [ ] agent 往 `temp/` write 一个新文本文件后，同回合紧接着的 `workspace.read` 能读到该文件内容。
- [ ] agent 往 `temp/` write 一个新文本文件后，同回合紧接着的 `workspace.edit` 能成功编辑该文件（不再报 `WORKSPACE_FILE_NOT_FOUND`）。
- [ ] agent `workspace.delete` 一个 temp 文件后，同回合后续 read/edit 不再找到该文件。
- [ ] temp write 覆盖已存在的 temp 文件后，read 拿到的是新内容。
- [ ] save-runtime / card-content 等其他 scope 的 write-then-read 行为不退化。
- [ ] `npm run build:web` 通过。
- [ ] `state-management.md:34` 的过时 TempVolume 描述已更新。

## Out of Scope

- temp 的跨会话持久化策略（附件 7 天清理等既有逻辑不动）。
- temp read 走 Dexie 实时查询的方案（本任务用 write/delete 后回填快照，不改 read 路径）。
- 重新设计 temp 的定位（草稿 vs 附件）——现状是两者共用，本任务只修同步 bug，不改定位。

## Notes

- 修复点集中在 `assistant-chat.ts` 的 temp mutations adapter（L516-557）：write 返回后 upsert 进 `activeWorkspaceTransaction.workspaceFiles`，delete 返回后从其中移除。
- `index.ts:244-252` 已有 `upsertWorkspaceFile` 模式可参考/复用。
- 这个 bug 在 06-24-workspace-partial-edit 任务的 edit 测试中被助手的 temp 测试场景暴露，但 bug 本身与 edit 无关——read 一直就有，edit 只是继承了。
