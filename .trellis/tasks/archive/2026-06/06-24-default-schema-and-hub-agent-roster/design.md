# Design: 默认 AIRP schema 与 hub-and-spoke Agent 阵容

## 1. 设计依据

### 1.1 brainstorm 决策汇总

| 决策点 | 结论 |
|--------|------|
| 实体粒度 | 混合粒度：角色/NPC/功法等高频单实体更新的走一实体一文件；关系图谱/规则等强关联整体走单文件 |
| 索引层 | 不维护独立索引文件；靠数据结构的引用关系 + 语义搜索自然形成导航（cognitive folding） |
| 引用方式 | 语义查找为主，不预设严格关系网；轻量 id 锚点 + tags 做辅助聚合 |
| 理论基础 | write-manage-read 循环 + 双层记忆(raw/semantic) + 三阶段演化(storage/reflection/experience) + 语义检索 |
| narrative 去留 | 彻底移除，master 自己写正文 |
| 前端改数据 | 双路径：纯 UI 交互走 save/frontend/view-state.json；游戏世界变更走 Agent→post-processing |
| 回滚一致性 | checkpoint 含全部 workspace 文件，回滚会恢复前端直接改的数据 |

### 1.2 理论模型映射

学术参考（2023-2026）：
- **write-manage-read 循环**（*"Memory for Autonomous LLM Agents"*, 2026 综述）：三 agent 架构的正式学术命名。master=Read 消费者，retrieval=Read 执行者，post-processing=Write+Manage。
- **双层记忆 M2A**（2026）：RawMessageStore（不可变原始日志）+ SemanticMemoryStore（语义状态）。映射：`save/history/turns/` = raw 层，`save/world/`+`save/memory/` = semantic 层。
- **三阶段演化**（ACL 2026 Findings）：Storage→Reflection→Experience。映射：turns=Storage，summaries/timeline=Reflection，world 实体知识=Experience。
- **Generative Agents**（Park et al., 2023）：relevance×recency×importance 三分数检索 + reflection。AIRP 场景弱化 importance（由 master 语义判断），保留 relevance+recency。
- **CogniFold**（2026）：cognitive folding——结构从内容流自涌现，不预设。支撑「不维护独立索引、靠引用关系自然导航」的设计。

### 1.3 旧工作流时期可继承思想

存储机制（stateRecords 表）已退役，只继承数据模型思想：
- 字段元数据关系 `relation:{target,targetField,cardinality}`（轻量版：不强制，作为 schema 文档约定）
- primaryKey（实体 id = 文件名）
- additionalFields opt-in（实体文件允许扩展字段）
- schema 版本字段
- 轻量字段描述（非完整 JSON Schema）
- retrieval 原语分解 query→extract→filter→rank→relate→merge→compose（作为 retrieval agent 的行为参考，不是平台节点）

## 2. Agent 阵容设计（hub-and-spoke）

### 2.1 阵容

```
                    master (唯一对话 agent)
                   /  (决策 + 执笔写正文)
                  /    
         agent_call│ agent_call
                /     \
    retrieval      post-processing
  (省 context 的    (落盘 + 状态维护
   检索工具)         + 记忆治理)
```

- **master**：唯一对话入口，既决策又执笔。contacts=`["retrieval","post-processing"]`。
- **retrieval**：工具型，稀疏按需调用。一次 agent_call 给意图，它在自己上下文里做多步 workspace.search/read，只把精炼结论回灌。类比 Explore 子代理。
- **post-processing**：工具型，近乎每回合调用。按规范格式落盘 turn 产出 + 更新涉及实体状态 + 维护关系图谱 + 记忆治理（摘要/压缩/归档）。
- **studio-assistant**：保留，同步更新阵容描述。
- **narrative**：彻底移除。

### 2.2 调用频率不对称

| agent | 调用频率 | 触发条件 |
|-------|---------|---------|
| retrieval | 稀疏按需 | master 缺料时（新角色登场、回忆往事、查关系） |
| post-processing | 近乎每回合 | 每回合有产出要落盘、状态可能要更新 |

