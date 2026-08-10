# 实施契约摘要

本摘要提炼自 `.trellis/spec/contracts/frontend/type-safety.md` 与已归档的“全仓测试主干收敛”任务，供实现/检查代理避免加载超大规范文件时截断关键内容。

## Play frontend 与卡 workspace 权威

- 游戏卡前端只修改 `apps/play-frontend-dev/src/**`。
- Skill、Agent、Tool、config 只修改 `cards/沉浸阅读器.tsian-card/workspace/**`。
- 不维护 `cards/<card>.tsian-card/frontend/**`、`game-card.json` 等历史导出残留。
- 前端改动运行 `npm run build:play-frontend` 与 `npm run package:frontend`；同时包含前端和 workspace 的交付运行 `npm run package:card`。

## Recoverable invokeAgent sidecar session

- `contextSlot + persist:true` 保存独立访谈；正式 story turn 不是访谈 revision。
- control 文件只保存 source/session/branch、revision、当前 attempt 和最终 receipt；最新 assistant hidden state 是渐进进度权威。
- attempt 在 invoke 前耐久写入；成功回复必须匹配 source/session/branch/revision/processedAttemptId。
- transport reject 复用同一 attempt；resolve 后 reconciliation 失败先恢复，不创建新 attempt。
- injection 是 per-turn 临时消息，不会持久化到 context；因此每轮都要携带 branch 不变量。
- streaming display 必须移除完整 hidden block 和任意 trailing marker prefix，不能闪现协议片段。
- 正式模型只在最终 action 完整校验后一次事务提交。

## 测试准入

- 仓库自动化拓扑固定为两条 Web smoke 与一条 Go smoke。
- UI、组件、composable、纯 helper 行为使用 build/package/manual gate；未经新的明确范围决策不得新增独立 `*.test.ts`。
- 新发现若不能由既有 smoke 表达，默认记录为手工验收，不为本任务扩建测试基础设施。
