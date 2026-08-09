# 访谈驱动的开局建模：技术设计

## 1. 设计边界

本任务把 `cards/沉浸阅读器.tsian-card` 内的初始理解、角色设定和游玩设定收敛为一个 `world-architect` 临时访谈会话。前端只负责导入、分支选择、对话呈现、持久恢复、重试和确认屏切换；Agent 负责按需阅读、缺口判断、问题生成、紧凑进度总结和最终开局提交。

硬边界：

- 前端实现修改 `apps/play-frontend-dev/src/**`；Skill/Tool/Agent/config/docs 修改 `cards/沉浸阅读器.tsian-card/workspace/**`。
- 不修改 `apps/platform-web` 平台宿主或内置 workspace 模板，不迁移既有本地可编辑卡。
- `apps/play-frontend-dev/src` 是游戏卡前端源码权威；卡 workspace 是卡内容源码权威。卡目录既有 `frontend/**` 与 `game-card.json` 属于早期导出残留，本次已有改动不回滚，但不再要求手工同步。
- 正式 save 模型只在完成轮统一提交；访谈中途的进度只存在临时 context 与控制文件。
- `setup-summary.status === "complete"` 继续作为进入独立确认屏的耐久完成信号。

## 2. 目标流程与可见状态

```text
导入小说
  → 选择：原著角色 | 原创角色
  → 单一 Agent 访谈（问题 + 快捷选项 + 自由输入）
  → Agent 原子提交正式模型与 turn 0
  → 独立开局确认屏
  → 玩家点击“进入故事”
```

Stepper 显示三节点：“导入小说 / 创建角色与世界 / 开局确认”。访谈内部不再有初始理解、角色表单、游玩设定等子步骤。

前端状态：

```ts
type OpeningInterviewStatus =
  | "idle"       // 已导入，等待选择分支
  | "running"    // 正在 invoke
  | "ready"      // 最新成功问题可回答
  | "recovering" // 提交结果未知或正在重建
  | "failed"     // 已确认 invoke 未提交，可重试
  | "complete"   // setup summary 已完成
```

`ready` 的不变量是：动态 context 最后一组有效 user/assistant 记录已通过会话协议校验，assistant 隐藏状态与当前 source/session/branch 匹配，并且最多有一个当前问题。

## 3. Source identity、session 与动态 slot

当前小说身份使用：

```ts
interface OpeningSourceIdentity {
  importedAt: string
  normalizationVersion: string
  title: string
  chapterCount: number
}
```

前端对规范化 identity 做稳定摘要，派生：

```text
sessionId = opening-<sourceHash>
contextSlot = opening-interview-<sourceHash>
contextPath = save/agents/world-architect/context-<contextSlot>.json
```

同一导入刷新后值不变；重新导入会产生新的 `importedAt` 和 slot。slot 只能包含平台允许的安全字符，不能直接拼入书名。

分支在首个成功 assistant 状态块落盘后不可变。首轮未成功时可用原分支重试；更换分支必须重新导入小说，从新 identity 启动新 session。

## 4. Context 内的耐久会话协议

### 4.1 为什么以 context 为进度权威

平台已保证 `persist:true` 的 user/assistant context 与本轮 Agent workspace 写入在同一事务提交；但工具 observation 不可靠跨轮保留。为了不修改宿主，也不依赖 Agent 必须额外调用一次状态 action，每个成功回复都携带一个紧凑隐藏会话块。平台将该块保留在 context，前端将其从显示文本移除。

最新有效 assistant 隐藏块是访谈进度权威。它与对应 user marker 一起提供真实的会话轮次、去重键、阅读证据和决策摘要；正式剧情 `turn` 不参与访谈排序。

### 4.2 User marker

首轮持久 input 是固定、可精确过滤的 marker：

```text
opening-interview:start:<sessionId>
```

分支、source identity 和“启用合并开局 Skill”的内部说明通过本轮 `injection` 提供，不作为玩家消息落盘。

后续回答使用：

```text
opening-interview:answer:<attemptId>
<玩家原始回答>
```

恢复 UI 时精确解析 marker，只显示第二行起的玩家回答；bootstrap marker 完全隐藏。不要用长 Prompt 模糊匹配。

### 4.3 Assistant 隐藏块

每个未完成成功回复以自然语言问题为正文，并附：

```text
[[开局会话]]
{"schema":"novel-airp.opening-turn.v1", ...}
[[/开局会话]]

[[开局选项]]
- 选项一
- 选项二
[[/开局选项]]
```

完成回复仍必须附 `[[开局会话]]`，选项块可省略。状态结构：