这决定两者 prompt 设计：retrieval 的 AGENT.md 强调「精炼、省 context、只回灌结论」；post-processing 的 AGENT.md 强调「规范格式落盘、状态维护职责、cognitive folding」。

### 2.3 不违反「检索不垄断」原则

平台不把检索锁在 retrieval 后面——master 仍可自己 workspace.search/read。retrieval 只是省 context 的封装。方向文档第 5 节原则保留，澄清 retrieval 定位。

### 2.4 agent.json / AGENT.md / SOUL.md 设计

#### master

agent.json:
- contacts: ["retrieval", "post-processing"]
- contextPaths: README.md, world/README.md, save/history/timeline.md, save/world/README.md, save/memory/summaries/current.md
- platformTools: ["agent_call", "workspace_read"]
- workspaceAccess: level 1

AGENT.md 核心指令：
- 你是唯一对话 agent，直接产出玩家面向的回复（正文）
- 需要创作资料时联系 retrieval（省你的上下文）
- 回合结束时联系 post-processing 落盘和维护状态
- 不要自己翻大量文件，把检索交给 retrieval

SOUL.md：
- 创作者身份 + 直接执笔写正文
- 联系 retrieval 获取精炼资料
- 联系 post-processing 落盘回合产出

#### retrieval

agent.json:
- contacts: ["master"]
- contextPaths: save/world/README.md, save/memory/README.md
- platformTools: ["workspace_read"]
- skills.enabled: ["entity-reader"]
- workspaceAccess: level 1

AGENT.md 核心指令：
- 你是 master 的智能检索工具，不是独立角色
- 收到检索意图后，做多步 workspace.search 找到最相关内容
- 读实体时用 read_entity（entity-reader Skill）而非裸 read——它会自动展开一层 _ref/_dir 引用，一次拿到 index.json + 直接子项
- 若 read_entity 返回里还有 _ref/_dir 标记且需要更深，再调一次 read_entity
- 只回灌精炼后的结论，不要回灌原始文件全文
- 类比：一次调用 = 一次聚焦的资料搜集，输出是「master 需要知道什么」而不是「文件里有什么」
- 语义搜索为主，沿 entity id 和 tags 锚点导航

SOUL.md：
- 检索专家，省 master 上下文
- 精炼回灌，只给结论
- 用 read_entity 读实体，一次拿一层完整数据

#### post-processing

agent.json:
- contacts: ["master"]
- contextPaths: save/world/README.md, save/history/README.md, save/memory/README.md
- platformTools: ["workspace_read", "workspace_write"]
- workspaceAccess: level 1

AGENT.md 核心指令：
- 你是 master 的后处理工具，负责落盘和维护世界状态
- 每回合：按规范格式落盘 turn 产出到 save/history/turns/
- 每回合：更新涉及实体的状态
- 渲染契约数据（前端固定渲染的数据）必须保持游戏卡约定的**固定格式 + 固定位置**写入——前端代码依赖数据的确切形状和位置。格式和位置由游戏卡创作者在 schema README / agent 定义 / skill 中约定，你必须遵守
- 语义数据（纯 agent 面向的数据）可按需灵活组织，包括 _ref/_dir 升级
- 需要时：更新 relationships.json
- 定期：更新 current.md / timeline.md / long-term.md（cognitive folding：把回合流折叠成越来越抽象的记忆层）
- 使用 memory-maintenance / world-state-maintenance Skill 做写入

SOUL.md：
- 后处理 + 状态维护 + 记忆治理
- 规范格式落盘
- cognitive folding：从回合流生成 reflection 和 experience

## 3. 默认 schema 设计

### 3.1 双层记忆 → workspace 分区

```
Raw 层（不可变原始记录）              Semantic 层（语义状态/记忆）
save/history/                        save/world/        ← 实体状态
  turns/turn-*.json                    save/memory/       ← 记忆摘要/事实
  (回合产出原样保存)                    save/state/        ← 通用状态
                                      
post 每回合写入                       post 维护（cognitive folding）
retrieval 不直接读                    retrieval 语义检索
```

