import formalSchemaGuide from "../../../../../../cards/沉浸阅读器.tsian-card/workspace/docs/novel-airp-schema-guide.md?raw"
import formalSchemaReference from "../../../../../../cards/沉浸阅读器.tsian-card/workspace/docs/novel-airp-schema-reference.md?raw"
import { text } from "../utils"

export const SCENES_README_MD = text([
  "# Scenes",
  "",
  "一场景一文件，存于 `save/scenes/<localId>.json`。场景是派生导航视图，记录“当前局面有谁、在哪”，不是实体副本。entity 文件是实体权威；scene 的 `present` 摘要从实体派生，丢了可重建，不要反向当作第二权威。",
  "",
  "字段：",
  "",
  "- `id`：场景 id，`scene:<localId>`。",
  "- `name`：场景名。",
  "- `location`：`{ ref, name }`，指向地点实体。",
  "- `present`：在场实体指针数组，每项仅 `{ ref }`（指向 `save/entities/<type>/<localId>.json`）。名称、简介、状态等展示信息一律回读实体权威，不在 scene 里冗余。",
  "- `status`：`active` / `background` / `resolved`。",
  "- `updatedTurn` / `updatedBy`：维护锚点。",
  "",
  "场记在场景变动时刷新涉及的场景文件。resolved 场景不删，剧情可回溯。",
])

export const RELATIONSHIPS_README_MD = text([
  "# Relationships",
  "",
  "一角色 subject 一文件，存于 `save/relationships/<scope>.json`。`<scope>` = subject 的 character scope，如 `character-萧玄`。",
  "",
  "本目录只承载人物/社交/阵营关系，不是泛实体图谱。`subject` 与 `edges[].to` 当前均必须使用 `character:<localId>`。地点、组织、物品、场景、事件、尸体/线索、概念等非角色关联不要写入 relationships；放到对应固定字段、已有 ref 结构或 `extensions.render=\"ref\"`，直到统一引用体系被正式设计。",
  "",
  "字段：",
  "",
  "- `subject`：主体角色实体 id，`character:<localId>`。",
  "- `edges`：角色关系条目数组，每项 `{ to, type, since?, until?, note? }`；`to` 也必须是 `character:<localId>`。",
  "- `updatedTurn` / `updatedBy`：维护锚点。",
  "",
  "双向角色关系两边各写一条；刻意单向的认知/隐瞒/单方面态度可只写主体侧。关系分片是导航视图，不是实体权威。",
])

export const NOVEL_AIRP_SCHEMA_GUIDE_MD = formalSchemaGuide

export const NOVEL_AIRP_SCHEMA_REFERENCE_MD = formalSchemaReference
