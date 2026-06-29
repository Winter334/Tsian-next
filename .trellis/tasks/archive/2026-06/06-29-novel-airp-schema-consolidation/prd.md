# 小说 AIRP schema 收口与开局链路修复

Parent: `06-27-default-card-novel-reader-airp`

## Goal

修复默认小说 AIRP 卡的开局抽取链路至"可用"，并系统性收口 schema 契约：补齐缺失的聚合/导航层、把开局成果接进游玩回路、把散落在 trellis 归档里的 schema 规范搬进运行时可读文档、同步仍描述废弃模型的项目方向文档。运行时执行层（browser_script / scope / transaction）经审计确认健康，不在本任务重构范围内。schema 设计本体（扁平存储）不重构，只新增聚合层 + 文档收口。

## Background

开局抽取（`06-28-novel-airp-initial-extraction-window` 交付的 inspect/read_slice/commit 脚本 + 前端向导）机制本身能跑通，但实测产出"几乎不可用"。根因不在运行时代码，而在知识层/契约层：

1. **opening-initialization Skill 形同虚设**：`OPENING_INITIALIZATION_SKILL_MD`（`apps/platform-web/src/storage/workspace-templates.ts:353-403`）仅约 50 行，只说"调 inspect→read→commit"，无抽取步骤、实体类型/粒度、brief 段落结构、spoiler-safe 边界、window.chapters 组装方式、重试策略。world-architect 拿到后只能自由发挥，产出质量随机。前端 `buildOpeningInitializationPrompt`（`apps/play-frontend-dev/src/source-import.ts:669-686`）也只是复读这 5 条要求，未补强。

2. **开局 brief 没接进 director 链路（深层断裂）**：master 的 contextPaths 是 `save/director/current-brief.md`（`workspace-templates.ts:683`），但 commit 脚本不写 director，只写 `save/understanding/initial-brief.md`（`workspace-templates.ts:560-562`）。开局后 master 看到的仍是默认"No director brief has been prepared yet"（`workspace-templates.ts:877`）。开局整理的成果进不了游玩回路。

3. **`save/understanding/` 是孤儿目录**：schema 契约（`docs/active/novel-airp-workspace-schema-direction.md:23-54`）只列 source/schema/entities/playthrough/director，无 understanding/。除前端硬编码读一次 `initial-summary.json`（`source-import.ts:6`），无 agent 的 contextPaths 指向它。

4. **schema 规范散落，详尽内容只活在 trellis 归档**：`06-27` design（560 行）含 lifecycle/origin 受控词、status 协议、容器模型、evidence、schema patch 模板、runtime.json 完整示例，但运行时可读的 `docs/novel-airp-schema-guide.md`（约 60 行）/`save/schema/README.md`/`current.md` 都没搬这些。agent 写数据文件时看不到完整规范。

5. **项目方向文档描述废弃模型**：`docs/active/agent-framework-runtime-workspace-direction.md` §9（行 213-318）+ §14（行 388）仍写 `save/world/` 一实体一目录 + `index.json` + `_ref`/`_dir` + `frontend/view-state.json` + workspaceVersion 7 + narrative agent，全是 06-24 已废弃、被 06-27 推翻的模型。实际模板已是 06-27 契约（扁平 entities、五分区、workspaceVersion 10）。开发者照方向文档会被带偏。

6. **06-28 design 与 06-27 契约冲突未纠正**：`06-28` design.md:128-146 的实体示例用斜杠 id `character/example` + 对象 sourceRefs + per-file type/version，与 06-27 定的 `<type>:<localId>` 冒号 + 字符串 sourceRefs + 不需要 type/version 直接冲突。实现代码跟了 06-27（正确），但文档从没对齐。

7. **扁平存储缺聚合/导航层**：06-27 推翻 06-24 的"一实体一目录 + index.json + _ref/_dir"时，把引用/聚合层一起扔了。retrieval 要"当前场景有谁""萧玄的全部关系"只能遍历实体目录或全量语义搜索。且 06-27 砍掉 06-24 的 `relationships.json` 后关系无处落脚。长篇小说人物爆炸、原创角色双线天然多场景，单文件/单场景模型从开局就不成立。

## Confirmed Facts

- 运行时执行链路健康：browser_script（Worker + AsyncFunction 注入 input/tsian/signal）、scope 解析（effective=card+save 联合视图，save-runtime→save/）、staged transaction（成功原子提交/失败丢弃）、skill 按需加载（use_skill 注入 SKILL.md 正文）。审计无 TODO/FIXME/断链。
- 导入与开局脚本咬合：import 写 `save/source/chapters.index.json`（`source-import.ts:604`）+ manifest status='ready'（`source-import.ts:374`），脚本 `loadSource`（`workspace-templates.ts:417-427`）正好读这两个并校验 status，路径/格式对齐。
- 三个开局脚本（inspect/read_slice/commit）校验/写入逻辑完备，能跑通；问题在 Skill 文档指导和产物落点，不在脚本执行。
- `tsian.workspace.read` 缺文件抛错不返回空（`workspace-operations.ts:594`）；`readText` 容错判断（`workspace-templates.ts:413`）对此无效，chapter 缺失会整脚本 reject（低风险但脆弱）。
- `workspace.write` 不读 `mediaType` 字段，按扩展名推断；脚本显式传 mediaType 无效（不影响功能）。
- `apply-world-state-plan`/`apply-maintenance-plan` 脚本硬拒非 replace mode（`workspace-templates.ts:140、316`），是过紧约束；平台 `workspace.edit` 已支持乐观锁局部编辑。
- save/ 路径在回合内走 transaction.write，平台 `workspace.write` 与 skill browser_script 都能写，无架构边界差异（修正早期误判）。

