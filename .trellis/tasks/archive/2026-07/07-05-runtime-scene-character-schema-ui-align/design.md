# Design — runtime/scene/character schema UI 对齐

## 1. 范围与不做

本任务只做 schema/模板/前端类型/现有状态栏对齐；不实现角色卡 UI，不实现 storyteller injection，不实现钉选机制，不做旧数据兼容。

命中改动的层：

- 平台模板：`apps/platform-web/src/storage/workspace-templates.ts` 中默认 runtime 模板、scene 生成脚本、schema 指南文档、Skill 指导。
- 前端类型 / 解析层：`apps/play-frontend-dev/src/lib/runtime-types.ts` 与 `apps/play-frontend-dev/src/lib/parse-runtime.ts`。
- 现有左侧状态栏 Vue 组件：`apps/play-frontend-dev/src/components/status-bar/StatusBar*.vue`（读法调整，不做钉选）。
- 相关 Trellis 子任务 PRD 依赖更新：角色卡任务 `07-04-present-characters-character-cards`、注入任务 `07-04-runtime-summary-injection`。

不动的层：

- 前端 `runtime-types.ts` 中 `RenderPreset`、`DisplayItems`、`DisplayItem` 等扩展项分桶结构（已在 07-04-frontend-runtime-render-infra 归档时冻结，仍适用）。
- 现有角色卡预览 HTML（讨论产物），不合入。

## 2. 新 runtime schema

`save/playthrough/runtime.json` 的新形态是"当前上下文索引 + 世界变量"，不再复制主角/场景/背包摘要。

结构：

```json
{
  "turn": 6,
  "worldTime": "赤明纪十二年三月初七，黄昏",
  "location": { "ref": "location:青玄门山门", "name": "青玄门山门" },
  "weather": "薄雾未散",
  "activeSceneRefs": [{ "ref": "scene:山门冲突", "name": "山门冲突" }],
  "protagonistRef": { "ref": "character:萧玄", "name": "萧玄" },
  "extensions": {
    "月相": { "render": "text", "value": "上弦" },
    "护山阵倒计时": { "render": "number", "value": 3, "unit": "刻" }
  },
  "updatedAtTurn": 6,
  "updatedBy": "stage-manager"
}
```

字段权威说明：

- `turn`：整数，必填（沿用）。
- `worldTime`：字符串，必填；空串表示未知/未建立。
- `location`：`{ ref, name } | null`。`name` 是快照，权威在 entity。
- `weather`：字符串或缺省；简短叙事，非结构化。
- `activeSceneRefs`：`{ ref, name }` 数组；至少一个。`name` 是快照。runtime 保持"入口指针"角色，不复制场景 `present` / `status`。
- `protagonistRef`：`{ ref, name } | null`。当前视角/主角实体入口。
- `extensions`：动态世界变量的扩展槽（月相、倒计时、诅咒周期等），沿用现有 render preset 体系。
- `updatedAtTurn` / `updatedBy`：维护锚点，允许缺省。

删除字段：

- `activeSceneIds`（旧字符串数组，被 `activeSceneRefs` 替代）。
- `activeScene`（旧单场景快照）。
- `player`（`{ character, location }` 嵌套结构；`character` 提为顶层 `protagonistRef`，`location` 提为顶层 `location`）。
- `inventory` runtime 摘要。
- `status` runtime 数组（属于主角实体，不在 runtime 保存）。

`RuntimeLikeInput` 必检：`turn`(number) + `worldTime`(string) + `activeSceneRefs`(array) + `extensions`(object)。其它字段允许缺省/null。

## 3. 新 scene schema

`save/scenes/<localId>.json` 的 `present` 改为 ref-only：

```json
{
  "id": "scene:山门冲突",
  "name": "山门冲突",
  "location": { "ref": "location:青玄门山门", "name": "青玄门山门" },
  "present": [
    { "ref": "character:萧玄" },
    { "ref": "character:赵长老" }
  ],
  "status": "active",
  "updatedTurn": 0,
  "updatedBy": "world-architect"
}
```

`present` 每项只保留 `ref`，不再复制人物 `name` / `brief` / `status`。前端/injection 需要人物摘要时通过 `ref` 读 entity。

Location 保留 `{ ref, name }` 是为了避免每次读场景都要再展开一层 location entity；location `name` 是快照，权威仍在 entity。

## 4. 新 character schema

character entity 直接服务角色卡 UI。设计上仍是 JSON，字段以角色卡三个标签页 + 状态栏读取为需求驱动：

