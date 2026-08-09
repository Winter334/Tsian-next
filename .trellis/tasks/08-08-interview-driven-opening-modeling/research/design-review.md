# 访谈驱动开局建模：设计审查断点

- 审查范围：`prd.md`、`design.md`、`research/source-authority-and-verification.md` 及相关实现契约
- 日期：2026-08-08
- 状态：历史审查基线已完成；原阻塞已由当前 `design.md` 修订关闭，映射见 `design-resolution.md`
- 恢复规则：网络失败后从本文件末尾继续，只补尚未审查项

## 已读取基线

- 产品要求明确：导入后仅先选原著/原创分支，角色选择/创建、偏好与确认均在同一 Agent 临时会话内；不得把内部里程碑变成 UI 子步骤（`prd.md:21-34`）。
- 设计给出的目标路径只有导入、分支选择、单一访谈、独立开局确认；分支选择不创建角色实体（`design.md:14-29`）。
- 平台持久 context slot 成功轮与 workspace transaction 同事务提交，失败整轮 discard；但 tool observation 不会可靠跨轮持久（`research/source-authority-and-verification.md:21-28`）。

## 发现记录

### DR-01（阻塞）：`ready` 状态同时承担“等待玩家回答”和可能的恢复态，但设计没有定义可提交性不变量

`design.md:43-58` 只给出五个扁平状态；`design.md:74-84` 又把显示消息、pending attempt 与底层调用分开。这里没有明确：

1. `ready` 必须对应最后一个**已持久化的 Agent turn**，且只能有一个可回答问题；
2. `running` 刷新后的判定方法（内存请求已丢失，context 可能仍停在上一成功轮）；
3. 用户回答已经显示、但调用失败后刷新时，context slot 并不含该失败轮玩家回答，UI 应从哪里恢复该回答及 retry payload。

PRD 要求失败后保留已提交回答、刷新恢复且重试不重复消息（`prd.md:52-57`、`:82-83`）。但设计把 pending attempt 明确限定为“仅内存”（`design.md:78-84`），因此“失败后刷新”会丢失回答和可重试输入，无法同时满足 AC8。实施前必须规定耐久 attempt 状态，或明确失败回答写入哪个独立 UI/session 状态且与 context 成功提交去重。

### DR-02（阻塞）：分支一旦启动耐久会话后的返回/改选/重启语义未定义

设计要求点击分支后立即用固定 `contextSlot: "opening-interview"` 启动（`design.md:60-72`），恢复优先级又规定只要新状态文件或 context 有记录就恢复访谈（`design.md:247-256`）。但可见阶段把“分支选择 + 连续访谈”合在 `interview`（`design.md:31-41`），没有规定以下转换：

- 首轮已经成功后，玩家能否返回分支选择；
- 若能改选，旧 context、`opening-interview.json.branch` 和新 Prompt 的 branch 如何同时清除/重建；
- 若不能改选，重新进入 `interview` 必须直接恢复对话而不是再次显示分支卡；
- 首轮失败且事务未提交时，是保留内存 branch 原地重试，还是回到分支选择。

当前旧向导允许多级返回（`apps/play-frontend-dev/src/components/setup/SetupWizard.vue:167-225`），若实现者机械保留 action bar，会把内部访谈重新拆成可回退的 UI 子流程，并产生 branch 双值。实施前应把分支定义为“首个成功持久轮后不可变”；改选只能走显式“重新开始访谈”事务，原子清理该 slot、临时状态及未完成新流程产物。常规返回/重进只恢复同一会话。

### DR-03（阻塞）：没有区分 Agent 事务失败与事务成功后的前端投影/读取失败，重试可能重复推进会话

平台只保证 `invokeAgent` 内的 workspace/context 成功或整轮丢弃（`research/source-authority-and-verification.md:23-28`）。Agent 调用返回后，前端还要做 reply projection、重建 choices、读取 `setup-summary` 并切状态；现实现这些都在 invoke 之后发生（`apps/play-frontend-dev/src/composables/useSetupState.ts:789-829`），其中 projection 本身会抛错（同文件 `:534-552`）。

`design.md:74-84` 只描述“本轮失败则底层 invoke 重试”，未定义 post-commit UI 处理失败。若 Agent 轮其实已持久化，而 projection 或 summary read 失败，直接重发 input 会把同一回答作为新一轮再次交给 Agent。完成轮尤其可能已经写完 turn 0，却又被重试。

状态机需要至少区分：

1. invoke 未提交：可用同一 attempt input 重试；
2. invoke 已提交但响应处理失败：禁止重发，先从 context slot 恢复最后 assistant turn，并重读 `setup-summary`；
3. commit 已完成但 UI 导航失败：以 `setup-summary.status === "complete"` 恢复确认屏。

恢复逻辑也应优先读取完成信号，再投影历史；单条 projection 失败不应把已完成开局降级成可继续发送的访谈。

### DR-04（阻塞）：推荐把临时状态放入 `world-architect.contextPaths` 与“正式运行不注入”直接矛盾

`design.md:129-137` 一方面说 complete 记录“正式运行不注入”，另一方面推荐把文件设为 `world-architect` 的 runtime contextPath。当前 contextPath 是 agent 静态配置，不感知 `contextSlot` 或 `purpose`：每次组装该 agent 都遍历全部 contextPaths，存在文件就注入（`apps/platform-web/src/agent-runtime/context.ts:100-176`）；契约也只有 path/template、role、position，没有条件字段（`packages/contracts/src/runtime.ts:455-468`）。

