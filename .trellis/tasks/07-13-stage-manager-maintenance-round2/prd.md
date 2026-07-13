# PRD：stage-manager 维护优化第二轮

## 背景

第一轮优化（scene 自动清理 + frontier 去冗余）后，stage-manager 回合后维护从 8 轮降到 5 轮，浪费从 5 轮降到 2 轮。剩余 2 处浪费的根因：

1. **readEntityBrief 只返回 `{ref, name, brief}`**：run.js 已 `readJsonFile` 读完整 entity JSON，却丢弃 `status`/`goals`/`identity`/`traits`/`attributes`/`appearance`/`background` 等字段。stage-manager 是维护 Agent，需要完整 entity 状态判断"哪些字段要改、怎么改"。brief 不够用 → 模型回退 `workspace_read` 读全文（每回合 1-2 轮浪费）。读全文却丢弃是纯浪费——已读了，该返回。

2. **memory 文件路径未指明 + 注入内容未被授权为权威**：AGENT.md 说"按标签记忆格式追加"但没说到哪追加。recall/scene/npc_action 记录没有明确文件（seeds.md 只有伏笔）。模型读 `memory/README.md` 找线索——README 是空 meta 文档，白花一轮。seeds.md 已在 contextPaths 注入，但 AGENT.md 写"维护 `save/memory/seeds.md`"——"维护"动词暗示"去读写文件"，模型把注入内容当参考素材，回退去读"真正的文件"（与 frontier.json 同模式）。

## 需求

### 需求 1：readEntityBrief 改 readEntity，返回完整 entity

- `read_maintenance_context` 的 run.js 里 `readEntityBrief` 改为 `readEntity`，返回完整 entity JSON 对象（含所有字段：id/name/brief/gender/aliases/tags/identity/appearance/attributes/gauges/status/traits/goals/background/containers/portrait/extensions 等）。
- 解析失败/文件不存在时仍返回 fallback `{ref, name: ref}`（保持向后兼容，不破坏下游 `entities` 数组结构）。
- `entities` 数组每项从 `{ref, name, brief}` 变为 `{ref, ...完整 entity}` 或 fallback `{ref, name: ref}`。
- 不动 `activeScenes`/`relationships`/`runtime`/`timeline`/`turnBody`/`previousTurnBody` 等其他聚合字段。

### 需求 2：memory 文件路径明确 + records.md + 注入授权

- AGENT.md "记忆格式"段指明 recall/scene/npc_action 记录追加到 `save/memory/records.md`。
- 新增 `save/memory/records.md` 模板文件（header + 格式说明），stage-manager agent.json contextPaths 加入 records.md。
- AGENT.md "记忆格式"和"伏笔追踪"段措辞改为"基于上下文已注入的 records.md / seeds.md 内容追加/更新"，正面引导用注入内容，不加"不要 read"禁令（与 frontier.json 修法一致）。

## 约束

- readEntity 返回完整 entity 符合 AIRP 原则 9 的正确适用：原则 9 约束 schema 字段存不存在（没消费者的字段应从 schema 删），不约束聚合工具返回多少字段。聚合工具返回的字段只要有一个消费者做一次决策就够——stage-manager 对 entity 每个字段都可能在不同回合做不同的维护决策。
- memory 措辞修正遵循 AI-Facing Content Changes：正面引导用注入内容，不加反向禁令。
- records.md 是按自然单元分文件的合理产物（recall/scene/npc_action 是逐回合追加的长期记录，与伏笔 seeds 分开）。

## 验收标准

1. **readEntity 全文返回**：read_maintenance_context 返回的 `entities` 每项含完整 entity 字段（至少 status/goals/identity/traits，实践中是整个 entity JSON）。
2. **entity 不再读全文**：stage-manager 不再为"判断是否要改 entity"而 workspace_read entity 全文；基于聚合返回的完整 entity 直接判断 + workspace_edit/write。
3. **records.md 路径明确**：AGENT.md 指明 recall/scene/npc_action 追加到 `save/memory/records.md`。
4. **records.md 在 contextPaths**：stage-manager agent.json contextPaths 含 records.md。
5. **memory 不再读 README/seeds**：stage-manager 不再 workspace_read `memory/README.md` 或 `memory/seeds.md`（注入已是权威）。
6. **措辞零禁令**：AGENT.md 不含"不要 read records.md / seeds.md"之类禁令；措辞正面引导用注入内容。
7. **类型检查通过**：`pnpm tsc --noEmit` 或 `npm run build:web` 通过。
8. **轮次降低**：典型 stage-manager 回合后维护从 5 轮降到 2-3 轮。
