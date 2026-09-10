# Scenes

一场景一文件，存于 `save/scenes/<localId>.json`。场景是派生导航视图，记录“当前局面有谁、在哪”，不是实体副本。entity 文件是实体权威；scene 的 `present` 摘要从实体派生，丢了可重建，不要反向当作第二权威。

字段：

- `id`：场景 id，`scene:<localId>`。
- `name`：场景名。
- `location`：`{ ref, name }`，指向地点实体。
- `present`：在场实体指针数组，每项仅 `{ ref }`（指向 `save/entities/<type>/<localId>.json`）。名称、简介、状态等展示信息一律回读实体权威，不在 scene 里冗余。
- `status`：`active` / `background` / `resolved`。
- `updatedTurn` / `updatedBy`：维护锚点。

场记在场景变动时刷新涉及的场景文件。resolved 场景不删，剧情可回溯。
