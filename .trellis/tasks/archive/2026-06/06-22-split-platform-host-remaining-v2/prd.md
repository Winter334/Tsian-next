# Split platform-host remaining seams v2

## Goal

继续拆分 `apps/platform-web/src/platform-host/index.ts`（当前 2281 行）剩余 4 个接缝。
承接任务 06-22-split-platform-host-index（已拆 3 接缝：assistant-chat/covers/workspace-ops）。
在同一分支 `refactor/split-platform-host-index` 上继续。

这是第二次尝试。第一次（06-22-split-platform-host-remaining）因用 Python 批量行提取
game-cards 接缝（5 个分散区域）时切断了函数边界，已回退。本次改用逐函数迁移。

## 方法变更（vs 第一次）

- **逐函数迁移**：每个函数用精确的 Edit 移动到目标文件，build 验证后再移下一个。
  不再用 Python 脚本按行号批量提取/删除。
- **原因**：game-cards 接缝分散在 5 个非连续行段，中间夹着 core helpers 和 seam D。
  批量脚本在多区域 + 边界猜测时容易切断函数。

## Confirmed Facts（复用上次勘察，代码状态相同）

### 4 个接缝 + 依赖关系

| 接缝 | 行段 | 外部私有依赖 | bridge 依赖 |
|---|---|---|---|
| **A studio-agents** | 1601-1979 + 接口 185-237 | `isRecord`（core） | 无 |
| **B local-assistant** | 1981-2257 + 接口 238-246 | A 的 6 个 helper + `PlatformStudioProviderPresetOption` + `isRecord` | 无（但 `resolveLocalAssistantActorLevel` 被 core 调用） |
| **C game-cards** | 接口 177-208 + helpers 389-424/447-540/744-747 + 导出 1205-1546 | 无 | `formatActiveFrontendId`/`ensureActiveSave` 被 bridge 直接调用 |
| **D history-turns** | 339-441 + 常量 173-174 + 类型 249-258 | 无 | 3 个 helper 被 bridge 直接调用 |

### 提取顺序

1. `isRecord` → internal.ts（core + A + B 共享）
2. seam A → studio-agents.ts（6 个共享 helper export）
3. seam B → local-assistant.ts（从 A import 共享 helper）
4. seam C → game-cards.ts（**逐函数迁移**，`formatActiveFrontendId`/`ensureActiveSave` export）
5. seam D → history-turns.ts（3 个 helper export + 常量/类型随之迁走）
6. index.ts 收尾 + internal.ts 清理

### Bridge 依赖的 13 个 core helpers（留 index.ts）

`finishReasonToKind`/`cloneSnapshot`/`snapshotWithTurnAndMessages`/`actionError`/
`workspaceActionError`/`isRecord`(迁internal)/`syncWorkspaceFileWrite`/
`normalizeWorkspaceActionRequest`/`executeWorkspaceOperationForActiveSave`/
`executePlatformAction`/`writeRuntimeTraceFileForSave`/`stageRuntimeTraceFile`/
`normalizeRuntimeDiagnosticsQueryParams`

## Acceptance Criteria

- [ ] `index.ts` 仅含 types + core helpers + `playFrontendBridge` 装配 + re-export；行数 < 700。
- [ ] 4 个新子模块各自职责单一。
- [ ] 11 个消费方的 import 路径与符号名零变更。
- [ ] `npm run build --workspace platform-web` 通过。