## Requirements

### 开局链路修复

- `R1` opening-initialization Skill 重写为真正的流程指导：抽取步骤、实体类型清单与粒度（character/location/faction/setting/item/container）、brief 段落结构（开局氛围/可用素材/第一幕场景/spoiler 边界）、candidateCharacters 选取标准、frontier.notes 写法、window.chapters 从 read 结果组装方式、重试策略。规范主体写进 SKILL.md 正文（按需加载时注入）；超长范例才拆 skill 目录下 reference 文件。
- `R2` 开局 brief 并入 director：`commit_opening_understanding` 不再写 `save/understanding/initial-brief.md`，改写 `save/director/current-brief.md` + `save/director/current-brief.meta.json`。删除 `save/understanding/` 概念，开局产物全部落正式契约路径。
- `R3` 开局 commit 一并写聚合层第一版（见 R6-R8），使开局成果直接成为 master/retrieval 推进期可读的导航层，开局链路与游玩回路从此处接通。
- `R4` 实体类型用词约定：脚本默认从 `character:` 前缀推候选（`workspace-templates.ts:551`），需在 Skill 文档明确约定使用 `character:`/`location:`/`faction:`/`setting:` 等前缀，避免 agent 自创不一致的类型名。
- `R5` 前端 `buildOpeningInitializationPrompt` 可补强以呼应重写后的 Skill 关键判断点（可选，若 Skill 自身已足够则不动）。

### schema 聚合/导航层（新增契约，开局即产出）

- `R6` 引入场景分片 `save/scenes/<sceneId>.json`（一场景一文件）：含 id/name/location/present(ref+name+brief+关键状态摘要)/status(active|background|resolved)/updatedTurn。天然支持多场景（原创角色双线、原著多线）。resolved 不删（剧情可回溯）。
- `R7` 引入关系分片 `save/relationships/<scope>.json`（一 subject 一文件）：subject 为某实体 id，edges 为它对所有其它实体（人/势力/地点）的关系条目（to/type/since/until/note）。补 06-27 砍掉 relationships.json 留下的缺口，吸收长篇关系爆炸。双向关系两边都写一条（post 维护规范明确）；单向关系（如隶属）只写从属方。
- `R8` `save/playthrough/runtime.json` 增加 `activeSceneIds: [...]` 指针数组，作为"当前活跃场景"导航入口（非场景内容权威）。runtime.json 同时保留高层运行时（player/inventory/turn）。
- `R9` 权威归属明确：entity 文件是实体权威；scene/relationship 文件是派生快照（丢了可重建）；runtime.activeSceneIds 是指针非内容。写进规范，避免双 authority。

### schema 文档化（分层按读取频率）

- `R10` 精简速查：扩充工作区内嵌 `docs/novel-airp-schema-guide.md` 到约 150-200 行，覆盖两种场景（维护 schema / 维护 schema 下数据文件）都要用的核心约定：目录契约（含 scenes/relationships/understanding-summary）、entity 最小/推荐字段、visibility、sourceRefs、structured refs、fields vs sections 职责、schema 演进 additive/patch 边界。进相关 agent 的 contextPaths。
- `R11` 详尽参考：把 06-27 design 遗漏的细节（lifecycle/origin 受控词、status 协议、容器/库存模型、evidence、schema patch Markdown 模板、runtime.json 完整示例、聚合层 scene/relationship 格式）整合成 `docs/novel-airp-schema-reference.md`。不进任何 contextPaths，agent 维护 schema 或写复杂数据时 workspace.read 按需查。
- `R12` `fields` vs `sections` 职责约定写进规范：fields=稳定 label/value 键值对（前端状态栏行式渲染）；sections=title/body 段落块（详情面板/Agent 上下文）。判据：是否需要前端按固定行结构渲染。
- `R13` 项目方向文档同步：`docs/active/agent-framework-runtime-workspace-direction.md` §9（行 213-318）+ §14（行 388）从废弃 06-24 模型更新为 06-27 现行契约 + 本任务新增的 scenes/relationships 聚合层 + workspaceVersion 11。移除 narrative agent、`save/world/` 一实体一目录、`_ref`/`_dir`、`frontend/view-state.json` 描述。
- `R14` `docs/active/novel-airp-workspace-schema-direction.md` 的 Workspace Contract 补 `save/scenes/` + `save/relationships/`，移除/不再提及 `save/understanding/`。

