# 本局运行状态

- runtime.json 初始 turn=0，主角/地点为空、无活跃场景；场记在开局正文落定后首次建档，将引用补齐并推进至 turn=1。
- opening-interview.json 保存本书/本次开局会话身份。写手承担剧情访谈，界面显式确认 proposal。
- opening-state.json 保存确认状态和世界适配凭据（内部字段 model 仅指本次 schema/规则提交，不再表示实体库）、正文发布与完成状态。
- setup-summary.json 标记开局是否完成；只有正文持久化和场记提交凭据通过后才能进入故事。enteredPlay 由前端响应玩家进入。
- player.json 保存玩家 persona/视角；branch.json 保存本局分支摘要。

正文独立 transcript 保留平台投影，发布到 save/history/turns/turn-000000.json 并 seed 正式正文上下文。维护失败只重试维护；刷新不静默调用模型。
历史时间线取各 turn.meta.recall 的已发生重要节点，无 frontier 或原著对齐坐标。阅读书签属于写手检索状态，不是本局剧情进度。