### 3.2 三阶段演化 → 记忆层次

```
Storage（原始）         Reflection（精炼）         Experience（抽象）
turn-*.json       →    timeline.md           →    long-term.md
                       current.md                 save/world/（实体知识）

post 每回合写入         post 定期精炼              post 定期抽象
```

### 3.3 实体格式：一实体一目录，按需升级子项（混合粒度 + 自然语言为主）

核心模型：**每个实体是一个目录，不是单个文件**。目录名 = 实体 id。目录下固定有一个 `index.json` 作为入口，承载实体主体信息。当某个部分（如背包、功法列表）复杂到需要独立管理时，从 index.json 的字段升级为同目录下的子文件或子目录。粒度随复杂度自然升降。

目录结构：
```
save/world/
  README.md                    # 世界数据区总说明 + schema 概览（范式入口）
  characters/
    README.md                  # 角色实体格式说明 + 字段约定 + 前端约定 + 示例
    李四/                       # 一角色一目录，目录名 = id
      index.json               # 固定入口：角色主体信息
      inventory.json           # 背包（简单时一个文件）
    王五/
      index.json
  locations/
    README.md                  # 地点格式说明
    凌烟阁/
      index.json
  relationships.json           # 关系图谱（强关联整体，单文件）
  rules.md                     # 世界规则（强关联整体）
```

默认只示范 `characters/` 和 `locations/` 两个最通用的实体类目——这是几乎所有世界设定都有的。功法/技能/法术/异能/物品/派系等类目**不纳入默认结构**，因为：
- 命名冲突：`skills/` 已被 Agent Skill（`skills/<skill>/SKILL.md`）占用，再用 `skills/` 存功法会撞名
- 世界差异大：不同设定里这类东西的名称、有无、组织方式完全不同（仙侠有功法、都市异能有异能、末日流可能完全没有）
- 默认 schema 的职责是示范「怎么组织」，不是穷举「组织什么」

schema README 会明确写「实体类目可扩展、可裁剪」，并给出一个**可扩展示例**（如功法用 `techniques/` 或 `arts/` 等不与 Agent Skill 撞名的目录名），但不在默认卡里实际创建该目录。

#### index.json 格式（简单时——全内嵌）

```json
// save/world/characters/李四/index.json
{
  "id": "李四",
  "type": "character",
  "tags": ["主角", "剑修", "凌烟阁"],
  "summary": "年轻的剑客，师承令狐冲，目前在凌烟阁修行。",
  "description": "李四是江南李家的独子，自幼拜入令狐冲门下……",
  "attributes": { "境界": "筑基后期", "气血": 85, "气血上限": 100, "攻击": 42 },
  "status": "正在凌烟阁闭关",
  "inventory": [
    { "name": "回血丹", "effect": "恢复30气血", "count": 2 },
    { "name": "青锋剑", "effect": "攻击+15", "count": 1 }
  ],
  "firstAppeared": 1,
  "lastUpdated": 42
}
```

简单时所有信息都在 index.json 里，自包含，retrieval 读一个文件就够。

#### 升级为子文件（某字段复杂时）

当 inventory 需要更丰富的物品描述（lore、来源、耐久等），从内嵌数组升级为同目录子文件：

```json
// save/world/characters/李四/index.json
{
  "id": "李四",
  ...
  "inventory": { "_ref": "inventory.json" },
  ...
}

// save/world/characters/李四/inventory.json
[
  { "name": "回血丹", "effect": "恢复30气血", "count": 2, "description": "以百年灵草炼制……", "source": "令狐冲所赠" },
  { "name": "青锋剑", "effect": "攻击+15", "count": 1, "description": "江南李家祖传宝剑……", "durability": 87 }
]
```

#### 升级为子目录（更复杂时，每条目一文件）

当物品数量多、每个物品都需要独立档案时，升级为子目录：

