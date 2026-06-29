# 小说 AIRP schema 收口与开局链路修复 — Implement

> 实施顺序按"契约先行 → 脚本/Skill → 文档同步 → 方法论沉淀"组织，每阶段可独立验证。所有改动集中在字符串模板 + 文档，无运行时代码逻辑改动。

## 实施前检查

- [ ] 确认 `06-29-novel-airp-schema-consolidation` 为当前 active task（`task.py current`）
- [ ] 工作区干净或只有预期改动

## Phase A：聚合层契约模板（workspace-templates.ts）

新增卡内容/save runtime 模板字符串，确立 scene/relationship 契约位（先建位，开局脚本再写入）。

- [ ] A1 定义 `SCENES_README_MD` 文本：`save/scenes/README.md` 内容（一场景一文件、字段说明、status active/background/resolved、present 是派生摘要非实体副本、权威归属）。
- [ ] A2 定义 `RELATIONSHIPS_README_MD` 文本：`save/relationships/README.md` 内容（一 subject 一文件、scope 命名、edges 字段、双向两边写/单向只写从属方、since/until 演化）。
- [ ] A3 在 `DEFAULT_WORKSPACE_FILES` 加入 `save/scenes/README.md`、`save/relationships/README.md`（卡内容，含在新建卡）。
- [ ] A4 在 `DEFAULT_SAVE_RUNTIME_FILES` 加入 `save/scenes/README.md`、`save/relationships/README.md`（save runtime，含在升级集）。
- [ ] A5 `DEFAULT_SAVE_RUNTIME_UPGRADE_FILE_PATHS`（`workspace-templates.ts:6-33`）补 `save/scenes/README.md`、`save/relationships/README.md`、`save/playthrough/understanding-summary.json`。
- [ ] A6 `DEFAULT_WORKSPACE_VERSION` 10 → 11。
- [ ] A7 更新 `save/playthrough/runtime.json` 默认值模板（`workspace-templates.ts:868`）：加 `activeSceneIds: []`、`activeScene: null`。
- [ ] A8 更新 `save/playthrough/README.md` 模板（`workspace-templates.ts:865`）：补 understanding-summary.json + activeSceneIds 说明。
- **验证**：`npm run build:web` 通过；新卡/升级集含新文件。

## Phase B：开局 commit 脚本重写（workspace-templates.ts）

改 `OPENING_COMMIT_UNDERSTANDING_SCRIPT_JS`（`workspace-templates.ts:489-580`）的写入逻辑。

- [ ] B1 扩 inputSchema（`OPENING_INITIALIZATION_SKILL_MD` 的 commit action 声明，`workspace-templates.ts:395-400`）：加 `scene`、`relationships`、`activeSceneId`。
- [ ] B2 新增 `normalizeScene(input.scene, knownEntities)` 校验：id 格式、name、location.ref 合法、present[].ref 合法且在本次 entities 或已知、present[].status 可选字符串。
- [ ] B3 新增 `normalizeRelationships(input.relationships)` 校验：按 subject 分组，subject/to 合法 `<type>:<localId>`，edges[].type/since/note。
- [ ] B4 改写入数组：移除 `save/understanding/initial-window.json`、`save/understanding/initial-brief.md`；改写 `save/director/current-brief.md`（brief 内容）+ `save/director/current-brief.meta.json`（basedOn/scene/sourceWindow/updatedAtTurn）；新增 `save/scenes/<开局 scene localId>.json`、`save/relationships/<scope>.json`（按 subject 分文件）；更新 `save/playthrough/runtime.json`（activeSceneIds/activeScene/updatedAtTurn/updatedBy）；`save/playthrough/understanding-summary.json`（替代 initial-summary.json）；保留 `save/playthrough/frontier.json`、`save/entities/*.json`。
- [ ] B5 返回值 summaryPath 改 `save/playthrough/understanding-summary.json`；trace 事件补 scene/relationship 写入。
- [ ] B6 `OPENING_SCRIPT_COMMON` 的 `readText`（`workspace-templates.ts:413`）加 try/catch 容错（R15），缺文件返回 ''。
- **验证**：`npm run build:web`；逻辑复核 commit 写入路径无 `save/understanding/`。

