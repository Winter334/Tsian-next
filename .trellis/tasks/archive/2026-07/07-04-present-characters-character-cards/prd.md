# 在场人物与角色卡

## Goal

扩展状态栏体验，支持在角色全屏视图中查看当前场景在场人物，并切换查看角色卡。角色卡采用 RPG 面板式 UI：左侧人物列表，右侧角色详情；角色详情使用标签页组织概况、属性、背包等区域，而不是状态栏式的长滚动列表。

## User Value

- 玩家可以集中查看当前场景中所有在场人物，快速切换关注点。
- 玩家可以通过 RPG 面板式角色卡了解主角与 NPC 的身份、形象、状态、关系、目标、背景、属性等档案信息，不必从长对话历史里回忆。
- 角色卡是实体信息的主展示面，schema 演进后的新字段优先进入角色卡，而不是自动塞进状态栏。
- 为后续背包/容器/物品详情任务预留入口。

## Confirmed UI/UX Decisions

### D1: 任务范围划分

- 本任务实现：在场人物列表、角色卡全屏视图、角色固定字段渲染、extensions 槽位、角色形象占位、character schema 微调。
- 背包/容器/物品详情只在角色卡中预留标签页入口，具体内容由 `07-04-containers-inventory-item-details` 子任务实现。
- 角色形象图片上传/持久化推迟到后续任务；MVP 只做大图区域和首字占位。
- 状态栏钉选机制不在本任务实现（PRD 仅描述方向，实现留给后续任务）。

### D2: 角色卡视图形态

- 角色卡是全屏视图，作为右侧 nav 的"角色"视图，不做侧边抽屉或中央模态。
- 通过右侧 nav 的"故事"视图返回剧情流，不在角色卡顶部额外加"返回故事"按钮。
- 状态栏头像点击进入角色视图；角色视图默认选中当前玩家角色（`runtime.protagonistRef`）。

### D3: 整体布局

- 左侧：当前场景在场人物列表。数据来源是 `runtime.activeSceneRefs[*].ref` → `save/scenes/<localId>.json` 的 `present` refs（每项 `{ ref }`）。
- `scene.present` 只保存人物 ref，不复制人物 `name`/`brief`/`status` 摘要，避免与 entity 双源。
- 右侧：选中人物的角色详情面板；人物名称、简介、状态、外貌、目标等信息从 character entity 读取。
- 左侧列表可切换人物，右侧详情随选中项更新。
- 左侧列表下方预留"关联人物"区域，展示 `save/relationships/character-<localId>.json` 中出现但不在场的人物（MVP 可实现，若实现成本低）。

### D4: 标签页组织

角色详情面板采用少量 RPG 标签页（参考 `.trellis/tasks/07-04-present-characters-character-cards/research/preview-character-card.html`）：

1. **概况**：固定大角色形象区 + 右侧档案式信息，分区显示身份锚点、当前形象、当前状态 chips、关系、意图与目标、背景摘记。
2. **属性**：六维基础维度卡片（体魄/悟性/气运/根骨/法力/魅力）+ 可选特殊量表条。
3. **背包**：预留占位，后续容器/物品任务填充。

后续装备系统视复杂度决定与"属性"合并还是新增独立标签页；本任务不实现装备页。

### D5: 状态视觉语义

- 不再围绕 `status.level` 设计 UI。`level` 暗含严重程度，偏负面，不适合正面/中性状态。
- Schema 已切到 `status.polarity ∈ positive | negative | neutral`；status item 形状为 `{ id, name?, description?, polarity? }`。
- UI 以"状态倾向"设计视觉效果：positive / negative / neutral，直接读 `entity.status[*].polarity`。
- UI 不显示内部字段值，不裸露 `minor/severe` 等枚举。
- 状态默认显示 `name`，`description` 通过 title/tooltip 或后续点击展开显示。
- 关联人物 UI 不显示 raw id，只显示名字与摘要；ref 只作为内部跳转依据。