```json
// save/world/characters/李四/index.json
{
  "id": "李四",
  ...
  "inventory": { "_dir": "inventory/" },
  ...
}

// save/world/characters/李四/inventory/回血丹.json
{ "name": "回血丹", "effect": "恢复30气血", "count": 2, "description": "……" }

// save/world/characters/李四/inventory/青锋剑.json
{ "name": "青锋剑", "effect": "攻击+15", "count": 1, "description": "……", "durability": 87 }
```

#### _ref / _dir 标记约定

- `{ "_ref": "filename" }`：详情在同目录下的一个文件里（文件内是完整内容，通常是数组或对象）
- `{ "_dir": "dirname/" }`：详情在同目录下的一个子目录里（每条目一文件，文件名 = 条目标识）
- 没有标记的字段就是内嵌的完整内容，直接用
- **`_ref`/`_dir` 只是位置标记，与数据是「渲染契约」还是「语义」无关**——一个 `_ref` 指向的文件既可以是渲染契约（格式固定、前端读）也可以是语义（格式灵活、agent 读）

这个模型让粒度随复杂度自然升降：初创角色时全在 index.json 里；随着游玩深入，数据膨胀，逐步把字段升级为子文件/子目录。同一套 schema 约定覆盖从简单到复杂的所有阶段。

#### 引用展开：entity-reader Skill（只展开一层）

agent 不需要自己手动 follow `_ref`/`_dir`——有一个共享 Skill `entity-reader` 提供 `read_entity` action（browser_script），自动展开**一层**引用：

- 读取目标文件（通常是 `<entity>/index.json`），解析 JSON
- 遍历顶层字段，遇到 `{_ref: "file"}` 就读取该文件内容内联替换；遇到 `{_dir: "dir/"}` 就 list + read 该目录下所有文件，组装成对象内联替换
- **只展开一层**：被展开内容内部如果再有 `_ref`/`_dir` 标记，保留标记不展开
- 返回展开一层后的完整对象

agent（主要是 retrieval）用 `read_entity` 代替裸 `read` 读实体，一次调用拿到 index.json + 直接子项。如果返回里还有 `_ref`/`_dir` 标记，agent 自己判断是否需要再调一次 `read_entity` 读更深一层。

**为什么只展开一层**：多层自动展开容易出问题——循环引用、无限递归、一次灌入过多内容。只展开一层让 agent 保持对读取深度的控制，符合 retrieval「按需读取、精炼回灌」的定位。宁可让 agent 再读一次，也不要一次展开太多。

**为什么用 Skill 而不是平台操作**：引用展开依赖具体数据结构约定（`_ref`/`_dir`），属于玩法层而非平台层。放 Skill 里可编辑可替换——约定变了改 Skill 文件，不改平台代码。符合方向文档第 5 节「依赖具体数据结构的能力用 Skill 包装平台 primitives」。

前端不需要这个 Skill——前端按固定路径直接读渲染契约（创作者写死路径），不做通用 `_ref`/`_dir` 展开。

#### 渲染契约 vs 语义数据（关键区分）

实体数据分两类，区分标准是**「格式是否固定 + 前端是否依赖」**，不是「内嵌 vs 升级」：

**渲染契约（前端固定渲染）**：
- 前端代码（HTML/CSS/JS）需要知道数据的**确切形状**才能可靠渲染
- **格式固定**：数据结构是创作者约定好的、不变的——但**位置灵活**：可以是 index.json 里的字段、同目录下的文件（`_ref` 指向）、子目录（`_dir` 指向）、或混合
- 由**游戏卡创作者自行约定**：哪些数据是渲染契约、什么格式、在什么位置（字段/文件/目录/混合）
- 前端代码知道去哪读——可能是直接读 index.json 的字段，也可能是读 `_ref` 指向的文件，也可能是 `list` + `read` `_dir` 指向的目录。这是创作者在前端代码里写死的
- 通过 **agent 定义（AGENT.md/SOUL.md）+ skill** 约束 post-processing 始终按这个格式、在这个位置写入
- 平台不强制——这是游戏卡内部契约，前端代码和 agent 定义都由同一创作者控制，两端对齐