## Phase C：opening-initialization Skill 重写（workspace-templates.ts）

重写 `OPENING_INITIALIZATION_SKILL_MD`（`workspace-templates.ts:353-403`）。

- [ ] C1 按 design §4.2 大纲写完整流程指导主体（抽取步骤、实体类型清单与粒度、brief 段落结构、candidateCharacters 选取、scene 组装、relationships 组装、frontier.notes、window.chapters 组装、重试策略、spoiler-safe 边界）。
- [ ] C2 实体类型用词约定（character/location/faction/setting/item/container 前缀）写进文档。
- [ ] C3 commit inputSchema 描述同步 Phase B1 扩展。
- [ ] C4 若 brief 段落范例超长，拆 `skills/opening-initialization/opening-brief-example.md`，SKILL.md 引用"更多范例见该文件，需要时 read"；否则内联。
- **验证**：`npm run build:web`；SKILL.md 自读确认流程指导完整、非空壳。

## Phase D：schema 速查 guide 扩充（workspace-templates.ts）

扩充 `NOVEL_AIRP_SCHEMA_GUIDE_MD`（`workspace-templates.ts:592-651`）。

- [ ] D1 扩到 ~150-200 行。
- [ ] D2 补目录契约含 `save/scenes/`、`save/relationships/`、`save/playthrough/understanding-summary.json`、`runtime.json` activeSceneIds。
- [ ] D3 补 fields vs sections 职责约定（design §5/§R12）。
- [ ] D4 补权威归属一句话（entity 权威、scene/relationship 派生、runtime 指针）。
- [ ] D5 保留现有 entity 最小/推荐字段、visibility、sourceRefs、structured refs、schema 演进 additive/patch 边界。
- **验证**：`npm run build:web`。

## Phase E：详尽 reference 文档（workspace-templates.ts，新文件）

新增 `NOVEL_AIRP_SCHEMA_REFERENCE_MD` 文本，加入 `DEFAULT_WORKSPACE_FILES`（卡内容）+ 升级集。

- [ ] E1 从 06-27 design 搬入遗漏细节：lifecycle/origin 受控词枚举、status 协议（prefix/suffix、level/until/source、numeric 谨慎）、容器/库存模型（contents/capacityNote/strict opt-in）、evidence 数组、schema patch Markdown 模板、runtime.json 完整示例。
- [ ] E2 补 scene/relationship 完整格式与示例（design §2.2、§2.3）。
- [ ] E3 顶部注明"按需查阅，不常驻；速查见 docs/novel-airp-schema-guide.md"。
- [ ] E4 加入 `DEFAULT_WORKSPACE_FILES`（`docs/novel-airp-schema-reference.md`）+ `DEFAULT_SAVE_RUNTIME_UPGRADE_FILE_PATHS`（不进 save runtime，仅卡内容）。
- **验证**：`npm run build:web`。

## Phase F：agent contextPaths 调整（workspace-templates.ts）

按 design §6 表调整四个 agent 的 contextPaths（`workspace-templates.ts:678-790`）。

- [ ] F1 retrieval：加 `save/scenes/README.md`、`save/relationships/README.md`。
- [ ] F2 post-processing：加 `save/scenes/README.md`、`save/relationships/README.md`。
- [ ] F3 world-architect：加 `save/scenes/README.md`、`save/relationships/README.md`。
- [ ] F4 master：不加（master 不直接维护聚合层，通过 director brief + runtime 指针消费）。
- **验证**：`npm run build:web`。

## Phase G：前端路径常量同步（source-import.ts）

