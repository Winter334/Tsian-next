# 开局设定检查点：前端创建 API + 替换 initial

## Goal

开局向导结束后，前端调用新 API 创建 turn 0 `manual` 检查点（含设定后的 workspace 快照），同时删除旧的 `initial` 检查点（空模板）。玩家回溯 turn 0 时回到"开局设定完成"状态，而非"未开局"状态。

## Background

当前流程：setup wizard 多轮 `invokeAgent("world-architect", ..., { commitMode: "workspace" })` 写入 traits/setup-summary/opening-narrative 等文件，但不创建检查点。`onEnterPlay` 翻转到 play 模式，也没创建检查点。回溯到 turn 0 的 `initial` 检查点 → workspace 文件回滚到初始空模板 → **所有开局设定丢失**。

修复后：`onEnterPlay` 时创建 turn 0 `manual` 检查点（"开局设定"）+ 删除 turn 0 `initial` 检查点（"初始状态"）。turn 0 始终只有一个检查点——开局设定完成后的状态。

## Requirements

### R1: 存储层 — replaceInitialCheckpointForSave
- `checkpoints.ts` 新增 `replaceInitialCheckpointForSave(saveId, { turn, label })`：
  - 调 `buildCheckpointRecordForSave` 建 `reason: "manual"` checkpoint record（事务外哈希）
  - 在一个 Dexie 事务内：`localDb.checkpoints.put(newRecord)` + 删除该 save 的所有 `reason: "initial"` checkpoint
  - 返回 `LocalCheckpointSummary`

### R2: 平台 host — create-checkpoint action
- `executePlatformAction` 新增 `request.action === "create-checkpoint"` 分支：
  - 校验 activeSaveId 存在
  - 取 `params.label`（可选 string）
  - 调 `replaceInitialCheckpointForSave(activeSaveId, { turn: 0, label: label ?? "开局设定" })`
  - 返回 `{ ok: true, item: summary }`
  - 失败走 `actionError`

### R3: bridge SDK — tsian.checkpoints.create
- `tsian-api.ts` `checkpoints` 对象新增 `create(label?: string): Promise<CheckpointSummary>` 方法
- 调 `platform.runAction({ action: "create-checkpoint", params: label ? { label } : {} })`
- 结果解包：`result.ok` → `result.item as CheckpointSummary`；`!result.ok` → throw error

### R4: 前端 — App.vue onEnterPlay 调 checkpoints.create
- `onEnterPlay` 在 `loadOpeningNarrative()` 之后、`enterPlayPending = true` 之前调 `tsian.checkpoints.create("开局设定")`
- 失败不阻塞进入游戏（console.error + 继续），检查点是安全增强不是必须条件

## Acceptance Criteria

- [x] `checkpoints.ts` 导出 `replaceInitialCheckpointForSave`，创建 manual checkpoint + 同事务删 initial
- [x] `executePlatformAction` 支持 `create-checkpoint` action，返回 checkpoint summary
- [x] `tsian.checkpoints.create(label?)` 可用，返回 `CheckpointSummary`
- [x] App.vue `onEnterPlay` 调 `checkpoints.create("开局设定")`，失败不阻塞
- [ ] setup 完成后回溯 turn 0 → 回到"开局设定完成"状态（非空模板）— 待浏览器验证
- [x] `build:web` + play-frontend-dev build 通过
- [x] `build:contracts` 通过（action 是 plain string，预期无 contracts 改动）

## Out of Scope

- contracts 层 PlatformActionName 类型收紧（action 是 plain string，不改为 union）
- 检查点列表 UI 展示优化（两个检查点共存问题已由"替换 initial"消除）
- setup 过程中中途创建检查点（仅最终 enterPlay 时创建一次）
