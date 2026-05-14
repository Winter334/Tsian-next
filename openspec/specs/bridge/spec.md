# Capability: bridge (delta)

> 由 OPSX change `prompt-preset-and-workflow-engine` 修改的既有 capability。`PlayFrontendBridge` 是平台 ↔ 游玩前端的唯一交互面。

## 1. Surface Changes

`PlayFrontendBridge.runtime` 新增 4 个写运行时方法（design.md §12）：

```ts
interface PlayFrontendBridge {
  // ... existing fields ...
  runtime: {
    // ... existing read methods ...

    // NEW
    applyPatch(patch: MaintenancePatchDocument): Promise<ApplyPatchOutput>;
    updateGlobals(path: string, value: unknown): Promise<void>;
    appendUserMessage(content: string): Promise<void>;
    appendAssistantMessage(content: string): Promise<void>;
  };
}
```

## 2. Behavior Contract

### 2.1 Single Collapse Point (HC-14)
所有 4 个方法在实现内部都转调 `runtime-host/patch-applier.ts` 的 `applyMaintenancePatch`（HC-14 + `§13.1`）。`updateGlobals(path, value)` 是 sugar：

```
applyMaintenancePatch({
  patch: { globals: [{ op: 'set', path, value }] },
  pushCheckpointReason: undefined,
})
```

`appendUserMessage / appendAssistantMessage` 转调 `runtimeEngine.appendUserMessage / appendAssistantMessage`（不递增 turn，`§13.6`）。

### 2.2 Checkpoint Behavior (`§13.9`)
- 桥 API 路径**始终**传 `pushCheckpointReason: undefined` —— 不创建 checkpoint
- 设计意图：前端写入是细颗粒变更，频繁 checkpoint 污染回溯链
- 若前端确实需要打点：先 `runAction({ kind: "push-checkpoint", reason })` 再 `applyPatch`

### 2.3 Authority (HC-13)
桥 API 是**平台代码**，不是模组代码。HC-13 限制"writing-runtime authority is platform-only" 在本变更中表述为：

- `bridge.runtime.applyPatch` 与 `apply-patch` 节点都属于平台特权
- 模组通过桥 API **可以**触发写运行时 —— 但调用者本身是平台代码（前端在浏览器内只能调桥 API，无 IndexedDB 直写权）
- 模组**不可**在 manifest workflow 中声明 `apply-patch` 节点（加载期 reject）

### 2.4 Error Modes (HC-9 fail loud)
| 场景 | 行为 |
|------|------|
| 非法 patch 引用 | applier throw，bridge 重新 throw 给前端 |
| 桥 API 与 apply-patch 节点对相同 patch 错误信息一致（P-I-1） | 必须严格一致（验收 I6） |

### 2.5 Reactivity
- 写入后下一轮 `sendMessage` 时 macros 包含最新 globals 值（`§13.5`）
- 同一轮内已经执行的 ai-call 节点不会"看到"中途桥 API 写入的 globals —— macros 在 sendMessage 入口就已经组装

## 3. Method Spec Detail

### 3.1 `applyPatch(patch)`
- 完整 ApplyPatchOutput 返回前端
- 前端可据此更新 UI（如显示"已修改 3 个 archive"）

### 3.2 `updateGlobals(path, value)`
- `path` 是点号路径，如 `"inventory.gold"`
- `value` 任意 JSON 可序列化值
- 失败：path 非法（非字符串、空、含非法字符）throw before applier
- 不返回 ApplyPatchOutput（前端无须；要细节请用 `applyPatch`）

### 3.3 `appendUserMessage(content)` / `appendAssistantMessage(content)`
- 仅 mutate `state.messages` + 持久化记录
- 不递增 turn，不触发工作流
- 调用者后续行为：
  - 通常紧接着 `bridge.interaction.sendMessage(...)` 走完一轮
  - 或显式接受悬挂 user 消息（需告知用户）

## 4. Cross-references

- design.md §12（Stage I 完整设计）、§13.3 / §13.6 / §13.9
- _research-notes.md HC-13, HC-14

## 5. Out of Scope
- 写其他模组的运行时数据（沙箱隔离）
- 在前端发起 AI 调用（必须经 ai-call 节点；前端不直接调 OpenAI）
- 动态注册新节点类型（HC-13）
