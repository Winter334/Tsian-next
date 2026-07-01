# Capabilities 三处注入统一

## Goal

将 `runAgentRuntimeTurn` 的 capabilities 构造从三处重复内联改为统一工厂函数，消除"新增平台工具要改三处、漏一处就静默失败"的问题。

## Background

`runAgentRuntimeTurn` 有三个调用点，每处都独立构造一个大型 capabilities 对象：

1. `platform-host/index.ts` `sendMessage` — 游戏 master turn
2. `platform-host/index.ts` `invokeAgent` — 旁路调用（如 world-architect understanding）
3. `platform-host/assistant-chat.ts` — 桌面助手 turn

三处的 `callModel`、`callModelNative`、`runBrowserScript`、`runTestSkillScript`、`emitTrace`、`toolCallMode` 等能力注入是重复的。`test_skill_script` 任务中漏了 `assistant-chat.ts` 的注入，导致助手 agent 报 `TEST_SKILL_SCRIPT_UNAVAILABLE`——三处重复是这类"漏一处"bug 的结构性根因。

三处的差异点（不是所有能力都一样）：
- `workspaceTransaction` 变量名不同（`activeWorkspaceTransaction` vs `workspaceTransaction`）
- `signal` 不同（`currentController.signal` vs `invokeController.signal` vs `compositeSignal`）
- `workspaceMutations` 路由不同（`assistant-chat` 有 `.tsian/local/` 特殊路由）
- `compressionMode` 不同（`narrative` vs `task`）
- `emitTrace` 来源不同

## Requirements

- 抽取 `createRuntimeCapabilities(options)` 工厂函数，封装公共能力构造（`runBrowserScript`、`runTestSkillScript`、`emitTrace` 等）。
- 三处调用点改为传不同参数调工厂，保留各自的差异点（`workspaceMutations` 路由、`compressionMode`、`signal` 等）。
- 新增平台工具时只需在工厂函数里加一处注入，三处自动生效。
- 差异点通过参数显式传入，不隐藏在工厂内部。

## Acceptance Criteria

- [ ] 三处 `runAgentRuntimeTurn` 调用不再内联重复的 capabilities 构造
- [ ] 新增平台工具只需改工厂函数一处 + `agent-runtime/index.ts` capability threading 一处
- [ ] `sendMessage`、`invokeAgent`、`assistant-chat` 三条路径行为不变
- [ ] `npm run build --workspace platform-web` 通过

## Out Of Scope

- 重构 `callModel` / `callModelNative` 的差异（三处 provider 解析逻辑不同，太深不改）
- 合并三处 `workspaceMutations` 路由（`assistant-chat` 的 `.tsian/local/` 特殊路由是合理的差异）

## Confirmed Facts

- 三处 `runAgentRuntimeTurn` 调用：`index.ts:795`（sendMessage）、`index.ts:1138`（invokeAgent）、`assistant-chat.ts:437`
- `runBrowserScript` 在三处都通过 `createBrowserSkillScriptRunner` 创建
- `runTestSkillScript` 在三处都通过 `createTestSkillScriptRunner` 创建
- `assistant-chat.ts` 的 `workspaceMutations.write` 有 `.tsian/local/` 特殊路由（line 559-568）
- spec `type-safety.md` 已记录 13 步注册清单（含 step 8b 三处注入点）
