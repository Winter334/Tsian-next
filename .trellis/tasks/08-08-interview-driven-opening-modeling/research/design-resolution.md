# 设计审查关闭记录

日期：2026-08-08

本文件把 `design-review.md` 的历史阻塞映射到当前 `design.md`。实施与检查以当前 PRD/design/implement 为权威；历史审查文件只保留证据和推理过程。

## 用户确认的范围决策

- 游戏卡前端只维护 `apps/play-frontend-dev/src/**`，并通过 `build:play-frontend`、`package:frontend` 与平台“上传前端包”功能交付。
- Skill、自定义 Tool、Agent/config/docs 等卡内容只维护 `cards/沉浸阅读器.tsian-card/workspace/**`。
- 不更新 `apps/platform-web` 内置 workspace 模板；该模板已停止维护，后续由通用模板卡替代。只有自动生成 save 框架等平台职责才修改平台前端。
- 卡目录既有 `frontend/**` 与 `game-card.json` 是早期导出残留；本次已有改动不回滚，后续不再手工同步。
- 不自动迁移用户已有 editable local 卡。
- 项目仍处于测试阶段；旧流程中间态不迁移、不清理、不原地适配，直接要求使用新存档。

## 阻塞关闭矩阵

| 审查项 | 当前结论 |
|---|---|
| DR-01 / DR-03 | 控制文件先耐久记录 attempt；invoke reject 才标 failed；resolve 后异常只从 setup/context 恢复，不重发。 |
| DR-02 | 首个成功状态块后分支不可变；改分支必须重新导入并生成新 source identity/session。 |
| DR-18 | 访谈顺序只用隐藏状态 `revision + processedAttemptId`，不使用正式剧情 turn。 |
| DR-04 | 不把临时文件加入 `world-architect.contextPaths`；进度来自最新 context 隐藏状态，frontier推进不受影响。 |
| DR-10 | 删除 `lastQuestion` 第二权威。开局选项和状态块保留在 context content，仅从 display 隐藏；刷新可对真实持久内容重新投影。 |
| DR-11 | 提交前写 submitted attempt；answer marker 持久携带 attemptId；恢复按 context 匹配确认，未知态以同一 attemptId 重试，Skill 幂等重放。 |
| DR-17 | 首轮只落盘固定 bootstrap marker；内部指令走 injection，UI 精确过滤 marker。 |
| DR-05 | 使用真实不连续 `readSlices[]`、稳定键 decisions/unresolved；没有 `committing` 状态，不保存完整草稿。 |
| DR-06 | `commit_opening` 明确缩小允许面到 character/location，禁止 container/item/equipment/ref extensions，并建立 entity/scene/relationship/runtime/frontier/turn0/entrypoint 校验矩阵。 |
| DR-07 | 用户将旧中间态迁移明确移出范围。新 action 只接受干净/pending save；发现旧模型即 fail closed 并提示使用新存档，不执行删除或归属推断。 |
| DR-08 / DR-09 | action 绑定 session/source/branch/revision/attempt，内部计算 canonical payload SHA-256 receipt；相同 receipt 幂等，不同 payload、complete、enteredPlay、turn>0、正式 context 均 fail closed。 |
| DR-12 | 当前协议的 context 隐藏块自带 source/session/branch/revision，可安全重建缺失控制文件；只有控制文件但 revision>0 无 context、身份不匹配或协议损坏均 fail closed。 |
| DR-13 | 平台模板/raw import 全部移出范围；不修改共享 opening/frontier helper。 |
| DR-14 | 前端权威改为 `apps/play-frontend-dev/src/**`；构建后生成 `.tsian-frontend.zip`，逐项核对 `frontend.json`、归档路径、大小和源码字节。卡内 frontend/game-card 导出残留不再同步。 |
| DR-15 | 用户明确接受不升级既有 local 卡；builtin 模板也不再维护。 |
| DR-16 | 不新增平台测试套件；使用临时/内联 action harness、开发前端类型检查与构建、前端源码包核对和手工路径验证。旧中间态只验证拒绝与零写入。 |

## 剩余门禁

- PRD、design、implement 需通过最终通读和 `task.py validate`。
- 最新规划摘要需提交用户审核；用户后续明确批准后才能 `task.py start`。