`world-architect` 还负责 `frontier推进`（`cards/沉浸阅读器.tsian-card/workspace/agents/world-architect/agent.json:50-55`）。因此一旦保留 complete 文件并加全局 contextPath，正式游玩中的 world-architect 调用也会持续收到过期开局临时状态，违反设计自己的边界，并可能把旧 unresolved/decisions 当现行状态。

MVP 应改为由合并后的开局 Skill 每轮显式 `workspace_read`，不要加入 agent 全局 contextPaths；或者先实现可按 slot/purpose 条件注入的宿主能力，但后者明显扩大范围，不适合本任务。设计中“少一次工具往返”的推荐必须删除。

### DR-05（阻塞）：临时状态 schema 既不足以稳定完成最终建模，又缺少防串会话/双权威规则

当前建议结构（`design.md:108-127`）只有 sourceWindow、主角 ref/name、自由文本 `decisions[]`/`unresolved[]`：

- 没有 session/generation id、manifest/import identity 或 source normalization/version 标识；同一存档重新导入小说或显式重启访谈时，旧状态可能与新 context/manifest 混用。
- `sourceWindow` 用单个连续 `startIndex/endIndex`，但设计允许玩家指定窗口外角色并“定向扩展阅读”（`design.md:174-179`）。定向读取可能是不连续 slices，单窗口会错误暗示中间内容已读；`chapters[]` 又与边界重复且 `ref/path` 可选，无法作为可靠 spoiler/evidence ledger。
- `decisions: string[]` 和 `unresolved: string[]` 无稳定 key、来源、替换/撤回语义。玩家更改答案时无法确定是覆盖旧决定还是追加冲突文本。
- 设计禁止保存完整草稿实体（`design.md:129-134`），但完成轮必须一次生成主角、必要实体、场景、关系、runtime、frontier、summary 和 turn 0（`design.md:203-211`）。若跨轮只剩自由文本摘要和 recentTurns，最终轮仍需重建所有已确认事实；这削弱了引入该文件以避免丢失建模进度/重读的理由。

临时文件是必要的，因为 tool observation 未跨轮持久（`research/source-authority-and-verification.md:23-28`），但应明确它是“仅在 setup 未 complete 时的工作权威”，不是正式模型权威。最小可实施 schema 至少需要：`sessionId`、source identity（例如 manifest `importedAt` + normalizationVersion/hash）、branch、phase、不连续 `readSlices[]`（source refs/ranges）、带稳定 key 的 `decisions`/`unresolved` map 及必要 evidence refs、`pendingAttempt`（见 DR-01）。是否保存结构化 draft 依赖需二选一：

1. 允许保存最小依赖闭包的 working draft，并明确 commit 成功后只以正式文件为权威、complete 临时文件不再读取；或
2. 坚持不存 draft，但承认该文件只解决读取范围和玩家决定，设计必须说明最终轮怎样从 context + evidence refs 确定性重建，以及压缩后仍可用。

目前两种目标混在一起，会阻塞 action schema 和恢复实现。

### DR-06（阻塞）：`commit_opening` 的“校验全部 ref”描述不足，当前 helper 不满足完整 Schema/ref 校验

设计只笼统写“规范化 entities、建立 id 集并校验 scenes/relationships、校验 runtime/frontier”（`design.md:203-213`）。现有 helper 实际只验证 entity 顶层 `id/name/brief`，并仅对 container/item 的 `type` 做少量检查（`cards/沉浸阅读器.tsian-card/workspace/agents/world-architect/skills/开局建模/scripts/_validation.js:19-25`）。它不校验正式 schema 中大量跨文件依赖：

- character `containers[]`、`equipment` 指向 container/item；container `contents[]` 指向 item/container，并需要无循环/独占/数量约束（正式契约见 `cards/沉浸阅读器.tsian-card/workspace/docs/novel-airp-schema-reference.md:49-55`、`:77-94`、`:114-135`）；
- traits/status/attributes/gauges 等正式字段形态；
- scene/location/present、runtime 指针的 ref/name 与目标文件 identity 一致；
- frontier 至少一个有效 source anchor、chapter 与 sourceWindow/extractedThrough 的一致性。当前 `commit-runtime-and-frontier.js` 允许空 timeline，且把任意输入 anchor 重编号为 1..N（`:46-63`）；并没有校验设计声称的“第一个 source anchor 可通过校验”（`design.md:170-172`）。

PRD 明确要求“现有或等价的跨文件 Schema/ref 校验”且所有 ref 存在（`prd.md:44-50`、`:80-81`）。实现前必须把 `commit_opening` 的输入契约和校验矩阵写清：每类实体允许字段、所有 ref-bearing 字段、文档 id/path identity、scene/runtime/frontier 不变量、trait 合并语义、opening reply projection、player-turn agent 存在/配置。否则“复用 helper”会把不完整校验误当等价校验。

### DR-07（阻塞）：旧中间态的“重建最小闭包”没有定义替换/清理集合，会保留幽灵正式资料

兼容策略说新访谈最终 `commit_opening` “以本次确认结果重建开局最小闭包”（`design.md:247-256`），但最终 action 只列出写入，没有列出删除或保留规则（`design.md:203-211`）。旧流程中间态已可能写入 entities、scenes、relationships、runtime、frontier；当前实体提交仅覆盖同路径，不删除未再次提交的文件（`commit-entities.js:5-14`），场景/关系同理（`commit-scenes-and-relationships.js:11-27`）。因此改选主角或切入点后，旧人物、关系和场景仍留在正式目录；关系文件还可能指向本次闭包之外的旧实体。