```json
{
  "id": "character:萧玄",
  "name": "萧玄",
  "brief": "青玄门外门弟子，当前卷入山门冲突。",
  "aliases": [],
  "identity": {
    "gender": "男",
    "age": "十七",
    "role": "外门弟子",
    "affiliation": "青玄门",
    "realm": "炼气后期"
  },
  "appearance": "身着青玄门外门弟子袍，衣袖被剑气割裂……",
  "status": [
    {
      "id": "injury:右臂轻伤",
      "name": "右臂轻伤",
      "description": "挥剑时略有迟滞。",
      "polarity": "negative"
    }
  ],
  "relationships": [
    { "ref": "character:玄衣少女", "summary": "山门冲突中突然出现的未知人物。" }
  ],
  "goals": {
    "current": "证明自己没有私通外敌，并从山门冲突中脱身。",
    "shortTerm": "查清禁地异动与玄衣少女出现之间的关联。",
    "longTerm": "在青玄门站稳脚跟，找出山门内暗藏的叛徒线索。"
  },
  "background": "萧玄入门时间不长，但剑法基础稳……",
  "attributes": {
    "体魄": 6,
    "悟性": 7,
    "气运": 5,
    "根骨": 6,
    "法力": 4,
    "魅力": 5
  },
  "gauges": [
    { "id": "cultivation-progress", "name": "修炼进度", "value": 24, "max": 100 },
    { "id": "mana-deficit", "name": "法力亏空", "value": 10, "max": 100, "tone": "danger" }
  ],
  "extensions": {},
  "origin": "canon",
  "sourceRefs": ["save/source/chapters/chapter-0001.md"],
  "updatedAtTurn": 6,
  "updatedBy": "stage-manager"
}
```

字段权威说明：

- 必填：`id`、`name`、`brief`（沿用）。
- `identity`：身份锚点对象；`realm` 属于身份，而不属于 attributes。
- `appearance`：当前形象描写；单段字符串。
- `status`：每项 `{ id, name, description?, polarity? }`。`polarity` = `positive | negative | neutral`，未标注时默认 `neutral`。移除旧 `level` 字段。
- `relationships`：`{ ref, summary }`；不存"当前态度"，态度由剧情读出。
- `goals`：`{ current?, shortTerm?, longTerm? }`；每项字符串。
- `background`：背景摘记字符串。
- `attributes`：六维基础维度 `{ 体魄, 悟性, 气运, 根骨, 法力, 魅力 }`。基准 5，UI 不显示基准，无上限；数值可为 null / 缺省表示未建立。
- `gauges`：可选特殊量表数组；`value` 通常 0–100 百分比，`max` 缺省 100，`tone` 沿用扩展项 tone union。用于修炼进度、腐化程度、法力亏空、理智值等；不是默认 HP/MP。
- `extensions`：动态字段扩展槽，沿用 render preset。
- 沿用：`aliases`、`visibility`、`lifecycle`、`origin`、`sourceRefs`、`tags`、`updatedAtTurn`、`updatedBy`。

Character 不再包含旧顶层 `fields` / `sections`（被 `identity` / `appearance` / `background` / `goals` 取代）。

## 5. 前端类型 / 解析对齐

`apps/play-frontend-dev/src/lib/runtime-types.ts` 的 `Runtime` 接口按新 runtime schema 重写：

```ts
export interface Runtime {
  turn: number
  worldTime: string
  location: { ref: string; name: string } | null
  weather: string
  activeSceneRefs: Array<{ ref: string; name: string }>
  protagonistRef: { ref: string; name: string } | null
  extensions: Record<string, unknown>
  updatedAtTurn: number
  updatedBy: string | null
}
```

删除旧字段：`activeSceneIds`、`activeScene`、`player`、`inventory`、`status`。

`RuntimeData` / `DisplayItems` / `DisplayItem` / render preset / category 分桶保持不变（这些属于扩展项渲染基础设施，无需触动）。

`parse-runtime.ts` 更新：

- `isRuntimeLike` 必检 `turn` / `worldTime` / `activeSceneRefs` / `extensions`。
- `parseRuntime` 只映射新字段；`activeSceneRefs` 校验为对象数组（非则视为 load-failed），逐项归一为 `{ ref, name }`。
- 移除对 `player` / `inventory` / `status` 的读取。

character/scene 侧本任务不新增强类型：状态栏当前只读 runtime 的入口 refs，不再依赖 entity 的固定类型。角色卡 UI 任务在实现时再引入 character 强类型契约。

## 6. 状态栏对齐

现有左侧状态栏 5 个子组件需按新 runtime schema 微调：

