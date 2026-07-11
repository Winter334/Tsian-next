# 修复 invokeAgent 覆盖前端写入

## Goal

修复桌面助手通过 `inspect_frontend` 操作可见 `/play` iframe 时，前端真实 `workspace.write` 已完成但随后被 `interaction.invokeAgent` side-channel 提交旧 workspace 快照覆盖的问题。

用户价值：助手自检/调试必须作用于玩家可见的真实前端与真实存档。助手点击导入小说后，UI 中显示的章节、Resource Manager / IndexedDB 中的 `save/source/**` 文件、后续章节预览与理解流程必须一致，不能出现“UI 内存显示成功，但 workspace 真相被回滚/删除”的分叉。

## Background / Evidence

- 复现场景：用户在 `/play` setup wizard 中选择 `情花孽.txt` 后，让桌面助手调用 `inspect_frontend` 点击“导入”。
- `inspect_frontend` activity 证据：点击后观察到多次 `workspace.write started → completed`，且无 failed；页面进入章节 review。
- IndexedDB 证据：桌面助手回复完成后，active save 的 `workspaceFiles` 中 `save/source/**` 只剩：
  - `save/source/manifest.json`
  - `save/source/README.md`
- `save/source/manifest.json` 证据：内容仍是模板初始 manifest（`chapterCount: 0` / `importedAt: null`），不是导入后的 ready manifest。
- 行为证据：review 页面章节列表仍来自前端内存，但切换/读取章节预览会出现“暂无可预览内容”，证明 workspace 真实文件已缺失。

## Confirmed Root Cause

`interaction.invokeAgent` side-channel 调用开始时会基于当时的 effective workspace 创建 `RuntimeWorkspaceTransaction`。在该 side-channel 调用期间，`inspect_frontend` 操作 `/play` iframe，前端通过 bridge `workspace.write` 直接持久化到 Dexie。

但 side-channel Agent 本轮结束时，旧实现将 transaction 的整份 `finalWorkspaceFiles()` 传给全量提交函数：

- `apps/platform-web/src/platform-host/index.ts`：`interaction.invokeAgent` 结束时调用 `commitWorkspaceFilesForSave(...)` 或 `commitWorkspaceFilesWithCheckpointForSave(...)`。
- `apps/platform-web/src/platform-host/assistant-chat.ts`：桌面助手本地 chat 结束时也用旧 staged snapshot 通过 `replaceWorkspaceFilesForSave(...)` 回写 save workspace。
- `apps/platform-web/src/storage/saves.ts` / `apps/platform-web/src/storage/workspace.ts`：这些 full-replace helper 会删除当前 save 的所有 `workspaceFiles` rows，然后用传入的 workspace snapshot 重写。

因此，前端 bridge 写入的新文件不在旧 snapshot 中，会在 side-channel commit 或桌面助手 chat commit 时被删除。

另有次要但相关的诊断语义问题：

- `apps/platform-web/src/platform-host/frontend-inspector.ts` 的 `wait: "runtime-settled"` 当前只把 `interaction.sendMessage` 视为触发条件。
- 导入小说这种纯 `workspace.write` 流程虽然真实完成，却会返回内层 `ok:false / INSPECT_RUNTIME_NOT_TRIGGERED`，误导桌面助手和人工诊断。

## Requirements

### R1 — Side-channel workspace commit must preserve external writes

`interaction.invokeAgent` 的 side-channel workspace 提交不得用调用开始时的旧 snapshot 全量替换当前 save workspace。

- 只提交 side-channel transaction 自己明确写入或删除的路径。
- 未被该 transaction 触碰的当前 DB 文件必须保留，包括 side-channel 调用期间由 `/play` frontend bridge `workspace.write` 新增/更新的文件。
- `agent-invocation.completed` 仍必须在 workspace / checkpoint 提交持久化完成后发出。

### R2 — Checkpoint mode must checkpoint merged state, not stale state

