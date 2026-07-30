# 总体实施计划

## 执行顺序

1. 启动并完成 `07-30-unified-ai-trace-core`。
2. 核心契约稳定后，并行实施：
   - `07-30-ai-trace-monitor-diagnostic-export`
   - `07-30-diagnostics-workspace-projection`
3. 回到父任务执行跨子任务集成检查，不直接新增第四套实现。

## 集成检查清单

- [ ] 正式回合、`invokeAgent`、桌面助手均只通过 AI 调用层写统一记录。
- [ ] 三个入口并发和失败重试不会覆盖 request，关联链可被完整查询。
- [ ] 旧 `.tsian/**/traces` 与 `AiDebugRecord` 不再接收新写入。
- [ ] 旧 runtime-trace、runtime-diagnostics、ai-debug parser/query/bridge 读取入口已移除；旧数据不会混入任何新视图或导出。
- [ ] 监视器、诊断包和 workspace 投影读取同一 `diagnosticRecords` 权威表。
- [ ] 本机持久化和导出均通过同一凭据脱敏器。
- [ ] 7 天、100 MiB、50 条导出、完整关联链规则均有自动测试。
- [ ] 桌面助手未读取 diagnostics 时不加载完整 Trace，写入 diagnostics 路径失败。

## 验证命令

```bash
npm run build:contracts
npm exec vitest run -- apps/platform-web/src/storage/diagnostic-records.test.ts apps/platform-web/src/runtime-host/ai/trace-recorder.test.ts apps/platform-web/src/platform-host/diagnostic-bundle.test.ts apps/platform-web/src/platform-host/diagnostics-workspace.test.ts
npm run build:web
git diff --check
```

补充反向搜索：

```bash
rg -n "pushAiDebugRecord|appendAiDebugRecord|formatAgentTracePath|assistantTracePath|stageRuntimeTraceFile" apps/platform-web/src
rg -n "runtime-trace|runtime-diagnostics|getAiDebugRecords" apps/platform-web/src/views apps/platform-web/src/platform-host
```

允许保留的旧路径命中只能服务 save 删除、恢复时的遗留文件清理；不得保留旧诊断 parser、query、bridge、UI 或导出读取。

## 风险与回滚点

- 核心子任务合入前先验证 Dexie 升级不会清空既有表。
- 监视器切换数据源前保留可独立验证的查询服务，避免 UI 与存储同时失效时难定位。
- workspace 虚拟适配器必须先有纯 list/read/search 测试，再接入桌面助手 runtime。
- 任一子任务失败可独立回滚；核心和监视器子任务必须在各自验收中同步移除旧读取入口，不能以“临时兼容”留到后续。