渲染契约的形式示例（同一概念可以用不同形式实现，创作者自选）：
- 字段形式：`attributes` 内嵌在 index.json，固定键值对
- 文件形式：`inventory` 用 `{_ref:"inventory.json"}` 指向独立文件，文件内是固定数组格式
- 目录形式：`inventory` 用 `{_dir:"inventory/"}` 指向子目录，每物品一文件，每文件固定格式
- 混合形式：attributes 内嵌 + inventory 独立文件 + relationships 在 world/ 根目录单文件——全都是渲染契约，格式都固定，位置各不同

**语义数据（agent 创作用）**：
- agent/retrieval 靠语义搜索，能处理灵活结构
- **格式灵活**：可随复杂度升级（内嵌 → `_ref` → `_dir`），结构不固定
- 无前端依赖——前端不读这些数据
- 默认示例：`description`（自然语言描述）、`journal`（角色日记）等纯 agent 面向的数据

**区分原则**：一段数据是渲染契约还是语义，由游戏卡创作者决定。创作者写前端时知道前端读什么形状、在什么位置的数据，就同时在 agent 定义/skill 里约束 post-processing 按这个形状和位置写。`_ref`/`_dir` 只是告诉读者「去这个位置读」，不决定数据是契约还是语义。

**当同一概念既需前端渲染又需丰富语义时**：可以拆成两部分——一个渲染契约（固定格式，前端读）+ 一个语义部分（格式灵活，agent 读）。但也可以不拆——如果固定格式本身已经够 agent 用，就不用额外加语义部分。是否拆分由创作者根据需求决定。

### 3.4 关系图谱格式

`save/world/relationships.json`：
```json
[
  { "from": "李四", "to": "王五", "type": "对手", "description": "因旧怨结为对手", "since": 3, "lastUpdated": 42 },
  { "from": "李四", "to": "令狐冲", "type": "师徒", "description": "李四自幼拜令狐冲为师", "since": 1 }
]
```

- `from`/`to`：entity id（轻量引用，不是强制外键）
- `type`：关系类型（自由文本）
- `description`：自然语言描述
- `since`/`lastUpdated`：回合号锚点
- 关系图谱是强关联整体，单文件便于整体查看和检索
- 不预设关系类型枚举——自由文本，语义检索匹配

### 3.5 回合产出格式

`save/history/turns/turn-000042.json`：
```json
{
  "turn": 42,
  "input": "我要挑战王五",
  "output": "你拔剑而起，青锋剑在月光下寒光凛凛……",
  "involvedEntities": ["李四", "王五"],
  "sceneTags": ["凌烟阁", "战斗"],
  "timestamp": "2026-06-24T12:00:00Z"
}
```

- `involvedEntities` + `sceneTags`：retrieval 顺藤摸瓜的入口锚点
- 轻量锚点，post 尽量填但不强制完整
- 不含 prompt/tool/trace（这些进 .tsian/traces/）

### 3.6 retrieval 查找路径

```
master: agent_call(retrieval, "我需要李四的背景和当前状态，以及他和王五的关系")

retrieval 内部：
  1. use_skill("entity-reader") → 加载 read_entity action
  2. workspace.search("李四") → 命中 characters/李四/index.json, turn-42.json, ...
  3. read_entity({path:"save/world/characters/李四/index.json"})
     → 自动展开一层 _ref/_dir → 拿到 summary + description + attributes + status + inventory(展开)
     → 若返回里还有 _ref/_dir 标记且需要更深 → 再调一次 read_entity
  4. workspace.search("王五") → 命中 characters/王五/index.json
  5. read_entity({path:"save/world/characters/王五/index.json"})
  6. workspace.read("save/world/relationships.json") → 搜"李四"+"王五" → 关系条目
  7. 精炼回灌 master:
     "李四：筑基后期剑客，师承令狐冲，正在凌烟阁闭关。
      王五：凌烟阁掌柜，中立。
      关系：因旧怨结为对手（自第3回合）。"
```

不需要预先建全局索引——workspace.search 是语义检索，目录名（=实体 id）+ tags + summary 是锚点，description 是语义匹配素材。一实体一目录的好处：retrieval 先读 index.json 拿主体，按需再读升级出来的子文件，不会一次性灌入过多内容。

