# 小说 AIRP schema 收口与开局链路修复 — Design

## 1. Scope & Boundaries

本任务修复"开局抽取产出不可用"并收口 schema 契约。运行时执行层（browser_script/scope/transaction/registry）经审计健康，不重构。schema 设计本体（扁平存储）不重构，只新增聚合层 + 文档收口。维护/检索 skill 的三项推进期优化归兄弟任务 `06-29-novel-airp-maintenance-skill-refinement`。

编辑面集中在三处：
- `apps/platform-web/src/storage/workspace-templates.ts` 字符串模板（开局 Skill/脚本、聚合层 README/模板、agent contextPaths、runtime.json 默认值）
- `docs/active/*.md` 项目方向文档同步
- `.trellis/spec/guides/` 方法论沉淀

不碰运行时代码逻辑（agent-runtime/、platform-host/、storage/ 的 .ts 实现文件），低风险。唯一脚本逻辑改动是 `readText` 容错（R15），在 openning 脚本模板字符串内。

## 2. 聚合/导航层设计（核心新增）

### 2.1 三层职责（原则 6：存储/引用/聚合分离）

- **存储层**：`save/entities/<type>/<localId>.json`，一实体一文件，扁平。实体本体权威。post 整体替换写入（推进期）。
- **引用层**：实体内 `{ref, name}` 指向别处，只"提一句关联"，不承担导航。容器 contents 用 ref 链表达嵌套。
- **聚合层**：scene/relationship 分片 + runtime 指针，派生导航视图。**丢了可重建，非第二权威。**

判据：这个文件回答"某实体本体"还是"实体间关系/当前局面"？前者存储层，后者聚合层。

### 2.2 场景分片 `save/scenes/<sceneId>.json`

一场景一文件，吸收多场景（原创角色双线、原著多线）。schema 现在即纳入契约（不留烂摊子）。

```json
{
  "id": "scene:山门冲突",
  "name": "山门冲突",
  "location": { "ref": "location:青玄门山门", "name": "青玄门山门" },
  "present": [
    { "ref": "character:萧玄", "name": "萧玄", "brief": "青玄门外门弟子，当前卷入山门冲突。", "status": "右臂轻伤" },
    { "ref": "character:赵长老", "name": "赵长老", "brief": "内门执法长老。" }
  ],
  "status": "active",
  "updatedTurn": 0,
  "updatedBy": "world-architect"
}
```

- `status`: `active`（当前焦点）/`background`（仍在发生但非焦点）/`resolved`（已结束，不删——剧情可回溯）。
- `present` 只放 ref + name + brief + 关键状态摘要（status 摘要，非全量），是导航索引不是实体副本。实体权威在 entity 文件。
- sceneId 用 `<type>:<localId>` 约定（如 `scene:山门冲突`），与 entity id 风格一致；路径 `save/scenes/<localId>.json`（type=scene 固定，目录扁平化）。

### 2.3 关系分片 `save/relationships/<scope>.json`

一 subject 一文件，吸收长篇关系爆炸。补 06-27 砍 relationships.json 留下的缺口。

```json
{
  "subject": "character:萧玄",
  "edges": [
    { "to": "character:赵长老", "type": "敌对", "since": 0, "note": "因山门冲突结怨。" },
    { "to": "faction:青玄门", "type": "隶属", "since": 0 }
  ],
  "updatedTurn": 0,
  "updatedBy": "world-architect"
}
```

- `<scope>` = subject 实体的 localId 去 type 前缀（如 `character-萧玄`），文件路径 `save/relationships/<scope>.json`。一角色一文件，检索 O(1)：查"萧玄的全部关系"直接读该文件。
- **双向关系两边各写一条**（post 维护规范明确，写进 R7 对应规范）；**单向关系（如隶属）只写从属方**。反向查询靠对称条目命中，不扫全局。
- `since`/`until` 表达关系演化（先师徒后决裂可两条 edge 或 until 标注）。推进期 post 维护。
- 推进期才会暴露的反向关系对称性扫描退化（若 post 漏写对称条目）记录为未来关注点，本任务不解决。

### 2.4 runtime.json 指针扩展

`save/playthrough/runtime.json` 增加 `activeSceneIds: [...]`：

```json
{
  "turn": 0,
  "activeSceneIds": ["scene:山门冲突"],
  "activeScene": { "ref": "scene:山门冲突", "name": "山门冲突" },
  "player": { "character": null, "location": null },
  "inventory": null,
  "status": [],
  "updatedAtTurn": 0,
  "updatedBy": null
}
```

