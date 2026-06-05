# Capability: runtime-host (delta)

> 由 OPSX change `prompt-preset-and-workflow-engine` 修改的既有 capability。本 delta 描述本变更后的对外契约；既有未变行为继续以 `apps/platform-web/src/runtime-host/` 当前代码为准。

## 1. Surface Changes

### 1.1 Removed
- `LocalRuntimeEngine.sendMessageWithContext` —— 该方法在 workflow 引入后语义重叠 `sendMessage`，并把"组装 prompt"的职责错误地下沉到运行时层。删除后 prompt 组装统一由 workflow 引擎调度（HC-14）。

### 1.2 Added (atomic methods)

```ts
interface LocalRuntimeEngine {
  // existing (unchanged)
  getSnapshot(): RuntimeSnapshot;
  query(req): unknown;
  getPlatformContext(): PlatformContext;
  applyRuntimeStatePatch(patch: RuntimeStatePatch): Promise<void>;

  // NEW
  appendUserMessage(content: string): Promise<void>;
  appendAssistantMessage(content: string): Promise<void>;
}
```

- 两个 append 方法**不**递增 `state.turn`（`design.md §13.6`）
- `state.turn++` 由 platform-host 在 `sendMessage` 入口、workflow.execute 之前发生
- 调用方"挂着的用户消息"自负其责：要么紧接着 sendMessage，要么接受悬挂

### 1.3 Extracted module: `runtime-host/patch-applier.ts`

```ts
export interface ApplyMaintenancePatchInput {
  patch: MaintenancePatchDocument;
  runtimeEngine: LocalRuntimeEngine;
  saveId: string;
  pushCheckpointReason?: "after-turn" | "manual";
  checkpointLabel?: string;
}

export interface ApplyPatchOutput {
  appliedArchives: string[];
  appliedEventIds: string[];
  globalsChanged: boolean;
  currentTimeChanged: boolean;
}

export async function applyMaintenancePatch(
  input: ApplyMaintenancePatchInput,
): Promise<ApplyPatchOutput>;
```

- 把当前 `platform-host/index.ts` 中分散的 `applyArchivePatchesForSave` / `applyEventPatchForSave` / `applyRuntimeStatePatch` 合并为单一坍塌点（HC-14、SC-CRIT-1..7 共用）
- 内部应用顺序固定：`currentTime → globals → archives → events`（`§13.1`）
- **不做回滚**：任何子项失败立即 throw，已 apply 的部分留在原地（HC-9 fail loud）
- 调用方禁止 catch + 重试；失败由调用栈向上抛
- apply-patch 是兼容写入口；应用 legacy snapshot/events/archives 后，必须先同步 save-scoped generic AIRP memory，再进入可选 checkpoint。
- 仅当 `input.pushCheckpointReason` 存在时创建 checkpoint（`§13.9`）；默认由平台回合成功后统一创建 after-turn checkpoint。

## 2. Behavior Contract

### 2.1 Atomicity
- 单条调用内：currentTime → globals 的更新发生在 archives / events 之前
- archives 失败 → events 不再尝试，throw
- events 失败 → archives 已落地、不回滚，throw
- 调用方两路径（apply-patch node、bridge.runtime.applyPatch）行为完全一致（P-I-1）

### 2.2 Determinism
- 同一 input 重复调用结果相同（除非中间有并发写入；本变更不引入并发，单线程主链路）

### 2.3 Error Modes (HC-9)
| 场景 | 行为 |
|------|------|
| patch 引用不存在的 archive id | throw before 任何 mutation |
| patch.events 含非法时间 | throw |
| IndexedDB 事务失败 | throw（原型期不重试） |
| `pushCheckpointReason` 提供但 checkpoint 写入失败 | throw（不静默丢） |

## 3. Cross-references

- design.md §9（LocalRuntimeEngine atomic methods）
- design.md §12.1（ApplyPatchOutput shape）
- design.md §13.1 / §13.6 / §13.9
- _research-notes.md HC-9, HC-10, HC-14

## 4. Out of Scope
- 跨进程 / 远程 RuntimeEngine（本变更仅本地浏览器内）
- patch 部分回滚（按 fail loud 原则不引入）
