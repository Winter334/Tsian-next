# 实施计划

1. 增加 contract 类型、Dexie 联合表和 CRUD/query/retention 测试。
2. 实现共享脱敏、size 计算、写队列、健康状态和中断恢复。
3. 为 `withAiRequestRetry` 增加 attempt observer，并用 recorder 重构四种 AI 请求函数。
4. 在线程/助手/`invokeAgent` 入口创建通用 operation context；让工具轮次和委派 fork 关系可追踪。
5. 安装全局前端错误收集器并验证去重/递归保护。
6. 停止旧 Runtime Trace 与 AI Debug 的新写入，并删除旧 parser、resource query 和 DebugBridge 读取入口；反向搜索 writer/reader 两侧。
7. 运行定向测试、contracts build、web build 和 diff check。

依赖/交付：本任务必须先完成；完成后监视器/导出和 workspace 子任务才可开始。高风险文件包括 `storage/db.ts`、`runtime-host/ai/calls.ts`、`agent-runtime/index.ts` 与三个 host 入口。
