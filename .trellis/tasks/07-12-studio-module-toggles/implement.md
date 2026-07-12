# Implement: Studio 运行配置新增规则模块开关

## 执行清单

### Step 1: studio-agents.ts — snapshot 增强 + 写入函数
- [ ] 新增 `PlatformStudioModuleInfo` interface
- [ ] `PlatformStudioSnapshot` 新增 `modules: PlatformStudioModuleInfo[]` 字段
- [ ] `getPlatformStudioSnapshot` 中扫描 files 发现 `agents/<id>/modules/*.md`，提取 stem 和 title
- [ ] 新增 `PlatformStudioAgentModuleToggleInput` interface
- [ ] 新增 `updatePlatformStudioAgentModuleEnabled` 函数（模式同 `updatePlatformStudioAgentSkillEnabled`）
- [ ] 验证：`npx tsc --noEmit -p apps/platform-web/tsconfig.json`

### Step 2: platform-host/index.ts — RPC 注册
- [ ] 检查现有 studio RPC 注册模式（`updatePlatformStudioAgentSkillEnabled` 如何暴露）
- [ ] 注册 `studio.updateAgentModuleEnabled` RPC
- [ ] 验证：`npx tsc --noEmit -p apps/platform-web/tsconfig.json`

### Step 3: StudioView.vue — UI 区域
- [ ] 新增 `modulesForSelectedAgent` computed
- [ ] 新增 `isModuleEnabled(agent, stem)` 辅助函数
- [ ] 新增 `toggleModule(stem, enabled)` 异步函数（调用 RPC + refreshSnapshot）
- [ ] 在运行配置 tab 能力开关区域之后新增"规则模块"区域（v-if modules.length > 0）
- [ ] 每个模块一个 Switch + title 显示
- [ ] 验证：`cd apps/platform-web && npm run build`

### Step 4: Build 验证
- [ ] `cd apps/platform-web && npm run build`
- [ ] 确认无 type error

## 验证命令

```bash
npx tsc --noEmit -p apps/platform-web/tsconfig.json
cd apps/platform-web && npm run build
```

## 风险文件

| 文件 | 风险 | 回滚点 |
|---|---|---|
| `studio-agents.ts` | snapshot 结构变更影响 StudioView | Step 1 完成后 typecheck |
| `StudioView.vue` | UI 改动 | Step 3 完成后 build |
| `index.ts` | RPC 注册遗漏 | Step 2 完成后 typecheck |
