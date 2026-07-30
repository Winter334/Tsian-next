# 诊断 Trace workspace 只读投影

## Goal

让桌面助手通过已有 workspace list/read/search 按需读取统一 Trace，并可据此修改真实故障文件，同时不复制、不预载和不允许修改诊断数据。

## Requirements

- 提供 `.tsian/local/diagnostics/index.jsonl`、`requests/<requestId>.json`、`frontend-errors/<errorId>.json` 虚拟路径。
- 投影直接读取统一 IndexedDB 权威表，不持久化第二份文件。
- 保持现有 Agent-facing 工具名称和参数；仅在内部注入 list/read/search 虚拟适配器。
- 桌面助手可访问，普通运行时 Agent 不挂载诊断适配器。
- index 支持 offset/limit；request/error 按 ID 单条读取；search 按 cursor 扫描并在 limit 达到后停止。
- write/edit/delete/move/copy 对 diagnostics 前缀明确返回只读错误，level 4 不例外。
- 桌面助手未显式读取时，不把最多 100 MiB Trace 合并进每轮 workspace snapshot。

## Acceptance Criteria

- [ ] 桌面助手能 list 出目录/index，read 完整请求或错误，search 命中诊断正文。
- [ ] 同一 ID 的虚拟 JSON 与 IndexedDB 权威记录一致，无第二份持久化数据。
- [ ] 普通游戏 Agent 不可看到该投影。
- [ ] 对 diagnostics 路径的所有变更操作稳定失败，实际卡/存档/frontend 文件仍可修改。
- [ ] 未读诊断时助手单轮初始化不枚举/序列化完整 Trace；读取单条不会加载整个保留集。

## Out of Scope

- 新增 `read_diagnostics` Agent 工具、写回 Trace 或通过 workspace 删除历史。
- 把 diagnostics 加入 checkpoint、卡包、存档备份或助手上下文注入。

## Dependencies

- 必须等待 `07-30-unified-ai-trace-core` 提供按 ID、分页 cursor 和搜索所需的存储接口。
