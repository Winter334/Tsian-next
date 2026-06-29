# 小说 AIRP 维护/检索 skill 优化

Parent: `06-27-default-card-novel-reader-airp`
关联兄弟任务：`06-29-novel-airp-schema-consolidation`（定义 scene/relationship 聚合层契约，本任务依赖）

## Goal

优化推进期使用的维护/检索 skill：让结构化写入支持按文件实际状态自适应 replace/edit、收敛 skill 边界（自由文本退出 skill 校验改用平台 write/edit、只保留有 schema 结构约束的写入校验）、新增 `resolve_entities` 批量读取 skill（按 ref 批量取详情 + 容器嵌套 depth 控制，省多轮往返与 token）。

## Background

本轮 schema 收口讨论中发现的维护/检索 skill 三项优化点，源自 `06-29-novel-airp-schema-consolidation` 的设计推演，但因主要服务于推进期游玩（retrieval 批量读、post 维护写）而非开局可用性，拆为本独立子任务。

确认事实：
- `apply-world-state-plan`/`apply-maintenance-plan` 脚本硬拒非 replace mode（`apps/platform-web/src/storage/workspace-templates.ts:140、316`），是过紧约束；平台 `workspace.edit` 已支持乐观锁局部编辑。
- save/ 路径回合内走 transaction.write，平台 `workspace.write`/`edit` 与 skill browser_script 都能写，无架构边界差异。
- 嵌套结构（容器套容器）若靠平台 read 逐层取，retrieval 多轮往返吃上下文 + token；skill 在 Worker 里批量按 ref 取 + depth 展开可一次返回。
- `06-29-novel-airp-schema-consolidation` 定义了 `save/scenes/<id>.json` + `save/relationships/<scope>.json` + `runtime.json` activeSceneIds 指针聚合层契约，`resolve_entities` 读取该层。

## Requirements

- `R1` mode 自适应：`apply-world-state-plan`/`apply-maintenance-plan` 写入脚本放开 edit mode，按"旧内容长度 + 本次改动占比"客观阈值自适应 replace/edit（默认如：旧内容 > 2000 字符 且改动 < 30% 用 edit，否则 replace），调用方可显式传 mode 覆盖。不按文件类型预设。
- `R2` skill 边界收敛：自由文本（brief.md、notes.md、timeline.md 等无 schema 结构约束的写入）退出 skill 校验写入，改由 agent 直接用平台 `workspace.write`/`edit`；skill 只保留有 schema 结构约束的写入（entity/scene/relationship/runtime 等结构化写入）的校验。更新对应 SKILL.md 的 allowed targets 与说明。
- `R3` `resolve_entities` 批量读取 skill：新增 skill（browser_script），输入 `{ refs: [...], depth?: number, withRelations?: boolean, withScene?: boolean }`，批量 read 对应 entity 文件，按 depth 展开容器/嵌套 ref（默认 1 层），可选从 `relationships/<scope>` 取关系边、可选取所在 active 场景。一次工具调用返回，省多轮往返。不递归遍历、深度由调用方控制、循环引用靠 visited 集合防护。
- `R4` retrieval 工作流约定写进 retrieval AGENT.md 或 skill 文档：找（语义搜索定位）用平台 `workspace.search`；单文件直读用平台 `workspace.read`；批量取 + 嵌套展开用 `resolve_entities`。
- `R5` 实现遵循 `06-29-novel-airp-schema-consolidation` Phase 3.3 沉淀的 8 条 agent/skill 设计方法论（`.trellis/spec/guides/agent-skill-design-principles.md`），特别是"skill 封装看往返次数""写入策略按客观状态不按类型标签""频率×后果给能力"。

## Acceptance Criteria

- [ ] `apply-world-state-plan`/`apply-maintenance-plan` 支持 edit mode 且按客观阈值自适应 replace/edit（R1）。
- [ ] 自由文本写入不再强制走 skill 校验，SKILL.md allowed targets 与说明已更新（R2）。
- [ ] `resolve_entities` skill 实现，批量取 + depth 展开 + 可选关系/场景，一次返回（R3）；容器套容器场景验证通过。
- [ ] retrieval 工作流约定文档化（R4）。
- [ ] `npm run build:web` 通过。

## Out of Scope

- scene/relationship 聚合层契约定义（归 `06-29-novel-airp-schema-consolidation`）。
- post-processing 在游玩中维护 scene/relationship 的增量流程编排。
- 开局链路修复（归 `06-29-novel-airp-schema-consolidation`）。

## Notes

- 依赖关系：`resolve_entities`（R3）依赖 `06-29-novel-airp-schema-consolidation` 落地 scene/relationship 聚合层契约；R1/R2 独立可先行。
- 优先级 P3：推进期优化，不阻塞开局可用。