### D6: 角色形象

- 概况标签页左侧放较大的角色形象区（参考预览 HTML 的 `portrait-column`，3:4.15 比例），目标是 RPG 立绘/档案主视觉感。
- MVP 无图片时使用首字占位 + 暗色仪式风边框/微光（参考预览 HTML 的 `portrait-glyph`）。
- 图片上传/持久化不在本任务实现。现有 `tsian.workspace.write` 只接受 string，二进制上传需要后续专门设计 platform action 或扩展 bridge。

### D7: 属性页方向

- 属性页不采用传统游戏 HP/MP/蓝条式面板，也不把世界观文本字段表格化。
- 属性页展示跨世界观基础维度：体魄、悟性、气运、根骨、法力、魅力（对应 `entity.attributes` 中文键，基线 5，UI 不显示基线）。
- 基准值只进入规则/Agent 语义，不在 UI 中解释。玩家主要通过同世界观角色之间的数字高低进行比较。
- 境界/层级属于身份锚点（`entity.identity.realm`），不作为基础属性。
- 功法、神通、技能、装备等后续视复杂度放入背包/装备/能力页，不放基础属性页。
- 特殊量表读 `entity.gauges`（数组形态，见 D9），不是默认必须显示的 HP/MP，而是可选的进度/资源/机制条，由剧情和世界观自由设定（如修炼进度、腐化程度、法力亏空、理智值）。

### D8: Schema 演进后的渲染扩展与状态栏钉选（方向，不在本任务实现）

- 角色卡是实体信息的主展示面。schema 演进后的新字段优先进入角色卡对应标签页/区域，而不是自动进入左侧状态栏。
- 同一份渲染控制字段在不同 UI 表面可有不同解释：角色卡使用完整/详细渲染，状态栏使用紧凑/钉选渲染，injection 使用文本去结构化渲染。`render` / `slot` / `polarity` 是语义提示，不是绑定某个组件外观的硬 UI 指令。
- 左侧状态栏不由 Agent 自动决定展示哪些角色字段，避免状态栏随 schema 演进越来越臃肿。
- 左侧状态栏采用用户钉选机制：用户从角色卡中的字段/状态/基础维度/特殊量表中选择少量项目显示到左侧状态栏。
- 默认显示主角/当前视角角色的钉选字段；未配置时只显示最小主角入口与 runtime 世界变量。
- 钉选配置属于前端显示偏好，默认存 localStorage，不写入 workspace，不成为剧情权威数据。
- 钉选配置只保存字段引用/路径，不保存字段快照；状态栏渲染时重新从 entity 读取当前值，避免双源。

### D9: character schema 微调（本任务前置）

schema 对齐任务 `07-05-runtime-scene-character-schema-ui-align` 已落地 character 字段，但与本任务预览 HTML 之间有几处偏差，需要在本任务中顺手修正 platform-web 模板与 guide 文档，使 character entity 真正服务角色卡 UI：

- **`identity`**：从 `{ age, gender, race, class, title }` 改为 `{ age?, gender?, role?, affiliation?, realm? }`。
  - `role` = 身份（如"外门弟子"）。
  - `affiliation` = 所属（如"青玄门"）。
  - `realm` = 境界/世界观阶位（如"炼气后期"，修仙世界观适用；非修仙世界观可缺省）。
  - 移除 `race` / `class` / `title`（D&D 风格键名不符合本卡方向）。
- **`gauges`**：从固定 5 个 key `hp/mp/sp/hunger/stamina` 改为自由命名数组 `Array<{ id, name, value, max?, min?, unit?, tone? }>`。
  - 与预览 HTML 一致，可表达腐化值/灵脉共鸣/修炼进度等任意机制条。
  - `tone` 沿用扩展项 tone union（neutral/accent/success/warning/danger/muted）。