宿主只会在 `checkpoint` 启用时运行 scene cleanup（`apps/platform-web/src/platform-host/ai-invocation.ts:483-496`），而设计示例未请求 checkpoint（`design.md:64-70`）；即便启用，cleanup 也只删除非 active、非 background scenes，不处理 entities/relationships（`apps/platform-web/src/platform-host/scene-cleanup.ts:58-127`）。

实施前需要选定可执行策略：

- **推荐**：为新流程加 generation/session ownership metadata 或显式 managed-path manifest；`commit_opening` 只替换该 generation 管理的开局文件，并删除旧 setup generation 的 stale scene/relationship/entity（保留用户资产如 portrait 的策略要定义）。
- 若不做删除，则不能声称“重建最小闭包”；必须保证旧中间资料不被消费者读到，并给出隔离方式。当前实体列表/关系 UI 会直接读取正式目录，因此单靠 runtime 指针不够。

对**已完成旧存档**，action 必须拒绝再次 commit，除非显式进入受支持的重新开局模式；不能无条件覆盖 turn 0 和正式 agent context。

### DR-08（阻塞）：完成轮的写入顺序把 `setup-summary.complete` 当普通文件，缺少 action 级幂等/前置保护

平台事务确实保证一个 `invokeAgent` 成功时 workspace/context 一起提交、异常时 discard（`apps/platform-web/src/platform-host/ai-invocation.ts:431-515`），所以单一 action 的原子方向可行。但是 action 仍需要逻辑前置条件和幂等语义，设计未定义：

- 若 `setup-summary.status === "complete"` 或已有正式 turn > 0，必须 fail closed，避免重试/旧 context 再次覆盖开局；
- `commit_opening` 必须绑定当前 `opening-interview.sessionId`、branch 与 source identity，防止旧模型回复提交到新导入；
- `opening-interview.status="committing"` 没有可观察的跨事务意义：若单 action 内先改为 committing 后又失败，整个事务回滚；若上一轮单独写 committing，刷新后反而可能卡死。设计需删除该持久 phase 或定义恢复规则；
- setup summary 应作为完成标记在脚本逻辑上最后构造/写入，且只有 turn 0、正式 context、runtime/frontier 等均完成才为 complete。当前旧 action 在 turn 0/context 之前先 stage complete（`游玩设定/scripts/commit-play-setup.js:84-99`），平台事务下不会半落盘，但不利于脱离宿主时的自洽承诺。

另外 `invokeAgent` 返回前平台还会 stage opening-interview context（`ai-invocation.ts:431-475`）。因此 action 内把临时 state 标 complete 与上下文落盘属于同一事务是成立的；不需要额外 `committing` 持久态。

### DR-09（建议调整）：正式 player-turn context 直接整文件覆盖可行但应保留明确“不覆盖已有正式进度”的边界

旧 `commit_play_setup` 用空 `saveId` 写新的正式 agent context，只 seed turn 0（`游玩设定/scripts/commit-play-setup.js:81-92`）。运行时解析会用真实 saveId/agentId 归一化，空 saveId 本身不会造成读取错误（`apps/platform-web/src/agent-runtime/context-lifecycle.ts:199-235`）。所以新开局首次 seed 可复用该形态。

但该写法是整文件替换。`commit_opening` 应先解析 `game-card.json` 的 playerTurn entrypoint，验证 agent 存在，并拒绝覆盖含正式 recentTurns/summary 的 context；同样拒绝覆盖任何 turn > 0。旧完成存档只走确认/正式游玩，不应调用该 action（`design.md:238-245`）。

## 修订复核（2026-08-08）

### DR-01 / DR-03 复核：原问题在设计意图上已解除；衍生出新的轮次关联阻塞（DR-18）

修订已补上耐久 `attempt`、`lastQuestion`、`ready` 不变量，并明确 invoke reject 才可重发、resolve 后处理失败只做恢复（`design.md:74-109`）。因此 DR-01 的“仅内存 pending”与 DR-03 的“post-commit 误重发”在设计意图上已修正，可标记为已解决。

### DR-18（阻塞）：修订用正式剧情 `turn` 关联访谈轮次，无法实现 DR-01/03 的不变量

但 `attempt.basedOnTurn` / `lastQuestion.turn` 被当作**访谈轮次**使用（`design.md:81-99`），平台持久 context 中的 `recentTurns[*].turn` 实际是正式剧情 turn：旁路调用每次取当前最大正式 turn（`apps/platform-web/src/platform-host/ai-invocation.ts:236-240`），把同一个 `invokeMaxTurn` 传给 runtime（同文件 `:279-286`），再写进 context（同文件 `:467-475`）；`appendTurnToContext` 只照值追加，不自增（`apps/platform-web/src/agent-runtime/context-lifecycle.ts:746-760`）。开局期间没有正式回合推进，所以多轮访谈通常全是 `turn: 0`。

因此“context 已推进到更高 turn”永远不能区分 failed attempt 是否其实已提交（`design.md:98-99`），`lastQuestion.turn` 也不能唯一对应最后一轮。必须改用会话自增 `session.revision` / invocation id / attempt id：每次成功轮与 context/state 同事务把 revision +1；attempt 保存 `basedOnRevision` 和稳定 `attemptId`；恢复按 revision 与最近 user/assistant 对数量或 hash 核对，不能用正式 turn。