- `activeSceneIds` 是"当前活跃场景"导航入口指针（非场景内容权威）。
- `activeScene`（单个 ref）保留兼容现有模板字段，推进期多场景时以 activeSceneIds 数组为准。开局阶段两者指向同一场景。
- 权威归属：场景内容权威在 scene 文件；runtime 只存指针。无双 authority。

### 2.5 权威归属汇总（原则 4）

| 数据 | 权威 | 派生 | 刷新时机 |
|---|---|---|---|
| entity json | entity 文件 | — | post 每回合整体替换 |
| scene json | scene 文件 | present 摘要从 entity 派生 | post 场景变动时重写 |
| relationship json | relationship 文件 | edges 引用 entity id | post 关系变动时重写涉及 subject |
| runtime.activeSceneIds | runtime.json | 指针指向 scene 文件 | 场景切换时更新 |

写进规范文档，避免双 authority。

## 3. 开局链路重写

### 3.1 commit_opening_understanding 脚本改动

当前写入（`workspace-templates.ts:559-565`）：
```
save/understanding/initial-window.json
save/understanding/initial-brief.md
save/understanding/initial-summary.json
save/playthrough/frontier.json
save/entities/...*.json
```

改为写入：
```
save/director/current-brief.md              ← brief 落点（并入 director）
save/director/current-brief.meta.json        ← brief 元数据（基于/更新回合）
save/scenes/<开局场景>.json                   ← 聚合层第一版（R6）
save/relationships/<涉及人物>.json            ← 聚合层第一版（R7）
save/playthrough/frontier.json                ← 保留（已有）
save/playthrough/runtime.json                 ← 更新 activeSceneIds/activeScene（R8）
save/entities/...*.json                       ← 保留（已有）
save/understanding/initial-summary.json       ← 保留（前端读，但移出 understanding 目录，改 save/playthrough/understanding-summary.json 或并入 runtime？见 3.3）
```

### 3.2 commit 输入扩展

`commit_opening_understanding` 的 inputSchema 增加：
- `scene`: { id, name, location: {ref,name}, present: [{ref,name,brief,status?}] } —— 开局场景
- `relationships`: [{ subject, edges: [...] }] —— 开局涉及人物的关系（按 subject 分组的输入，脚本按 subject 分文件写）
- `activeSceneId`: string —— 写入 runtime.activeSceneIds

脚本校验：scene.present 的 ref 必须在本次 commit 的 entities 中或已存在 entity；scene.location.ref 同理。relationships 的 subject/to 必须是合法 `<type>:<localId>` id。

### 3.3 initial-summary 去留

前端 `loadOpeningUnderstandingSummary`（`source-import.ts:425-430`）硬编码读 `save/understanding/initial-summary.json` 判断完成态。删除 understanding 目录后，summary 改落 `save/playthrough/understanding-summary.json`（playthrough 域，正式契约内），前端 `INITIAL_SUMMARY_PATH`（`source-import.ts:6`）同步改路径。或并入 runtime.json 一个 `openingUnderstanding` 子对象。

**推荐**：落入 `save/playthrough/understanding-summary.json`，与 frontier 同域，前端只改一个常量路径，最小改动。schema 契约在 playthrough README 补这个文件说明。

### 3.4 brief 落 director 的内容

`current-brief.md` 开局内容 = 开局整理的 brief（开局氛围/可用素材/第一幕场景/spoiler 边界），由 Skill 指导 world-architect 产出。`current-brief.meta.json`：`{ basedOn: ["opening-extraction"], updatedAtTurn: 0, scene: <开局场景 ref>, sourceWindow: <frontier sourceWindow>, notes: "" }`。

master AGENT.md/SOUL.md 不需改：其 contextPaths 已含 `save/director/current-brief.md`，开局后即可读到。这正修复"开局成果进不了游玩回路"的深层断裂。

## 4. opening-initialization Skill 重写

### 4.1 结构

SKILL.md 主体写完整流程指导（按需加载时一次注入），不拆 reference 除非范例超长。front matter 保留中文 name/description（index 触发用）。

### 4.2 主体内容大纲

1. **定位**：开局一次性建档，不是推进期维护。目标不是理解整本书，是读到一段足够支撑开局的连续剧情。
2. **抽取步骤**（对应 inspect→read→commit 三工具）：
   - inspect：观察书名/章节数/前部预览，判断小说类型与可能的实体类别。
   - read：连续阅读开头章节，是否继续以"剧情充分性"为准（角色登场+冲突建立+开局场景可定+第一幕可起），不用固定章节数机械停。护栏：默认在 ~60k 字或读够后停。
   - commit：一次性提交理解包。
