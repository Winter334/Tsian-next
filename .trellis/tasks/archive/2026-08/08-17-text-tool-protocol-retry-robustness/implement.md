# Implementation Plan

## 1. Text Protocol Contract

- 在 `text-tool-protocol.ts` 增加 executed-tools 非执行标签与单条执行报告 formatter。
- 保留旧 call-records 的拒绝/剥离兼容，但停止生成并从正常 AI-facing 提示中移除。
- 将最大连续纠错次数调整为 3。
- 为各 parser 错误代码提供集中、可测试的正向纠错提示；统一剩余次数语义。

## 2. Runtime Message Flow

- 精简 text 模式系统提示：唯一正例、runtime user 执行报告说明、正常答复出口。
- 合法工具轮后只追加一条 user 执行报告；将 call、accepted observation 和可选图片放在同一消息中。
- 保持工具调用 id、执行顺序、工具记忆采集、timeline 和事务行为不变。
- 保持纠错预算在合法工具调用后重置，耗尽时抛出最后错误代码。

## 3. Compression Adaptation

- 更新文本工具交互识别和工具名提取，按 executed-tools/observations 标签识别 user 报告。
- 更新 `textTaskGroup` 从一条报告解析调用与结果并按 id 对齐。
- 保持最近 5 轮、并行调用原子分组、未解决失败固定保留和 checkpoint 生成语义。
- 更新过时的“两条消息一轮”注释，避免未来代码再次依赖 role 形态。

## 4. Regression Coverage

- 更新 `assistant-runtime.smoke.test.ts` 的文本轮 fixture 和压缩断言。
- 增加 text-mode scripted provider 成功纠错链：三次不同协议错误后第四次合法，工具仅执行一次。
- 增加四次连续错误耗尽与事务不变断言。
- 断言 provider-bound 正常历史没有 assistant call-records，图片/文本执行报告为同一 user 消息。
- 断言系统提示和纠错提示只包含正确模板及错误专用修正动作。

## 5. Specs And Validation

- 同步更新 `type-safety.md` 与 `quality-guidelines.md` 的文本协议、压缩和错误矩阵。
- 审计本次触及的 smoke：合并表驱动协议变体，删除重复/过度绑定文案的专项断言，保留长期安全与数据完整性契约；在 `quality-guidelines.md` 记录每次任务收尾的测试保留价值审计。
- 运行：
  - `npm run test:smoke:web`
  - `npm run build:web`
  - `git diff --check`
- 最终复核原生工具调用相关测试未改变，文本历史标签没有 AI-facing 残留负例。

## Risk / Rollback Points

- 高风险边界：执行报告与 observation 的 id 对齐、图片 ContentPart、失败轮固定保留、纠错次数 off-by-one。
- 若 runtime 集成测试显示单条报告破坏 provider 消息，回滚第 2、3 步为一个整体；不得只恢复 assistant 历史而保留新的压缩假设。
- 若 3 次纠错造成不可接受的延迟，只能在后续产品决策中调整上限；本任务不引入动态 provider-specific retry 配置。
