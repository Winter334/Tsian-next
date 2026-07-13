# PRD：stage-manager 回合后维护优化

## 背景

从一次 stage-manager 回合后维护的调用记录（8 轮工具往返）发现：理想路径只需 2 轮（read_maintenance_context → 一次批量 write），实际花了 8 轮，其中 5 轮是浪费。两个底层原因：

1. **scene 生命周期管理缺失**：离开 activeSceneRefs 的 scene 无自动清理，文件数随回合无界增长，既拖慢通用工具检索，又让模型每回合面对清理候选产生不必要决策。

2. **frontier.json 三重注入**：同一数据在 contextPaths 注入、read_maintenance_context.timeline 字段、模型主动 workspace_read 三处出现，无主从关系声明。AGENT.md/SKILL 措辞"读 save/playthrough/frontier.json 的 timeline"是诱导指令，模型按字面执行回退到 workspace_read，没意识到注入/aggregate 已是权威来源。

## 需求

### 需求 1：scene 自动清理（平台 hook）

- 离开 `runtime.activeSceneRefs` 的 scene 由平台自动清理（删除 scene 文件），不需要模型逐个判断。
- 自动清理在 stage-manager turn 收尾、runtime 写入完成后由平台 hook 执行，基于**新 runtime.activeSceneRefs**（模型刚写完的当前状态）判定，不依赖正文文本解析。
- 模型想保留某 scene 作为长期据点导航时，显式将其 `status` 写为 `"background"`；自动清理跳过 background scene。
- 自动清理结果对模型可见（trace 或返回信息），但模型不参与执行决策。

### 需求 2：scene 延迟创建（连续两回合才建）

- scene 创建延迟一回合：连续两回合在同一地点/同一在场组合才建 scene，短暂出现（只在一回合正文里出现、后续无跟进）不建。
- `read_maintenance_context` 返回 `previousTurnBody`（上一回合正文），供模型判断"驻留 vs 路过"，避免单回合无法区分。
- scene 仍是模型 workspace_write 创建，平台不自动建 scene；延迟创建通过 SKILL 措辞约束模型行为。

### 需求 3：frontier.json 去冗余注入

- 删除 stage-manager agent.json contextPaths 里的 `save/playthrough/frontier.json`。
- `read_maintenance_context` 返回的 `timeline` 字段（`sourceAnchors`/`playerAnchors`/`sourceWindow`）作为 stage-manager 访问 frontier 数据的单一权威入口。

### 需求 4：指令措辞修正（删诱导指令）

- AGENT.md / SKILL 里所有"读 `save/playthrough/frontier.json` 的 timeline"措辞改为"用 `read_maintenance_context` 返回的 `timeline` 字段"。
- 不提文件路径、不描述"从 frontier.json 聚合"等内部机制。
- 不加"不要重复 read frontier.json"之类的禁令——按 AI-Facing Content Changes 规范，删掉诱导指令即可，模型自然无动机去 read。

## 约束

- 自动清理逻辑是稳定规则（离开即过期），归平台代码；background 标记是易变决策（哪些 scene 算据点因卡而异），归模型显式写入。遵循 AIRP 原则 2（能力归属由"会不会变"决定）。
- frontier 去冗余遵循 AIRP 原则 4（两份相同数据必写权威与派生）：aggregate.timeline 为权威，contextPaths 注入删除，不留"兜底"降级保留。
- 措辞修正遵循 AI-Facing Content Changes：删诱导指令，零 surface trace of "读 frontier.json"，不加反向禁令。
- scene 是派生导航视图（entity 是权威），删除 scene 不影响 entity/relationship 权威数据。
- 向后兼容：已有存档的 scene 文件在首次触发自动清理时按新规则处理（离开的清，background 的留）。

## 验收标准

1. **轮次降低**：典型 stage-manager 回合后维护调用从 8 轮降到 2-3 轮（read_maintenance_context + 批量 write）。
2. **scene 不累积**：玩家离开的 scene 在该回合维护后被自动删除；scene 目录只保留 active + background scene，不随回合无界增长。
3. **background 保留**：模型显式标记 `status: "background"` 的 scene 不被自动清理。
4. **frontier 不重复读**：stage-manager 不再 workspace_read `save/playthrough/frontier.json`；plotOrder 映射、player 锚点追加仍正确工作。
5. **措辞零 trace**：grep stage-manager 的 AGENT.md / SKILL，"读.*frontier.json"零命中；措辞只引用 `read_maintenance_context` 返回字段。
6. **previousTurnBody 可用**：read_maintenance_context 返回包含上一回合正文，模型可据此判断是否驻留。
7. **类型检查通过**：`pnpm tsc --noEmit` 或等价命令通过。
