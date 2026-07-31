# 诊断虚拟卷资源管理器接入

## Goal

让玩家和桌面助手通过同一套 workspace 文件系统心智发现、浏览、搜索和读取平台诊断记录。诊断记录保持只读和实时，不产生第二份持久化副本；需要整理时可以复制到普通可写位置形成独立快照。

## Background

- 当前统一诊断的权威数据位于 IndexedDB `diagnosticRecords`，保留 7 天且最多 100 MiB。
- `.tsian/local/diagnostics/**` 已提供按需虚拟 list/read/search，但只挂载给桌面助手；资源管理器的本地 `.tsian/` 路径没有挂载该适配器，因此完全不可见。
- 当前虚拟目录仅列出 `index.jsonl`、`requests/` 和 `frontend-errors/`；两个记录目录不会枚举 retained records，所有 mutation（包括从诊断路径复制出去）都会被 `WORKSPACE_VIRTUAL_READ_ONLY` 拒绝。
- 资源管理器当前默认将文本文件以可编辑模式打开，并把复制、剪切、重命名和删除统一视为“可修改”，缺少通用只读条目语义。
- 历史任务已经确定 diagnostics 不进入 eager workspace snapshot、不挂载给运行时或委托 Agent、不迁移旧 Trace；本任务保留这些边界，只补齐资源管理器和复制能力。

## Requirements

1. 资源管理器的“本地存储”正常显示 `.tsian/local/diagnostics/`、`index.jsonl`、`requests/`、`frontend-errors/` 及其当前保留记录，不增加诊断专用页面或专用浏览交互。
2. 资源管理器与桌面助手读取同一 `diagnosticRecords` 权威数据；记录继续按需生成 JSON，不写入 `workspaceFiles`、本地助手文件表或 Save/checkpoint。
3. workspace 的目录、文件和读取结果具备通用只读语义。只读诊断内容可以打开、搜索和复制；不能新建、粘贴、编辑、覆盖、剪切、移动、重命名或删除。
4. 文本编辑器以普通只读模式打开诊断文件：内容可选择和复制，但不可修改或保存，不产生未保存变更提示。
5. 单个诊断文件及整个 `diagnostics/`、`requests/`、`frontend-errors/` 目录均可递归复制到普通可写路径。目标是完整、独立、可编辑的普通 workspace 快照；后续 Trace 更新或清理不影响副本。
6. diagnostics 仍只对平台所有者资源管理器和 trusted desktop assistant 可见。普通运行时 Agent、委托 Agent、Skill 和游戏前端继续不可见。
7. 桌面助手的 framework knowledge 增加面向助手自身的诊断说明：何时查看、如何从 index 找记录、如何读取关联请求、如何判断失败与后续成功、只读边界，以及需要整理时复制到工作文件。文案不解释 IndexedDB、adapter、表结构或开发实现原因。
8. 现有 7 天/100 MiB 保留、凭据脱敏、诊断包、Trace UI 与旧 Trace 不兼容策略保持不变。

## Acceptance Criteria

- [x] AC1：从资源管理器“本地存储”可逐层进入 `.tsian/local/diagnostics/`，并看到 index、请求和前端错误记录。
- [x] AC2：打开诊断 JSON/JSONL 时使用普通文本查看界面，但编辑与保存不可用，关闭时不出现未保存提示。
- [x] AC3：单个诊断文件和整个诊断目录均可复制到可写 workspace；副本内容完整、可编辑，并与原记录解除同步。
- [x] AC4：诊断路径上的新建、粘贴、写入、编辑、剪切、移动、重命名和删除均不可用或稳定返回只读错误。
- [x] AC5：资源管理器搜索 `.tsian/local/diagnostics/**` 能返回记录路径和内容匹配；读取仍按需执行，不把诊断集加入普通 workspace 快照。
- [x] AC6：普通运行时 Agent 与委托 Agent无法 list/read/search diagnostics，桌面助手既有读取能力不回归。
- [x] AC7：桌面助手官方知识以任务口吻准确说明诊断资源的使用方式和只读边界，不包含面向开发者的实现解释。
- [x] AC8：相关 contracts、workspace operation、adapter、资源管理器/编辑器和知识刷新测试通过，`build:contracts` 与 `build:web` 通过。

## Out of Scope

- 修改诊断记录内容、删除/清空诊断记录或调整保留策略。
- 把 diagnostics 物化为普通 workspace 文件或增加第二份存储。
- 向运行时 Agent、委托 Agent、Skill 或游戏前端开放诊断资源。
- 修改 Trace 监视器、诊断包格式、诊断 schema 或旧 Trace 兼容策略。
- 设计 diagnostics 专用编辑器、浏览器、工具栏或管理页面。
