import { DEFAULT_WORKSPACE_VERSION, WORKSPACE_MANIFEST_PATH } from "./constants"
import { json, text, type TemplateFile } from "./utils"
import { STAGE_MANAGER_AGENT_FILES, STAGE_MANAGER_SKILL_FILES } from "./agents/stage-manager"
import { STORYTELLER_FILES, WRITING_RULES_MD } from "./agents/storyteller"
import { WORLD_ARCHITECT_AGENT_FILES, WORLD_ARCHITECT_SKILL_FILES } from "./agents/world-architect"
import {
  NOVEL_AIRP_SCHEMA_GUIDE_MD,
  NOVEL_AIRP_SCHEMA_REFERENCE_MD,
  RELATIONSHIPS_README_MD,
  SCENES_README_MD,
} from "./docs/airp"
import { TSIAN_FRAMEWORK_KNOWLEDGE_MD } from "./docs/framework"
import { ROLL_DICE_FILES } from "./tools/roll-dice"
import { EQUIPMENT_FRONTEND_ACTION_FILES } from "./frontend-actions/equipment"

export const DEFAULT_WORKSPACE_FILES: TemplateFile[] = [
  {
    path: "README.md",
    content: text([
      "# Runtime Workspace",
      "",
      "This effective workspace combines Game Card content with active save runtime data. Runtime play data lives under `save/`.",
      "The `.tsian/` directory is platform-owned metadata and is hidden from ordinary Agent, Skill, and frontend workspace APIs.",
      "",
      "This default card uses the novel AIRP backstage crew: `storyteller`, `stage-manager`, and `world-architect`. Read `docs/novel-airp-schema-guide.md` before changing novel source, schema, entity, or playthrough files.",
    ]),
  },
  {
    path: "agents/README.md",
    content: text([
      "# Agents",
      "",
      "Agent 配置放在 `agents/<agent>/agent.json`。`AGENT.md` 是岗位说明（SOP），`SOUL.md` 是工作风格。",
      "",
      "默认阵容：",
      "",
      "- `storyteller` / 三人写手：玩家正式回合入口。",
      "- `stage-manager` / 场记：回合后维护。",
      "- `world-architect` / 世界架构师：开局建模与 schema 设计。",
      "",
      "Agent-local Skills 放在 `agents/<agent>/skills/<skill>/SKILL.md`，默认优先按岗位定制。",
    ]),
  },
  ...STORYTELLER_FILES,
  ...STAGE_MANAGER_AGENT_FILES,
  ...WORLD_ARCHITECT_AGENT_FILES,
  ...STAGE_MANAGER_SKILL_FILES,
  ...WORLD_ARCHITECT_SKILL_FILES,
  ...EQUIPMENT_FRONTEND_ACTION_FILES,
  {
    path: "skills/README.md",
    content: text([
      "# Shared Skills",
      "",
      "默认卡的核心 Skill 都是 Agent-local，路径为 `agents/<agent>/skills/<skill>/SKILL.md`。",
      "",
      "卡级共享 `skills/` 只用于多个 Agent 完全一致的底层能力。当前默认模板不放共享玩法 Skill。",
    ]),
  },
  {
    path: "docs/README.md",
    content: text(["# Docs", "", "Official and game-card-authored documentation for Agents, Skills, frontends, and authors can live here. Read `docs/novel-airp-schema-guide.md` for this default card's novel workspace contract."]),
  },
  { path: "docs/tsian-framework-knowledge.md", content: TSIAN_FRAMEWORK_KNOWLEDGE_MD },
  { path: "docs/novel-airp-schema-guide.md", content: NOVEL_AIRP_SCHEMA_GUIDE_MD },
  { path: "docs/novel-airp-schema-reference.md", content: NOVEL_AIRP_SCHEMA_REFERENCE_MD },
  ...ROLL_DICE_FILES,
]

export const RUNTIME_DEFAULT_CARD_PATHS = new Set<string>([])

