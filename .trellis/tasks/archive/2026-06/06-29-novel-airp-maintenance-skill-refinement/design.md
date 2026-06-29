# 小说 AIRP 维护/检索 skill 优化 — Design

## 1. Scope & Boundaries

本任务优化推进期使用的维护/检索 skill，承接 `06-29-novel-airp-schema-consolidation` deferred 的三项优化。依赖关系：R3 `resolve_entities` 依赖兄弟任务已落地的 `save/scenes/`、`save/relationships/` 契约（已满足）；R1/R2 独立可先行。

编辑面集中在 `apps/platform-web/src/storage/workspace-templates.ts` 字符串模板（维护 skill 脚本/SKILL.md、新增 resolve_entities skill）+ retrieval AGENT.md（R4 工作流约定）。不碰运行时代码逻辑（workspace.edit 原语已存在，browser_script SDK 已暴露），低风险。

## 2. 关键事实（实现前确认）

- `workspace.edit` 原语语义是 **oldString/newString/replaceAll 字符串替换**（`workspace-operations.ts:1021-1075`），不是 JSON path patch、也不是 expectedContent+full-content。`expectedContent` 仅用于 `write` 的乐观并发（`workspace-operations.ts:960-974`）。edit 要求 oldString 非空、文件存在、匹配数 > 0；不匹配抛 `WORKSPACE_EDIT_NO_MATCH`。
- browser_script SDK 已暴露 `tsian.workspace.edit`（`browser-skill-script-executor.ts:173`），返回 file 对象。SDK 签名：`edit(input)`，input 含 scope/path/oldString/newString/replaceAll。
- `apply-world-state-plan`/`apply-maintenance-plan` 当前 `validateWrite` 硬拒非 replace mode（`workspace-templates.ts:319、对应 maintenance`），`mode: 'replace'` 需 `content` + `reason`；写入走 `tsian.workspace.write({scope:'save-runtime', path, content, mediaType})`。
- `apply-world-state-plan` 的 isAllowedTarget（`workspace-templates.ts:306-313`）覆盖 entities/schema/playthrough/source/director。`save/scenes/` + `save/relationships/` 在兄弟任务已加入 README 与 runtime，但 **isAllowedTarget 正则尚未覆盖它们** — 推进期 post 维护聚合层会被拒。本任务必须补这两条通配。
- `resolve_entities` 读取依赖：entity 文件在 `save/entities/<type>/<localId>.json`，scene 在 `save/scenes/<localId>.json`，relationship 在 `save/relationships/<scope>.json`。读取用 `tsian.workspace.read({scope:'effective', path})`；列目录用 `tsian.workspace.list`。容器嵌套靠 entity 内 `contents[].ref` 链。

## 3. R1 — mode 自适应（replace/edit）

### 3.1 设计判据（原则 7：按客观状态）

脚本收到 write 请求时，按 `旧内容长度` 与 `改动占比` 自适应：
- 旧内容 > 2000 字符 且 改动占比 < 30% → 倾向 edit（省 token/上下文）
- 否则 → replace（整文件重写更可靠）

但**自适应只在调用方未显式指定 mode 时起作用**；调用方可显式传 `mode: 'replace'` 或 `mode: 'edit'` 覆盖。不按文件类型预设。

### 3.2 实现：validateWrite 扩展

`validateWrite` 接受两种形态：
- `mode: 'replace'`（或省略 mode 且自适应判定为 replace）：需 `content` + `reason`。走 `tsian.workspace.write`。
- `mode: 'edit'`（或省略 mode 且自适应判定为 edit）：需 `oldString` + `newString` + `reason`，可选 `replaceAll`。走 `tsian.workspace.edit`。

自适应判定逻辑（仅当 `mode` 省略时）：
1. 读旧文件内容 `tsian.workspace.read({scope:'effective', path})`（缺文件则强制 replace，因为 edit 需要存在文件）。
2. 旧长度 > 2000 且 `newString.length / oldLength < 0.3` → edit；否则 replace。
3. 若调用方为 edit 提供了 oldString/newString 但省略 mode，直接按 edit 走（已具备 edit 输入）。