### DR-02：分支决策已解除原阻塞

修订明确首轮成功后分支不可变，普通返回/刷新/重进直接恢复同一会话，改分支只能重新导入；首轮失败保留已选分支重试（`design.md:111-113`；`prd.md:21-28`、`:76-80`）。动态 slot 又绑定本次 `manifest.importedAt`（`design.md:60-72`），因此不会因重新导入恢复旧 context。该部分可实施。

仍需统一文档中的固定路径示例：`design.md:119-125` 仍写 `context-opening-interview.json`，但实际已改为动态 `openingInterviewSlot(manifest)`。应写成 `context-<openingInterviewSlot>.json`，避免实现者恢复错误文件。

### DR-10（阻塞）：`lastQuestion` 仍依赖 Agent 自报，缺少可强制的成功轮后置条件

修订正确识别 context 已保存 clean content、choices 不能从 context 重算，所以把 `lastQuestion` 设为刷新恢复选项权威（`design.md:74-96`）。但设计让 Agent 通过 `commit_opening_interview_state` 自己写它（`design.md:181`、`:240-247`），平台并不会要求一次成功 invocation 必须调用该 action。Agent 若漏调、action 参数与最终回复不一致，invoke 仍可成功并提交 context，随后状态却没有与最后 assistant reply 对应的问题/选项；恢复将进入不可发送状态。

还有两个权威冲突：

- `lastQuestion.content` 复制了 context 的玩家可见 assistant content，违反“对话由 context 权威、临时文件不保存玩家可见字段另一份长期权威”（`design.md:117-125`、`:176-181`）；
- action 在 Agent 最终回复生成前执行，无法可靠证明 `lastQuestion.content/choices` 与最终 reply projection 完全相同。

实施前必须选一个可强制方案。建议最小方案是：state 只存 `revision + choices + assistantContentHash`，不复制 content；宿主或前端用**实际最终 raw response 的 projection**生成该记录。若坚持同一 invoke 事务，就需要宿主在 stage context 时同步 stage lastQuestion（属于小型宿主能力）；若由前端 resolve 后写，则必须承认存在“context 已提交、state 未写”的崩溃窗口，并设计从 raw context 保留的 projection 元数据恢复。单靠 Skill 提示不能作为 AC9 的耐久保证。

`design.md:125` 还说“通过 reply projection 重建……最后一轮选项”，与 `design.md:76` 的“choices 不能只从 context 重算”直接矛盾，应改成“context 恢复消息正文，匹配 state 恢复最后 choices”。

### DR-04：未解除，仍阻塞

修订仍推荐把 `opening-interview.json` 加到 `world-architect` 静态 runtime contextPath（`design.md:185`），同时要求 complete 后正式运行不注入（`design.md:182`）。当前 contextPath 不按 slot/purpose 条件过滤（`apps/platform-web/src/agent-runtime/context.ts:111-176`；`packages/contracts/src/runtime.ts:455-468`），world-architect 的正式 `frontier推进` 仍会收到该文件。原结论不变：MVP 应由合并 Skill 显式读取，不能加全局 contextPath；或者扩大宿主实现条件注入，但不建议。

### DR-05：source/session 防串已部分修正，其余仍阻塞

修订新增 `source.importedAt/title`、`session.slot/revision`、attempt 和 lastQuestion（`design.md:137-183`），配合动态 slot（`design.md:60-72`），已解决“重新导入串用固定 context”的主要问题。

仍未解决：

1. `sourceWindow` 仍只表达一个连续 `startIndex/endIndex`（`design.md:150-155`），但阅读策略允许定向扩展到窗口外角色（`design.md:222-227`）；不连续读取会被误记为已读完整区间。需改为 `readSlices[]`，每段记录真实 source refs/range/reason；最终 frontier 的连续窗口与访谈 evidence ledger 不应混为一物。
2. `decisions[]`/`unresolved[]` 仍是无 key 自由文本（`design.md:161-162`），无法可靠覆盖玩家修改、清除已解决缺口或关联 evidence。至少改为按稳定 key 的小对象/map，含 value/status/sourceRefs/revision；不需要复制完整实体草稿。
3. 文件自称“建模进度”，却禁止保存任何最小 working draft（`design.md:176-180`）。如果决定坚持轻量状态，应明确它只持久化“读取证据 + 玩家决定 + 缺口”，最终模型由完成轮依据这些结构化事实与 recentTurns 构造；不要声称它持久化完整渐进模型。若要保证 context 压缩后仍能完成，则关键建模决定必须结构化落在 state，不能只留在自由文本对话摘要。
4. `status: "committing"` 仍存在（`design.md:148`），但没有恢复语义；单 action 同事务内不可耐久观察，单独上一轮写又会制造卡死。应删为 `interviewing | complete`，或明确 stale committing 的回退判定。

### DR-11（阻塞）：耐久 attempt 的写入时序与崩溃恢复仍未闭合

`design.md:78-99` 定义了 `submitted/failed/committed`，但只明确 invoke reject 后由前端写 `failed`（`:97`），没有明确在调用 Agent **之前**何时耐久写 `submitted`。若只显示内存 pending 后立即 invoke：

