# 开局向导对话与模型一致性优化：技术设计

## 1. 边界与源码权威

本任务是一个紧密耦合的开局访谈修正，不拆子任务：流式 UI 与角色 branch 契约都发生在同一个“选择分支 → 启动访谈 → 展示首轮回复”路径中，可由同一整卡手工验收。

权威修改范围：

- `apps/play-frontend-dev/src/**`：开局访谈 UI、流式呈现和 invoke injection。
- `cards/沉浸阅读器.tsian-card/workspace/agents/world-architect/skills/开局建模/**`：Agent-facing branch 语义、action schema 与原子提交校验。

不修改：

- `cards/沉浸阅读器.tsian-card/frontend/**` 历史导出残留；
- `apps/platform-web/**`、共享 contracts、bridge wire shape；
- opening control、hidden state、attempt/revision 与 receipt 协议；
- 正式故事流式 UI，除非复用组件需要增加一个默认不启用的新样式变体。

## 2. 角色分支契约

### 2.1 单一结构化权威

`OpeningInterviewControl.branch` 继续是唯一结构化权威，取值仍为：

- `canon`：原著角色；
- `original`：原创角色。

不新增第二个 branch 字段，不把中文 label 写入控制文件或隐藏状态，也不改变 bootstrap/answer marker。恢复流程继续校验 control、assistant state 与当前 source 中的 branch 一致。

### 2.2 Frontend injection

在 `opening-interview.ts` 建立 branch → 中文标签的封闭映射，由 `buildOpeningInjection` 同时发出：

- 稳定枚举值；
- 玩家已确认的中文角色类型；
- 正向执行要求：将其视为当前会话不变量，第一次提问直接进入对应分支。

这一内容仍使用现有 `before-input` user injection，不生成玩家可见的虚假回答，也不持久化为 context turn。实际 input 仍是可恢复的精确 marker。

### 2.3 Skill 自包含

《开局建模》Skill 在入口处明确说明枚举映射，并把首轮行为写成：

- `canon`：读取足够的小说开头线索，直接提供原著候选或请玩家指定角色；
- `original`：直接询问姓名、身份或切入点中最高价值的一项。

“branch 已由玩家选择”属于已观察到重复询问后的必要约束；不增加与当前行为无关的额外禁令。

## 3. 安静的连续流式排版

### 3.1 同一消息骨架

`PlaySetupDialog` 在 `status === "running"` 时也渲染 `NarrativeMessage`，不再切换到 standalone `EmberForge` 或独立 `.streaming-block`：

- 首个 delta 前：content 使用简短状态“正在整理…”，消息末尾显示小型呼吸光点；
- 收到 delta 后：content 改为 `sanitizeOpeningDisplay(rawStreamingText)`，光点仍位于正文末尾；
- 完成后：同一位置由消息列表中的最终 `NarrativeMessage` 接管，光点淡出/移除。

流式文本不做客户端打字机补间，直接展示 Provider 已到达的 chunk，避免重复动画、追赶和跳字。

### 3.2 组件兼容

在 `NarrativeMessage` 增加可选的 quiet streaming 变体；现有正式故事调用保持默认行为，因此本任务不改变 StoryView 的流式视觉。quiet 变体使用正文伪元素或等价的行内标记，确保指示器紧随正文末尾，而不是新增卡片或独立 Canvas。

quiet 变体沿用最终消息的 margin、字体、颜色、Markdown 渲染和宽度。删除 `PlaySetupDialog` 中只服务旧流式卡片的样式与 `EmberForge` import。

### 3.3 动效与可访问性

- 光点只做低幅度 opacity/scale 呼吸，不位移、不随机、不闪烁成硬切方块。
- 完成态移除指示器时不改变正文起始位置。
- `prefers-reduced-motion: reduce` 下关闭循环和淡出动画，保留静态光点/状态语义。
- running 消息使用 `aria-live="polite"` / `aria-busy` 或等价语义，避免每个 delta 形成高干扰播报；具体属性以现有组件结构中最小改动实现。
- 继续使用现有 streaming sanitizer，任何完整或部分隐藏 marker 都不得闪现。

## 4. 内容驱动的正式模型闭包

### 4.1 普通内容规则

Skill 不再维护“开局只允许 character/location”或“禁止 container/item/equipment”的特殊概念，只执行统一规则：依据已读小说、玩家回答和已确认的开局处境，建立让第一回合成立的最小充分模型。

这意味着：