export const DEFAULT_SAVE_RUNTIME_FILES: TemplateFile[] = [
  {
    path: "save/README.md",
    content: text(["# Save Runtime Data", "", "This directory contains runtime data for the active novel AIRP save slot.", "", "Main novel AIRP runtime paths: `source/`, `schema/`, `entities/`, `scenes/`, `relationships/`, `playthrough/`, `memory/`, and `agents/`."]),
  },
  { path: "save/agents/storyteller/notes.md", content: "# 三人写手 Notes\n\n" },
  { path: "save/agents/storyteller/writing-styles.md", content: "# 文风学习记录\n\n" },
  { path: "save/agents/storyteller/writing-rules.md", content: WRITING_RULES_MD },
  { path: "save/agents/stage-manager/notes.md", content: "# 场记 Notes\n\n" },
  { path: "save/agents/world-architect/notes.md", content: "# 世界架构师 Notes\n\n" },
  {
    path: "save/history/README.md",
    content: text(["# History", "", "Keep this playthrough's durable conversation records and timeline summaries here.", "Raw player-facing AIRP turns are stored under `save/history/turns/` as one JSON file per successful turn."]),
  },
  { path: "save/history/turns/README.md", content: text(["# Raw AIRP Turns", "", "Each successful AIRP turn is stored here as `turn-000001.json`, `turn-000002.json`, and so on.", "Turn files contain the player input and final assistant narrative only."]) },
  { path: "save/memory/README.md", content: text(["# Runtime Memory", "", "Store this playthrough's long-term summaries, durable facts, and retrieval-oriented notes here."]) },
  { path: "save/memory/seeds.md", content: text(["# 伏笔追踪", "", "短期伏笔标记递增或失效，长期伏笔保留不动。", "", "格式：", "- [伏笔描述] 状态: <planted|developing|resolved|abandoned>; 关联回合: N", ""]) },
  { path: "save/memory/records.md", content: text(["# 回合记忆记录", "", "按标签记忆格式追加，每条一行：", "`- [序号] <recall|scene|npc_action> 关键词: 简短关键词; 摘要: 一句客观事实`", "", "- `recall`：玩家可回忆的前文事件", "- `scene`：当前场景的关键状态变化", "- `npc_action`：NPC 的自主行动", "", "只记客观事实，去修辞。序号递增。不复制整段正文原文。", ""]) },
  {
    path: "save/source/README.md",
    content: text(["# Source Corpus", "", "Imported novel text belongs here. The source corpus is the factual basis for derived schema, entities, scenes, and relationships.", "", "Current imports write a manifest, a chapter index, and shard-backed source text. Agents should use source-reading actions and chapter refs rather than assuming any storage layout.", "", "Layout:", "", "```text", "save/source/manifest.json", "save/source/chapters.index.json", "save/source/shards/source-shard-0001.md", "save/source/shards/source-shard-0002.md", "```", "", "Track progress in `save/playthrough/frontier.json` and expand the source frontier as play needs it."]),
  },
  { path: "save/source/manifest.json", content: json({ title: "", importedAt: null, status: "pending", chapterCount: 0, files: { chaptersIndex: "save/source/chapters.index.json", shardsRoot: "save/source/shards/" }, storage: { kind: "sharded", targetShardCharacters: 1000000 }, notes: "Filled when a novel is imported." }) },
  {
    path: "save/schema/README.md",
    content: text(["# Schema", "", "This directory holds the living schema for this novel AIRP save.", "", "- `current.md` is the authoritative human/Agent-readable schema.", "- `changelog.md` records applied changes and reasons.", "- `deprecated.md` records retired fields or concepts.", "- `patches/pending/*.md` records decision/risk/migration changes awaiting confirmation.", "- `patches/applied/*.md` records accepted patches after they are applied.", "", "Safe additive changes can update `current.md` and `changelog.md` directly. Use pending Markdown patches only when confirmation is needed."]),
  },
  {
    path: "save/schema/current.md",
    content: text(["# Current Novel AIRP Profile", "", "Status: draft", "", "This file records only save-specific choices relative to `docs/novel-airp-schema-guide.md`.", "", "- Entity id/path profile: `<type>:<localId>` → `save/entities/<type>/<localId>.json`.", "- Character attributes: six worldview-specific dimensions; current defaults are 体魄/悟性/气运/根骨/法力/魅力.", "- Relationships: character-to-character shards under `save/relationships/`.", "- Runtime/frontier: use the standard fixed fields; no save-specific extensions are active.", "", "Add only actual profile deviations or accepted extensions here. Read the full schema guide on demand before changing generic structures."]),
  },
  { path: "save/schema/changelog.md", content: "# Schema Changelog\n\n" },
  { path: "save/schema/deprecated.md", content: "# Deprecated Schema Concepts\n\n" },
  { path: "save/schema/patches/pending/README.md", content: "# Pending Schema Patches\n\nPut Markdown schema patches awaiting confirmation here.\n" },
  { path: "save/schema/patches/applied/README.md", content: "# Applied Schema Patches\n\nMove accepted schema patches here after applying them to current.md and changelog.md.\n" },
  {
    path: "save/entities/README.md",
    content: text(["# Entities", "", "Store semantic entities as JSON files at `save/entities/<type>/<localId>.json`.", "", "Character and equipment example:", "", "```json", "{", "  \"id\": \"character:萧玄\",", "  \"name\": \"萧玄\",", "  \"brief\": \"青玄门外门弟子，当前卷入山门冲突。\",", "  \"gender\": \"男\",", "  \"attributes\": { \"体魄\": 7, \"悟性\": 6, \"气运\": 4, \"根骨\": 5, \"法力\": 5, \"魅力\": 5 },", "  \"containers\": [{ \"ref\": \"container:萧玄行囊\" }],", "  \"equipment\": {", "    \"武器\": [{ \"ref\": \"item:粗铁短剑\", \"applied\": { \"体魄\": 2 } }],", "    \"护甲\": [{ \"ref\": null }]", "  }", "}", "```", "", "Equipment is grouped by slot type. Every value is a non-empty array whose existing length is fixed capacity; exact empty slots are `{ \"ref\": null }`. `attributes` contains current effective safe integers, while an occupied slot's optional `applied` records its current non-zero safe-integer contribution.", "", "Container example (`save/entities/container/<localId>.json`):", "", "```json", "{", "  \"id\": \"container:萧玄行囊\",", "  \"name\": \"外门弟子行囊\",", "  \"brief\": \"入门时统一发放的青灰色布囊。\",", "  \"type\": \"container\",", "  \"contents\": [", "    { \"ref\": \"item:清心丹\", \"count\": 3 },", "    { \"ref\": \"item:粗铁短剑\" }", "  ]", "}", "```", "", "Item example (`save/entities/item/<localId>.json`):", "", "```json", "{", "  \"id\": \"item:粗铁短剑\",", "  \"name\": \"粗铁短剑\",", "  \"brief\": \"制式短剑，刃口有小豁。\",", "  \"type\": \"equipment\",", "  \"tags\": [\"制式\", \"近战\"],", "  \"equipment\": {", "    \"slotType\": \"武器\",", "    \"add\": { \"体魄\": 2 },", "    \"percent\": { \"法力\": 10 },", "    \"effects\": [\"近身搏斗时略微提高威胁\"]", "  }", "}", "```", "", "An equipped item remains reachable through the character's exclusive `containers` graph and recursive `container.contents`; do not move it into a virtual equipment container. `slotType` must match the target slot type. `add` and `percent` are safe-integer maps over existing character attributes; `effects` are narrative only. Use the equipment management capability to preview, equip, replace, unequip, or refresh the projection.", "", "`item.type` uses one of `equipment` / `material` / `consumable` / `special` / `other`. Quantity is stored on the containing container.contents[*].count, not on the item itself.", "", "`localId` may be Chinese, but must not contain path separators, colon, NUL, empty path segments, `.`, or `..`."]),
  },
  { path: "save/scenes/README.md", content: SCENES_README_MD },
  { path: "save/relationships/README.md", content: RELATIONSHIPS_README_MD },
  {
    path: "save/playthrough/README.md",
    content: text(["# Playthrough 回合运行时", "", "本目录存放存档级运行时变量、player 设置、source frontier、setup 摘要与 branch 摘要。", "", "- `runtime.json`：高频访问、玩家面向或前端管理的摘要，含 `worldTime`（当前世界/剧情时间字符串，未知时为空）、`plotOrder`（数字，单调递增，表示玩家当前走到哪个 source order；场记每回合维护，前端用于判断是否触发 frontier 推进）、`weather`、`location`（当前地点 `{ ref, name } | null`）、`activeSceneRefs`（当前活跃场景指针数组，每项 `{ ref, name }`）、`protagonistRef`（主角指针 `{ ref, name } | null`）；也可通过 `extensions` 承载新增/临时的玩家可见运行时字段，例如月相、倒计时或诅咒周期。旧字段 `activeSceneIds`/`activeScene`/`player`/`inventory`/`status` 已废弃。", "- `player.json`：玩家 persona/视角设置。", "- `frontier.json`：源文本抽取/阅读进度与时间标记锚点。含 `sourceWindow`（已读章节窗口）、`extractedThrough`（已抽取到的最远源章节引用）、`timeline`（时间标记锚点数组，锚点用 `kind` 区分 `source`/`player`，均含 `order` 单调递增整数线性坐标；source 锚点 `{ kind, order, chapter, time, label }`，player 锚点 `{ kind, order, turn, time, label, alignment, sourceRef }`）、`notes`。", "- `understanding-summary.json`：开局理解摘要。", "- `setup-summary.json`：游玩设定对话完成信号；`enteredPlay` 由前端在玩家点击进入故事后置为 `true`，用于重开存档时恢复主游玩界面。", "- `branch.json`：玩家创建的分支摘要，不是源文本的重写。", "", "开局 assistant 回复写入 `save/history/turns/turn-000000.json`，并同步 seed 到玩家正式回合入口 Agent 的 `save/agents/<playerTurnAgent>/context.json`。", "", "纯前端 view state（活跃标签、滚动位置、折叠面板、瞬时过滤、悬停状态）默认不应存这里。"]),
  },
  { path: "save/playthrough/runtime.json", content: json({ turn: 0, worldTime: "", plotOrder: 1, location: null, weather: "", activeSceneRefs: [], protagonistRef: null, extensions: {}, updatedAtTurn: 0, updatedBy: null }) },
  { path: "save/playthrough/player.json", content: json({ viewpoint: null, character: null, preferences: {} }) },
  { path: "save/playthrough/frontier.json", content: json({ sourceWindow: { start: null, end: null }, extractedThrough: null, timeline: [{ kind: "source", order: 1, chapter: 1, time: "元年", label: "开局" }], notes: "Track how far the imported source has been normalized, chunked, and extracted." }) },
  { path: "save/playthrough/understanding-summary.json", content: json({ status: "pending", title: null, candidateCharacters: [] }) },
  { path: "save/playthrough/setup-summary.json", content: json({ status: "pending", summary: null }) },
  { path: "save/playthrough/branch.json", content: json({ summary: "", divergenceLevel: "none", importantEvents: [] }) },
  {
    path: WORKSPACE_MANIFEST_PATH,
    content: json({
      version: "0.0.0",
      workspaceVersion: DEFAULT_WORKSPACE_VERSION,
      contentModel: { fileContent: "text", binaryContent: false, cardContentRoot: "/", activeSaveRoot: "save/" },
      platformMetadata: { path: ".tsian/", ordinaryWorkspaceVisible: false },
    }),
  },
  { path: ".tsian/README.md", content: text(["# Tsian Platform Metadata", "", "Files under `.tsian/` are owned by the platform for this save slot. They are hidden from ordinary Agent, Skill, and frontend workspace APIs."]) },
]
