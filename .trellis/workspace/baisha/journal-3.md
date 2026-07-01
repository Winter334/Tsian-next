# Journal - baisha (Part 3)

> Continuation from `journal-2.md` (archived at ~2000 lines)
> Started: 2026-07-01

---



## Session 107: Task 超时从总时长改为无响应超时

**Date**: 2026-07-01
**Task**: Task 超时从总时长改为无响应超时
**Package**: platform-web
**Branch**: `feat/workspace-context-cache-split`

### Summary

超时语义从'turn 开始累计总时长 5 分钟'改为'距离上一次活动超过 10 分钟无进展才超时'。DEFAULT_TASK_TIMEOUT_MS(300s)→DEFAULT_TASK_INACTIVITY_TIMEOUT_MS(600s)。WorkspaceToolLoopOptions: taskStartedAt→lastActivityAt, taskTimeoutMs→inactivityTimeoutMs。runtime 每轮结束更新 lastActivityAt。assistant-chat.ts 的 setTimeout 改为可重置计时器,onDelta/onRoundEnd/onTool 回调里 reset。TaskTimeoutError 消息改为'任务无响应超时'。invokeAgent 路径去掉无效的 taskStartedAt 字段。spec 更新 Turn Token Budget scenario。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `de84e2e` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 108: 统一三处脚本 runner 注入（createBrowserScriptRunners 工厂）

**Date**: 2026-07-01
**Task**: 统一三处脚本 runner 注入（createBrowserScriptRunners 工厂）
**Package**: platform-web
**Branch**: `feat/workspace-context-cache-split`

### Summary

评估三处 capabilities 的重复程度：真正重复的只有 runBrowserScript + runTestSkillScript 创建逻辑（约 30 行），callModel/workspaceMutations/callbacks 都有真实业务差异。抽 createBrowserScriptRunners 工厂函数统一脚本 runner 注入，三处用 ...spread。不统一有差异的部分。spec 13 步清单更新 step 8b 反映工厂模式。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `8e7449f` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete
