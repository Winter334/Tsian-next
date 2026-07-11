# 实施计划：可见 Play iframe 前端自检

> 供下一会话执行。当前任务保持 `planning`；编码前先运行 `trellis-continue`，完成 planning review/context gate 后再 `task.py start`。

## 总体策略

按可独立回滚的接缝分五个阶段实施。每阶段先做精确反向搜索，改动后运行 `npm run build:web`，绿色后再进入下一阶段。不要同时重写 bridge、storage 和 inspector。

## Phase A — Play mount handle 与 target registry

### A1. 反向搜索

- [ ] 搜索 `mountRemoteIframeFrontend(` 全部调用点。
- [ ] 搜索 `disposeFrontend`、`onBridgeReady`、`onSessionId`、`FRONTEND_RELOAD_EVENT` 消费者。
- [ ] 确认 bridge sessionId 未被持久化或暴露给 AI。

### A2. 扩展 mount

- [ ] 在 `bridge/remote-iframe-bridge.ts` 定义 status、activity、handle 类型。
- [ ] 返回 handle 而非裸 disposer，保留幂等 `dispose()`。
- [ ] 为 status/activity 使用 mount-local listener Set。
- [ ] 在合法 RPC 边界记录 started/completed/failed；仅 metadata。
- [ ] send 顺序：bridge resolve → response → real `turn-completed` → activity completed。
- [ ] 暴露 in-flight、activity sequence、`waitForReady(timeoutMs)`。
- [ ] 所有 failed 路径正确 decrement in-flight。

### A3. registry 与 PlayView

- [ ] 新建 `bridge/play-frontend-target.ts`：generation、register/unregister identity guard、current、subscribe、wait-next-ready。
- [ ] registry 只暴露 borrowed handle，inspector 无法 dispose owner mount。
- [ ] metadata 包含 kind/cardId/entry；不持久化 sessionId/generation。
- [ ] PlayView packaged/remote mount 后 register；replace/launcher/close/unmount 时 unregister + owner dispose。
- [ ] minimized 不 unregister；保持 loading/error/rebuild/fullscreen 行为。

### A4. 验证/回滚点

- [ ] `npm run build:web`
- [ ] 验证 packaged/remote 打开、启动器、关闭、重开、源码 reload、fullscreen。
- [ ] 验证旧 cleanup 不会误注销新 handle。
- [ ] 此阶段不改变 inspector 外部行为。

## Phase B — baseline marker 与检查点保护

### B1. local meta

- [ ] 新建 `storage/frontend-debug-session.ts`，实现 schema v1 严格 normalize/read/write/clear。
- [ ] 区分 absent/valid/invalid；invalid 由业务层报错一次后 clear。
- [ ] 提供 protected checkpoint lookup 给 checkpoint storage。
- [ ] 按需从 `storage/index.ts` 导出；不新增 Dexie table/DB name。

### B2. baseline 选择

- [ ] 从 save turn files 计算 currentTurn。
- [ ] turn > 0：最新 post-turn-maintenance 优先，否则 after-turn。
- [ ] turn 0：最新 manual 优先，否则 initial。
- [ ] 严格同 turn，无结果 fail loud。
- [ ] 验证 save.gameCardId 与 Play target/active card 一致。

### B3. 生命周期保护

- [ ] `pruneCheckpointsForSave` keep protected exact ID。
- [ ] maintenance replace 排除 protected ID。
- [ ] `replaceInitialCheckpointForSave` 排除 protected ID。
- [ ] 检查 GC 不回收 protected manifest blobs。
- [ ] platform restore action 在 active marker 下拒绝 target.turn < baselineTurn。
- [ ] 恢复 baseline/测试期 checkpoint 不清 marker。
- [ ] save 删除不额外耦合 marker；下次 inspector invalid+clear。

### B4. 验证/回滚点

- [ ] `npm run build:web`
- [ ] 验证 turn 0/普通/maintenance baseline 选择。
- [ ] focused probe 验证 prune、maintenance、manual replacement 不删 baseline。
- [ ] 验证 baseline floor。

## Phase C — Inspector 内核重写

### C1. 拆分纯 helper

- [ ] 新建 `frontend-inspector-dom.ts`，移动 actions、auto-wait、ARIA/structure/style/text、diff。
- [ ] 新建 `frontend-inspector-diagnostics.ts`，移动 collector。
- [ ] 每个接缝移动后 build，避免放进 `internal.ts`。

### C2. DOM/diagnostics 修复

- [ ] action events 使用 `doc.defaultView` 构造器。
- [ ] resource/Error 判断跨 realm 安全。
- [ ] diagnostics disposer 移除具名 listener，条件恢复 console wrapper。
- [ ] collector 使用有界存储。
- [ ] structured action error 保留具体 code/message。

### C3. live frame session

- [ ] 按 registry generation 创建/销毁 diagnostics + activity + diff session。
- [ ] 同 generation 累计；generation 改变时全部重置。
- [ ] target 消失时清内存 collector但保留 marker。
- [ ] bridgeState 来自 handle status + active chain。

### C4. inspect operation

- [ ] 删除 hidden container、inspection bridge、ephemeral save、runEphemeralTurn。
- [ ] 删除旧 AI/runtime/streaming imports 与 turn timeline。
- [ ] 首次 inspect 执行 target/build/runtime/save/canonical checkpoint 校验并写 marker。
- [ ] 后续验证 marker/save/checkpoint/target；invalid marker 一次报错并 clear。
- [ ] 执行 actions/observeBetween，采 structure/diagnostics/diff/fileLineMap。
- [ ] 返回 debugSession/frameGeneration/activity/runtime。