```ts
interface OpeningTurnState {
  schema: "novel-airp.opening-turn.v1"
  sessionId: string
  sourceHash: string
  branch: "canon" | "original"
  revision: number
  processedAttemptId: string // bootstrap 使用 "start"
  readSlices: Array<{
    ref: string              // 必须来自 chapters.index
    start?: number
    end?: number
    purpose: string
  }>
  protagonist?: {
    mode: "canon" | "original"
    ref?: string
    name?: string
  }
  decisions: Record<string, {
    value: string
    evidenceRefs?: string[]
  }>
  unresolved: Record<string, {
    reason: string
  }>
  phase: "interviewing" | "ready-to-commit" | "complete"
}
```

规则：

- `revision` 从 1 开始，每个新的成功 attempt 恰好加 1；重复相同 attemptId 只重放最新问题，不增加 revision 或再次应用决定。
- `readSlices` 记录真实、不要求连续的读取范围；不得用单一 `startIndex/endIndex` 暗示中间内容均已读取。
- `decisions` / `unresolved` 使用稳定语义 key，更新时替换同 key，不追加互相冲突的自由文本。
- 块内只保留下一轮所需的紧凑事实，不复制原文、不保存完整正式实体/scene/runtime 草稿。
- 最新块在每轮重复完整状态，因此即使 context 压缩，最近保留轮仍包含恢复所需进度。

### 4.4 Reply projection

卡内 `workspace/config/reply-projection.json` 保留现有正式故事 `[[选项]]` 规则，并新增开局专用规则：

- `[[开局会话]]`：`content` 不替换，`display` 删除，投影出 `openingState` 原始 JSON 字符串；
- `[[开局选项]]`：`content` 不替换，`display` 删除，投影出 `openingChoices` 数组。

因为平台只把 projection 的 `content` 写入 context，这两个块会耐久保留；玩家收到的是清理后的 `displayContent`。正式故事的 `[[选项]]` 规则不变，避免改变游玩阶段行为。

前端同时实现一个只认识这两个精确 marker 的本地解析/清理器：即使 `reply-project` action 失败，也绝不把内部块渲染给玩家；解析或 schema 校验失败则进入 `recovering`，不允许继续发送。

## 5. 控制文件、attempt 与崩溃恢复

### 5.1 控制文件

`save/playthrough/opening-interview.json` 不是模型进度第二权威，只保存会话控制与最终 receipt：

```ts
interface OpeningInterviewControl {
  schema: "novel-airp.opening-interview.v1"
  source: OpeningSourceIdentity & { hash: string }
  session: {
    id: string
    slot: string
    revision: number
  }
  branch: "canon" | "original"
  status: "interviewing" | "complete"
  attempt?: {
    id: string
    input: string
    inputHash: string
    basedOnRevision: number
    status: "submitted" | "failed"
    createdAt: string
  }
  receipt?: {
    revision: number
    payloadHash: string
    committedAt: string
  }
}
```

不使用 `committing` 持久态：完成 action 与 context 属于同一事务，失败会整体回滚。控制文件不加入 `world-architect.contextPaths`，避免污染正式 `frontier推进`；Agent 从最近 context 隐藏块读取进度，首轮/恢复不变量由 injection 补充。

### 5.2 提交回答

1. 校验当前为 `ready`，生成稳定 `attemptId` 和 `inputHash`。
2. 前端先把 `attempt.status="submitted"` 写入控制文件，再显示一条 pending 玩家消息。
3. 用 answer marker + 原回答调用同一动态 slot。
4. invoke resolve 后解析实际 response 的隐藏块，要求 session/source/branch 匹配、`processedAttemptId` 匹配、`revision = basedOnRevision + 1`。
5. context 已经耐久提交；前端把控制文件 revision 更新并清除 attempt。若这次写回失败，刷新后仍可从 context 重建。

### 5.3 失败、未知结果和幂等重试

- invoke reject：context 未提交；前端将 attempt 标为 `failed`，重试复用同一 attemptId 和 input，不再 push 第二条玩家消息。
- 页面在 invoke 中途关闭：控制文件可能仍为 `submitted`。恢复先重读动态 context；若存在匹配 attemptId 的有效 assistant 块，则视为成功并修复控制文件；否则进入 `recovering`。
- `recovering` 允许重新读取；确认 context 仍未处理后，可用同一 attemptId 重试。若原请求稍后先提交，队列中的重复调用会看到相同 `processedAttemptId`，Skill 必须只重放最新问题/状态，不重复应用决定。
- invoke resolve 后投影、控制文件写回或导航失败：禁止创建新 attempt；始终先读 setup summary，再读 context 并重建。