- **`appearance`**：从 label/value 键值对改为单段字符串（叙事描写）。
  - 预览 HTML 的"当前形象"区段是单段文字，不是键值对。
  - 与 `background` 同形态。
- **`goals`**：新增字段 `goals: { current?, shortTerm?, longTerm? }`，每项字符串。
  - 概况页"意图与目标"区段直接读。
- **`background`**：新增字段 `background: string`。
  - 概况页"背景摘记"区段直接读。
- **`relationships`**：不在 character entity 内嵌；继续走 `save/relationships/character-<localId>.json` 分片。
  - 角色卡概况页"关系"区段通过新增 `useRelationships(subjectRef)` 读取分片。
  - 避免与既有 `save/relationships/` 权威分片形成双源。
  - UI 从分片的 `edges[*]` 取 `{ to, type, note? }`，再按 `to` ref 读取对方 entity 的 `name`/`brief` 摘要（不存快照）。

## Requirements

### 角色卡 UI

- R1: 基于 `runtime.activeSceneRefs[*].ref` → `save/scenes/<localId>.json` 的 `present` refs（每项 `{ ref }`）展示当前在场人物列表。
- R2: 角色视图左侧显示在场人物列表，点击人物 ref 后读取对应 character entity 并展示右侧角色卡。
- R3: 角色卡固定渲染 character entity 字段：`name`、`brief`、`aliases`、`identity`（age/gender/role/affiliation/realm）、`appearance`（单段字符串）、`attributes`（六维）、`gauges`（数组）、`status`、`goals`、`background`、`extensions`。
- R4: 角色卡支持 `extensions`，并按渲染类型进入数值区、状态/标签区、关联区、详情区等预留槽位。
- R5: `name` 是主显示名；aliases 仅作为替代称呼显示。
- R6: 读取失败或实体缺失时，用 ref/localId 降级展示；不要依赖 scene.present 中的人物摘要。
- R7: 角色卡采用少量标签页：概况 / 属性 / 背包。
- R8: 状态 UI 不展示内部枚举值；正/负/中状态通过 `status.polarity` 用视觉差异表达。状态默认显示 `name`，`description` 走 title/tooltip。
- R9: 关联 UI 不展示裸 ref/id，只显示可读名称和摘要。
- R10: 背包标签页只做占位，不实现容器/物品详情。
- R11: 角色形象只做占位，不实现上传持久化。
- R12: 场景在场人物应按 ref 解析实体；UI 不引入 name/brief/status 的第二权威摘要。
- R13: 属性页展示基础维度 `entity.attributes`，避免把功法/神通/境界/装备混入基础属性；特殊量表 `entity.gauges` 作为可选机制条展示。
- R14: 玩家角色入口读 `runtime.protagonistRef.ref`。
- R15: 角色卡概况页"关系"区段通过 `useRelationships(characterRef)` 读取 `save/relationships/character-<localId>.json` 分片，从 `edges[*].to` ref 读取对方 entity 的 `name`/`brief`；不显示 raw ref/id，也不显示当前态度（态度由剧情读出）。
- R16: 角色卡概况页"意图与目标"区段读 `entity.goals.{current,shortTerm,longTerm}`，按 当前/短期/长期 三行 label-text 展示；缺省项不展示该行。
- R17: 角色卡概况页"背景摘记"区段读 `entity.background`（单段字符串）；缺省时不展示该区段。
- R18: 角色卡概况页"当前形象"区段读 `entity.appearance`（单段字符串）；缺省时不展示该区段。

### schema 微调

- R19: 更新 `apps/platform-web/src/storage/workspace-templates.ts` 中 character `identity` 字段为 `{ age?, gender?, role?, affiliation?, realm? }`；移除 `race`/`class`/`title`。
- R20: 更新 `gauges` 字段为自由命名数组 `Array<{ id, name, value, max?, min?, unit?, tone? }>`；移除固定 5 key 设计。
- R21: 更新 `appearance` 字段为单段字符串（不再是 label/value 键值对）。
- R22: 新增 `goals: { current?, shortTerm?, longTerm? }` 与 `background: string` 字段到 character entity 推荐字段、guide、reference、current.md。
- R23: 不在 character entity 内嵌 `relationships`；继续走 `save/relationships/<scope>.json` 分片。

