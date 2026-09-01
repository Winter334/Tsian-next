# 正文 Agent 原作文风学习：技术设计

## Overview

实现由一个自替换的 Markdown 文风模块和现有工作区原语组成：

1. 新增 `agents/storyteller/modules/文风/原作文风.md`，默认不启用。
2. 文件初始内容是面向 Storyteller 的一次性学习指令。
3. 模块启用时，现有 `modules/文风/*.md?enabled` 宏把该指令注入 Storyteller。
4. Storyteller 读取已读范围内的实际源正文，形成文风规则。
5. Storyteller 使用 `workspace_write` 把规则整体写回同一路径，并继续当前正文。
6. 后续注入的是普通文风规则，因此不再触发学习。

不新增 Skill、状态文件、触发器或模块管理逻辑。

## Component Boundaries

### Storyteller Module

权威文件：

`cards/沉浸阅读器.tsian-card/workspace/agents/storyteller/modules/文风/原作文风.md`

初始提示只包含 Storyteller 执行所需的信息：

- 从 `save/playthrough/frontier.json` 确认当前已读章节范围。
- 使用当前可用的源文本读取能力获取对应章节正文；不把底层分片路径、字符偏移或固定目录布局当作 Agent 契约。
- 在已读范围内选取有代表性的正文片段，分析稳定表达规律。
- 将结果整体写入 `agents/storyteller/modules/文风/原作文风.md`，写入 scope 为 `card-content`。
- 写入后使用所得规则继续当前正文。

提示词不解释开发侧架构，也不引用未在文件中建立含义的流程术语。

### Storyteller Capability

修改 `agents/storyteller/agent.json`：

- 在 `platformTools.enabled` 中加入 `workspace_write`。
- 将 `workspaceAccess.level` 从 `1` 调整为 `2`。

现有权限模型中 `card-content` 的 `editLevel` 已是 `2`，无需修改全局权限表。Storyteller 因此也能写入 level 1 的 `save-runtime`，这是现有分级模型的自然结果；本任务不增加路径白名单或 Storyteller 专用权限类型。

### Platform Host Persistence

工作区权限检查会允许 level 2 Agent 发起 `card-content` 写入，但游戏 Agent 的两个宿主适配器当前只接受暂存到存档事务的 `save-runtime` 写入，因此需要补齐持久化路由：

- `apps/platform-web/src/platform-host/runtime-turn.ts`：玩家正式回合。
- `apps/platform-web/src/platform-host/ai-invocation.ts`：旁路或委托调用。

两处在收到 `scope === "card-content"` 时：

1. 调用现有 `writeCardContentFileForActiveCard`，直接写入当前卡的逐文件内容表。
2. 将返回的 `WorkspaceFile` upsert 到当前 `workspaceTransaction.workspaceFiles`，保证同一调用后续的 read/list/glob 能看到新内容。
3. 返回写入结果给 workspace tool。

其他 scope 的行为保持不变。`delete`、`edit`、`move` 等能力不为本功能额外扩展；初始提示明确使用整文件 `write` 覆盖固定文件。

卡内容写入不属于 save-runtime 事务和 checkpoint。若同一 Agent 回合随后失败，已完成的卡内容直写不会随存档事务回滚；这符合本任务对低风险语义文本的容错取向，不增加事务补偿。

## Source Sampling

文风学习的材料边界是 `frontier.json` 已记录的 `sourceWindow`，以避免读取未到达的原著剧情。Storyteller 通过当前可用的源文本读取能力获取该范围内分布于不同位置、具备连续上下文的实际正文片段，而不是只看章节首段或摘要。底层 source shard 的路径、偏移和目录布局由读取器负责，不写入 Agent-facing 提示。

采样不设平台硬阈值，也不新增脚本。提示词要求 Storyteller 进行语义判断：材料能支持稳定归纳时才写入；材料明显过短、只有梗概或无法读取实际正文时，保留初始文件并继续当前正文请求。

## Output Contract

学习产物是普通 Markdown 文本，建议按以下方面组织，但不要求机器校验固定标题：

- 叙述视角与距离
- 句式、段落和节奏
- 信息揭示与场景推进
- 对白组织
- 动作、环境与感官描写
- 修辞、用词和情绪表达
- 应避免的偏离

每条规则必须是可执行指令。产物不得复制原文，不得携带角色名、剧情事件、专有名词或后续情节。

## Compatibility And Packaging

- `creation-guide.md` 已通过通配宏注入所有已启用文风模块，无需修改。
- 卡打包脚本扫描完整权威 workspace 树，新文件无需加入手工 manifest。
- 不同步旧的 `apps/platform-web/src/storage/workspace-templates/agents/storyteller.ts`；当前卡目录是本功能的权威 Storyteller 定义，旧模板描述的是已退役设计。
- 学习结果存放在卡内容层，因此对该卡的所有存档可见。切换小说或需要重学时由用户恢复初始文件或手动改写。

## Non-Goals

- 不创建文风学习 Skill。
- 不新增学习状态、版本号、来源标记或更新时间字段。
- 不自动检测“初始提示”以外的状态；文件内容本身决定当前行为。
- 不校验学习结果格式或质量。
- 不提供写入恢复、备份或原始模板保护。
- 不组合、排序、阻止或自动切换文风模块。

## Risks And Accepted Trade-offs

- 用户同时启用多个文风模块时可能产生冲突；由用户自行管理。
- 源文本不足时，初始学习提示会在下次启用回合再次出现；用户可切换预设文风或稍后重试。
- 直写卡内容不跟随存档事务回滚；文风文件可直接查看和修复，接受该风险。
- 文风提取质量取决于模型对样本的归纳；不为纯语义结果建立形式化校验。
