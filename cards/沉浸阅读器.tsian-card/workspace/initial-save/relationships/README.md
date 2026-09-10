# Relationships

一角色 subject 一文件，存于 `save/relationships/<scope>.json`。`<scope>` = subject 的 character scope，如 `character-萧玄`。

本目录只承载人物/社交/阵营关系，不是泛实体图谱。`subject` 与 `edges[].to` 当前均必须使用 `character:<localId>`。地点、组织、物品、场景、事件、尸体/线索、概念等非角色关联不要写入 relationships；放到对应固定字段、已有 ref 结构或 `extensions.render="ref"`，直到统一引用体系被正式设计。

字段：

- `subject`：主体角色实体 id，`character:<localId>`。
- `edges`：角色关系条目数组，每项 `{ to, type, since?, until?, note? }`；`to` 也必须是 `character:<localId>`。
- `updatedTurn` / `updatedBy`：维护锚点。

双向角色关系两边各写一条；刻意单向的认知/隐瞒/单方面态度可只写主体侧。关系分片是导航视图，不是实体权威。
