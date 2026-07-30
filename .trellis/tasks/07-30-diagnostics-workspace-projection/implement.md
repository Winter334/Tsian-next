# 实施计划

1. 定义通用 virtual read adapter 类型并接入 workspace list/read/search。
2. 实现 diagnostics path 规范化、index 分页、按 ID JSON 和 cursor search。
3. 从 Agent Runtime capabilities 透传 adapter，只在桌面助手入口注入。
4. 在所有 mutation 操作前拒绝 diagnostics 前缀。
5. 增加单元/集成测试：可发现、按需读、搜索、只读、普通 Agent 不可见、无全量预载。
6. 运行 web build 和 workspace 相关回归测试。

显式前置：核心子任务未完成不得开始。高风险文件是 `workspace-operations.ts`、workspace tool context、`assistant-chat.ts` 与 host workspace 路由。
