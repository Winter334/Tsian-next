# runtime/scene/character schema UI 对齐

## Goal

根据已确认的状态栏、角色卡和 storyteller injection UI/UX 方向，先反向调整默认 novel AIRP 的 runtime / scene / character schema，再继续实现角色卡 UI。避免为了兼容当前临时 schema 写复杂兼容层，也避免 runtime、scene、entity 之间复制摘要形成双源。

## Background

角色卡 UI 讨论后确认：先设计 UI，再反推 schema。当前旧方向把 `runtime.json` 视为状态栏数据面、`scene.present` 存人物摘要、character `status.level` 暗含负面严重程度，这些都会妨碍新 UI：

- runtime 不应复制主角/场景/背包摘要，而应作为当前上下文索引和世界变量载体。
- scene 不应复制在场人物的 name/brief/status，而应只保存在场 refs。
- character entity 应直接服务角色卡概况、属性、状态、关系、目标等 UI。
- storyteller injection 需要按 runtime/world、active scene、protagonist 多条 message 注入，提升 prompt cache 粒度。

项目当前没有需要兼容的旧生产数据；本任务不做旧 schema 兼容。

## Confirmed Decisions

### D1: runtime 是当前上下文索引 + 世界变量

`save/playthrough/runtime.json` 保存：

- 世界变量：`worldTime`、天气/环境、当前位置/地点引用等。
- 当前入口引用：`activeSceneRefs`、`protagonistRef`。
- 少量确实属于当前世界层的运行时变量。

runtime 不保存：

- 主角 name/brief/status/goals。
- scene.present 人物摘要。
- 背包 contents 摘要。
- NPC 摘要。

### D2: scene.present ref-only

`save/scenes/<localId>.json` 的 `present` 方向为 ref-only：

```json
"present": [
  { "ref": "character:萧玄" },
  { "ref": "character:赵长老" }
]
```

或等价 ref 数组。scene 不复制人物 `name` / `brief` / `status`。

### D3: character entity 服务角色卡 UI

character entity 应支持角色卡：

- identity / profile：性别、年龄、身份、所属、境界/层级等身份锚点。
- appearance：当前外貌/形象描写。
- status：状态名称 + 可选详情 + polarity（positive / negative / neutral）。不再使用 `level`。
- relationships：结构性关系/关联摘要，不存当前态度。
- goals：当前 / 短期 / 长期目标。
- attributes：六维基础维度（体魄、悟性、气运、根骨、法力、魅力）。
- gauges：可选特殊量表/进度/资源条，如修炼进度、理智值、腐化程度、法力亏空百分比。
- extensions：schema 演进字段，提供 render/slot/polarity 等语义提示。

### D4: 基础维度规则

默认基础维度：

- 体魄
- 悟性
- 气运
- 根骨
- 法力
- 魅力

规则基准：普通健康成年人、无超自然力量、常规训练水平 = 5。

该基准是给 Agent / 规则文件 / 行动裁定使用的，不在 UI 中解释。UI 只显示数字，玩家通过同世界观角色之间的高低进行比较。不预设上限；数值随剧情和世界观表现调整。

### D5: 境界/功法/神通/装备不属于基础属性

- 境界/层级更像身份和世界观阶位，放概况页身份锚点，不作为六维属性。
- 功法、神通、技能、装备更像可持有/可配置能力或装备体系，后续视复杂度进入背包/装备/能力页，不放基础属性页。

### D6: 渲染控制字段是语义提示，不是组件指令

同一份 render/slot/polarity 在不同 UI 表面可以有不同解释：

- 角色卡：完整/详细渲染。
- 左侧状态栏：用户钉选后的紧凑渲染。
- Injection：去结构化文本渲染。

动态字段提供足够语义提示，但不自动进入左侧状态栏。状态栏显示由用户从角色卡钉选字段决定，钉选配置存 localStorage，保存字段引用/路径，不保存字段值。

### D7: storyteller injection 多消息分块

后续 injection 应拆成多条 message：runtime/world block、active scene block、protagonist block。这样 scene 变化不导致 protagonist block cache 失效，主角变化也不导致 runtime block cache 失效。

## Requirements

- R1: 更新默认 runtime schema/template：明确 `activeSceneRefs`、`protagonistRef`、world variables；移除/避免摘要复制字段。
- R2: 更新默认 scene schema/template：`present` 改为 ref-only，不包含人物 name/brief/status 摘要。
- R3: 更新默认 character schema/template/guide：支持 identity/profile、appearance、status name/description/polarity、relationships、goals、attributes 六维、gauges、extensions。
- R4: 移除或废弃 `status.level` 指导，改为状态 polarity。
- R5: 更新默认卡 schema guide / reference / Agent-local Skill 指导，确保场记和世界架构师按新 schema 写数据。
- R6: 更新前端 runtime 类型与解析逻辑，直接按新 schema，不做旧字段兼容。
- R7: 更新已实现的左侧状态栏数据读取逻辑，使其从 runtime refs + entity 读取主角信息，而不是依赖 runtime 摘要。
- R8: 更新当前角色卡任务 PRD 依赖，明确角色卡 UI 依赖本任务完成。
- R9: 更新 runtime injection 任务 PRD 方向为多消息 current context injection。
- R10: 不实现角色卡 UI；只完成 schema/template/类型/现有状态栏对齐。

## Acceptance Criteria

- [ ] 默认 `save/playthrough/runtime.json` 模板体现当前上下文索引：world variables + `activeSceneRefs` + `protagonistRef`。
- [ ] 默认 scene 示例/脚本产物的 `present` 不再复制人物 name/brief/status。
- [ ] 默认 character schema 文档包含 identity/profile、appearance、status polarity、relationships、goals、attributes 六维、gauges。
- [ ] `status.level` 不再作为默认推荐字段出现在新模板/指南中。
- [ ] 前端 `Runtime` 类型和 `parseRuntime` 与新 runtime schema 对齐。
- [ ] 左侧状态栏仍能构建通过，并按新 schema 读取主角入口/状态信息。
- [ ] 相关 Trellis 子任务 PRD 已更新依赖和方向。
- [ ] 通过 `npm run build --workspace play-frontend-dev`。
- [ ] 若修改 platform template，运行 `npm run build:web`。

## Out of Scope

- 不实现角色卡全屏 UI。
- 不实现状态栏钉选机制。
- 不实现 storyteller injection。
- 不实现角色图片上传/二进制存储。
- 不兼容旧 schema / 旧存档。

## Dependencies

- 依赖 UI 设计讨论已确认的新方向。
- 是 `07-04-present-characters-character-cards` 的前置任务。
