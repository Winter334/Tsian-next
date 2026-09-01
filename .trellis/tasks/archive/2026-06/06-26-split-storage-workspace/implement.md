# Implement — 拆分 storage/workspace.ts

> seam 顺序按依赖序：types（底层）→ templates（独立）→ paths（依赖 types）。每 seam 一 commit + `npm run build:web` green。

## Seam 1: 提取 workspace-types.ts

- [ ] 用 node 脚本基于内容标记切出 25-55 区段（锚：`export type CheckpointWorkspaceFile` 起，`const DEFAULT_WORKSPACE_VERSION` 止）
- [ ] 写入 `workspace-types.ts`，调整 import（LocalWorkspaceFileRecord 来自 `./db`）
- [ ] workspace.ts 删除该段，替换为 `export type { ... } from "./workspace-types"` + `export { WorkspaceStorageError } from "./workspace-types"` + `import { WorkspaceStorageError } from "./workspace-types"`（内部 throw 用）
- [ ] `npm run build:web` green
- [ ] commit

## Seam 2: 提取 workspace-templates.ts

- [ ] 用 node 脚本基于内容标记切出块 A（起始锚 `const DEFAULT_WORKSPACE_VERSION = 8`，终止锚 `function createTableId`）
- [ ] 写入 `workspace-templates.ts`，加 `import type { AgentConfig } from "@tsian/contracts"`
- [ ] 6 个被主文件用的常量加 `export`：DEFAULT_WORKSPACE_VERSION、WORKSPACE_MANIFEST_PATH、DEFAULT_SAVE_RUNTIME_UPGRADE_FILE_PATHS、DEFAULT_WORKSPACE_FILES、RUNTIME_DEFAULT_CARD_PATHS、DEFAULT_SAVE_RUNTIME_FILES
- [ ] workspace.ts 删除该段，替换为 `import { DEFAULT_WORKSPACE_FILES, DEFAULT_SAVE_RUNTIME_FILES, DEFAULT_WORKSPACE_VERSION, WORKSPACE_MANIFEST_PATH, DEFAULT_SAVE_RUNTIME_UPGRADE_FILE_PATHS, RUNTIME_DEFAULT_CARD_PATHS } from "./workspace-templates"`
- [ ] `npm run build:web` green
- [ ] commit

## Seam 3: 提取 workspace-paths.ts

- [ ] 用 node 脚本基于内容标记切出路径判定函数（锚：`function normalizeDirectoryPath` 或 `export function normalizeWorkspaceFilePath` 起，到 `function toContentFile` 或下一个非路径函数止）
- [ ] 写入 `workspace-paths.ts`，import `{ WorkspaceStorageError } from "./workspace-types"` + `{ normalizeWorkspacePath } from "@/lib/workspace-path"`
- [ ] workspace.ts 删除该段，替换为 `export { normalizeWorkspaceFilePath, isPlatformMetadataPath, isActiveSaveRuntimePath, isSaveRuntimePersistencePath, isOrdinaryWorkspacePath } from "./workspace-paths"` + `import { normalizeWorkspaceTargetPath, normalizeDirectoryPath, assertOrdinarySaveRuntimeMutationPath, assertOrdinaryReadPath, assertPlatformSaveRuntimeMutationPath, fileName } from "./workspace-paths"`（内部用）
- [ ] `npm run build:web` green
- [ ] commit

## 验收（全部 seam 完成后）

- [ ] `npm run build:web` green
- [ ] 导出面等价：workspace.ts barrel 的 public export = 原 31 个（grep 对照）
- [ ] 6 个消费方导入路径未改动（`from "...storage/workspace"` 不变）
- [ ] workspace CRUD/路径/模板/checkpoint 手动冒烟
- [ ] 无死 import；实现真正移出（workspace.ts < 700 行）
- [ ] 无循环导入

## 验证命令

- 每 seam 后：`npm run build:web`
- contract shape 不变 → 无需 build:contracts

## Rollback

- seam 级：单 commit `git revert`
- 子任务级：3 个 commit 全 revert；barrel 保证消费方未动