### 3.7 post-processing cognitive folding 流程

```
回合结束 → master 调 post-processing:
  1. 读本回合 master 产出
  2. 按规范格式落盘 turn-*.json（involvedEntities/sceneTags）
  3. 更新涉及实体状态：按游戏卡约定的位置写入（可能是 index.json 字段、约定文件、约定子目录）
     渲染契约数据：保持约定的固定格式 + 固定位置，不改变结构或位置
     语义数据：可按需 _ref/_dir 升级，灵活组织
  4. 若关系变化，更新 relationships.json
  5. 更新 current.md（近期场景摘要）+ timeline.md
  6. 定期（非每回合）更新 long-term.md（长期模式）
```

### 3.8 schema 文件即范式

`save/world/README.md` 既是 schema 说明也是新作者范式参考。包含：
- 目录结构说明
- 实体类型清单（默认只示范 characters/locations；可扩展、可裁剪）
- **渲染契约 vs 语义数据区分**：哪些数据保持固定格式 + 固定位置供前端渲染（形式可以是字段/文件/目录/混合），哪些可灵活组织供 agent 语义使用。这是范式核心——新作者必须理解这个区分才能正确设计自己的状态数据。约束方式：在 agent 定义/skill 中约束 post-processing 遵守渲染契约。
- 检索约定（retrieval 怎么找）
- 前端约定（前端怎么渲染、怎么改）
- 扩展指南（作者怎么加新实体类型；给出不与 Agent Skill `skills/` 撞名的命名建议，如功法用 `techniques/`/`arts/`、物品用 `items/`、派系用 `factions/`）

每个实体类型目录的 README.md 是该类型的格式说明 + 字段约定 + 示例，兼作范式。

## 4. 前端数据读写设计

### 4.1 前端可用能力（全部已存在，无需平台改动）

| 能力 | bridge 方法 |
|------|------------|
| 读 workspace 文件 | `query.query({resource:"workspace.read", params:{path}})` |
| 列 workspace 目录 | `query.query({resource:"workspace.list", params:{path}})` |
| 搜 workspace | `query.query({resource:"workspace.search", params:{query}})` |
| 写 workspace 文件 | `platform.runAction({action:"workspace.write", params:{path,content}})` |
| 删 workspace 文件 | `platform.runAction({action:"workspace.delete", params:{path}})` |
| 全量快照 | `runtime.getRuntimeSnapshot()` |

### 4.2 状态栏渲染

前端读取渲染契约数据时，**按游戏卡创作者约定的固定位置和格式直接读**。渲染契约可以是字段、文件、目录或混合——前端代码知道去哪读（创作者写前端时就写死了读取路径），不依赖通用解析逻辑。

```
前端状态栏组件（示例：创作者约定 attributes 内嵌 + inventory 独立文件）
  ├─ 启动/回合结束后：
  │   read index.json → 拿到 attributes（固定键值对）+ status（固定字符串）
  │   read inventory.json → 拿到 inventory（固定数组）→ 渲染状态栏 + 背包栏
  └─ 订阅 turn-completed 事件 → 重新 read → 刷新
```

不同创作者可能有不同约定（attributes 内嵌、inventory 用 `_dir` 子目录、relationships 读 world/ 根文件等），前端代码按各自约定读。这是游戏卡内部契约——前端代码和 agent 定义都由同一创作者控制，两端对齐：创作者在前端代码里读 `attributes.境界` + `inventory.json`，就在 post-processing 的 AGENT.md/skill 里约束「attributes 保持 {境界, 气血, ...} 键值对格式，inventory 写在 inventory.json 里保持 [{name,count,effect}] 数组格式」。

不需要平台强制、不需要通用 `_ref`/`_dir` 解析——前端代码直接按约定路径读，post-processing 按约定路径写。`_ref`/`_dir` 标记主要服务 retrieval（语义侧），前端按创作者写死的路径直接读。

### 4.3 双路径改数据

