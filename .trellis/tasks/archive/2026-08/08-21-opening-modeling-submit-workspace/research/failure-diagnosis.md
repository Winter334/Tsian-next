# 开局建模提交失败诊断

## 结论

附件中的直接失败发生在 `commit_opening` 脚本执行之前，不是原子写入内部回滚，也没有证据表明是 provider endpoint 或 context window 超限。

失败链路是：

1. storyteller 已成功返回正文和 `responseRef = "tool-result-0"`。
2. world-architect 随后先发出一次完全空的 `run_script`，返回 `ACTION_SKILL_REQUIRED`。
3. 下一次 `commit_opening` 调用传入了约 1,999 characters 的完整模型草案，但没有传 `inputRefs`，因此 action 输入门禁返回 `ACTION_INPUT_INVALID: Action input is missing required field: openingReply`。
4. 再下一次模型回复没有形成完整 strict JSON array，文本工具协议返回 `TEXT_TOOL_PROTOCOL_INVALID_JSON` 并要求纠错。

因此本次故障是“复杂最终工具调用的组装失败 + 纠错时再次生成非法 JSON”，而不是 `commit-opening.js` 对 entity/scene/runtime/frontier 的业务校验失败。

## 附件量化

- 请求体可被 `ConvertFrom-Json` 正常解析。
- UTF-8 bytes：116,904。
- characters：85,198。
- messages：8。
- system message：12,638 characters。
- 最后一条 user message：63,338 characters。
- storyteller request：514 characters；storyteller response：1,020 characters。
- 最终 `commit_opening.input`：约 1,999 characters。
- 模型配置声明的 context window 为 400,000，附件本身没有超窗证据。

最后一条 user message 之所以膨胀，主要是工具循环把完整《开局建模》Skill、来源读取结果、opening notes、storyteller observation、完整 schema guide、`_validation.js` 与 `commit-opening.js` 读取结果都带入了提交轮。最终草案本身不是最大的载荷，但原子 action 迫使模型同时维持完整图数据、正文结果引用和一次性发布规则。

## 当前代码事实

### 1. `inputRefs` 能解决转义问题，但仍依赖模型正确组装

`run_script.inputRefs` 会把当前工具循环中的 `agent_call.responseRef` 解析到 action 顶层输入。当前 Skill 已明确要求省略内联 `openingReply`，改传 `inputRefs.openingReply`。附件中模型没有遵守这一步，所以通用 action schema 在脚本执行前拒绝了调用。

### 2. 当前原子 action 把两个不同生命周期耦合在一起

`cards/沉浸阅读器.tsian-card/workspace/agents/world-architect/skills/开局建模/scripts/commit-opening.js` 当前同时负责：

- 校验和规范化 entity/scene/relationship/runtime/frontier/summary；
- 校验及投影 storyteller 正文；
- 验证 player-turn entrypoint；
- 检查新存档 clean state；
- 写入正式模型、turn 0、storyteller context 与 complete setup summary。

`openingReply` 在脚本第 254 行附近才进入校验，但缺少 required 字段时通用 action 门禁更早失败，整段脚本完全不执行。

### 3. delegated storyteller 可以看到当前 turn 已 staged 的 workspace

`apps/platform-web/src/agent-runtime/index.ts` 的 delegated agent 路径保留 root turn 的 live staged workspace array；目标 Agent 的 registry/context 与 workspace operation 都基于该视图。因此只要模型资料先通过 workspace action 写入，storyteller 可以直接 `read` 这些文件，不需要调用方复制完整实体事实。

### 4. 单个 action 与整个 invokeAgent 有两层事务边界

- browser script action 使用 savepoint；当前 action 失败会回滚该 action 的写入。
- 整个 persistent `invokeAgent` 只有在模型成功返回后才调用 `commitWorkspaceChangesForSave`；provider/tool-loop 最终失败会 discard 整个 outer transaction。

这意味着“同一 invocation 内先 stage、后 storyteller”能让后续 action 读取前序成功结果，但若要让模型资料在 storyteller/publish 整体失败后仍可恢复，至少需要在模型 staging 完成后结束一次成功的 outer invocation，再开始 finalize invocation。

## 历史约束

项目在 `6d624dee` 之前已有 `commit_entities`、`commit_scenes_and_relationships`、`commit_runtime_and_frontier` 等分步 action。`08-08-interview-driven-opening-modeling` 任务将它们收敛为单一 `commit_opening`，原因不是“分步永远错误”，而是旧分步流程存在：

- 访谈尚未收敛就写正式文件；玩家改选角色或切入点后会留下 stale entity/scene/relationship；
- 没有 generation/session ownership manifest，无法区分本次开局管理的文件与未知正式数据；
- 各 action 的跨文件闭包校验与失败零写入语义不完整；
- 前端把任何正式目录数据视为 legacy/dirty state，刷新无法安全恢复。

所以本任务不能直接恢复旧脚本。新的分阶段方案只在玩家确认开始后执行；每批先完成最低校验，再写正常权威路径。source/control、pending setup、自然语言 opening notes 与正常 workspace 共同支持恢复，action 用完整阶段输入、现有路径冲突和下游锁定保护已完成资料；不新增 stage manifest、hash、owned-path receipt 或第二份模型权威。

