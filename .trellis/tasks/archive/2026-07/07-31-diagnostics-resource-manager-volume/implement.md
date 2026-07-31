# 诊断虚拟卷资源管理器接入 — 实施计划

## 1. Contracts 与通用 workspace 能力

- [x] 在 `WorkspaceEntry`、`WorkspaceListResult`、`WorkspaceReadResult`、`WorkspaceSearchResult` 增加可选 `readOnly` 视图元数据。
- [x] 调整 virtual list/read/search 合并与返回，确保只读元数据不进入持久化记录。
- [x] 修改虚拟 mutation 守卫：copy-out 允许，只读目标、move 和其余 mutation 保持拒绝。
- [x] 为 copy 增加通用 virtual source 递归收集、完整分片读取、目标冲突预检和普通 mutation 写入。

## 2. Diagnostics volume 与资源管理器 host

- [x] 扩展 diagnostic summary service，按时间返回当前 retained summaries。
- [x] `requests/` 与 `frontend-errors/` 显式 list 时生成只读文件条目；根 list 保持静态和按需。
- [x] index/read/search/list 返回通用只读元数据。
- [x] 本地 `.tsian/` 的 list/read/search/copy execution context 挂载 diagnostics adapter；cross-root copy 同步挂载。
- [x] 保持普通/委托 Agent 不挂载，保留 reserved-prefix 防碰撞和路径规范化。

## 3. 资源管理器与文本编辑器

- [x] 资源管理器跟踪当前目录只读状态，拆分 copy 与 mutation 能力。
- [x] 只读条目仅保留打开/复制；新建、粘贴、剪切、重命名、删除及快捷键统一受守卫。
- [x] WorkspaceEditor 使用 read result 的只读状态，隐藏保存并启用 CodeMirror readonly，关闭不触发未保存确认。
- [x] 复制后的普通文件按现有编辑流程打开和保存。

## 4. 桌面助手知识

- [x] 为 `framework-knowledge` 增加面向助手的 diagnostics reference，并加入 SKILL 阅读顺序。
- [x] 说明定位、关联分析、只读与复制快照流程，不泄漏开发实现叙述。
- [x] 更新默认知识/手动刷新测试，确保已有安装可通过现有刷新入口获得新文档。

## 5. 验证与审查

- [x] 更新 workspace operation、diagnostics adapter、assistant 隔离和知识文件相关测试。
- [x] 运行 `npm run build:contracts`。
- [x] 运行相关 Vitest 文件，覆盖单文件及完整目录复制和所有只读拒绝路径。
- [x] 运行 `npm run build:web`。
- [x] 运行 `git diff --check`，确认没有恢复旧 Trace/AI Debug 路径或修改诊断 schema。

## 回滚点

- contracts 字段均为 additive optional；若 UI 接入失败，可整体回退只读元数据消费者而不影响存储。
- virtual copy-out 与现有 eager copy 在一个 operation 分支内隔离；若递归复制有问题，可回退 virtual source 分支而保持 diagnostics 读取可见。
- diagnostics 数据不迁移、不复制到新表，回滚不涉及持久化修复。