3. **实体抽取指引**：
   - 类型清单：`character:`（人物）、`location:`（地点）、`faction:`（势力/组织）、`setting:`（设定/规则/体系，如修炼体系、世界规则）、`item:`（开局关键物品，按需）、`container:`（开局就有且重要的容器，按需）。
   - 粒度：只抽开局窗口内登场/提及且对开局有用的实体。背景提及但不开局介入的不抽（推进期 post 补）。
   - 字段：每实体至少 id/name/brief；按需加 sourceRefs（指向读到的章节路径）、tags、aliases、origin（开局都 canon）。
   - id 用词：用上述前缀，不自创。中文 localId 允许，不含 `/ \ : NUL . ..`。
4. **brief 段落结构**（写进 director）：
   - 开局氛围（一两句定调）
   - 可用素材（开局已登场的关键人物/地点/势力/冲突）
   - 第一幕场景（玩家可介入的起点）
   - spoiler 边界（只写开局窗口内事实，不提未来剧情）
   - 简洁，可执行，面向后续 master/post。
5. **candidateCharacters 选取**：开局窗口内登场、有足够信息可供玩家选择扮演的原著角色；最多 8 个；每人 name+brief（一句话定位）。若无合适原著角色（主角已固定或信息不足），可空数组（后续走原创角色）。
6. **scene 组装**：从读到的开局确定一个开局场景（id/name/location/present）。present 是开局在场人物，含 ref+name+brief+关键状态摘要（若有）。
7. **relationships 组装**：开局窗口内已明确的人物间关系（隶属/敌对/师徒/亲属等）。按 subject 分组（一人物一 subject），双向关系两边都给 edges。
8. **frontier.notes**：写为什么这个窗口足够开局（哪些 inciting situation/protagonist context/conflict/setting cues）。
9. **window.chapters 组装**：从 read_opening_slice 的 window.chapters 直接取（脚本返回值含 path/index/title），commit.window.chapters 复用，reason 写 frontier.notes 的判断依据。
10. **重试策略**：commit 返回校验错误时，按错误 code/message 修正后重试，不放弃。常见错误：sourceRefs 指向不存在章节→检查 path；entity id 格式错→改 `<type>:<localId>`；缺必填→补。

### 4.3 front matter 与 action 声明

保留现有 action 声明（inspect/read_slice/commit），只扩 commit inputSchema（加 scene/relationships/activeSceneId）。triggers 不在本 skill 重复（design 2.5 已说 index 即触发）。

## 5. 文档分层（原则 8：按读取频率）

| 文档 | 位置 | 常驻 contextPaths | 内容 |
|---|---|---|---|
| 速查 guide | `docs/novel-airp-schema-guide.md`（工作区内嵌） | 是（world-architect/post-processing/master/retrieval 相关） | 扩充到 ~150-200 行：目录契约（含 scenes/relationships/understanding-summary）、entity 最小/推荐字段、visibility、sourceRefs、structured refs、fields vs sections、schema 演进 additive/patch 边界 |
| 详尽 reference | `docs/novel-airp-schema-reference.md`（工作区内嵌，新文件） | 否 | 06-27 design 遗漏细节：lifecycle/origin 受控词、status 协议、容器/库存模型、evidence、schema patch Markdown 模板、runtime.json 完整示例、scene/relationship 完整格式与示例 |
| 本存档实例 | `save/schema/current.md` | world-architect/post-processing | 保持 living 实例定位，补 scenes/relationships 目录契约一句 |
| 项目方向 | `docs/active/novel-airp-workspace-schema-direction.md` | 否（开发者） | Workspace Contract 补 scenes/relationships，移除 understanding/ |
| 项目方向 | `docs/active/agent-framework-runtime-workspace-direction.md` | 否（开发者） | §9/§14 同步现行契约 |
| 方法论 | `.trellis/spec/guides/agent-skill-design-principles.md` | 否（开发者/spec） | 8 条泛用原则 |

判据：每回合查→常驻且精简；偶尔查→按需且详尽；一次性→skill 激活注入；开发者→docs/active。

## 6. agent contextPaths 调整

