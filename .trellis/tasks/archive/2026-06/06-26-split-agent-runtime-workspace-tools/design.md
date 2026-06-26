# Design — 拆分 agent-runtime/workspace-tools.ts

> 共享约定见父任务 `design.md`。验收按轻量标准(build green + 导出面等价 + class identity 查)。

## 1. 文件结构分析

`workspace-tools.ts`（2461 行，35 export = 24 类型 + 11 函数/const）分三块：

| 区段 | 行 | 内容 |
|------|----|------|
| 类型/契约层 | 25-360 | 24 export 类型 + 8 内部类型 + RUNTIME_WORKSPACE_TOOL_NAMES + WORKSPACE_OPERATION_TOOL_NAMES + isWorkspaceOperationToolName |
| 解析层 | 362-738 | pattern 常量 + parse/strip/extract + 通用 helper(isRecord/toolError) + trace emit |
| 执行层 | 739-2461 | skill 加载/激活/执行 + action executor + inspect + agentcall + workspace op + 调度 + 格式化 |

无 module-level mutable state（全 const）。

## 2. Seam 分组

### Seam 1 → `workspace-tools-types.ts`（类型/契约层）
- 25-360 整体移出：24 个原 export 类型/const + 8 内部类型 + WORKSPACE_OPERATION_TOOL_NAMES + isWorkspaceOperationToolName
- 原 24 export 保持 export（barrel re-export）；原内部符号加 export（主文件 import 用，不进 barrel 公开面）
- import type：contracts、./trace、./workspace-operations（均 type-only）
- 运行时：RUNTIME_WORKSPACE_TOOL_NAMES(const)、WORKSPACE_OPERATION_TOOL_NAMES(const Set)、isWorkspaceOperationToolName(function) — 不依赖运行时 import

### Seam 2（评估中）→ 解析层
parse/strip/extract + 相关 pattern。非连续块（362-365 常量 + 625-738 函数），待 Seam 1 green 后评估。

### 执行层留主文件
skill/action/tool 执行是单一职责域，高内聚，强行拆会打碎调用关系引入循环风险。

## 3. 依赖方向
```
workspace-tools-types ← (type-only) contracts / ./trace / ./workspace-operations
         ↑
workspace-tools.ts (barrel) ──→ import types + 内部符号
```
types 不 import 主文件 → 无环 ✓

## 4. 导出面等价
barrel re-export 原 24 个 public 类型/const；内部 8 类型 + 2 运行时符号不进 barrel（主文件 import）。公开面 = 原 35 个。