### 脚本细节修正

- `R15` `readText` 容错修正：使 chapter 文件缺失时不整脚本 reject（inspect/read_slice 容错降级），或明确缺文件属于 import 未完成的可操作错误。

### 方法论沉淀（Phase 3.3 spec 更新）

- `R16` 把本轮讨论提炼的 8 条 agent/skill 设计方法论写成平台通用 spec guide `.trellis/spec/guides/agent-skill-design-principles.md`，并在 guides/index.md 登记表加一行。原则刻意保持泛用，不绑 novel AIRP 场景：①频率×后果给能力、②能力归属由"会不会变"决定、③skill 封装看往返次数、④两份相同数据必写权威与派生、⑤无界增长量一开始就分片、⑥一次性产物必落到后续能读到路径、⑦写入策略按客观状态不按类型标签、⑧文档分层按读取频率。

## Acceptance Criteria

- [ ] opening-initialization SKILL.md 重写后包含完整流程指导（R1 各子项），world-architect 据此能稳定产出可用开局资料，不再纯靠自由发挥。
- [ ] `commit_opening_understanding` 写入 `save/director/current-brief.md` + meta，不再写 `save/understanding/`（R2）；workspace 中无 `save/understanding/` 残留路径引用。
- [ ] 开局 commit 写入至少一个 `save/scenes/<id>.json` + 涉及人物的 `save/relationships/<scope>.json` + 更新 `runtime.json` 的 activeSceneIds（R3、R6-R8）。
- [ ] master 的 contextPaths 能读到开局 brief（director）+ active 场景；开局成果进入游玩回路（R2、R3 验证：开局后 master AGENT.md/SOUL.md 无需改即能看到 director brief）。
- [ ] 实体类型用词约定（R4）写进 Skill 文档且脚本候选推断与之一致。
- [ ] `docs/novel-airp-schema-guide.md` 扩充为速查层，含 scenes/relationships/runtime 指针契约 + fields/sections 约定（R10、R12），并进相关 agent contextPaths。
- [ ] 详尽参考文档（R11）存在且覆盖 06-27 design 遗漏的全部细节；不进 contextPaths。
- [ ] `docs/active/agent-framework-runtime-workspace-direction.md` §9/§14 不再出现 save/world、index.json、_ref/_dir、frontend/view-state.json、narrative、workspaceVersion 7（R13）。
- [ ] `docs/active/novel-airp-workspace-schema-direction.md` Workspace Contract 含 scenes/relationships，无 understanding/（R14）。
- [ ] `readText` 容错修正后 chapter 缺失不致整脚本 reject（R15）。
- [ ] `.trellis/spec/guides/agent-skill-design-principles.md` 存在，8 条原则齐全且泛用，guides/index.md 已登记（R16）。
- [ ] `npm run build:web` 通过（任何 platform-web 模板字符串改动后）。
- [ ] `npm run build --workspace play-frontend-dev` 通过（若动了 source-import.ts）。

## Out of Scope

- 运行时执行层重构（browser_script/scope/transaction/registry）——经审计健康。
- schema 设计本体重构——扁平存储保持不变，本任务只新增聚合层 + 文档收口。
- 维护/检索 skill 三项推进期优化（`resolve_entities` 批量读取 skill、apply-world-state-plan/maintenance 的 mode 自适应、skill 边界收敛）——拆为同级子任务 `06-29-novel-airp-maintenance-skill-refinement`，其 PRD 已承接，不丢失。
- post-processing 在游玩中维护 scene/relationship 的增量流程——推进期。
- 推进期才会暴露的关系图谱深度优化（反向关系对称性扫描退化、resolved 场景归档）——记录为未来关注点。
- 全书抽取、增量 frontier refresh、原创角色访谈、开局正文生成、玩家角色创建完整流程。
- 06-28 任务的状态处置（是否归档为"机制已交付"）——由用户单独决定。

## Notes

- 本任务与 `06-28-novel-airp-initial-extraction-window`（in_progress）的关系：06-28 交付了开局抽取机制（inspect/read_slice/commit 脚本 + 前端向导），本任务重写其 commit 脚本与 Skill 文档以修复"产出不可用"，并扩展 schema 契约。06-28 的归档时机由用户决定。
- **关联子任务**：`06-29-novel-airp-maintenance-skill-refinement`（同级，父 06-27）承接本任务 deferred 的三项推进期维护/检索 skill 优化。`resolve_entities` 依赖本任务定义的 scene/relationship 聚合层契约，其实现应在本任务落地契约之后。
- 编辑面高度集中：R1-R9、R15 主要改 `apps/platform-web/src/storage/workspace-templates.ts` 的字符串模板；R13 改 `docs/active/agent-framework-runtime-workspace-direction.md`；R14 改 `docs/active/novel-airp-workspace-schema-direction.md`；R16 改 `.trellis/spec/guides/`。不碰运行时代码逻辑，低风险。