### C5. runtime-settled

- [ ] send started 创建/扩展 chain；chain 活跃时纳入全部 RPC。
- [ ] with-actions：记 cursor，短窗口内必须出现新 send。
- [ ] without-actions：只续等 active/unfinished chain。
- [ ] pending=0 + quiet 2000ms 才 settled。
- [ ] timeoutMs 默认 300000、上限 900000；timeout 不 abort。
- [ ] multiple send、failed activity、long ask request、超时续等符合 PRD。
- [ ] activity 不含 params/result，有界截断。

### C6. 验证/回滚点

- [ ] `npm run build:web`
- [ ] grep inspector 不再调用 mount/create save/run runtime。
- [ ] 验证无 Play/launcher/remote/minimized/packaged/building/build failed。
- [ ] 验证不新增第二 iframe。
- [ ] 验证 wrapper 不叠加，generation 重建后旧 listener 清理。
- [ ] 验证真实 fill+click、立即返回与 runtime-settled。

## Phase D — finish 与恢复重挂

### D1. finish 前置

- [ ] 无 marker → DEBUG_SESSION_NOT_ACTIVE。
- [ ] save mismatch → 提示切回，保留 marker。
- [ ] marker target 缺失/损坏 → 一次报错并 clear。
- [ ] Play 未挂载/not ready/remote/building → fail，保留 marker。
- [ ] in-flight 或未 quiet → DEBUG_SESSION_BUSY，保留 marker。

### D2. restore/reload

- [ ] dispose inspector frame session，不 dispose Play handle。
- [ ] restore exact baseline，并补充删除同 turn 中 `createdAt > baseline.createdAt` 的测试期 checkpoint；成功后 clear marker，失败保留。
- [ ] emit debug refresh + frontend reload。
- [ ] 等 next generation ready 10 秒。
- [ ] 成功时采一次性恢复快照后 dispose，不建新 marker。
- [ ] reload timeout 返回 restored partial success，marker 保持 cleared。

### D3. 验证/回滚点

- [ ] `npm run build:web`
- [ ] busy finish 不恢复。
- [ ] 测试 turn/trace/future checkpoints 消失，baseline state 恢复。
- [ ] frontend/src 与 dist 修改保留。
- [ ] reload success snapshot、timeout partial、重复 finish error。
- [ ] marker 跨刷新/助手会话/Play 关闭重开。

## Phase E — 契约与 AI-facing 清理

### E1. 类型/normalize/schema

- [ ] 输入改为 operation/actions/observeBetween/autoWait/wait/timeoutMs。
- [ ] 删除旧 timeline，新增 activity/runtime/debugSession/restored 类型。
- [ ] normalize 新枚举、timeout、finish 冲突；删除旧常量/字段。
- [ ] 已删除旧字段明确拒绝，不静默忽略。
- [ ] schema 只描述真实 Play、自动 baseline、真实 UI、runtime-settled、finish。

### E2. 权限/说明/文档

- [ ] 更新 `tool-controls.ts`。
- [ ] 同步 text-mode guidance 与例子。
- [ ] `local-assistant-files.ts` 补完整调试 SOP 和 finish 义务。
- [ ] 更新 `docs/active/assistant-frontend-inspection-direction.md`。

### E3. 零残留 grep

对活跃源码/文档检查（归档 task 不改）：

- [ ] hidden/隐藏 iframe
- [ ] ephemeral save / ephemeralSaveId
- [ ] inspector send / refresh
- [ ] inspect runtime / screenshot
- [ ] bridge-ready / 旧 turn-completed wait
- [ ] createInspectionBridge / runEphemeralTurn / ensureHiddenContainer
- [ ] 旧 timeline 类型/描述

AI-facing string 要求零残留。

## 最终质量门

### 构建

- [ ] `npm run build:web`
- [ ] 仅共享 contracts 实际变化时运行 `npm run build:contracts`

### 浏览器矩阵

- [ ] 目标：无 Play、launcher、remote、packaged、minimized、building、build failed。
- [ ] baseline：turn 0、after-turn、post-maintenance、strict currentTurn、invalid marker、save mismatch。
- [ ] activity：send 未触发、single/multiple send、generic follow-ups、failed、long pending、timeout/续等、2s quiet。
- [ ] lifecycle：多次 inspect、success rebuild reset、关闭/重开、刷新、助手会话切换。
- [ ] finish：no-session、busy、wrong-save、missing-target、restore success、reload timeout、repeat finish。
- [ ] rollback：save-runtime 回滚；frontend source/dist 保留；baseline floor 生效。

### 审查

- [ ] registry/bridge/storage 无反向 import 到 inspector；无 import cycle。
- [ ] inspector 不 dispose borrowed Play mount。
- [ ] activity 不记录业务内容。
- [ ] marker 不进入 checkpoint/workspace/distribute。
- [ ] 无兼容层、隐藏 fallback 或第二套目标逻辑。
- [ ] `git diff --check` 与范围审查通过，不覆盖任务前未提交改动。

## 下一会话启动顺序

1. 运行 `/trellis:continue`。
2. 阅读本任务三个规划文档与 jsonl context。
3. 完成 Phase 1.3 context gate 和 1.4 review。
4. 用户确认后运行 `task.py start`。
5. 从 Phase A 开始，不跨阶段大改。
