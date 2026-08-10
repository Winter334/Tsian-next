# 开局访谈重复读取与恢复修复 — Implementation Plan

## Phase 1: Persistent task-mode Tool memory

- [x] 在 `stageAgentContextFile` 输入中接收本轮 `AgentContextToolMemory[]`，按桌面助手既有模式合并、排序并应用 retention。
- [x] `invokeAgent(persist:true)` 把 runtime 返回的 Tool memory 传入 sidecar context 写回；失败 turn 不写回。
- [x] `buildEntryAgentMessages()` 改由 task/narrative compression mode 控制 Tool memory 层，保留 assistant/game 的称谓差异但移除路径能力特判。
- [x] 扩展既有 `assistant-runtime.smoke.test.ts` 的 owning transaction，覆盖 persistent world-architect task mode 的写回/下轮注入；narrative 排除由精确分支条件和构建审查确认；不新增测试文件。

## Phase 2: Skill-only protocol hardening

- [x] 只更新卡包 workspace《开局建模》Skill：完整 top-level schema、非空示例、字段唯一归属、幂等规则。
- [x] 明确 `decisions.*`、`unresolved.*`、`protagonist` 的合法/非法形状。
- [x] 明确 `readSlices` 0-based/end-exclusive 字符范围及 inspect preview 与正文精读的区别。
- [x] 明确先复用 hidden state/Tool memory，再按当前证据缺口读取；不承诺禁止一切合法重读。
- [x] 不修改游戏前端，不新增或修改 Skill action/script 来维护访谈进度。

## Phase 3: Verification

- [x] 运行 retained Web smoke，覆盖 Tool memory 持久化与消息注入。
- [x] 运行 `npm run build:web`。
- [x] 运行 `npm run package:card -- --out <temporary-output>`，验证更新后的 workspace Skill、现有 frontend、inventory 与导入 round trip；验证 ZIP 已删除。
- [x] 检查 git diff、生成物边界和无关用户文件，确认没有游戏前端改动、进度脚本或第二状态权威。

## Dependencies and Rollback Points

- Phase 1 与 Phase 2 可独立实现；端到端新会话实测必须在两者完成后进行。
- 卡包构建最后执行，因为它会组合卡包 workspace 与现有游戏前端。
- 若 Tool memory 回归，可单独回退 Phase 1；Skill 文案问题可独立调整而不触碰 runtime。

## Deferred Follow-up Trigger

新建测试会话后，若仍出现多次状态形状错误或 Agent 无法稳定维护完整快照，再创建独立任务设计脚本 action 作为进度读写接口；不得在本任务中追加一个仅做 JSON 校验的临时 action。