`invokeAgent` 的 `workspace-with-checkpoint` commit mode 仍需保留 post-turn-maintenance 语义，但 checkpoint 必须基于“当前 DB 状态 + side-channel transaction 变更集”后的 merged workspace，而不是旧 transaction snapshot。

- 继续保持同 turn `after-turn` checkpoint replacement 规则。
- 如果提交失败，不得创建 maintenance checkpoint；原有 fallback checkpoint 必须保留。
- 不得把外部 frontend writes 的丢失状态固化进 checkpoint。

### R3 — `inspect_frontend` runtime-settled must support generic bridge activity

`inspect_frontend({ wait: "runtime-settled" })` 在有 actions 时应等待 actions 触发的 bridge activity settle，而不是只等待 `interaction.sendMessage`。

- `interaction.sendMessage` 仍代表正式 player turn，并继续计入 `sendCount`。
- 纯 `workspace.write` / `workspace.read` / 其它真实 bridge RPC 触发的前端工作也应能进入 wait chain，等待 in-flight 为 0 且 quiet 2 秒。
- 只有 actions 后完全没有新的 bridge activity 时，才返回 `INSPECT_RUNTIME_NOT_TRIGGERED`。

### R4 — AI-facing descriptions and specs must match new semantics

更新 `inspect_frontend` 工具 schema / 本地助手工具说明 / Trellis spec，避免继续教模型“runtime-settled 只用于 sendMessage/player turn”。

更新 storage spec 中 `invokeAgent` side-channel commit 语义，避免未来实现再回到 full snapshot replacement。

### R5 — Preserve existing boundaries

- 不创建隐藏 iframe / 私有检查目标；`inspect_frontend` 仍只操作可见 `/play` packaged iframe。
- 不新增 OS 文件选择/上传能力。
- 不重构整个 workspace storage 层。
- 不改变 Dexie schema；除非实现过程中发现必须改 schema，否则不 bump DB name。
- 不扩大到无证据的正式 `interaction.sendMessage` 主 turn 全量提交语义，除非规划中明确纳入。

## Acceptance Criteria

- [ ] 桌面助手通过 `inspect_frontend` 点击 setup wizard “导入”后，`workspace.write` activity completed，且助手本轮完成后 active save 仍保留导入产物：
  - `save/source/chapters.index.json`
  - `save/source/chapters/*.md`
  - 导入后的 `save/source/manifest.json`
- [ ] Resource Manager / IndexedDB / setup review 页面读取的 workspace 真相一致；切换章节预览不再出现因文件丢失导致的“暂无可预览内容”。
- [ ] `inspect_frontend({ actions, wait: "runtime-settled" })` 对纯 `workspace.write` 导入流程返回成功结果，而不是 `INSPECT_RUNTIME_NOT_TRIGGERED`。
- [ ] `interaction.sendMessage` 触发的正式 player turn 等待语义仍可用：send 仍计入 `sendCount`，wait 仍等待 bridge quiet。
- [ ] `invokeAgent` `workspace-with-checkpoint` 模式仍在成功提交后发出 `completed`，并保持 post-turn-maintenance checkpoint 语义。
- [ ] `npm run build:web` 通过。
- [ ] 如果修改 `packages/contracts`，则 `npm run build:contracts` 通过。

## Out of Scope

- 修复或重构无关的当前工作树已有改动。
- 添加 Playwright/CDP 级别浏览器输入能力。
- 支持助手操作浏览器外的文件选择窗口。
- 引入全局 EventBus 或新的持久化表。
- 重新设计正式 turn history/checkpoint 架构。

## Open Question

- 已决策：本任务不纳入正式 `interaction.sendMessage` 主 turn 的 full snapshot commit 语义调整。理由：当前复现与直接根因在 side-channel `invokeAgent`；正式 turn commit 涉及 history/checkpoint/turn lifecycle 核心语义，应另行评估，避免把本 bugfix 扩大为 runtime commit 架构重构。