- 页面在 invocation 进行中刷新，尚无 failed attempt 可恢复；
- 调用成功但前端已卸载时，依赖 Agent 自觉写 committed/lastQuestion；漏写则回答丢失于 UI；
- `submitted` 枚举没有任何规定的恢复分支。

可实施顺序应明确为：

1. 校验当前 `revision/lastQuestion`；
2. 前端先 read-modify-write `attempt={attemptId,input,status:"submitted",basedOnRevision}`；
3. 再 invoke，并把 attemptId/revision 放入 prompt；
4. Agent 成功事务只接受匹配 attemptId，并将 revision +1、attempt committed；
5. reject 后前端仅在 attemptId 仍匹配时 CAS 式标 failed；
6. 刷新见 submitted 时先只读恢复：若 context/state revision 已推进则视为 committed，否则显示“正在恢复/可确认重试”，不能盲发。

普通 workspace API 没有真正 CAS，因此至少要在每次 read-modify-write 前核对 `session.slot/revision/attemptId`，并禁止并发 send；设计应说明多标签页/重复点击的最后写保护。否则 attempt 文件本身会成为覆盖新状态的竞态源。

### DR-06：未解除，仍阻塞

修订后的最终 action 仍只写“校验并规范化全部 entities / 校验 refs”（`design.md:249-263`），没有增加输入 schema 与校验矩阵。现有 helper 仍仅完整覆盖顶层 entity id/name/brief、scene/relationship/runtime 的一部分 ref（`开局建模/scripts/_validation.js:19-76`；`commit-runtime-and-frontier.js:7-70`），不等价于 PRD 要求的跨文件 Schema/ref 校验（`prd.md:45-51`）。

实施设计至少要列出本 action 必须验证的闭包：

- entity 文档 id 与目标 path；character/container/item 的所有 ref-bearing 字段；container cycle/ownership、equipment reachability/quantity；
- character 必需展示字段及 traits/status/attributes/gauges 的 shape；
- scene id/path、location/present，relationship subject/edge；
- runtime protagonist 必须是 character、location/active scenes 存在且 name 与目标一致；
- frontier window/chapter refs/extractedThrough 与 source index 一致，timeline 至少一个 `kind:"source", order:1` 的开局锚点，runtime.plotOrder 与之对应；
- `openingReply` projection 成功、turn 0 结构、player-turn entrypoint agent 存在；
- 输入数组内重复 id/path 与将覆盖的现有文件身份冲突。

若 MVP 明确不创建 container/item/equipment，可在 action schema 中禁止这些未完整校验的类型，把校验面缩小；不能接受任意实体 JSON 再宣称全 Schema 校验。

### DR-07：未解除，仍阻塞

旧中间态仍被描述为由 `commit_opening` “重建开局最小闭包”（`design.md:295-304`），但 action 仍只有写入列表，无 stale 文件删除/隔离/ownership 规则（`design.md:249-259`）。旧 entities/scenes/relationships 会留在正式目录；scene cleanup 只有请求 checkpoint 才运行，且不清实体/关系（`apps/platform-web/src/platform-host/ai-invocation.ts:483-496`；`scene-cleanup.ts:58-127`）。

建议把兼容范围收窄成一个可执行规则：检测为旧中间态且 `setup-summary` 未 complete 时，**在启动新访谈前**清除旧流程明确管理的半成品路径并重置 runtime/frontier 为 pending 基线，或记录 explicit legacy managed paths 供最终 action 删除。若无法安全辨认哪些实体是旧半成品，就必须提供新的 generation 命名空间/managed-path manifest，并说明旧残留不会被任何 UI/Agent glob 消费。当前“Prompt 告知可能有旧产物”不是隔离机制。

### DR-08 / DR-09：未解除，仍阻塞完成 action 的重试安全

修订没有增加 action 前置保护或幂等键。`commit_opening` 必须在任何写入前验证：

- 当前 setup 未 complete；不存在 turn > 0；turn 0/正式 player-turn context 不含非本 session 的已有进度；
- 输入 `session.slot/revision/source.importedAt/branch` 与当前 state/manifest 完全一致；
- 本 session 已有 commit receipt 时返回已有成功摘要而不是覆盖；不同 payload hash 使用同一 session/revision 时 fail closed；
- 正式 player-turn context 只在首次开局 seed，绝不覆盖已有 summary/recentTurns；
- `setup-summary.complete` 在脚本逻辑最后 stage，且临时 `status` 同时改 complete。

`status:"committing"` 仍无必要（见 DR-05）。事务原子性本身可行：action 写入、opening context 写回和 workspace commit 都在同一 `RuntimeWorkspaceTransaction`，异常 discard（`apps/platform-web/src/platform-host/ai-invocation.ts:431-515`）。问题是同一成功调用被业务层再次执行时仍会覆盖；必须用 session/revision + receipt 解决。

### DR-12（阻塞）：旧中间态检测优先级会把孤儿 context 当成当前小说会话恢复

兼容优先级写“新 `opening-interview.json` **或新 context slot** 有记录 → 恢复访谈”（`design.md:297-302`）。动态 slot 只由当前 manifest 导出虽降低串书风险，但单看 context 文件不能验证 branch、state revision、lastQuestion/choices 或 source identity；状态文件缺失/损坏时，context 记录本身不足以恢复为可回答会话。尤其首轮 invocation 可能成功写 context、却因 DR-10 漏写 state，按该规则会进入一个没有耐久 choices/branch 的残缺会话。

