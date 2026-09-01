# 当前开局建模流程（代码核对）

## 1. 源码权威

- 前端：`apps/play-frontend-dev/src/**`。
- Agent、Skill、脚本与回复投影：`cards/沉浸阅读器.tsian-card/workspace/**`。
- `cards/沉浸阅读器.tsian-card/frontend/**` 是历史导出残留；`package:card` 从开发前端源码和卡 workspace 重新组装整卡。

## 2. 从卡片选择到第一次 Agent 回复

1. `OpeningBranchChoice.vue` 点击卡片后发送 `canon` 或 `original`。
2. `SetupWizard.vue` 把事件直接交给 `useSetupState.startOpeningInterview`。
3. `createOpeningControl` 根据导入小说的 `importedAt`、normalization version、标题和章节数计算 source hash，并派生：
   - session id：`opening-<hash>`；
   - context slot：`opening-interview-<hash>`；
   - 控制文件：`save/playthrough/opening-interview.json`。
4. 前端先写 revision 0 控制文件，其中已含 branch；再调用 `world-architect`：
   - 实际 input 是 `opening-interview:start:<sessionId>`，用于持久上下文和恢复时精确识别；
   - before-input injection 携带 session/source/branch/revision/attempt；
   - `persist:true` 把访谈保存在独立 context slot，不污染正式游玩会话。
5. `world-architect` 按 injection 启用《开局建模》Skill。Skill 决定是否调用：
   - `inspect_source_opening`：读取 manifest 和前若干章预览；
   - `read_opening_slice`：按当前问题需要定向读取连续章节正文。
6. Agent 回复由三部分组成：玩家可见的问题、完整 `[[开局会话]]` 状态、可选 `[[开局选项]]`。
7. reply projection 和前端 parser 隐藏内部块，只显示自然语言与快捷选项；完整原始 content 仍保留在访谈 context 中供下一轮恢复。

## 3. 每轮回答与恢复

1. 玩家回答前，前端先把 `{attemptId,input,basedOnRevision,status:"submitted"}` 写入控制文件。
2. 发给 Agent 的 user turn 是 `opening-interview:answer:<attemptId>\n<回答>`；同一 injection 再次携带不可变 session/source/branch 和本轮 revision。
3. Agent 从最近 assistant 的 `[[开局会话]]` 读取完整进度，更新 `decisions`、`unresolved`、`readSlices` 和 protagonist 摘要，再提出下一个最高价值问题。
4. 前端校验 sessionId、sourceHash、branch、revision、processedAttemptId 和章节 ref；只有全部匹配才接受回复并推进控制文件 revision。
5. invoke 失败时保留同一 attempt；刷新或重试先读持久 context，已处理则恢复，未处理才用同一 attemptId 重发，避免重复推进。

## 4. 最终建模与提交

1. Skill 以“让第一回合成立的最小闭包”为完成条件：主角、开局地点、至少一个场景、必要人物/关系/traits、runtime/frontier 指针和玩家开始确认。
2. 必要时委托 `storyteller` 生成正式首回合正文；访谈状态不交给 storyteller。
3. `commit_opening` 在任何写入前校验：
   - session/source/branch/revision/attempt 与控制文件一致；
   - save 仍是干净 pending 状态；
   - entity、scene、relationship、runtime、frontier 和所有 ref 一致；
   - opening reply 能被正式回复投影处理；
   - payload 大小、路径、重复 id 与幂等 receipt 合法。
4. 校验通过后在同一平台事务中写入正式 entities、scenes、relationships、runtime、frontier、turn 0、正式 player context、完成态控制文件和 `setup-summary.json`。
5. 前端看到 setup summary complete 后进入开局确认页，玩家点击“进入故事”才进入正式游玩。

## 5. 当前角色选择缺陷

链路没有丢失 branch：UI、控制文件、injection 和恢复校验都携带它。实际薄弱点是 AI-facing 语义：

- injection 只暴露 `branch:"canon"` / `"original"`，没有直接给出中文含义；
- Skill 使用“原著分支/原创分支”，却未建立 enum 映射；
- 首轮 input 只含 session marker，所有角色类型语义依赖 injection 被模型正确联结。

修复应强化这一处契约，而不是增加第二份业务状态：前端明确写“玩家已选择：原著角色/原创角色”，Skill 定义枚举映射并直接进入对应首问，控制文件与恢复校验继续作为 branch 的结构化权威。

## 6. 当前流式视觉问题

- 无文本：`EmberForge` standalone Canvas，随机粒子持续向中心聚拢。
- 有文本：切换为独立左边框卡片，纯文本逐 delta 追加，并显示闪烁矩形 caret。
- 完成：流式节点卸载，新增正式 `NarrativeMessage`，改为无卡片的 Markdown 排版。
- 每个 delta 都触发贴底滚动。

这会造成等待态、生成态和完成态在形状、位置、排版与动效语言上连续跳变。重设计应优先保持同一消息骨架，只让末尾状态指示器发生轻量变化。