- `StatusBarScene`：读 `runtime.activeSceneRefs[0]?.name` 与 `runtime.worldTime`。若有多个活跃场景，只展示第一个；后续多场景显示留给角色卡任务。
- `StatusBarCharacter`：`character` 属性来源改为 `runtime.protagonistRef`（不是 `runtime.player.character`）。`useEntity` 调用不变。
- `StatusBarStatus`：runtime 不再存 `status`。改为读主角实体的 `status` 数组，通过 `useEntity(runtime.protagonistRef?.ref)` 获取。展示 `status[].name`，不再显示 `level`；`polarity` 影响 chip 视觉（如颜色 tone），可以先做最小映射（negative→danger tone、positive→success、neutral→muted）。`displayItems.tags`（来自 runtime.extensions）保持展示。
- `StatusBarMetrics`：仍展示 `displayItems.metrics`（runtime.extensions 里的 progress/number 项）。runtime 不再存主角 gauges；主角 gauges 属于角色卡内容，不进状态栏（后续钉选机制单独任务）。
- `StatusBarRefs`：仍展示 `displayItems.refs`（runtime.extensions 里的 ref 项）。

`App.vue` 中 `StatusBar` 的 props：从 `runtime.player.character` 改为 `runtime.protagonistRef`。

状态栏不实现"钉选机制"；钉选是后续任务，本任务不引入 localStorage 钉选配置。

## 7. Skill / 指南更新

`apps/platform-web/src/storage/workspace-templates.ts` 中：

- `NOVEL_AIRP_SCHEMA_GUIDE_MD`：runtime 示例改为新形态；scene 示例 present 改 ref-only；character 示例补 identity/appearance/status polarity/attributes 六维等区块；`权威归属`小节区分 runtime 入口指针 vs entity 内容权威。
- `NOVEL_AIRP_SCHEMA_REFERENCE_MD`：Runtime 变量小节、场景分片格式小节按新 schema 重写；实体推荐元数据示例补 identity/appearance/attributes/gauges/status.polarity，移除 `status.level` 与旧 `fields`/`sections` 示例。
- `SCENES_README_MD`：`present` 字段说明改为 ref-only；删除"每项 `{ ref, name, brief, status? }`"。
- `STAGE_MANAGER_STATUS_SKILL_MD`：runtime 维护语言改为"存高频入口指针 + world variables"；不再声称 runtime 存 player/status/inventory 摘要；补充 character status 用 `polarity` 不用 `level`。
- `WORLD_ARCHITECT_OPENING_SKILL_MD` + `_validation.js`（`OPENING_VALIDATION_JS`）：`normalizeScene` 的 `present` 归一改为 ref-only；`normalizeEntity` 不强推 status.level 示例；`commit_runtime_and_frontier` 脚本按新 runtime schema 校验（`activeSceneRefs` 替代 `activeSceneIds`，`protagonistRef` 替代 `player.character`，`location` 顶层）。
- `save/schema/current.md`（`DEFAULT_SAVE_RUNTIME_FILES` 中 `save/schema/current.md`）：更新 runtime 可读字段清单、character 字段清单、gauges/attributes 说明。

## 8. 迁移 / rollout

无旧数据兼容：本项目当前没有生产存档，`DEFAULT_WORKSPACE_VERSION` 从 12 递增到 13，触发 workspace 重建时按新模板初始化。

不写 legacy field 转换器；`parse-runtime.ts` 遇旧 shape 直接 `load-failed`，前端在开发本地清空存档重启一次即可。

## 9. 已知取舍

- **runtime.location 顶层 vs 场景内隐含**：把 `location` 提为顶层，代价是 runtime 与 scene.location 存在语义重叠。取舍：状态栏和 injection 有时需要"当前地点"而不加载 scene 文件，顶层字段更方便；`scene.location` 仍是场景语义权威。
- **runtime.weather**：暂用字符串而非引用；天气目前主要用于叙事氛围，不需要引用地点/环境 entity。后续如果出现"天气影响机制"再升级。
- **character.attributes = null vs 缺省**：允许键缺省表示"未建立"；不强制模板初始化六维（避免 spoiler 未开局就写死数值）。UI 缺失时展示"—"。
- **gauges 与 extensions 分离**：`gauges` 保留为独立字段而不是塞到 `extensions.render=progress`，因为特殊量表是角色卡主视觉，不应与扩展槽混淆。extensions 仍可放临时量表。
- **status 只在 character，不在 runtime**：这与旧 runtime.status 摘要不同；injection 任务需要保证"主角状态注入"从主角实体读，而不是 runtime。
