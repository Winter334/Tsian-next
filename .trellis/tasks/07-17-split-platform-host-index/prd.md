# 拆分 platform-host 入口聚合文件

## Goal

将 `apps/platform-web/src/platform-host/index.ts` 中仍混杂的 action、runtime trace、resource query、AI invocation 等职责按平台宿主边界拆分，让 `index.ts` 回到 barrel + bridge assembly + re-export 边界。

## Background / Evidence

- 当前文件约 1651 行 / 63.5 KiB。
- Directory Structure spec 明确 `platform-host/index.ts` 应作为 barrel + `playFrontendBridge` assembly + re-export boundary，新职责应进入 focused sub-module。
- 历史上该文件曾经更大并已拆过一轮，说明继续维持边界是项目既定方向。

## Requirements

- R1. 识别当前剩余职责：workspace action execution、runtime trace writes、resource queries、AI invocation queue/adapter、bridge assembly。
- R2. 将非 assembly 逻辑移入已有或新建 focused modules，例如 `workspace-ops.ts`、`assistant-chat.ts`、`host-state.ts` 或更具体模块。
- R3. 保持 `playFrontendBridge` 对外 API、事件顺序、active save lifecycle、checkpoint commit 行为不变。
- R4. 避免 `index.ts` 与子模块循环依赖；共享 singleton 状态放入 dedicated state module。
- R5. 备份：实现前记录 baseline commit 并创建 `backup/split-platform-host-index-pre-split` 本地备份 ref；每个 host responsibility seam 后验证 build。

## Acceptance Criteria

- [ ] `platform-host/index.ts` 聚焦 bridge assembly / barrel / re-export。
- [ ] 被抽出的 host modules 命名符合职责。
- [ ] Bridge API、runtime trace path、workspace action commit 语义保持不变。
- [ ] `npm run build:web` 通过。
- [ ] 无循环依赖、无死 import。

## Out of Scope

- 不改变 bridge contract。
- 不改变 save/checkpoint 生命周期。
- 不新增平台 host 功能。
