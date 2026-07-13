# Implement：stage-manager 回合后维护优化

## 执行顺序

### Phase 1：scene 自动清理 hook

- [ ] 1.1 `apps/platform-web/src/platform-host/index.ts`：在 invokeAgent 写 trace 后、`finalWorkspaceChanges()` 前，新增 `cleanupScenesInTransaction(workspaceTransaction!)` 调用。gate on `commitMode === "workspace-with-checkpoint"`。helper 内部失败只 warn 不中断。
- [ ] 1.2 新建 `apps/platform-web/src/platform-host/scene-cleanup.ts`：导出 `cleanupScenesInTransaction(transaction: RuntimeWorkspaceTransaction): void`。逻辑：从 `transaction.workspaceFiles` 读 runtime.json → 提取 activeSceneRefs Set → 过滤 `save/scenes/*.json` → 逐个解析 → 不在 activeSet 且 status !== "background" → `transaction.delete(scenePath)`。轻量 log 记录 staged 删除列表。
- [ ] 1.3 `platform-host/index.ts`：import `cleanupScenesInTransaction`，在 hook 位置调用。

### Phase 2：previousTurnBody 字段

- [ ] 2.1 `apps/platform-web/src/storage/workspace-templates.ts`：`STAGE_MANAGER_READ_MAINTENANCE_CONTEXT_RUN_JS`，在 readMaintenanceContext 里 turn 确定后，加读 turn-1 正文逻辑。turn > 1 时 findTurnFile(turn-1) + extractTurnBody → previousTurnBody；否则 null。
- [ ] 2.2 run.js output 对象加 `previousTurnBody` 字段。
- [ ] 2.3 run.js trace 调用加 `previousTurnBody: !!previousTurnBody`（只记 presence，不记内容）。

### Phase 3：frontier 去冗余 + 措辞修正

- [ ] 3.1 `workspace-templates.ts:3059`：删 stage-manager agent.json contextPaths 的 frontier.json 条目。
- [ ] 3.2 `workspace-templates.ts:3111`：AGENT.md plotOrder 措辞改为"用 read_maintenance_context 返回的 timeline.sourceAnchors"。
- [ ] 3.3 `workspace-templates.ts:3115`：AGENT.md player 锚点措辞改为"用 read_maintenance_context 返回的 timeline"。
- [ ] 3.4 `workspace-templates.ts:1289`：SKILL plotOrder 措辞改。
- [ ] 3.5 `workspace-templates.ts:1299`：SKILL plotOrder 映射步骤 1 改。
- [ ] 3.6 `workspace-templates.ts:1330`：SKILL player 锚点措辞改。
- [ ] 3.7 `workspace-templates.ts:1047`：tool.json includeTimeline 描述去 "frontier.json" 提及。
- [ ] 3.8 SKILL scene 维护段 + 回退流程段：加"清理由平台自动执行，模型只更新 activeSceneRefs，想保留写 background"措辞。

### Phase 4：sceneCleanupCandidates 字段移除

- [ ] 4.1 `workspace-templates.ts` run.js：删除 `sceneCleanupCandidates` 扫描/输出逻辑（`glob save/scenes/*.json` + 候选构造）。清理由平台 hook 负责，不再让模型看候选。
- [ ] 4.2 `workspace-templates.ts` run.js：trace 删除 `cleanupCandidates` 字段。
- [ ] 4.3 `workspace-templates.ts` AGENT.md/SKILL：删除/改写任何让模型处理 scene 清理候选的措辞，只保留"维护 activeSceneRefs；要保留长期据点写 background；离开 scene 由平台自动清理"。

### Phase 5：验证

- [ ] 5.1 类型检查：`cd F:/workspace/Tsian && pnpm tsc --noEmit`
- [ ] 5.2 build:web：`npm run build:web`
- [ ] 5.3 grep 零 trace：stage-manager AGENT.md/SKILL 内容里 "frontier.json" 零命中
- [ ] 5.4 grep 零 trace：stage-manager AGENT.md/SKILL 里 "读.*frontier" 零命中
- [ ] 5.5 scene-cleanup hook 逻辑验证：active scene 不删、background 不删、离开的删、runtime 缺失跳过
- [ ] 5.6 previousTurnBody：turn=1 时 null、turn>1 时有值、turn 文件缺失时 null

## 验证命令

```bash
# 类型检查
cd F:/workspace/Tsian && pnpm tsc --noEmit

# build:web（覆盖 workspace-templates + platform-host 改动）
cd F:/workspace/Tsian/apps/platform-web && npm run build:web

# grep 零 trace 检查（stage-manager 相关内容不应再提 frontier.json）
# 注意：world-architect/researcher 的 frontier.json 引用不动，只查 stage-manager
cd F:/workspace/Tsian && rg -n "frontier\.json" apps/platform-web/src/storage/workspace-templates.ts
# 预期：只命中 world-architect/researcher/README 等非 stage-manager 行
```

## 回滚点

- Phase 1（hook）独立，可单独回滚（删 scene-cleanup.ts + 删 index.ts 调用）。
- Phase 2（previousTurnBody）独立，可单独回滚（删 run.js 加的几行）。
- Phase 3（frontier 去冗余）独立，可单独回滚（恢复 contextPaths + 措辞）。
- 三条线无依赖，可按任意顺序实现，但建议 hook 先行（风险最高，先验证）。