恢复条件应是：

1. setup complete 优先；
2. state schema/source/slot/revision 有效，且对应动态 context 能与 state 最后一轮校验 → 恢复；
3. 只有 context、没有有效 state → 显示“会话恢复失败/重新导入”安全态，不得猜 branch 或继续发送；
4. 只有 state、没有 context → 同样 fail closed；仅当 revision=0 且无成功轮时可回到已选分支的首轮重试。

`initialize()` 不能把普通 workspace read 异常一律吞掉并回到导入选择（当前旧实现如此：`apps/play-frontend-dev/src/composables/useSetupState.ts:861-914`），否则暂时性读取错误会让用户覆盖已有会话。

### DR-13（阻塞）：`?raw` 单一权威方案的边界写得过宽，会误改 `frontier推进` 的共享 helper

设计说把“相关 Skill/scripts”改为 raw import 卡 workspace（`design.md:310-314`），方向可行，现有装备能力已有同模式（`apps/platform-web/src/storage/workspace-templates/agents/stage-manager.ts:0-5`）。但当前平台模板的 `OPENING_COMMON_JS` / `OPENING_VALIDATION_JS` 不只映射旧开局与游玩设定，还同时生成 `frontier推进` 的 `_common.js/_validation.js`（`apps/platform-web/src/storage/workspace-templates/agents/world-architect.ts:539-558`）。如果实现者直接删除 `scripts/opening.ts` 或将这两个常量只指向新开局 helper，可能无意改变正式 frontier 推进，违反设计自己“不受影响”的边界（`design.md:263`）。

必须把同步清单写精确：

- raw import 卡 workspace 的新合并《开局建模》`SKILL.md`、其 inspect/read/state/commit scripts 和该 Skill 私有 helpers；
- 从 template mapping 删除旧《游玩设定》及旧开局 commit mappings；
- `frontier推进` 继续映射其当前卡文件，最好也独立 raw import 自己目录下的 helper，不能继续隐式借新开局常量；
- `agent.json` 与 `AGENT.md` 仍在平台模板中生成，不会因 Skill raw import 自动同步，需单独更新 skills.enabled、岗位说明和工具配置。

若 raw import build 失败再双写，必须有**字节级局部一致性检查**，而不是 grep 关键词。

### DR-14（阻塞）：两套前端“只同步涉及文件”可行，但设计没有列出可执行 manifest，也漏掉 dist 产物边界

两棵前端确实整体不同，不能整树覆盖；当前 task 相关 setup 文件大多字节相同，`App.vue` 已存在无关差异。`package:frontend` 只把 `apps/play-frontend-dev/src` 打成独立 zip（`scripts/package-play-frontend-source.mjs:133-176`），不会更新 `cards/沉浸阅读器.tsian-card/frontend/src` 或 `frontend/dist`；根脚本也没有卡前端同步命令（`package.json:18,30`）。卡 manifest 绑定的是 packaged `frontend/dist/index.html`（`cards/沉浸阅读器.tsian-card/game-card.json:14-19`）。

因此 `design.md:312` 仅说“同步本任务涉及文件”不足以验收 AC11。实施前需固定 manifest，至少包含：

- `composables/useSetupState.ts`、`lib/source.ts`；
- `components/setup/SetupWizard.vue`、`SetupStepper.vue`；
- 新的分支选择/访谈组件与被删除的旧 understanding/step3/step4 入口；
- `OpeningConfirm.vue`（去 understanding summary 依赖）；
- 若恢复模式/进入故事逻辑改动则两树各自的 `App.vue`，但必须人工移植 task hunk，不能整文件覆盖；
- 所有新增 imports 依赖的共享文件。

还必须明确 packaged card 的 `frontend/dist` 是否为本任务交付物。既然 `game-card.json` 实际运行 dist，若只同步 src 而不重建 dist，仓库内打包卡仍运行旧五步流程；这违反“打包卡前端权威来源”要求（`prd.md:60-65`）。若项目约定 dist 不提交，设计需明说并提供重新打包流程；当前仓库显然已跟踪 dist，因此更合理的是构建 card frontend 或用明确命令更新 dist，并校验 manifest 文件清单/size 是否需要更新。

### DR-15（阻塞）：默认平台模板更新只自动重置 builtin 卡，不会升级既有 local 卡内容

平台 `ensureBuiltinBlankGameCard` 会对 builtin 模板逐文件内容比对，不一致时全量 reseed（`apps/platform-web/src/storage/game-cards.ts:407-436`、`:973-991`）。但用户从模板创建的 editable local card 是一次性复制 content/frontend（同文件 `:998-1033`）；后续没有看到按模板版本升级 local card 的路径。save runtime 的 workspaceVersion 升级也只补**缺失的 save 文件**，不更新 card-content Skill/scripts（`apps/platform-web/src/storage/workspace.ts:280-318`）。

设计的“平台内置工作区模板”更新可保证**新建卡/重置 builtin**采用新流程，但未保证已存在 local 卡加载新 AI-facing Skill。PRD 的“新导入/新开局使用新流程”（`prd.md:60-65`）若涵盖既有 local 卡的新存档，这会成为兼容缺口。

实施前必须明确产品边界：

- 若只承诺仓库默认卡包 + 更新后的 builtin 新建卡，需把“既有 local 自定义卡不会自动迁移”列为已知限制；
- 若必须升级现有 local 默认派生卡，则需要 card-content version/migration，且只能替换确认未被用户修改的旧模板内容，不能无条件全量覆盖。