### 5.4 初始化优先级

1. `setup-summary.status === "complete"` → 确认屏或正式游玩；
2. 当前 source 对应的动态 context 含有效隐藏块 → 以 context 重建/修复控制文件并恢复访谈；
3. 控制文件 revision=0 且无成功 context → 恢复已选分支的 bootstrap 重试；
4. state/context 身份不匹配、只有 revision>0 state、或 context 协议损坏 → fail closed 的恢复错误页；
5. manifest ready 且没有新会话 → 分支选择；
6. 无 manifest → 导入页。

普通 workspace 读取异常不能吞掉后回到导入页，以免覆盖已有会话。

## 6. 合并后的 `world-architect` Skill

重写卡内《开局建模》Skill，使其自包含地负责完整访谈；从 `agent.json` / `AGENT.md` 启用面移除旧《游玩设定》独立入口及“先理解、再角色、再裁剪”概念。`frontier推进` Skill 和其 helper 不修改。

每轮行为：

1. 解析当前 user marker、injection 不变量与最近 `OpeningTurnState`；发现重复 attemptId 时幂等重放。
2. 只在当前决策缺口需要时调用 `inspect_source_opening` / `read_opening_slice`。
3. 用真实 refs/ranges 更新 `readSlices`，用稳定 key 替换 decisions/unresolved。
4. 每轮只问一个最高价值问题；极少数紧耦合信息可问两个。
5. 输出自然语言问题、完整隐藏状态和可选的开局选项块。
6. 当最小依赖闭包满足且玩家确认开始时调用 `commit_opening`；成功后输出 `phase:"complete"` 状态，不再提问。

完成条件：主角明确、开局切入点有 source evidence、必要人物和地点可建模、至少一个有效 scene、关系与 traits 足够、runtime/frontier 可闭合、玩家已明确确认开始。

## 7. `commit_opening` 原子提交

### 7.1 输入与允许面

单一 action 接收：

- `sessionId/sourceHash/branch/revision/attemptId`；
- 最小 entities（MVP 仅 `character` 与 `location`）；
- scenes、character relationships、runtime、frontier；
- protagonist traits、setup summary、opening reply；
- 规范化后 payload 的幂等 hash 由 action 内部计算，调用方不能自报为权威。

MVP 禁止 container/item entity、character `containers` / `equipment`、未知 ref-bearing extension。开局装备可在后续正式回合由既有装备能力建立。

### 7.2 前置保护与校验矩阵

在任何 write 前读取并验证：

- 当前 source manifest 与控制文件 source/session/branch 完全匹配；控制文件 attemptId/revision 与 action 输入匹配；
- save 必须是新流程的干净/pending 状态：entity/scene/relationship 目录为空，没有 turn 0 或正式玩家回合 context，runtime/frontier 仍是初始 pending 形态；发现旧流程半成品或未知正式模型即 fail closed；
- 若已有相同 session/revision/payloadHash receipt，返回既有成功摘要；已有不同 receipt、setup complete、`enteredPlay=true`、任意 turn > 0 或非空正式玩家回合 context 均 fail closed；
- entity id/path 唯一且文档 identity 与路径一致；character/location 允许字段形态、字符串长度、安全整数、trait/status/gauge 唯一性合法；
- 所有 scene.location、scene.present、relationship subject/to、runtime protagonist/location/activeSceneRefs 均指向本 payload entity/scene 集，并校验 ref/name 一致；
- frontier window/read refs 存在于当前 chapter index，`extractedThrough` 与 window 一致，timeline 至少有一个 `kind:"source", order:1` 锚点，runtime.plotOrder 与之对应；
- opening reply 经 `tsian.reply.project` 成功，turn 0 结构合法；`game-card.json` 的 playerTurn entrypoint 存在且目标 Agent 可读取；
- 所有计划写入路径唯一，payload 大小和数组数量在上限内。

验证实现必须形成显式矩阵，不能以旧 `_validation.js` 的部分检查代替“全量校验”。

### 7.3 干净 save 前置条件

项目仍处于测试阶段，本任务不承担旧流程中间态迁移。`commit_opening` 只向由新流程启动、且尚未写入正式模型的 save 提交：

- entity/scene/relationship 目录必须为空；
- runtime/frontier 必须符合卡模板初始 pending 形态；
- 不得存在 turn 0、正式玩家回合 context 或旧 setup 完成信号；
- 不做任何目录级 delete、旧文件归属推断或半成品合并。

任一条件不满足即返回稳定兼容错误，由前端提示玩家创建新存档重新导入。这样避免为测试期旧数据引入高风险清理和迁移协议。