## 设计推论

1. 模型资料与玩家首回合发布是不同生命周期，应拆开。
2. entity/scene/relationship/runtime/frontier 写入正式 `save/...` 权威路径，避免 draft 与 formal 两份事实；`setup-summary.status` 继续是正式开局完成门。
3. 每个 entity、graph、state 阶段由独立成功的 persistent invocation 形成耐久边界，并由 Agent 更新自然语言 opening notes；程序不把 notes 解析成状态机。
4. frontend 只消费 reply projection 的 continuation 信号；刷新恢复显示可继续状态，不自动调用模型。
5. finalize invocation 让 storyteller 读取正常 workspace 权威模型，只传轻量任务/终点/输出格式；最终 publish action 只接收 `openingReply`（通过 `inputRefs`）并写 turn 0/context/complete summary。
6. publish 失败时已 staged 模型保持不变；重试不再重建实体和图。分阶段 action 失败时只回退当前 action，前序成功 phase 可恢复。
7. 相同 complete 状态在未进入正式游玩时继续返回 alreadyComplete，正式游玩开始后保持拒绝覆盖。

## 分批残留风险复核（用户质疑后）

“残留文件”不是分批提交必然有害，也不是维持当前单体 action 的充分理由。需要区分两种实现：

### 直接分批写正式路径

风险有当前代码可验证的实际表现：

- `useSetupState.hasLegacyOpeningState` 只要发现 `save/entities`、`save/scenes` 或 `save/relationships` 中有正式数据就返回 legacy；刷新后会进入“请创建新存档”的阻塞页。
- 当前 `commit-opening.js` 在最终提交前同样要求 entity/scene/relationship 目录为空；任何前序正式写入都会触发 `OPENING_SAVE_NOT_CLEAN`，不能直接与现有 publish 逻辑组合。
- 旧 split action 只覆盖新 payload 提到的路径，不删除旧 payload 已移除的路径。若角色、地点或 scene id 在修正中改变，旧文件会留在正式目录。多数当前 UI 按 runtime ref 定向读取，因此未引用残留往往暂时无显示影响；但 frontier validation 会 glob 全部 entity，装备候选会 list character entity，未来 Agent 搜索也可能看到它，所以不能证明它永远惰性。

这个风险在“玩家已最终确认、所有 id 永不变化”的理想路径上概率较低；最强的实际影响不是剧情立刻错乱，而是刷新恢复和最终 clean check 的确定性阻塞。幽灵资料污染属于条件性风险。

### 专用 staging namespace 后原子提升

更简单的替代方案是把已校验模型放在例如：

```text
save/playthrough/opening-stage/model/entities/...
save/playthrough/opening-stage/model/scenes/...
save/playthrough/opening-stage/model/relationships/...
save/playthrough/opening-stage/model/runtime.json
save/playthrough/opening-stage/model/frontier.json
save/playthrough/opening-stage/manifest.json
```

storyteller 仍然可以从 workspace 读取；普通 runtime/UI/Agent 不会把它当作正式模型。最终 publish 从 stage 读取并在一个事务中复制到正式路径、写 turn 0/context/setup complete，然后删除整个 stage。此时：

- 局部 validation/generation 错误只影响对应 stage section；
- storyteller/publish 失败不会丢失 stage；
- 正式目录在 publish 前保持 clean；
- stale stage 被隔离，替换/清理只针对一个明确前缀；
- 最终 action 仍原子，但它只是确定性 promotion，不要求模型重新提交完整图。

代价是模型文件会经历一次 stage→formal 复制，storyteller 需要按 manifest 中的 stage path 读取；这些成本小于 formal-path staging 所需的 managed-path 删除、pending runtime 恢复和 legacy-state 兼容复杂度。

专用 namespace 是可行的隔离方案，但用户进一步明确了更符合产品语义的选择：每个建模批次本身先完整校验、成功后直接成为正常 workspace 权威资料；中途保留的是“已完成进度”，不是未验证草稿。最终方案因此采用正常正式路径，不增加 build receipt、hash、owned paths 或另一份结构化阶段状态。每个阶段用独立成功的 persistent invocation 形成真实耐久边界；普通 gameplay 仍由 setup summary complete 门控。

该选择成立的必要约束是：

- 每个 section action 在第一次写入前完成本阶段全部校验；失败零写入。
- action 成功、Agent 更新 opening notes 并结束 invocation 后，section 文件与自然语言笔记才一起耐久提交。
- 下游 phase 未完成时可重做当前 section；下游一旦提交，上游 id/path 集合锁定，避免级联 stale 清理。
- frontend 只在 source/control 匹配、setup pending、opening notes 存在且 runtime/frontier 形状可恢复时接受 partial formal model；其他未知正式状态继续 fail closed。
- storyteller 只在 runtime/frontier phase 已耐久完成后调用，并直接读取正常实体、场景、关系和 runtime/frontier。