**路径 A：通过 Agent（涉及游戏世界的变更）**
```
玩家前端点"使用回血丹" → 发消息给 master
→ master 创作 + 调 post-processing 更新主角/index.json（气血+30）和 inventory 子项（回血丹-1）
→ staged transaction 提交 → snapshot 刷新 → 前端重渲染
→ 回合失败则 staged 丢弃，状态不变
```

**路径 B：前端直接改（纯 UI 交互或即时反馈）**
```
玩家前端点"展开背包面板" → workspace.write save/frontend/view-state.json
→ 即时生效，不进 Agent 回合

玩家前端点"分配属性点" → workspace.write save/world/characters/主角/index.json
→ 即时生效，不进 staged transaction
```

### 4.4 回滚一致性

checkpoint 存储内容含 `workspaceFiles`（全部 save/ workspace 文件快照）。restore 时全量替换 workspace 文件。

- 走 Agent 路径：写入在 staged transaction 内，回合失败自动丢弃。✅
- 前端直接改：即时写入，不在 staged 内。
  - 回滚到改动之前的 checkpoint → 改动消失（被 checkpoint 状态覆盖）。✅
  - 回滚到改动之后的 checkpoint → 改动保留（checkpoint 已包含）。✅
  - 前端改后未触发回合 → 无新 checkpoint 保护 → 手动回滚到更早 checkpoint 会丢失改动。
  - 这等同「手动操作没存档别读档」，可接受，schema 前端约定中写清。

### 4.5 save/frontend/view-state.json

纯前端 UI 状态（选中标签、展开面板、动画状态）：
```json
{
  "activeTab": "character",
  "expandedPanels": ["attributes", "inventory"],
  "selectedCharacter": "主角"
}
```

平台不解释（方向文档第 7 节已明确）。

## 5. 方向文档更新

### 5.1 agent-framework-runtime-workspace-direction.md 第 4 节

当前描述「对等团队」（master/narrative/memory/state 对等协作）。替换为 hub-and-spoke 心智模型：

- master 为核：唯一对话 agent，既决策又执笔写正文
- retrieval/post-processing 为工具型 agent：由 master 按需 agent_call，类似智能工具
- 调用频率不对称：retrieval 稀疏按需，post-processing 近乎每回合
- 团队由 Agent 联系关系自然形成（保留），但默认阵容是 hub-and-spoke 而非对等

### 5.2 第 5 节「工具原则」

保留「检索不被某个 Agent 垄断」原则。澄清：
- 平台不把检索锁在 retrieval 后面，master 仍可直搜
- retrieval 是省 context 的封装，不是检索垄断
- 这不改变「工具应尽量通用」的原则

### 5.3 推荐目录结构（第 9 节）

更新 agents/ 部分：移除 narrative，新增 retrieval 和 post-processing。更新 world/ 部分：体现一实体一目录 + index.json 入口 + _ref/_dir 升级的组织方式。

## 6. 模板卡内容变更

### 6.1 DEFAULT_WORKSPACE_FILES（卡内容）变更

