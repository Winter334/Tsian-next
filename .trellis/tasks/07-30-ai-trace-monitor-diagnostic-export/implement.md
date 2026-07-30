# 实施计划

1. 扩展 DebugBridge contract 与 host 查询/订阅接口。
2. 实现 Trace 列表/详情组件、过滤、分页、复制和健康警告。
3. 把 Overview 统计切换到统一 summaries，移除旧 AI Debug/Runtime Trace UI 及其 query/bridge 调用，不保留兼容入口。
4. 实现诊断包纯构建服务、50 条+关系闭包算法和 zip 文件结构测试。
5. 增加复现步骤导出对话框与下载动作，不增加内容/时间选项。
6. 运行 contracts/web build、bundle 定向测试与旧查询反向搜索。

显式前置：核心子任务未完成不得开始。高风险文件是 `packages/contracts/src/bridge.ts`、`DebugView.vue` 和新导出服务。