校验保留：path 白名单（isAllowedTarget，需补 scenes/relationships）、reason 必填、content/oldString 长度上限。

### 3.3 两个 skill 都改

`apply-world-state-plan` 与 `apply-maintenance-plan` 共用同一套 mode 逻辑。`MAINTENANCE_SCRIPT_COMMON` 已含 normalizePath/fail/isRecord；mode 判定 + edit 路由加入各自 validateWrite。记忆维护 allowed targets 是 notes/timeline/summaries（自由文本，见 R2 — 可能退出 skill，但 R1 仍让脚本支持 edit mode 供仍走 skill 的结构化写入用）。

## 4. R2 — skill 边界收敛

### 4.1 判据（原则 1：频率×后果；原则 2：会不会变）

自由文本（brief.md、notes.md、timeline.md、summaries）**无 schema 结构约束**，错了 agent 自己改，属"高频×可自纠"→ 平台 primitive，不必 skill 校验。结构化 JSON（entity/scene/relationship/runtime）**有 schema 约束**，错了破坏契约，属"高频×破坏性"→ skill 校验。

### 4.2 调整

- `apply-world-state-plan` SKILL.md 的 allowed targets 保留结构化路径（entities/schema md/playthrough json/source/director/scenes/relationships），**移除自由文本说明**（其实它本就只列结构化路径，无 brief.md/notes.md —— 确认后可能无需改）。
- `apply-maintenance-plan` 当前 allowed targets 是 `save/agents/<agent>/notes.md`、`timeline.md`、`summaries/current.md`、`summaries/long-term.md`，**全是自由文本**。按 R2，这些退出 skill 校验，agent 直接用平台 `workspace.write`/`edit`。
- 但完全删 `apply-maintenance-plan` 会丢"staged transaction 写入 + trace + reason 审计"的价值。取舍：**保留 skill 但放开为通用 workspace 写入包装**（不再限白名单到自由文本，而是让 agent 选择用 skill 还是自己平台 write）。或更简：保留现状（自由文本仍走 skill 校验无害，只是过紧），R2 重点放在**新增结构化写入的 skill 边界明确**，不在本任务删 maintenance。

**决策**：R2 轻量化执行——在两个 SKILL.md 明确"无结构约束的自由文本可直接用平台 workspace.write/edit，本 skill 主要服务有 schema 约束的结构化写入"，不强删 maintenance 的自由文本白名单（删了反而让 agent 失去 staged 写入便利）。本任务 R2 落地为**文档澄清**，非删除能力。这符合"该给的慷慨给"。

### 4.3 isAllowedTarget 补 scenes/relationships（必须）

`apply-world-state-plan` 的 isAllowedTarget（`workspace-templates.ts:306-313`）补：
- `^save\\/scenes\\/[^/]+\\.json$`
- `^save\\/relationships\\/[^/]+\\.json$`

否则推进期 post 维护聚合层会被 skill 拒（被迫走平台 write 绕过校验，或无法写入）。这是兄弟任务契约落地后的必然补丁。

## 5. R3 — resolve_entities 批量读取 skill

### 5.1 定位（原则 3：看往返次数）

裸用平台 read 取嵌套容器：读容器 → 看到 ref → 再读内层 → 看到 ref → 再读...，多轮往返吃上下文。skill 在 Worker 里批量按 ref 取 + depth 展开，一次返回。判据：多次往返 → 封装。

### 5.2 新增 skill：skills/resolve-entities/

- `SKILL.md`：front matter（name: entity-resolver 或 resolve-entities）+ 说明"批量按 ref 取详情 + 容器嵌套 depth 控制 + 可选关系/场景，一次返回省往返"。
- `scripts/resolve-entities.js`（browser_script）。

### 5.3 action 输入/输出