### 验证

- R24: 通过 `npm run build --workspace play-frontend-dev`。
- R25: 若修改 platform template（R19–R22 必然触发），运行 `npm run build:web`。

## Acceptance Criteria

- [ ] 当前场景有 `present` 时，角色视图左侧能显示在场人物列表。
- [ ] 点击在场人物可切换右侧角色详情。
- [ ] 状态栏头像点击可进入角色视图，并默认选中玩家角色（`runtime.protagonistRef`）。
- [ ] 角色卡概况页包含固定大角色形象区域、name、brief、aliases、身份锚点（age/gender/role/affiliation/realm）、当前形象（appearance 单段字符串）、当前状态 chips（polarity 视觉）、关系（从 relationships 分片读取）、意图与目标（goals 三行）、背景摘记（background）。
- [ ] 角色卡属性页能展示体魄、悟性、气运、根骨、法力、魅力等基础维度；UI 只显示数值高低，不向玩家解释基准。
- [ ] 角色卡属性页展示 `entity.gauges` 数组中存在的特殊量表条（自由命名，如腐化值/修炼进度）。
- [ ] 角色卡背包页显示占位，明确由容器/物品任务填充。
- [ ] 角色卡能展示固定字段和至少一种动态扩展字段（extensions）。
- [ ] 动态扩展字段不会堆到单一"其它"区域，而是按 render 类型进入对应区域。
- [ ] 状态默认显示状态名称，详情通过 title/tooltip 显示；不显示 `level` / `minor` / `severe` 等内部字段值。
- [ ] 关系区段不显示 raw id/ref，也不显示当前态度；只显示结构性关系/关联摘要。
- [ ] 当前场景在场人物列表通过 present refs 读取 entity 展示，不依赖 scene.present 中的 name/brief/status 摘要。
- [ ] 缺失实体、读取失败、空 present 均有降级展示。
- [ ] character entity 模板与 guide 已按 R19–R22 更新；`identity` 不再含 race/class/title；`gauges` 是数组；`appearance` 是字符串；含 `goals` 与 `background`。
- [ ] 通过 `npm run build --workspace play-frontend-dev`。
- [ ] 通过 `npm run build:web`。

## Out of Scope

- 角色图片上传与二进制持久化。
- 背包/容器/物品详情。
- 装备页。
- 状态栏钉选机制（D8 仅描述方向）。
- 修改 runtime-summary-injection。
- 修改 runtime / scene schema（已在 07-05-runtime-scene-character-schema-ui-align 完成）。

## Dependencies

- 依赖 `.trellis/tasks/07-04-renderable-runtime-entity-schema`（已归档）。
- 依赖 `.trellis/tasks/07-04-frontend-runtime-render-infra`（已归档）。
- 依赖 `.trellis/tasks/07-04-left-status-bar-mvp`（已归档，已提供角色视图入口）。
- 依赖 `.trellis/tasks/07-05-runtime-scene-character-schema-ui-align`（已归档）：
  - runtime shape 已切到 `turn/worldTime/location/weather/activeSceneRefs/protagonistRef/extensions`。
  - `scene.present` 已 ref-only。
  - `status.polarity` 已进入 schema。
  - character `identity/appearance/attributes/gauges/status` 已落地（本任务微调 identity/gauges/appearance 形态并补 goals/background）。
- 依赖 `.trellis/tasks/07-04-present-characters-character-cards/research/preview-character-card.html`（视觉与结构参考）。

## Open Questions

无（所有规划期决策已在 D1–D9 + R1–R25 中固化）。
