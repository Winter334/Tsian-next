# 诊断虚拟卷资源管理器接入 — 技术设计

## 1. 设计目标与边界

本任务把 diagnostics 从“桌面助手专用隐藏读取适配器”提升为平台所有者可见的通用只读 workspace volume。权威数据仍是 `diagnosticRecords`；资源管理器和桌面助手只消费同一虚拟投影，不创建持久化副本。

不改变以下边界：

- diagnostics 不进入 eager `workspaceFiles` snapshot、Save 或 checkpoint。
- 普通运行时 Agent、委托 Agent、Skill 和游戏前端不挂载 diagnostics adapter。
- 诊断记录不可写、编辑、剪切、移动、重命名或删除。
- Trace schema、保留策略、脱敏和诊断包不变。

## 2. 通用只读契约

在 contracts 的 workspace 结果上增加可选展示能力：

```ts
interface WorkspaceEntry {
  // existing fields
  readOnly?: boolean
}

interface WorkspaceListResult {
  path: string
  entries: WorkspaceEntry[]
  readOnly?: boolean
}

interface WorkspaceReadResult extends WorkspaceFile {
  // existing slice metadata
  readOnly?: boolean
}

interface WorkspaceSearchResult {
  // existing fields
  readOnly?: boolean
}
```

这些字段是读取视图元数据，不进入 `LocalWorkspaceFileRecord` 或任何持久化文件。资源管理器和编辑器依赖该通用能力，不在组件里硬编码 diagnostics 路径来判断可写性。

## 3. 虚拟目录投影

`createDiagnosticsWorkspaceAdapter()` 继续拥有：

```text
.tsian/local/diagnostics/
  index.jsonl
  requests/<request-id>.json
  frontend-errors/<error-id>.json
```

- `.tsian/local` 和 diagnostics 根仍使用静态目录项，不读取 retained records。
- 用户或助手显式打开 `requests/`、`frontend-errors/` 时，才读取现有 diagnostic summary cache，按 `timestamp` 新到旧生成文件条目。
- 每个条目带 `readOnly: true`、`size` 和 `updatedAt`；目录 list result 也带 `readOnly: true`。
- index、单条 record 和搜索结果带 `readOnly: true`。
- 记录目录枚举是显式用户操作，受现有 7 天/100 MiB 上限约束；不引入 diagnostics 专用分页 UI。

资源管理器本地 `.tsian/` 的 list/read/search execution context 挂载同一个 diagnostics adapter。普通/委托 Agent 的 context 保持不挂载。

## 4. 只读源复制

“只读”约束按操作方向拆分：

| 操作 | 诊断源路径 | 诊断目标路径 |
|---|---:|---:|
| read/list/search | 允许 | — |
| copy | 允许 | 禁止 |
| write/edit/delete | 禁止 | 禁止 |
| move/cut/rename | 禁止 | 禁止 |

workspace copy 在 eager snapshot 找不到源路径时，可从 `virtualReads` 收集源：

1. 单文件通过 virtual read 获取完整正文；若返回 `truncated`，按 offset/limit 续读直至完整。
2. 目录通过 virtual list 递归枚举文件，再逐文件读取。
3. 写入前完成目标路径冲突与权限检查。
4. 使用既有 mutation adapter 写入普通目标 volume，保持原目录结构。
5. 副本不携带 `readOnly` 元数据，成为普通可编辑文件。

该能力属于通用 virtual read adapter，不为 diagnostics 在资源管理器 host 中编写旁路复制逻辑。`move` 仍需要删除源，因此不允许从只读 volume 发起。

## 5. 资源管理器和编辑器

资源管理器从 list result/entry 的 `readOnly` 元数据得到当前目录与条目能力：

- 只读条目保留打开和复制。
- 隐藏或禁用剪切、重命名、删除。
- 只读目录内隐藏或禁用新建、粘贴。
- Ctrl+C 可用；Ctrl+X、Delete、F2 和 Ctrl+V 走同一通用能力守卫。

WorkspaceEditor 从 read result 接收 `readOnly`：

- CodeMirror 使用现有 `readonly` prop。
- 隐藏保存按钮，标题显示普通“只读文件”状态。
- 不产生 draft change 和 before-close 保存提示。
- 仍允许文本选择和系统剪贴板复制。

不增加 diagnostics 专用窗口、工具栏、对话框或样式体系。

## 6. 桌面助手知识

在官方 `framework-knowledge` 中增加 diagnostics reference，并更新 Skill 阅读顺序。内容直接面向桌面助手：

- 何时读取诊断资源。
- 先从 `index.jsonl` 或 search 找相关 ID，再读取 request/frontend-error 正文。
- 结合 status、attempts、error、parent/previous/operation 关系判断问题；不要只看一条摘要就下结论。
- 原记录只读且会随保留策略变化；需要标注或长期保存时复制到工作文件，明确其为快照。
- 不尝试写入、移动或删除诊断资源。

文案不出现 IndexedDB、Dexie、adapter、table、actor level 或开发侧实现原因。新安装使用更新后的默认知识；已有安装通过现有“更新助手知识”流程刷新官方文件。

## 7. 兼容与风险

- 新 contracts 字段全部可选，旧消费者不受影响。
- diagnostics 路径与 record JSON 格式不变。
- 显式打开或递归复制整个目录可能处理接近 100 MiB 数据；这是用户主动操作，使用现有保留上限作为边界，不增加特殊确认交互。
- 复制需要在写入前检查所有目标冲突，避免中途因已存在文件留下部分副本。
- 虚拟路径规范化仍先于只读判断，防止 `..` 或反斜线绕过。

## 8. 验证

- contracts 可选只读字段类型与构建。
- virtual adapter 的静态根、显式记录枚举、按需读取和搜索。
- 单文件/完整目录 copy-out、完整 index 分页读取、目标冲突预检和只读目标拒绝。
- write/edit/delete/move/copy-in 路径规范化拒绝。
- 资源管理器只读能力与编辑器只读状态。
- 桌面助手可见、普通与委托 Agent 隔离。
- framework knowledge 默认/刷新文件内容。
- `npm run build:contracts`、相关 Vitest、`npm run build:web`、`git diff --check`。
