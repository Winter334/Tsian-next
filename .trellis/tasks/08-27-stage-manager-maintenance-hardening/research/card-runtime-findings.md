# 卡内运行时事实

## 范围

- 实际分发源是 `cards/沉浸阅读器.tsian-card/`：打包脚本收集其 `workspace/` 与 `frontend/` 内容，并以卡内 `card-manifest.json` 作为成品清单来源。
- `apps/platform-web/src/storage/workspace-templates/` 已停止维护，不属于本任务的修改或同步目标。
- 卡内前端通过 `workspace/agents/stage-manager/agent.json` 配置场记，并在 `frontend/src/composables/useSyncAfterTurn.ts` 调用 `postTurnMaintenance`；本任务没有证据要求修改该前端编排。

## 已确认的故障链

1. 运行时只把 Skill Index 摘要放入初始上下文；正式调用提示词没有显式 `use_skill`，因此场记可能不加载“回合后维护”的完整流程。
2. `json_edit` 与 `text_edit` 会将预期业务错误作为 `{ status: "failed" | "partial_failed" }` 返回，并且批量操作会保留先前成功的写入。工具结果不够细，Skill 也没有规定如何只处理失败项。提供的请求样本中未观察到一次真实的“工具失败却被判成功”，因此不以此前端假设扩大改动范围。
3. `json_edit` / `text_edit` 逐条写入 `ops`；后续操作失败时会留下先前写入。两者也拒绝外层 `target` 加 `ops` 的可归一化形状。
4. `read_maintenance_context` 当前只展开活跃场景、场景在场实体和主角，无法区分“相关实体不存在”与“存在但未被展开”。
5. `useSyncAfterTurn` 将 Agent `completed` 或 `invokeAgent` resolve 直接视为同步成功；这一行为存在，但提供的样本并未证明它造成了本次故障，因此不纳入本任务修复。

## 可用修复边界

- 只修改游戏卡的 Agent、Skill、Tool 和必要的卡内测试；不修改平台模板，也不为本次缺乏证据的前端问题添加门禁。
- 工具必须按目标返回可消费的逐项结果。单个普通操作错误不应中断其他独立目标；同一目标的多个修改应先预演，避免半套字段落盘。只有基础设施读写异常才走整体异常路径。
- `commit_turn_recall` 继续作为最后一步 recall 提交，不增加 invocation 绑定的维护完成标记。