- 当前内容没有持有物或装备需求时，不创建 container/item；
- 当前内容需要时，container/item、character containers/equipment 与 character/location/relationship 一样正常进入闭包；
- relationships 保持 character-to-character，不把物品持有关系塞进关系分片；
- extensions 不替代已有核心 schema，validator 继续拒绝未知 ref-bearing 字段。

Skill 的完成条件改为“正式模型的全部已用引用可闭合”，不按 entity 类型设置必建清单。

### 4.2 `commit_opening` entity union

`entities` action schema 与脚本扩展为当前正式 schema 的封闭 union：

- character：在现有字段基础上允许 `containers` 与 `equipment`；
- location：保持现有字段；
- container：`id/name/brief/type="container"/contents/status?/extensions?`；
- item：`id/name/brief/type/tags?/equipment?/extensions?`。

normalization 分两阶段：先规范化所有 entity 并建立 `entityById`，再验证 character/container/item 之间的引用，避免数组顺序成为隐式依赖。场景、关系和 runtime 继续使用同一个 entity map。

### 4.3 容器与装备一致性

提交前验证：

- character container roots 与 container contents 使用 canonical refs；count 缺省为 1，否则必须是正安全整数；
- container 只包含 item/container，图无循环；同一根/嵌套容器不能被多个角色共同拥有；
- equipped item 必须从该角色容器图可达，引用次数不超过可用数量；
- item `type="equipment"` 时必须有合法 equipment 规则，slotType 与角色槽位一致；
- add/percent 只引用角色已有属性并使用安全整数；
- `applied` 是确定性派生，不由模型任意决定。实现优先复用现有装备语义；若资源隔离要求本 Skill 自包含，则保持同一公式/错误边界并在一次性 harness 中做交叉验证。

输入侧允许 Agent 表达基础属性、装备槽与 item 规则；action 在正式写入前计算或验证最终 attributes/applied，使输出直接符合现有物品栏和《装备管理》Skill 的 canonical schema。

### 4.4 原子性与兼容

新增 entity 类型仍在现有 `commit_opening` 单事务中与 scene、relationship、runtime、frontier、turn 0、context、control 和 setup summary 一起提交。任一图或装备校验失败时零持久写入。

项目仍处于测试阶段，不迁移已经开始的旧中间态；完成旧存档继续按既有完成信号恢复。当前 control/hidden-state schema 不需要版本变化。

## 5. 状态与错误处理

- `playSetupStatus`、`playSetupStreamingText`、active invocation 过滤和自动滚动逻辑保持不变。
- invoke reject、recovering、retry、revision/attemptId 校验不变。
- 最终 response 只有通过 `parseOpeningAssistant` 和 branch/session/revision 校验后才进入消息列表。
- 若请求中的 branch label 与枚举映射不一致，视为前端代码缺陷；封闭映射从同一个 branch 值生成，避免两处独立拼接。

## 6. 交付与验证

自动门槛遵循仓库 smoke-only 决策，不新增 UI/组件/纯 helper 测试文件：

1. `npm run build:play-frontend`；
2. `npm run package:frontend` 并核对源码包来自权威前端；
3. `npm run package:card`，验证最新前端与卡 workspace 共同进入整卡；
4. 解析修改后的 Skill `tsian-actions` JSON，并编译其 scripts；使用一次性 harness 覆盖无物品基线、正常 container/item/equipment 闭包、缺失 ref、容器循环/共享、不可达或槽位不匹配装备、整数溢出和失败零写入；
5. `git diff --check` 与 Trellis task validate。

手工验收使用新存档覆盖：`canon` / `original` 的首问与请求 injection；无物品开局不产生冗余实体；有普通持有物/装备的开局能被角色页和物品栏读取；以及流式等待/delta/完成连续性、刷新恢复、reduced-motion 和窄屏表现。

## 7. 回滚

- UI 回滚：恢复 `PlaySetupDialog.vue` 与 `NarrativeMessage.vue` 的 quiet 变体；StoryView 默认行为未改。
- branch 契约回滚：恢复 `opening-interview.ts` injection 文案和 Skill 入口映射；control/context/schema 无迁移。
- entity 闭包回滚：恢复 `commit_opening` 的 entity/action schema 与 Skill 普通建模说明；已通过新 action 创建的测试存档不做降级迁移，使用新存档复测。
- 重新运行 frontend/whole-card 打包即可交付回滚版本，无用户数据迁移。