这与保留 `understanding-summary.json` 的 save runtime 升级是两件事，不能靠 `DEFAULT_SAVE_RUNTIME_UPGRADE_FILE_PATHS` 解决。

### DR-16（建议调整）：验证方案应落成具体命令和最小 action harness

当前没有发现 world-architect 开局 scripts 的现成单测；生产 browser preflight 主要验证 Frontend Action 和装备错误传输（`scripts/test-frontend-action-production-browser.mjs:133-191`），不能证明 `commit_opening` 的 schema/ref/回滚语义。宿主已有 browser skill script runner，但没有开局专用 fixture harness。

建议设计明确最小验证：

1. 为 `commit_opening` 增加轻量 Vitest/脚本 harness，基于 `createRuntimeWorkspaceTransaction` + browser script executor fixture，至少覆盖成功闭包、未知 ref、重复 id、已有 complete/turn>0 拒绝、失败零写入、同 receipt 幂等；
2. `npm run build:web` 验证 raw imports/template；`npm run build:play-frontend` 验证开发前端；
3. 对 manifest 中每个双前端文件做 `cmp`/hash（对 App.vue 只检查 task hunk 或先定义允许差异，不能要求整文件相同）；
4. 对平台模板生成的每个新开局 Skill/script 与 card workspace raw 文件做字节相等断言；
5. 构建/更新 card `frontend/dist` 后做 packaged card smoke；
6. `git diff --check`。

无需为本任务引入重型端到端 Agent 模型测试，但单一高后果 commit action 没有负例/回滚测试不可接受。

### DR-17（阻塞）：直接重放 context 会把首轮内部启动 Prompt 显示成玩家消息

设计把首轮 branch/导入元数据放在 `invokeAgent` 的 input Prompt（`design.md:60-72`），同时把 context `recentTurns` 当 UI 对话恢复权威（`design.md:117-125`）。平台会把每次 invoke 的 `userInput` 原样追加为 context 的 user turn（`apps/platform-web/src/platform-host/ai-invocation.ts:279-286`、`:467-475`；`context-lifecycle.ts:746-760`）。因此首轮恢复时，内部 `buildOpeningInterviewPrompt(title, branch)` 会被当作玩家消息重放；当前恢复实现确实对所有 role=user 无差别显示（`apps/play-frontend-dev/src/composables/useSetupState.ts:677-700`）。这既破坏自然对话，也可能暴露内部 Skill/schema 指令，违反 R2（`prd.md:30-35`）。

必须给 bootstrap turn 可过滤的耐久标识。最小做法：首轮实际 input 使用固定非展示 marker（例如 `opening-interview:start:<sessionId>`），branch/source/Skill 指令通过本轮 `injection` 或 state/contextPath 提供；UI 恢复明确跳过该 marker。若 injection 不落盘，后续所需 branch/source 已由 state 保留。不要用内容模糊匹配任意长 Prompt，也不要把内部 Prompt 渲染给玩家。

成功 user answer 仍可从 context 恢复；失败 answer 则从 attempt 恢复，两者按 attemptId/revision 去重。

## 最终结论

### 是否还有阻塞问题

**有。当前设计尚不宜直接进入实施。** DR-01、DR-02、DR-03 的原始问题已按用户决策和修订设计解除，但修订方案及剩余设计仍有以下实施阻塞。

### 阻塞问题

#### A. 临时状态与对话权威

1. **访谈轮次关联键不可用（DR-18）**：`attempt.basedOnTurn` / `lastQuestion.turn` 使用正式剧情 turn（`design.md:74-99`），而开局旁路多轮通常都写 `turn:0`（`apps/platform-web/src/platform-host/ai-invocation.ts:236-240,279-286,467-475`；`apps/platform-web/src/agent-runtime/context-lifecycle.ts:746-760`）。必须改用 `session.revision + attemptId`。
2. **全局 contextPath 污染正式 world-architect（DR-04）**：设计仍推荐静态注入临时文件（`design.md:176-185`），但 contextPath 不按 slot/purpose 过滤（`apps/platform-web/src/agent-runtime/context.ts:111-176`；`packages/contracts/src/runtime.ts:455-468`）。MVP 应由开局 Skill 显式读取。
3. **lastQuestion 双权威且无强制成功后置条件（DR-10）**：context 是正文权威（`design.md:117-125`），state 又复制 content/choices（`design.md:163-181`），且 Agent action 在最终回复前无法证明二者一致。state 应只保存 revision、choices 和正文 hash，且用实际最终 projection 生成或强制校验。
4. **attempt 崩溃窗口未闭合（DR-11）**：`submitted` 的 invoke 前耐久写入、刷新恢复、attemptId 校验和并发覆盖规则未定义（`design.md:74-100`）。
5. **首轮内部 Prompt 会被恢复成玩家消息（DR-17）**：首轮 Prompt 作为 invoke input（`design.md:60-72`）会原样进入 recentTurns（`ai-invocation.ts:279-286,467-475`），而现有恢复显示所有 user turns（`apps/play-frontend-dev/src/composables/useSetupState.ts:677-700`）。需使用可过滤 bootstrap marker，并通过 injection/state 提供内部指令。
6. **临时状态仍有恢复歧义（DR-05）**：单一连续 `sourceWindow` 与定向窗口外读取冲突（`design.md:150-155,222-227`）；`status:"committing"` 没有失败恢复语义（`:148`）；`decisions[]/unresolved[]` 缺稳定替换规则（`:161-162`）。

