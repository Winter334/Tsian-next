# workspace 投影设计

遵循父任务 `design.md` 第 7 节。

## 内部契约

为 `executeWorkspaceOperation` context 增加可选 virtual read adapter，分别处理 list/read/search 并与普通 snapshot 结果合并。adapter 只接受固定 diagnostics 前缀；其余路径返回未处理，保持现有调用方兼容。

Agent Runtime capabilities 和 workspace tool context 只透传 adapter，不新增工具。桌面助手 host 注入 IndexedDB-backed adapter；正式回合和 `invokeAgent` 不注入。

写路径在 operation 层先检查只读虚拟前缀，避免落入现有 platform-meta mutation 分支。搜索逐记录序列化匹配并遵循现有 limit/contextLines 结果形状。
