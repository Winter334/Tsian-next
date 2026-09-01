# Design — 拆分 storage/workspace.ts

> 共享拆分约定见父任务 `design.md`（barrel re-export、seam-based、一 seam 一 commit + green build、标记锚点提取、防循环、accessor）。本文件补充 `storage/workspace.ts` 的 seam 细节。

## 1. 文件结构分析

`storage/workspace.ts`（2284 行）分两大块：

| 区段 | 行 | 内容 | 性质 |
|------|----|------|------|
| imports | 1-24 | contracts / lib / 同目录 db、game-cards | — |
| 类型/errors | 25-55 | CheckpointWorkspaceFile、WorkspaceListInput、WorkspaceWriteInput、RuntimeWorkspaceTransaction、WorkspaceStorageError | 共享底层 |
| **块 A：模板数据** | 57-1506 | ~1450 行纯 const 字符串数组（SKILL_MD、SCRIPT_JS、DEFAULT_WORKSPACE_FILES、DEFAULT_SAVE_RUNTIME_FILES 等）+ agentConfigContent helper | 纯数据，占 63% |
| **块 B：逻辑** | 1488-2284 | 路径判定 + 文件转换 + manifest + CRUD + transaction + list/read/write/delete | 运行时逻辑 |

## 2. Seam 分组（3 子模块 + barrel）

### Seam 1 → `workspace-types.ts`（底层，先建）
- `CheckpointWorkspaceFile`（type）
- `WorkspaceListInput`、`WorkspaceWriteInput`、`RuntimeWorkspaceTransaction`（interface）
- `WorkspaceStorageError`（class）
- import：`@tsian/contracts`（LocalWorkspaceFileRecord type）、`./db`（LocalWorkspaceFileRecord）
- **不 import 任何 workspace 子模块** → 底层无环

### Seam 2 → `workspace-templates.ts`（最大收益）
块 A 全部内容移出：
- **export**（主文件内部用）：`DEFAULT_WORKSPACE_VERSION`、`WORKSPACE_MANIFEST_PATH`、`DEFAULT_SAVE_RUNTIME_UPGRADE_FILE_PATHS`、`DEFAULT_WORKSPACE_FILES`、`RUNTIME_DEFAULT_CARD_PATHS`、`DEFAULT_SAVE_RUNTIME_FILES`
- **不 export**（templates 内部用）：`MEMORY_MAINTENANCE_*`、`ENTITY_READER_*`、`WORLD_STATE_MAINTENANCE_*`、`TSIAN_FRAMEWORK_KNOWLEDGE_MD`、`agentConfigContent`
- import：`type { AgentConfig } from "@tsian/contracts"`（agentConfigContent 用）
- 不依赖任何 workspace 子模块 → 单向
- **拆后主文件立即从 2284 → ~830 行（降 63%）**

### Seam 3 → `workspace-paths.ts`
路径判定/断言函数移出：
- `normalizeWorkspaceFilePath`（export）、`normalizeWorkspaceTargetPath`、`normalizeDirectoryPath`（内部）
- `isPlatformMetadataPath`、`isActiveSaveRuntimePath`、`isSaveRuntimePersistencePath`、`isOrdinaryWorkspacePath`（export）
- `assertOrdinarySaveRuntimeMutationPath`、`assertOrdinaryReadPath`、`assertPlatformSaveRuntimeMutationPath`、`fileName`（内部）
- import：`{ WorkspaceStorageError } from "./workspace-types"`、`{ normalizeWorkspacePath } from "@/lib/workspace-path"`
- 依赖 types → **Seam 3 必须在 Seam 1 之后**

### 主文件 `workspace.ts`（barrel + 核心实现）
保留 CRUD/transaction/list/read/write/manifest 实现 + barrel re-export。

## 3. 依赖方向（无环证明）

```
workspace-types  ←  workspace-paths
       ↑                    ↑
       |                    |
workspace-templates    (paths import types)
       ↑
       |
  workspace.ts (barrel)  ──→ import types + templates + paths
```

- types：不 import 任何子模块 ✓
- templates：仅 import contracts type ✓
- paths：import types + lib/workspace-path ✓
- 主文件：import types + templates + paths ✓
- **无 index ↔ sub-module 循环** ✓

## 4. 导出面等价策略（强制）

原 31 个 public export 分布：
- workspace-types.ts：5 个（CheckpointWorkspaceFile、WorkspaceListInput、WorkspaceWriteInput、RuntimeWorkspaceTransaction、WorkspaceStorageError）
- workspace-paths.ts：5 个（normalizeWorkspaceFilePath、isPlatformMetadataPath、isActiveSaveRuntimePath、isSaveRuntimePersistencePath、isOrdinaryWorkspacePath）
- workspace.ts（自身直接 export）：21 个（createDefault*、toWorkspaceFileFromGameCardContent、createLocalWorkspaceFileRecord、initialize/list/read/createRuntimeWorkspaceTransaction/write/delete/replace 系列）

**barrel 用显式 re-export，不用 `export *`**：
```ts
// workspace.ts barrel 区
export type { CheckpointWorkspaceFile, WorkspaceListInput, WorkspaceWriteInput, RuntimeWorkspaceTransaction } from "./workspace-types"
export { WorkspaceStorageError } from "./workspace-types"
export { normalizeWorkspaceFilePath, isPlatformMetadataPath, isActiveSaveRuntimePath, isSaveRuntimePersistencePath, isOrdinaryWorkspacePath } from "./workspace-paths"
```

**为何不用 `export *`**：templates 模块会 export 内部常量（DEFAULT_WORKSPACE_FILES 等，主文件需 import），`export *` 会把它们泄漏到公开面 → 导出面膨胀 ≠ 原 31 个。显式 re-export 精确等价。

模板常量在主文件用 `import { DEFAULT_WORKSPACE_FILES, ... } from "./workspace-templates"`（内部使用，不 re-export）。

## 5. 提取策略（标记锚点，不依赖行号）

用 node 脚本基于**内容标记**切分（非行号）：
- 块 A 起始锚：`const DEFAULT_WORKSPACE_VERSION = 8`（文件中唯一）
- 块 A 终止锚：`function createTableId(saveId: string, path: string)`（块 B 首行，唯一）
- 脚本提取两锚之间的内容 → workspace-templates.ts，原文件该段替换为 import 语句
- types/paths 块同理用各自首尾唯一字符串作锚

提取后：常量加 `export` 关键字（仅主文件需 import 的 6 个），import 语句调整，`npm run build:web` green。

## 6. 权衡

- 拆 3 子模块 + barrel 是否过度？主文件拆后 ~650 行做 save-level CRUD + transaction + manifest，内聚。types(30行) 拆出是为给 paths 防循环；templates(1450行) 是最大 ROI；paths(150行) 是清晰独立职责域。粒度合理。
- 不拆 manifest/upgrade 逻辑（parseWorkspaceManifestVersion 等）：它们用 templates 常量 + db，与 save 初始化强内聚，留主文件。
