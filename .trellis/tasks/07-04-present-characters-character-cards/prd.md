# 在场人物与角色卡

## Goal

扩展状态栏体验，支持在角色全屏视图中查看当前场景在场人物，并切换查看角色卡。角色卡采用 RPG 面板式 UI：左侧人物列表，右侧角色详情；角色详情使用标签页组织概况、属性、背包等区域，而不是状态栏式的长滚动列表。

## Confirmed UI/UX Decisions

### D1: 任务范围划分

- 本任务实现：在场人物列表、角色卡全屏视图、角色固定字段渲染、extensions 槽位、角色形象占位。
- 背包/容器/物品详情只在角色卡中预留标签页入口，具体内容由 `07-04-containers-inventory-item-details` 子任务实现。
- 角色形象图片上传/持久化推迟到后续任务；MVP 只做大图区域和首字占位。

### D2: 角色卡视图形态

- 角色卡是全屏视图，作为右侧 nav 的“角色”视图，不做侧边抽屉或中央模态。
- 通过右侧 nav 的“故事”视图返回剧情流，不在角色卡顶部额外加“返回故事”按钮。
- 状态栏头像点击进入角色视图；角色视图默认选中当前玩家角色。

### D3: 整体布局

- 左侧：当前场景在场人物列表。数据来源是 `runtime.activeSceneRefs` / 当前场景引用 → `save/scenes/<localId>.json` 的 `present` refs。
- 方向上 `scene.present` 应只保存人物 ref，不复制人物 `name` / `brief` / `status` 摘要，避免与 entity 双源。
- 右侧：选中人物的角色详情面板；人物名称、简介、状态、外貌、目标等信息从 character entity 读取。
- 左侧列表可切换人物，右侧详情随选中项更新。
- 可在左侧列表下方预留“全部已知 / 相关人物”区域，但 MVP 可先只展示当前在场人物。

### D4: 标签页组织

角色详情面板采用少量 RPG 标签页：

1. **概况**：固定大角色形象区 + 右侧档案式信息，包括 name/brief/aliases、身份锚点、境界/层级、当前形象、当前状态、关系、意图与目标、背景摘记。
2. **属性**：跨世界观基础维度，例如体魄、悟性、气运、根骨、法力、魅力；以普通健康成年人、无超自然力量、常规训练水平 = 5 为基准，不预设上限。
3. **背包**：预留占位，后续容器/物品任务填充。

后续装备系统视复杂度决定与“属性”合并还是新增独立标签页；本任务不实现装备页。

### D5: 状态视觉语义

- 不再围绕 `status.level` 设计 UI。`level` 暗含严重程度，偏负面，不适合正面/中性状态。
- Schema 已切到 `status.polarity ∈ positive | negative | neutral`（见
  `07-05-runtime-scene-character-schema-ui-align`）；status item 形状为
  `{ id, name?, description?, polarity? }`。
- UI 以“状态倾向”设计视觉效果：positive / negative / neutral，直接读 `entity.status[*].polarity`。
- UI 不显示内部字段值，不裸露 `minor/severe` 等枚举。
- 关联人物 UI 不显示 raw id，只显示名字与摘要；ref 只作为内部跳转依据。

### D6: 角色形象

- 概况标签页左侧放较大的角色形象区，目标是 RPG 立绘/档案主视觉感。
- MVP 无图片时使用首字占位 + 暗色仪式风边框/微光。
- 图片上传/持久化不在本任务实现。现有 `tsian.workspace.write` 只接受 string，二进制上传需要后续专门设计 platform action 或扩展 bridge。

### D7: 属性页方向

- 属性页不采用传统游戏 HP/MP/蓝条式面板，也不把世界观文本字段表格化。
- 属性页展示跨世界观基础维度：体魄、悟性、气运、根骨、法力、魅力
  （对应 `entity.attributes.{physique, insight, fortune, constitution, mana, charisma}`，
  见 `07-05-runtime-scene-character-schema-ui-align`）。
- 基准：普通健康成年人、无超自然力量、常规训练水平 = 5。
- 基准值只进入规则/Agent 语义，不在 UI 中解释。玩家主要通过同世界观角色之间的数字高低进行比较。
- 境界/层级更像身份与世界观阶位，放在概况页身份锚点中（`entity.identity` 的
  `age/gender/race/class/title`），不作为基础属性。
- 功法、神通、技能、装备等更像可持有/可配置能力或装备体系，后续视复杂度放入背包/装备/能力页，不放基础属性页。
- 特殊量表读 `entity.gauges.{hp,mp,sp,hunger,stamina}`（`{value, max?, min?, unit?}`），
  不是默认必须显示的 HP/MP，而是可选的进度/资源/机制条，由剧情和世界观自由设定。

### D8: Schema 演进后的渲染扩展与状态栏钉选