### 7.4 写入与 receipt

写入顺序：

1. 写 entities、scenes、relationships；
2. 写 runtime、frontier；
3. 写 turn 0 与正式 player-turn context；
4. 将控制文件写为 `complete` 并记录 canonical payload SHA-256 receipt；
5. 最后构造并 stage `setup-summary.status="complete"`，其中带同一 session/revision/receipt。

任一异常由平台事务整体 discard。相同 receipt 重试只返回短摘要，不覆盖文件；不同 payload 使用同一 session/revision 时拒绝。action 不返回 openingReply 正文。

## 8. 兼容策略

### 8.1 已完成旧存档（自然兼容）

- `enteredPlay === true`：直接进入正式游玩；
- setup complete 且未 entered：进入 OpeningConfirm；
- 不启动新访谈，不调用 `commit_opening`；除此之外不增加迁移逻辑。

### 8.2 旧中间态

旧 understanding、runtime protagonist、旧 play-setup context 不驱动新流程。检测到 setup 未 complete 且存在旧 context、旧正式模型或非初始 runtime/frontier 时，显示“测试期旧开局进度不支持升级，请使用新存档重新导入”，不启动新访谈、不清理文件、不调用 `commit_opening`。

保留 pending `understanding-summary.json` 文件作为兼容残留，但新前端和新 Skill 不消费它。

### 8.3 不迁移对象

本任务不更新平台 builtin workspace 模板，也不自动升级用户已有 editable local 卡。开发前端通过 `.tsian-frontend.zip` 上传更新；卡 workspace 通过后续整卡打包流程交付。通用模板卡由后续任务处理。

## 9. 源码权威与交付

### 9.1 权威文件

- `cards/沉浸阅读器.tsian-card/workspace/agents/world-architect/**`
- `cards/沉浸阅读器.tsian-card/workspace/config/reply-projection.json`
- `apps/play-frontend-dev/src/**`（游戏卡前端权威源码）
- `scripts/package-play-frontend-source.mjs`（当前前端源码包交付入口）

不创建 raw-import 同步、不触碰平台 `workspace-templates/scripts/opening.ts`，因此不会影响它与 `frontier推进` 共享的 helper。

### 9.2 前端文件 manifest

实现至少审查并按实际依赖修改：

- `apps/play-frontend-dev/src/composables/useSetupState.ts`
- `apps/play-frontend-dev/src/lib/source.ts`
- `apps/play-frontend-dev/src/components/setup/SetupWizard.vue`
- `apps/play-frontend-dev/src/components/setup/SetupStepper.vue`
- 分支选择与访谈组件（可复用现有 step4 组件后改名/收敛）
- `apps/play-frontend-dev/src/components/setup/step5/OpeningConfirm.vue`
- `apps/play-frontend-dev/src/App.vue`（仅当初始化/确认路由需要）
- 所有新增协议 parser/type 文件及其 imports

旧 step2/step3/step4 组件只有无消费者时才删除。

### 9.3 构建与导出

实施完成后：

1. 对 `apps/play-frontend-dev` 运行类型检查和生产 build，要求零诊断；
2. 运行 `npm run package:frontend` 生成 `.tsian-frontend.zip`；
3. 核对包内 `frontend.json` 与 `src/**` 文件清单；
4. 通过平台“上传前端包”更新目标卡，由平台构建 `dist` 并确认入口可加载。

## 10. 验证与回滚

最低验证：

- Skill 中 `tsian-actions` JSON 可解析，所有新增脚本通过语法编译；
- 临时/内联 `commit_opening` 脚本 harness 覆盖：成功闭包、未知 ref、重复 id、source/session 不匹配、已有 complete/turn>0 拒绝、旧中间态拒绝且零写入、相同 receipt 幂等、不同 payload 拒绝；
- 前端协议测试/手工验证覆盖：bootstrap 隐藏、原著/原创、自由指定、刷新恢复、选项恢复、invoke reject、resolve 后写回失败、submitted 未知态、重复 attemptId；
- 开发前端 build 零诊断，前端源码包清单与 `apps/play-frontend-dev/src/**` 一致；
- `git diff --check`，并确认产品 diff 只落在 `apps/play-frontend-dev/**` 与 `cards/沉浸阅读器.tsian-card/workspace/**`；本次已存在的卡前端导出残留改动不回滚。

回滚以功能分层：先恢复开发前端的 SetupWizard/useSetupState，再恢复卡 workspace 的 Agent Skill/scripts 与 reply projection，最后重新生成前端源码包。任何回滚都不删除用户 save/source 或 assets。