- 移除 agents/narrative/* 全部文件
- 新增 agents/retrieval/{agent.json,AGENT.md,SOUL.md,notes.md}
- 新增 agents/post-processing/{agent.json,AGENT.md,SOUL.md,notes.md}
- 修改 agents/master/{agent.json,AGENT.md,SOUL.md}：contacts 改为 retrieval+post-processing；AGENT.md/SOUL.md 改为「自己写正文」
- 修改 agents/memory → 移除（其职责并入 post-processing）
- 新增 skills/entity-reader/{SKILL.md, scripts/read-entity.js}：retrieval 读取实体用，自动展开一层 _ref/_dir（browser_script）
- 新增 skills/world-state-maintenance/{SKILL.md, scripts/apply-world-state-plan.js}：post-processing 写入用（browser_script，staged write）
- 更新 world/README.md：从空 canon.md 改为 schema 范式说明（含一实体一目录 + index.json 入口 + _ref/_dir 升级约定 + entity-reader Skill 读取约定 + 实体类目可扩展/裁剪指南）
- 新增 world/characters/README.md（格式说明 + 字段约定 + _ref/_dir 升级示例 + 前端约定）
- 新增 world/locations/README.md
- 新增 world/relationships.json（空数组初始）
- 不创建 world/skills/（避免与 Agent Skill `skills/` 撞名；功法/技能等作为可扩展示例写进 world/README.md 扩展指南）
- 更新 state/README.md：指向新 schema 约定
- 更新 studio-assistant AGENT.md：同步新阵容描述

### 6.2 DEFAULT_SAVE_RUNTIME_FILES（存档运行时）变更

- 移除 save/agents/narrative/notes.md
- 移除 save/agents/memory/notes.md
- 新增 save/agents/retrieval/notes.md
- 新增 save/agents/post-processing/notes.md
- 新增 save/world/characters/README.md（从卡内容复制？不——这是存档运行时，应只有空目录占位）
- 新增 save/world/relationships.json（空数组）
- 更新 save/world/README.md

### 6.3 memory-maintenance Skill 变更

当前 allowed targets：
- save/agents/<agent>/notes.md
- save/history/timeline.md
- save/memory/summaries/current.md
- save/memory/summaries/long-term.md

扩展 allowed targets（post-processing 维护实体状态需要）：
- `save/world/**/*.json`（覆盖 index.json 及实体目录内任意深度的子文件/子目录 JSON——一实体一目录模型下自动覆盖升级出来的子项）
- save/world/relationships.json（已被 **/*.json 覆盖）
- save/world/rules.md
- save/history/turns/*.json（回合产出落盘）
- 若需要写 .md 文件（如角色日记 journal.md），再加 `save/world/**/*.md`

allowed target 用 `save/world/**/*.{json,md}` 通配而非穷举类目，一实体一目录 + _ref/_dir 升级模型下自动覆盖任意深度，无需每加类目或升级子项时改 Skill。

或：不扩展 memory-maintenance Skill，而是新增一个 post-processing 专用的「world-state-maintenance」Skill，allowed targets 覆盖 world/ 目录。后者更清晰，职责分离。

### 6.4 workspace version bump

`DEFAULT_WORKSPACE_VERSION` 从 6 升到 7。`DEFAULT_SAVE_RUNTIME_UPGRADE_FILE_PATHS` 加入新文件路径。旧存档升级时补齐缺失的新默认文件。

## 7. 边界与取舍

### 7.1 不做的

- 不新增平台 runtime primitive / action executor
- 不复活旧 stateRecords 表 / namespace-collection-recordId 存储模型
- 不实现原生向量检索（workspace.search 全文搜够用，未来可由 Skill + browser_script 扩展）
- 不做 schema 可视化编辑器 UI
- 不做首次启动世界创建流程
- 不预设严格关系网 / 不强制外键校验

### 7.2 取舍

- **自然语言为主 vs 结构化字段**：取自然语言为主 + 轻量结构化锚点。牺牲了精确关系查询，换取了 schema 的灵活性和 cognitive folding 的自涌现空间。这符合 AIRP 是创作而非数据管理的定位。
- **不维护独立索引 vs post 维护负担**：取不维护独立索引。post 只维护实体文件本身的引用完整性（更新涉及实体的 lastUpdated、relationships.json），不维护派生索引文件。减轻 post 负担，但 retrieval 要多做几步搜索。可接受——retrieval 的上下文就是用来做这个的。
- **双路径改数据 vs 单路径**：取双路径。牺牲了「所有变更都进回合可回滚」的一致性，换取了前端交互自由度和即时反馈。回滚不一致风险通过 checkpoint 含 workspace 文件 + 前端约定写清来缓解。

## 8. 兼容性

- 旧 IndexedDB 原型数据不做迁移，通过 workspace version bump + upgrade 逻辑补齐新默认文件。
- 旧存档（workspaceVersion < 7）升级时：补齐 retrieval/post-processing 的 notes、新 world README、relationships.json 等；不会删除旧 narrative/memory 文件（它们变成普通 workspace 文件，作者可手动清理）。
- 导出/导入的 *.tsian-card.zip 包含新阵容 + 新 schema 文件。