- 角色卡是实体信息的主展示面。schema 演进后的新字段优先进入角色卡对应标签页/区域，而不是自动进入左侧状态栏。
- 同一份渲染控制字段在不同 UI 表面可有不同解释：角色卡使用完整/详细渲染，状态栏使用紧凑/钉选渲染，injection 使用文本去结构化渲染。`render` / `slot` / `polarity` 是语义提示，不是绑定某个组件外观的硬 UI 指令。
- 左侧状态栏不由 Agent 自动决定展示哪些角色字段，避免状态栏随 schema 演进越来越臃肿。
- 左侧状态栏采用用户钉选机制：用户从角色卡中的字段/状态/基础维度/特殊量表中选择少量项目显示到左侧状态栏。
- 默认显示主角/当前视角角色的钉选字段；未配置时只显示最小主角入口与 runtime 世界变量。
- 钉选配置属于前端显示偏好，默认存 localStorage，不写入 workspace，不成为剧情权威数据。
- 钉选配置只保存字段引用/路径，不保存字段快照；状态栏渲染时重新从 entity 读取当前值，避免双源。

## Requirements

- R1: 基于 runtime 当前场景引用与 `save/scenes/<localId>.json` 的 `present` refs 展示当前在场人物。
  运行时读 `runtime.activeSceneRefs[*].ref`（不是旧的 `activeSceneIds` / `activeScene`）。
- R2: 角色视图左侧显示在场人物列表，点击人物 ref 后读取对应 character entity 并展示右侧角色卡。
- R3: 角色卡固定渲染 `name`、`brief`、`aliases`、`identity`（age/gender/race/class/title）、`appearance`、
  `attributes`（体魄/悟性/气运/根骨/法力/魅力）、`gauges`（hp/mp/sp/hunger/stamina）、`status`、`sections`。
- R4: 角色卡支持 `extensions`，并按渲染类型进入数值区、状态/标签区、关联区、详情区等预留槽位。
- R5: `name` 是主显示名；aliases 仅作为替代称呼显示。
- R6: 读取失败或实体缺失时，用 ref/localId 降级展示；不要依赖 scene.present 中的人物摘要。
- R7: 角色卡采用少量标签页：概况 / 属性 / 背包。
- R8: 状态 UI 不展示内部枚举值；正/负/中状态通过 `status.polarity` 用视觉差异表达。
- R9: 关联 UI 不展示裸 ref/id，只显示可读名称和摘要。
- R10: 背包标签页只做占位，不实现容器/物品详情。
- R11: 角色形象只做占位，不实现上传持久化。
- R12: 场景在场人物应按 ref 解析实体；UI 不引入 name/brief/status 的第二权威摘要。
- R13: 属性页展示基础维度 `entity.attributes`，避免把功法/神通/境界/装备混入基础属性；
  特殊量表 `entity.gauges` 作为可选机制条展示。
- R14: 玩家角色入口读 `runtime.protagonistRef.ref`（不是旧 `runtime.player.character.ref`）。

## Acceptance Criteria

- [ ] 当前场景有 `present` 时，角色视图左侧能显示在场人物列表。
- [ ] 点击在场人物可切换右侧角色详情。
- [ ] 状态栏头像点击可进入角色视图，并默认选中玩家角色。
- [ ] 角色卡概况页包含固定大角色形象区域、name、brief、aliases、身份锚点、当前形象、当前状态、关系、意图与目标、背景摘记。
- [ ] 角色卡属性页能展示体魄、悟性、气运、根骨、法力、魅力等基础维度；UI 只显示数值高低，不向玩家解释基准。
- [ ] 角色卡背包页显示占位，明确由容器/物品任务填充。
- [ ] 角色卡能展示固定字段和至少一种动态扩展字段。
- [ ] 动态扩展字段不会堆到单一“其它”区域，而是按 render 类型进入对应区域。
- [ ] 状态默认显示状态名称，详情通过点击/展开显示；不显示 `level` / `minor` / `severe` 等内部字段值。
- [ ] 关联人物不显示 raw id/ref，也不显示当前态度；只显示结构性关系/关联摘要。
- [ ] 当前场景在场人物列表通过 present refs 读取 entity 展示，不依赖 scene.present 中的 name/brief/status 摘要。
- [ ] 缺失实体、读取失败、空 present 均有降级展示。
- [ ] 通过 `npm run build --workspace play-frontend-dev`。

## Out of Scope

- 角色图片上传与二进制持久化。
- 背包/容器/物品详情。
- 装备页。
- 修改 runtime-summary-injection。

## Dependencies

- 依赖 `.trellis/tasks/07-04-renderable-runtime-entity-schema`（已归档）。
- 依赖 `.trellis/tasks/07-04-frontend-runtime-render-infra`（已归档）。
- 依赖 `.trellis/tasks/07-04-left-status-bar-mvp`（已归档，已提供角色视图入口）。
- 依赖 `.trellis/tasks/07-05-runtime-scene-character-schema-ui-align`：
  runtime shape 已切到 `turn/worldTime/location/weather/activeSceneRefs/protagonistRef/extensions`；
  character schema 已固定为 `identity/appearance/attributes/gauges/status`；
  `status.polarity` 已进入 schema。本任务直接消费新 shape，不写旧兼容层。
