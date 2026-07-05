# 当前上下文多消息注入 storyteller

## Goal

让前端在玩家发送行动前，基于 `runtime.json` 当前上下文索引，分别读取 runtime/world、当前场景、主角/当前视角角色，并编译成多条 storyteller 友好的 injection message，减少 storyteller 每轮自行读取高频上下文的成本，同时避免摘要双源和 prompt cache 粒度过粗。

## Background / Direction

最新父任务方向：`runtime.json` 是当前上下文索引与世界变量载体，不再复制 scene/entity 摘要。UI 和 injection 都是派生投影：需要显示或注入时读取权威文件并格式化。

Injection 也不应把 runtime + scene + protagonist 拼成一条大消息。为了减少 LLM prompt cache 失效范围，应按信息块拆成多条 injection message：runtime/world 一条、active scene 一条、protagonist 一条。

## Requirements

- R1: 使用 `runtime.json` 作为当前上下文索引，读取其中的世界变量、`activeSceneRefs` / 当前场景引用、`protagonistRef` / 当前视角角色引用。
  （对应 `07-05-runtime-scene-character-schema-ui-align` 定义的新 runtime shape：
  `turn/worldTime/location/weather/activeSceneRefs/protagonistRef/extensions`；不再读旧的
  `activeSceneIds` / `runtime.player.character`。）
- R2: 生成多条 injection message，而不是一条大 runtime 摘要；每条 message 对应一个稳定信息块。
- R3: runtime/world block 包含剧情内时间（`worldTime`）、天气/环境（`weather`）、地点/位置（`location.{ref,name}`）、当前 scene refs（`activeSceneRefs[*]`）、protagonist ref（`protagonistRef`）等世界变量与入口引用。
- R4: active scene block 读取当前场景文件（`save/scenes/<localId>.json`）并去结构化为 storyteller 可读文本；只展开一层场景文件，不递归展开 `present` 中的人物或其它 refs。
- R5: protagonist block 读取主角/当前视角角色实体，并去结构化为 storyteller 可读文本；包含 name/brief、
  `identity`（age/gender/race/class/title）、`appearance`、`attributes`（体魄/悟性/气运/根骨/法力/魅力）、
  `gauges`（hp/mp/sp/hunger/stamina）、`status`（含 polarity）、goals 等叙事高频信息。
- R6: 不把 injection 当成权威数据或缓存文件；它是发送前从 workspace 权威文件派生的临时上下文。
- R7: 不承担 schema 维护或剧情推理。上下文健康度分两类：
  - ref 缺省（`activeSceneRefs=[]` / `protagonistRef=null`）→ 跳过该 block，不阻断发送。
  - ref 存在但对应文件缺失、JSON 解析失败或读取抛错 → 阻断本轮发送并在 UI 提示原因，
    避免以缺失关键上下文的方式喂给 storyteller，导致核心流程弱化或输出退化。
  - runtime.json 未就绪 → 阻断发送（与 ref 加载失败等价）。
- R8: storyteller 如果仍缺信息，应使用 workspace 工具读取更多实体/关系，或 call 资料员；前端注入器不递归替 storyteller 做资料员工作。
- R9: 可配置或可关闭，避免在不需要时额外污染 storyteller 上下文。

## Acceptance Criteria

- [x] 发送玩家行动时可附带多条 current context injection messages。
- [x] 至少生成 runtime/world block；当 ref 存在且读取成功时生成 active scene block 和 protagonist block。
- [x] active scene block 不递归展开 scene.present / refs 指向的实体详情。
- [x] protagonist block 使用角色实体权威信息，不复制 runtime 摘要。
- [x] injection 内容为 storyteller 友好文本，不是原始冗余 JSON。
- [x] ref 缺省时对应 block 跳过，不阻断发送；ref 存在但 load 失败或 runtime 未就绪时阻断发送并在 UI 提示。
- [x] 不改变 runtime/entity/scene 数据，不承担维护职责。
- [x] 通过 `npm run build --workspace play-frontend-dev`。

## Dependencies

- 依赖 `.trellis/tasks/07-04-frontend-runtime-render-infra`。
- 依赖 `.trellis/tasks/07-05-runtime-scene-character-schema-ui-align`：
  runtime 当前上下文索引字段固定为 `worldTime/weather/location/activeSceneRefs/protagonistRef`；
  character entity 固定 schema 为 `identity/appearance/attributes/gauges/status`（含 polarity）。
- 建议在角色卡 UI 与 runtime 索引口径稳定后实施。