```
resolve_entities({
  refs: [\"character:萧玄\", \"container:玩家储物袋\"],   // 必填，要取详情的 entity id
  depth?: 1,                          // 容器/嵌套展开层数，默认 1
  withRelations?: false,              // 顺带从 relationships/<scope> 取这些 ref 的关系边
  withScene?: false                    // 顺带取这些 ref 所在的 active 场景
})
```

返回 `{ entities: [{ id, path, data }], expanded: [...], relationships?: [...], scenes?: [...] }`。

### 5.4 脚本逻辑

1. 解析 refs 为 `<type>:<localId>`，路径 `save/entities/<type>/<localId>.json`。
2. 批量 `tsian.workspace.read` 取 entity 文件（缺文件跳过，不抛——返回中标记 missing）。
3. depth 展开：对每个 entity 的 `contents[].ref`（容器），按 depth 递归取下一层实体；用 visited Set 防循环；depth 到 0 停，保留 ref 标记不展开。
4. withRelations：对每个 ref 的 localId，读 `save/relationships/<scope>.json`，合并 edges。
5. withScene：读 `save/playthrough/runtime.json` 的 activeSceneIds，读对应 scene 文件，筛 present 含目标 ref 的场景。
6. trace `entities_resolved`（refCount/depth/expandedCount/relations/scenes）。
7. 一次返回，不递归遍历全局、深度可控。

### 5.5 不做的事

- 不做语义搜索（找用平台 workspace.search，原则 3）。
- 不做单文件直读（用平台 workspace.read 一次取完，原则 3）。
- 不缓存（派生视图，原则 4——caller 需要时再调）。

## 6. R4 — retrieval 工作流约定

retrieval AGENT.md（`workspace-templates.ts` retrieval AGENT.md 块）补工作流约定：
- 找（语义搜索定位）→ 平台 `workspace.search`。
- 单文件直读 → 平台 `workspace.read`。
- 批量取 + 嵌套展开 + 可选关系/场景 → `resolve_entities` skill。
- 关系查询："某 subject 全部关系" → 平台 `workspace.read` 直读 `save/relationships/<scope>.json`（一 subject 一文件，O(1)）。
- 场景查询：当前在场 → 平台 `workspace.read` runtime.json 拿 activeSceneIds → 读 scene 文件。

判据：往返次数决定用平台还是 skill，不靠抽象层次。

## 7. skill 注册

新增 `skills/resolve-entities/SKILL.md` + `scripts/resolve-entities.js` 注册到 `DEFAULT_WORKSPACE_FILES`。retrieval agent.json 的 `skills.enabled` 加入该 skill（推进期 retrieval 用）；post-processing 也可启用（维护时批量取详情）。

## 8. 兼容性 / 回滚

- 字符串模板改动，重建卡生效；旧存档靠 workspace version 升级（已是 11，本任务不 bump，因不改契约只加 skill + 脚本能力）。resolve-entities skill 文件加入 `DEFAULT_SAVE_RUNTIME_UPGRADE_FILE_PATHS`？skill 是卡内容不是 save runtime，放 `DEFAULT_WORKSPACE_FILES` 即可，无需升级集（旧存档缺这个 skill 只是没批量取能力，不影响已有功能）。
- 无运行时代码、无 Dexie 变更。回滚：git revert 模板改动。
- 校验：`npm run build:web`（模板改动 + 新 skill 脚本字符串）。

## 9. Trade-offs

- **mode 自适应读旧文件多一次 read**：edit 判定需读旧内容算占比，多一次 read。但 edit 省的 token 远大于这一次 read 的成本。可接受。
- **resolve_entities depth 默认 1**：防一次灌太多。caller 需要更深显式传 depth。循环引用靠 visited Set 防死循环。
- **R2 轻量执行**：不删 maintenance skill 自由文本白名单，只文档澄清。避免过激删能力，符合"该给的慷慨给"。若后续发现 agent 因 maintenance 过紧而绕路，再调整。
- **isAllowedTarget 补 scenes/relationships**：兄弟任务漏的必然补丁，不补则 post 维护聚合层无法走 skill 校验写入。