| agent | 当前 contextPaths | 调整 |
|---|---|---|
| master | README, guide, director/current-brief.md, runtime.json, schema/current.md | guide 用扩充版；runtime.json 含 activeSceneIds 指针；director 含开局 brief。无需新增路径 |
| retrieval | guide, source/README, entities/README | guide 用扩充版；可加 scenes/README、relationships/README（让 retrieval 知道聚合层存在） |
| post-processing | guide, schema/current.md, runtime.json, director/current-brief.md | guide 用扩充版；加 relationships/README、scenes/README（维护聚合层要知道契约） |
| world-architect | guide, source/README, schema/current.md, schema/changelog.md, frontier.json | guide 用扩充版；加 scenes/README、relationships/README（开局要写聚合层） |

新增 README：`save/scenes/README.md`、`save/relationships/README.md`（卡内容模板 + save runtime 升级路径集）。

## 7. readText 容错（R15）

`OPENING_SCRIPT_COMMON` 的 `readText`（`workspace-templates.ts:413`）当前：
```js
async function readText(tsian, path) { const file = await tsian.workspace.read({ scope: 'effective', path }); return file && typeof file.content === 'string' ? file.content : ''; }
```
`workspace.read` 缺文件**抛错不返回空**，所以 `file &&` 判断无效。修正：try/catch 包裹，缺文件返回 ''，使 inspect/read_slice 在某 chapter 文件缺失时降级（该章 preview/slice 为空）而非整脚本 reject。若整体 manifest/index 缺失仍应 reject（那是 import 未完成，可操作错误），由 `loadSource` 的 readJson 抛错保留。

## 8. DEFAULT_SAVE_RUNTIME_UPGRADE_FILE_PATHS 升级

`workspace-templates.ts:6-33` 的升级路径集补：
- `save/scenes/README.md`
- `save/relationships/README.md`
- `save/playthrough/understanding-summary.json`（替代 understanding/initial-summary.json）
- 移除原 understanding 相关（若有）

`DEFAULT_WORKSPACE_VERSION` 从 10 升到 11（schema 契约变更）。旧存档升级补齐新默认文件（不删除旧 understanding 文件，作者手动清理）。

## 9. 方法论沉淀（R16）

`.trellis/spec/guides/agent-skill-design-principles.md`，8 条泛用原则（每条：不绑场景 + 可操作判据）：

1. 频率×后果给能力，该慷慨时慷慨该锁死时锁死
2. 能力归属由"会不会变"决定，非"重不重要"
3. skill 封装看往返次数，不看抽象层次
4. 两份相同数据必写权威与派生 + 刷新时机
5. 会无界增长的量一开始就按自然单元分片
6. 一次性产物必落到后续能读到的路径
7. 写入策略按客观状态决定，不按类型标签
8. 文档分层按读取频率，非详尽程度

`guides/index.md` 登记表加一行 + 触发条件（涉及 agent/skill/工具设计时读）。

## 10. Deferred（兄弟任务 06-29-novel-airp-maintenance-skill-refinement）

- `resolve_entities` 批量读取 skill（依赖本任务 scene/relationship 契约落地）
- apply-world-state-plan/maintenance 的 mode 自适应（replace/edit 按文件大小+改动比例）
- skill 边界收敛（自由文本退出 skill 校验）

记录于此不丢失，由兄弟任务承接。

## 11. 兼容性 / 回滚

- 字符串模板改动：重建卡即生效；旧存档靠 workspace version 11 升级补新文件。旧 understanding 文件不删（变普通 workspace 文件，作者清理）。
- 无运行时代码改动，无 Dexie schema 变更，无 DB 名 bump。
- 回滚：git revert 模板改动即可；已升级存档的新文件无害（unused 直到下次开局 commit）。
- 校验：`npm run build:web`（模板改动）；`npm run build --workspace play-frontend-dev`（若改 source-import.ts 常量路径）。

## 12. Trade-offs

- **聚合层增加 post 维护负担**：post 推进期每回合维护 scene/relationship 涉及文件。代价换检索效率（retrieval O(1) 读 subject/scene）。符合原则 1（高频×破坏性给硬边界工具，但优化往返）。
- **派生视图同步性**：entity 改了 scene.present 摘要短暂不一致。回合内一致（post 每回合刷新），回合间可接受。
- **relationships 反向查询依赖对称条目**：post 漏写则反向退化。写进 post 维护规范 + 兄弟任务的 resolve_entities 可加反向聚合兜底（未来）。
- **scene resolved 不删累积**：v0 可接受（可回溯是 feature）；远了归档到 scenes/archive/，本任务不做。
- **understanding-summary 改路径**：前端要改一个常量。最小改动，一次性。