#### B. `commit_opening` 原子性、覆盖与旧存档

7. **原子宿主成立，但业务幂等未定义（DR-08/09）**：平台会在同一事务提交 action 写入与 context，异常 discard（`apps/platform-web/src/platform-host/ai-invocation.ts:431-515`；`apps/platform-web/src/storage/saves.ts:323-348`），这部分可行；但 action 没有 session/revision/payload receipt，也未拒绝 complete、turn>0 或已有正式 player-turn context（`design.md:249-263`），重复成功调用仍可覆盖 turn 0 与正式上下文。
8. **跨文件校验契约不足（DR-06）**：设计只给步骤级描述（`design.md:249-261`），现有 helper 只校验部分顶层字段/refs（`cards/沉浸阅读器.tsian-card/workspace/agents/world-architect/skills/开局建模/scripts/_validation.js:19-76`；`commit-runtime-and-frontier.js:7-70`），没有覆盖正式 container/equipment、文档 identity、frontier 首锚点等契约（`cards/沉浸阅读器.tsian-card/workspace/docs/novel-airp-schema-reference.md:49-55,77-94,185-234`）。必须明确 action 输入 schema 与校验矩阵，或缩小允许实体类型。
9. **旧中间态没有可执行清理/隔离规则（DR-07）**：设计说重建最小闭包（`design.md:295-304`），但 action 只有写入，没有 stale entities/scenes/relationships 删除或 ownership manifest（`:249-259`）。现有 scene cleanup 也不处理实体/关系（`apps/platform-web/src/platform-host/scene-cleanup.ts:58-127`）。
10. **残缺 state/context 的兼容优先级不安全（DR-12）**：当前“state 或 context 有记录即恢复”（`design.md:295-304`）会把只有 context、没有 branch/revision/choices 的孤儿会话判为可恢复。必须要求 state 与动态 slot context 成对校验，否则 fail closed。

#### C. 源码同步边界

11. **raw import 改造会误触 frontier 共享 helper（DR-13）**：当前平台模板把 `OPENING_COMMON_JS/VALIDATION_JS` 同时映射给开局、旧游玩设定和 `frontier推进`（`apps/platform-web/src/storage/workspace-templates/agents/world-architect.ts:539-558`）。设计的笼统“相关 Skill/scripts raw import”（`design.md:310-314`）必须拆成精确文件清单，保证 frontier 不受影响。
12. **双前端与 packaged dist 交付边界缺失（DR-14）**：`package:frontend` 只输出 zip，不同步卡目录（`scripts/package-play-frontend-source.mjs:133-176`；`package.json:30`）；卡实际运行 `frontend/dist/index.html`（`cards/沉浸阅读器.tsian-card/game-card.json:14-19`）。设计只同步 src（`design.md:312`）会让仓库打包卡继续运行旧流程。必须列出 task 文件 manifest，并明确重建/提交 dist 与 card manifest 元数据。

### 建议调整（非单独阻塞）

- 将 source evidence 改为真实 `readSlices[]`，decisions/unresolved 改为稳定 key 的紧凑对象；无需复制完整实体草稿，但要明确它们是“证据/决定/缺口权威”，正式模型只在 commit 后成为权威（`design.md:127-185`）。
- 明确既有 editable local 卡不会被平台模板自动升级，或另行设计保守 card-content migration。builtin 会 reseed（`apps/platform-web/src/storage/game-cards.ts:973-991`），local 卡仅创建时复制（`:998-1033`），save workspaceVersion 只补 save 文件（`apps/platform-web/src/storage/workspace.ts:280-318`）。
- 为高后果 `commit_opening` 增加最小脚本 harness，覆盖成功、未知 ref、重复 id、已有 complete/turn>0 拒绝、失败零写入和 receipt 幂等；现有 production browser preflight 不覆盖开局 action（`scripts/test-frontend-action-production-browser.mjs:133-191`）。
- 统一动态 context 路径文档：`design.md:119-125` 不应再写固定 `context-opening-interview.json`，应写 `context-<openingInterviewSlot>.json`。

### 可接受部分

- 产品流程确实只保留导入、分支选择、单一连续 Agent 访谈、独立确认屏，没有再次引入初始理解/角色表单/游玩设定 UI 子步骤（`design.md:14-41`）。
- 首轮成功后分支不可改、普通返回/刷新恢复原会话的决策已经清楚（`design.md:111-113`；`prd.md:21-28`），DR-02 已解除。
- 动态 source slot 与 source identity 的方向正确，可避免重新导入后串用旧 context（`design.md:60-72,137-147,182-183`）。
- 正式实体只在最终轮提交、访谈中不提前污染正式模型的边界正确（`design.md:6-12,187-191`）。
- 单一 `commit_opening` 运行在 `RuntimeWorkspaceTransaction` 中，可实现整轮多文件原子落盘；需要补的是业务幂等、覆盖与完整校验，而不是另造分布式事务（`design.md:249-263`；`apps/platform-web/src/platform-host/ai-invocation.ts:431-515`）。
- `setup-summary.status === "complete"` 继续作为旧完成存档与确认屏的耐久边界是兼容的（`design.md:265-293`；`apps/play-frontend-dev/src/App.vue:83-115`）。
