# 时间线注入：让 storyteller 看见原著剧情节点

## Goal

让正文 Agent（storyteller）在每轮写作时能看到当前剧情坐标附近的 `frontier.timeline`，从已有 source 锚点获得原著剧情方向感。MVP 只做轻量上下文注入：解释 timeline 是 world-architect 从原著中抽出的剧情节点，并把相关节点展示给 storyteller。不要构建原著后台事件状态机。

## Background

### 现状（已确认）

storyteller 写正文时上下文里只有：
- AGENT.md / SOUL.md / creation-guide / output-format / prefill-accept（3 条 contextPaths，无一条指向 `save/`）
- 前端 `buildContextInjection` 注入的 runtime / scene / protagonist 三个 block
- 早期剧情摘要 summary + 最近 K=5 轮正文
- 自有工具 `read_entity` / `read_scene` / `read_relationships`（硬编码只读 `save/entities|scenes|relationships`，不读 `save/source/`）

storyteller 当前看不见：
- `save/playthrough/frontier.json` 的 `timeline`
- `runtime.plotOrder`
- `save/source/shards/*.md` 原著源文本

### 已确认事实

1. `frontier.timeline` 已经是 world-architect 从原著中抽出的剧情节点，不需要再做第二套剧情摘要。
2. source 锚点 schema 为 `{ kind, order, chapter, time, label }`，由 world-architect 写入；`label` 是一句话客观标签，`time` 是可估计的剧情时间字符串。
3. player 锚点 schema 为 `{ kind, order, turn, time, label, alignment, sourceRef }`，由 stage-manager 维护，用来记录玩家事件与原著轴的关系。
4. `runtime.plotOrder` 是玩家当前剧情进度坐标，前端已有基于它判断 frontier 推进的逻辑。
5. `worldTime` 是自由中文叙事时间字符串，不适合作为程序比较依据。
6. `frontier` 概念不进入平台 contracts，本任务只改开发前端源码。
7. 前端已有 `parseFrontier` 纯函数和 frontier 类型，可复用；`context-injection.ts` 是发送前注入 storyteller 运行时上下文的位置。

## Revised Decision

用户确认：**当前 timeline 足够；它本身就是抽出来的原著剧情节点，只需要说清楚，并让 storyteller 能看见它。**

因此本任务收敛为：
- 只注入现有 timeline；
- 不新增 `ifLineStatus`；
- 不让 stage-manager 维护 `pending/fired/superseded`；
- 不做“玩家不在场时原著事件默认发生”的存档事实机制；
- 不在 MVP 中加入原著源文本查询 Skill；
- researcher 移除不属于本任务。

## Requirements

### R1. storyteller 每轮看到原著剧情节点

- `buildContextInjection` 读取 `save/playthrough/frontier.json`。
- 解析成功时，向 storyteller 追加一个 `role: "user"`、`position: "before-input"` 的 injection block。
- block 与 runtime / scene / protagonist 一样是发送前派生上下文，不写回任何存档文件。
- 读取失败、文件不存在或解析失败时静默跳过 timeline block，不阻断发送。

### R2. timeline block 说明语义边界

block 必须告诉 storyteller：
- 这些 source 锚点是 world-architect 从原著中抽出的剧情节点；
- 它们用于提供原著方向感和剧情坐标，不是要求机械复刻原著；
- 玩家行动可以贴近、偏离、改写或暂时绕开原著节点；
- 不要把未发生的原著节点当作已经发生的事实写进正文。

### R3. timeline block 展示当前坐标

block 至少包含：
- 当前 `runtime.plotOrder`；
- 当前 `runtime.worldTime`；
- 当前坐标附近的 source 锚点列表，字段含 `order/chapter/time/label`；
- 窗口大小：当前 `plotOrder` 前 2 个 source 锚点 + 后 3 个 source 锚点；
- 若附近有 player 锚点，展示最近 3 个 player 锚点的 `turn/time/label/alignment/sourceRef`，帮助 storyteller 理解玩家 if 线与原著轴关系。

### R4. 使用现有发送前注入渠道

- timeline block 通过前端 `buildContextInjection` 生成，作为 `role: "user"`、`position: "before-input"` 的 `InjectionMessage` 注入给 storyteller。
- 该 block 是每次发送前从 `save/playthrough/frontier.json` + runtime 快照派生的临时上下文，不进入 AGENT.md / SOUL.md 常驻提示词，不写入 history，不新增工具调用门槛。
- 注入顺序建议放在 runtime/world block 之后、scene/protagonist block 之前；在最终消息序列中它位于玩家本轮输入之前，使玩家输入仍是当前回合最后的直接请求。
- block 用“数据说明/语义边界”口吻表达：source 锚点是原著剧情节点和方向感，不是已发生事实列表；避免把原著节点写成 system 级硬约束。

### R5. 不引入新持久化状态

- 不修改 source anchor schema。
- 不新增 `ifLineStatus` / `pending` / `fired` / `superseded`。
- 不新增结构化时间戳、tick、中文时间比较函数或后台事件状态机。
- 不修改 stage-manager 的维护逻辑。

### R6. 只改开发前端源码

本任务只修改开发前端源码：
- `apps/play-frontend-dev/src/lib/context-injection.ts`

不直接修改卡内已打包源码：
- `cards/沉浸阅读器.tsian-card/frontend/src/lib/context-injection.ts`

原因：后续通过开发前端打包上传替换现有卡，避免手工维护两份镜像源码。

## Acceptance Criteria

### AC1. 注入可见

- storyteller 发言前的注入消息中出现 timeline / 原著剧情节点 block。
- block 包含当前 `plotOrder`、`worldTime`、附近 source 锚点。
- block 明确说明 timeline 是“原著剧情节点 / 方向感”，不是“已发生事实列表”。

### AC2. 故障不阻断

- `frontier.json` 不存在、读取失败、JSON 解析失败或 timeline 无有效锚点时，发送仍继续。
- runtime / scene / protagonist 原有阻断语义不被改变。

### AC3. 无新状态机

- source anchor 仍保持 `{ kind, order, chapter, time, label }`。
- 没有新增 `ifLineStatus` 或背景事件维护写入。
- stage-manager 不需要新增每回合判定逻辑。

### AC4. storyteller 使用方式正确

- 在有原著节点时，storyteller 能把它作为剧情方向参考。
- storyteller 不会仅因看到未来 source 锚点就把它们写成已经发生的事实。

## Out of Scope

- 背景事件自动发生机制。
- `pending/fired/superseded` 事件状态。
- 原著源文本查询 Skill。
- researcher 移除。
- 结构化时间系统或 `worldTime` 比较函数。
- 修改平台 contracts。

## Resolved Decisions

- timeline block 窗口大小：当前 `plotOrder` 前 2 个 source 锚点 + 后 3 个 source 锚点；最近 3 个 player 锚点作为玩家分支参考。
