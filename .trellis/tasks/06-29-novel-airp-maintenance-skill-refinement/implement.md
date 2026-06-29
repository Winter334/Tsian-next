# 小说 AIRP 维护/检索 skill 优化 — Implement

> 实施顺序：先补 isAllowedTarget bugfix（阻塞聚合层维护）→ mode 自适应 → resolve_entities skill → retrieval 工作流文档。每阶段可独立验证。集中在 `workspace-templates.ts` 字符串模板，不碰运行时代码。

## 实施前检查

- [ ] 确认 `06-29-novel-airp-maintenance-skill-refinement` 为 current task（或 task.py start 后）
- [ ] 工作区干净（任务 A 已 commit + archive）

## Phase A：isAllowedTarget 补 scenes/relationships（阻塞 bugfix）

兄弟任务落地了 scenes/relationships 契约，但 `apply-world-state-plan` 的 isAllowedTarget（`workspace-templates.ts:306-313`）未覆盖，推进期 post 维护聚合层会被拒。

- [ ] A1 isAllowedTarget 正则补 `^save\\/scenes\\/[^/]+\\.json$` 与 `^save\\/relationships\\/[^/]+\\.json$`。
- [ ] A2 SKILL.md（world-state-maintenance）allowed targets 文档补 scenes/relationships 说明。
- **验证**：`npm run build:web`。

## Phase B：R1 mode 自适应（replace/edit）

改 `apply-world-state-plan` 与 `apply-maintenance-plan` 的 validateWrite + 写入路由。

- [ ] B1 validateWrite 放开：接受 `mode: 'replace'`（content）/ `mode: 'edit'`（oldString+newString+replaceAll?）/ 省略 mode（自适应）。硬拒非 replace 的 `mode !== 'replace'` 判断改为分支。
- [ ] B2 自适应判定（mode 省略时）：读旧文件；旧长度 > 2000 且 edit 输入具备（oldString/newString 提供）或改动小 → edit；否则 replace。缺文件强制 replace。
- [ ] B3 edit 路由：`tsian.workspace.edit({ scope: 'save-runtime', path, oldString, newString, replaceAll })`，catch `WORKSPACE_EDIT_NO_MATCH` 返回可操作错误让 agent 修正。
- [ ] B4 replace 路由不变（`tsian.workspace.write`）。trace 区分 mode。
- [ ] B5 两个 skill 脚本都改（world-state + maintenance），共用判定逻辑（各自内联，因脚本是独立字符串模板）。
- **验证**：`npm run build:web`；逻辑复核 edit/replace 分支正确。

## Phase C：R2 skill 边界澄清（文档）

- [ ] C1 `apply-world-state-plan` SKILL.md 加一句：无结构约束的自由文本（brief/notes/timeline/summaries）可直接用平台 workspace.write/edit，本 skill 主要服务有 schema 约束的结构化写入（entity/scene/relationship/runtime/schema md）。
- [ ] C2 `apply-maintenance-plan` SKILL.md 同样澄清：自由文本维护可直接平台 write/edit，本 skill 提供 staged 写入 + reason 审计便利，不强删自由文本白名单。
- [ ] C3 不删除 maintenance 的自由文本 allowed targets（保留便利，符合"该给的慷慨给"）。
- **验证**：`npm run build:web`。

## Phase D：R3 resolve_entities 批量读取 skill

新增 `skills/resolve-entities/SKILL.md` + `scripts/resolve-entities.js`（browser_script 字符串模板）。

- [ ] D1 定义 `RESOLVE_ENTITIES_SKILL_MD` 文本：front matter（name: entity-resolver / resolve-entities，中英 description）+ 使用说明（批量取 + depth + withRelations/withScene，省往返；不替代搜索/单文件直读）。
- [ ] D2 定义 `RESOLVE_ENTITIES_SCRIPT_JS` 脚本：
  - 输入校验：refs 数组必填、每项 `<type>:<localId>` 格式；depth 正整数默认 1；withRelations/withScene 布尔默认 false。
  - 批量 read entity 文件（缺文件标记 missing 不抛）。
  - depth 递归展开容器 contents ref（visited Set 防循环，depth 到 0 保留 ref 标记）。
  - withRelations：读 relationships/<scope>.json 合并 edges。
  - withScene：读 runtime.json activeSceneIds → 读 scene 文件 → 筛 present 含目标 ref。
  - trace `entities_resolved`。
  - 返回 { entities, expanded, relationships?, scenes? }。
- [ ] D3 注册到 `DEFAULT_WORKSPACE_FILES`：`skills/resolve-entities/SKILL.md` + `skills/resolve-entities/scripts/resolve-entities.js`。
- [ ] D4 retrieval agent.json `skills.enabled` 加入 `skills/resolve-entities/SKILL.md`（推进期 retrieval 用）。
- [ ] D5 （可选）post-processing `skills.enabled` 也加入（维护时批量取详情）。
- **验证**：`npm run build:web`；脚本逻辑复核 visited 防循环、depth 控制、一次返回。

## Phase E：R4 retrieval 工作流约定

- [ ] E1 retrieval AGENT.md（`workspace-templates.ts` retrieval AGENT.md 块）补工作流约定段落：
  - 找 → 平台 workspace.search
  - 单文件直读 → 平台 workspace.read
  - 批量取 + 嵌套展开 → resolve_entities
  - 关系查询 → 直读 relationships/<scope>.json（一 subject 一文件）
  - 当前在场 → 读 runtime.json activeSceneIds → 读 scene 文件
- **验证**：`npm run build:web`。

## Phase F：最终验证

- [ ] F1 `npm run build:web` 通过。
- [ ] F2 自读 isAllowedTarget 含 scenes/relationships。
- [ ] F3 自读 validateWrite：edit/replace 分支正确，自适应阈值合理。
- [ ] F4 自读 resolve_entities 脚本：visited 防循环、depth 控制、缺文件不抛、一次返回。
- [ ] F5 retrieval AGENT.md 工作流约定完整。

## 风险文件 / 回滚点

- **集中改动**：`workspace-templates.ts`（字符串模板）。回滚：git revert。
- **无运行时代码改动**：workspace.edit 原语已存在，browser_script SDK 已暴露 edit。回滚成本最低。

## task.py start 前检查

- [ ] prd.md / design.md / implement.md 齐全且用户已 review。
- [ ] 用户明确批准进入实现。