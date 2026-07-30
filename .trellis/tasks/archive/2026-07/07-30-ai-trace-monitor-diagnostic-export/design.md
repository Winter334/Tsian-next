# 监视器与诊断包设计

遵循父任务 `design.md` 第 5–6 节。

## UI

将 Trace 提取为独立 debug component，避免继续膨胀 `DebugView.vue`。列表只取 summary/page，选中后按 ID 拉正文；筛选变更重置 cursor。旧 AI Debug、runtime-diagnostics、runtime-trace 查询从主 UI 移除，检查点 Recovery 保留。

bridge/debug API 提供：分页 summary 查询、单条读取、filter facets、健康状态、导出 Blob 与 Trace 更新订阅。UI 不直接访问 Dexie。

## 导出

`diagnostic-bundle.ts` 完成锚点选择、50 条 query、关系闭包、二次脱敏和 `fflate` zip。文件内容由确定性纯函数生成，便于快照/解压测试。浏览器下载沿用 Blob + object URL 模式并及时 revoke。
