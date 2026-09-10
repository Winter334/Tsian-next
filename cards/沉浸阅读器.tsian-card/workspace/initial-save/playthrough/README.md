# Playthrough 回合运行时

本目录存放存档级运行时变量、player 设置、source frontier、setup 摘要与 branch 摘要。

- `runtime.json`：高频访问、玩家面向或前端管理的摘要，含 `worldTime`（当前世界/剧情时间字符串，未知时为空）、`plotOrder`（数字，单调递增，表示玩家当前走到哪个 source order；场记每回合维护，前端用于判断是否触发 frontier 推进）、`weather`、`location`（当前地点 `{ ref, name } | null`）、`activeSceneRefs`（当前活跃场景指针数组，每项 `{ ref, name }`）、`protagonistRef`（主角指针 `{ ref, name } | null`）；也可通过 `extensions` 承载新增/临时的玩家可见运行时字段，例如月相、倒计时或诅咒周期。旧字段 `activeSceneIds`/`activeScene`/`player`/`inventory`/`status` 已废弃。
- `player.json`：玩家 persona/视角设置。
- `frontier.json`：源文本抽取/阅读进度与时间标记锚点。含 `sourceWindow`（已读章节窗口）、`extractedThrough`（已抽取到的最远源章节引用）、`timeline`（时间标记锚点数组，锚点用 `kind` 区分 `source`/`player`，均含 `order` 单调递增整数线性坐标；source 锚点 `{ kind, order, chapter, time, label }`，player 锚点 `{ kind, order, turn, time, label, alignment, sourceRef }`）、`notes`。
- `understanding-summary.json`：开局理解摘要。
- `setup-summary.json`：游玩设定对话完成信号；`enteredPlay` 由前端在玩家点击进入故事后置为 `true`，用于重开存档时恢复主游玩界面。
- `branch.json`：玩家创建的分支摘要，不是源文本的重写。

开局 assistant 回复写入 `save/history/turns/turn-000000.json`，并同步 seed 到玩家正式回合入口 Agent 的 `save/agents/<playerTurnAgent>/context.json`。

纯前端 view state（活跃标签、滚动位置、折叠面板、瞬时过滤、悬停状态）默认不应存这里。
