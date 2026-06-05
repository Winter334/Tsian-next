# Capability: platform-host (delta)

> 由 OPSX change `prompt-preset-and-workflow-engine` 修改的既有 capability。本 delta 描述变更后的对外契约。

## 1. Scope of Change

平台壳 (`apps/platform-web/src/platform-host/`) 不再硬编码"检索 → 正文 → 维护"三段链路；改为读取 save override、mod workflow preset 或默认工作流定义，交给 workflow-engine 调度，自身只负责：

1. 解析当前 save/mod 的工作流来源
2. 组装平台层 macros（`{{user.input}} / {{globals.*}} / {{archives.*}} / {{currentTime}}` ...）
3. 创建 per-turn outputs store ref
4. 抗 abort（保证下一轮入口先 abort 上一轮）
5. 持久化（snapshot / history）

## 2. `sendMessage` Orchestration

```
sendMessage(input):
  1. await abortPreviousTurn()
  2. state.turn++              (§13.6 唯一递增点)
  3. workflow = resolveWorkflow(save, mod)
              (save override -> mod.workflowPresetId resource -> deprecated manifest.workflow -> defaultWorkflow)
  4. workflowEngine.validate(workflow) (首次 cache)
  5. macros = buildBuiltinMacros(input, snapshot)
              .merge(mod.manifest.customMacros)   (§13.5)
  6. outputsRef = shallowRef({})
  7. ctrl = new AbortController()
  8. await workflowEngine.execute(workflow, {
        macros, abortSignal: ctrl.signal, outputsStore: outputsRef,
        applyMaintenancePatch, callOpenAi,
        appendUserMessage, appendAssistantMessage,
     })
  9. await persistAfterTurn(outputsRef.value)
```

## 3. After-turn Persistence

- 工作流成功后统一落盘 snapshot / history，并把 save-scoped generic AIRP memory 投影回 legacy snapshot/events/archives 兼容切片。
- 平台回合成功后统一创建 after-turn checkpoint；`apply-patch` 与 `memory-write` 节点默认不创建节点本地 checkpoint。
- `apply-patch` 作为兼容写入口时，applier 负责先同步 generic AIRP memory，再执行可选节点本地 checkpoint。
- `write-runtime` 仍是手动覆盖入口，成功后创建 `manual` checkpoint。

## 4. `runAction` (unchanged)

- `restore-checkpoint`、`write-runtime` 行为不变
- `write-runtime` 内部转调 `applyMaintenancePatch`（HC-14）

## 5. `abortPreviousTurn`

- `sendMessage` 入口处必须 await 完成
- 上一轮 AbortController 已 abort 后，引擎需保证：
  - 已 settled 的节点保持原状态
  - pending / running 的节点全部进入 `aborted`
  - 上轮 outputs ref 不再被写入新 ref（§13.7 实例隔离自动保证）

## 6. Behavior Contract

| 场景 | 平台行为 |
|------|---------|
| 用户连续点两次 send | 第二次入口 abort 第一次；turn 递增 1 次（第二次） |
| 工作流执行失败（内部 throw） | sendMessage 重新 throw；outputs ref 保留失败时的 partial 状态供调试 |
| save 配置 workflow preset | 优先使用 save-scoped workflow preset |
| mod 声明 workflowPresetId | 从平台资源库读取 workflow preset；缺失时 fail loud |
| 仅历史 mod 声明 manifest.workflow | 作为 deprecated legacy fallback 使用 |
| 无任何 workflow 来源 | 使用 `default-workflow.ts` |
| workflow 校验失败 | fail loud，不退化到默认 |

## 7. Cross-references

- design.md §8（默认工作流）、§9（platform-host 解耦）、§13.6 / §13.9
- _research-notes.md HC-13, HC-14, SC-CRIT-1..7

## 8. Out of Scope
- 工作流热更新（mod 加载后 workflow 不变）
- 跨 mod 工作流复用
