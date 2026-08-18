# Implementation Plan

## 1. Preserve And Reconcile The Existing Baseline

- 保留当前未提交的私有标签恢复、显式闭合提示、严格缺闭合兜底、最新纠错替换和成功清理改动。
- 先审阅现有 diff，确认不覆盖用户改动，并把过时的“全局连续错误预算”规范改为按错误代码预算。

## 2. Child A — Error-Scoped Retries

- 激活 `08-17-text-tool-error-scoped-retries`，将单一 `protocolErrorRetriesRemaining` 替换为按 `error.code` 记录的出现次数。
- 保持 `retryRemaining` 为当前错误类型尚可发出的纠错调用数；同码第 4 次直接终止。
- 保持最新纠错消息替换、合法工具调用后清空计数/纠错消息和 network retry 隔离。
- 更新既有 Assistant Runtime smoke 的错误序列，不创建新测试文件。

## 3. Child B — Current-Loop Result Reference

- 激活 `08-17-current-turn-tool-result-reference`，扩展 session state、`agent_call` accepted observation 和 `run_script` schema/resolver。
- 只注册成功且最终 accepted 的 `agent_call.response`；确保 text/native 共享同一 `responseRef`。
- 在 action schema 与 savepoint 前解析顶层 `inputRefs`，实现格式、冲突和 not-found 错误。
- 排除跨 turn Tool memory/UI presentation 持久化，并更新开局建模 Skill 使用引用提交正文。
- 在既有 Assistant Runtime smoke 中覆盖主路径和一个关键失败/回滚边界。

## 4. Parent Integration Review

- 对照父 PRD 逐项检查两个子任务组合后仍只有 `<tsian-tool-calls>` 可执行，引用不放宽 parser。
- 核对 observation 32 KiB gate、call/result ID 对齐、transaction savepoint、Tool memory、UI timeline 和 task compression 未被破坏。
- 同步 `type-safety.md`、`quality-guidelines.md` 与必要 AI-facing 说明；不迁移旧记录。

## 5. Validation And Test Retention Gate

- 运行 `npm run test:smoke:web`。
- 运行 `npm run build:web`。
- 运行 `git diff --check`。
- 审计本次触及的 smoke 断言：保留核心协议、引用和回滚契约；合并或删除一次性诊断/实现细节断言；不新增窄专项测试文件。
- 构建完成后交给真实 Provider 场景复核；429/网络失败记录为外部验证阻塞，不通过增加虚拟 Provider 测试替代。

## Rollback Points

- Child A 可独立回滚到全局预算，但必须保留唯一私有执行标签和非执行标签拒绝。
- Child B 必须成组回滚 registry、`responseRef`、`inputRefs`、resolver 与 Skill 提示。
- 若集成检查失败，先回退对应子任务，不恢复 JSON repair、`arg_value` 兼容或持久化 artifact。
