# Technical Design

## Boundary

本任务同步 AI-facing Schema/Agent 契约和正式卡文件清单，不增加新的平台执行能力。数据流为：

```text
默认 AIRP 文档 + save/schema/current.md
        ↓ 告知
Stage Manager（内部模板 / 正式卡实际 Skill）
        ↓ 维护 entity JSON
character.equipment + item.equipment + attributes/applied
        ↓ 只读消费
开发前端角色/物品舞台
```

开发前端已经是实际消费者，本任务不修改它。正式卡 packaged frontend 由后续导入更新。

## Equipment Contract

### Character projection

```ts
type CharacterEquipment = Record<string, {
  ref: string | null
  applied?: Record<string, number>
}>
```

- slot key 是自然语言动态名称，JSON key 顺序即维护/展示顺序。
- `ref: null` 是显式空槽。
- 非空 ref 必须指向 `type: "equipment"` 的 item，并可从角色 containers 递归到达。
- `applied` 是该槽当前已反映到 `attributes` 的整数差值快照；不是裸装属性。

### Item metadata

```ts
interface ItemEquipment {
  slot?: string
  mods?: Record<string, string>
  effects?: string[]
}
```

- `slot` 是建议槽位而非平台强制约束。
- `mods` 继续使用 Schema 定义的有限运算符字符串，由 Stage Manager 解释；平台无求值器。
- `effects` 只影响叙事判断，不自动改数值。

## Maintenance Semantics

Stage Manager 在已有实体上下文足以判断时执行一次完整角色装备维护：

1. 从当前 attributes 撤销所有旧 `applied`，得到本次维护基线。
2. 验证每个非空装备 ref 可从 containers 递归到达且 item 是 equipment。
3. 按 character.equipment key 顺序解释对应 item mods，逐槽记录实际整数差值。
4. 写回当前有效 attributes 和每槽 applied；不可达槽清空。
5. 任一表达式、属性引用或持有关系不明确时，不提交部分结果。

这是 Agent 工作约定，不宣称平台提供 deterministic evaluator 或事务。正式卡用 `json_edit` 将同一角色实体的相关字段一起更新；无法保证完整维护时保持旧值并在结果中说明，而不是猜测。

## Template Synchronization

- `docs/airp.ts` 是内置卡 guide/reference 来源。
- `files.ts` 中 `save/schema/current.md` 是新存档 living schema 种子，必须与文档一致。
- `files.ts` 中 `save/entities/README.md` 提供最小互相可达示例。
- `stage-manager.ts` 维护内部默认 Agent 行为。
- 正式卡 docs 是卡内对应文档；正式卡 AGENT/Skill 是实际运行提示词，按其 generic-edit 架构适配。
- `DEFAULT_WORKSPACE_VERSION` 不变，因为现有升级器不会覆盖已有 living schema，本任务不伪装成迁移。

## Render Error Contract

Schema guide/reference/current 均明确：

- `render` 缺省时可按现有默认规则处理。
- `render` 显式存在但不在已知 preset 中时，消费者记录警告并隐藏该字段。
- 不将未知值降级成 text。

该规则恢复既有 fail-loud 行为，避免 Schema 拼写错误被静默掩盖。

## Formal Stage Manager Adaptation

不复制内部模板，因为正式卡已经采用较新的维护架构：

- `read_maintenance_context` 聚合上下文；
- `json_edit` / `text_edit` 通用编辑；
- `commit_turn_recall` 单独提交 recall；
- 当前 scene 清理与维护域摘要。

装备被加入 entity 维护域：AGENT 建立常驻权威/边界，Skill 给出自包含流程和修改判据。正式卡继续用 generic tools，不恢复 update_entity。

## Manifest Regeneration

使用一次性受控脚本读取当前 `game-card.json`，只替换 `workspaceFiles`：

- 递归枚举 `cards/沉浸阅读器.tsian-card/workspace`；
- package path 为 `workspace/<relative-posix-path>`；
- 按 path 排序；
- size 读取文件系统字节数；
- mediaType 按现有扩展名约定推导；
- 写回前后深比较 manifest/frontendFiles/coverFiles/exportedAt/exporter。

这既修正文档 size，也吸收已完成的 generic edit 工具变更。不得调用 IndexedDB exporter 或 frontend packaging。

## Compatibility And Rollback

- 字段全部可选，旧存档/旧前端继续容错。
- 默认种子只影响新 Workspace；已有 living schema 不被覆盖。
- 文档/Agent 变更可按文件回滚，不涉及 DB 或 Bridge contract。
- manifest 变更只重建 workspace inventory；其他 package 区域保持字节级结构不变。
- 当前 dirty baseline 保存在 `.git/trellis-equipment-schema-baseline.*`，只用于本地对照，不提交。