- [ ] G1 `INITIAL_SUMMARY_PATH`（`source-import.ts:6`）从 `save/understanding/initial-summary.json` 改 `save/playthrough/understanding-summary.json`。
- [ ] G2 确认 `loadOpeningUnderstandingSummary` 读取逻辑无需其它改（只路径变）。
- [ ] G3 （可选 R5）若重写后 Skill 已足够，`buildOpeningInitializationPrompt` 不动；否则补强呼应关键判断点。
- **验证**：`npm run build --workspace play-frontend-dev`。

## Phase H：项目方向文档同步（docs/active/）

- [ ] H1 `docs/active/agent-framework-runtime-workspace-direction.md` §9（行 213-318）：移除 `save/world/` 一实体一目录、`index.json`、`_ref`/`_dir`、`frontend/view-state.json`、`narrative` agent；更新为 06-27 现行契约（`save/entities/<type>/<localId>.json` 扁平 + 五分区 + scenes/relationships 聚合层 + runtime activeSceneIds）。
- [ ] H2 同文件 §14（行 388）：workspaceVersion 7 → 11；移除 narrative/memory agent 描述中过时部分；agents 列表对齐现行（master/retrieval/post-processing/world-architect/studio-assistant）；schema README 描述对齐（扁平 + 聚合层，非一实体一目录）。
- [ ] H3 `docs/active/novel-airp-workspace-schema-direction.md` Workspace Contract（行 23-54）：补 `save/scenes/`、`save/relationships/`；移除任何 `save/understanding/` 提及（若有）；Agent Responsibilities 补 world-architect 写开局聚合层、post 维护聚合层。
- [ ] H4 同文件补权威归属说明（entity 权威 / scene/relationship 派生 / runtime 指针）。
- **验证**：人工复核三处文档无废弃模型残留；术语一致。

## Phase I：方法论沉淀（.trellis/spec/guides/）

- [ ] I1 新建 `.trellis/spec/guides/agent-skill-design-principles.md`：8 条泛用原则，每条含"不绑场景 + 可操作判据 + 一句执行手段"。原则见 design §9。
- [ ] I2 `.trellis/spec/guides/index.md` Available Guides 表加一行；Quick Reference 触发条件补"涉及 agent/skill/工具能力设计/写入策略/数据权威/文档分层时"。
- **验证**：自读 8 条原则确认泛用（离开 novel 场景仍成立）。

## Phase J：最终验证

- [ ] J1 `npm run build:web` 通过。
- [ ] J2 `npm run build --workspace play-frontend-dev` 通过（若动了 source-import.ts）。
- [ ] J3 全局 grep 确认无 `save/understanding/` 残留引用（除 06-28 归档文档作历史记录）。
- [ ] J4 grep 确认 `save/world/`、`index.json`、`_ref`、`_dir`、`frontend/view-state.json`、`workspaceVersion.*7`、`narrative` 不再出现在 `docs/active/` 现行方向文档。
- [ ] J5 自读重写后的 opening-initialization SKILL.md：world-architect 据此能否稳定产出（非空壳）。
- [ ] J6 自读 commit 脚本写入路径：开局后 master contextPaths（director brief + runtime activeSceneIds）能读到开局成果。

## 风险文件 / 回滚点

- **高风险**：`workspace-templates.ts`（集中改动），`source-import.ts:6`（路径常量）。回滚：git revert。
- **中风险**：`docs/active/agent-framework-runtime-workspace-direction.md`（大段重写 §9/§14），`novel-airp-workspace-schema-direction.md`。回滚：git checkout 单文件。
- **低风险**：`.trellis/spec/guides/` 新文件 + index 登记。回滚：删文件 + revert index。
- 无运行时代码改动，无 Dexie/DB 变更，回滚成本最低。

## task.py start 前检查

- [ ] prd.md / design.md / implement.md 齐全且用户已 review。
- [ ] PRD convergence pass 已跑（无重复事实、无临时段、锚点未丢）。
- [ ] 用户明确批准进入实现。
