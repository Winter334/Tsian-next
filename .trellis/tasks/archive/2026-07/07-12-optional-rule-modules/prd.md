# 移植预设可选规则模块到 context injection composer

## Goal

用刚实现的 context injection composer（`{{file:...?enabled}}` + `enabledModules`）把预设中的可选规则做成 workspace 模块文件，让 storyteller 可以通过 `enabledModules` 控制哪些规则启用。为后续"玩家可选规则模块 UI"产品特性提供内容基础。

## Background

### 已完成的两个前置任务

1. **预设提取 v2**（commit `8d47b38`）：越狱补强 + writing-rules.md 常驻 + 自审清单 + 成人场景改造
2. **规则拼接系统**（commit `6cade9e`）：contextPaths 支持对象形式 + `{{file:...}}` 宏引擎 + `?enabled` 条件包含 + `enabledModules` 启用列表

### 已实现的规则（不重复）

常驻 contextPath（`save/agents/storyteller/writing-rules.md`）：禁用词表核心、反全知、长篇连续性、用户输入处理、增加对白、详略得当。

skill：活人感基准、叙事推进、成人场景指导。

skill reference（不做成模块）：反回避色色（`anti-avoidance.md`）、物理规则（`physics-rules.md`）——保持 skill reference 形式，因为它们是成人场景的配套指导，按需加载模式更合适。

### 技术能力（已实现）

- `contextPaths` 支持 `{template, role}` 对象形式
- `{{file:dir/*.md?enabled}}` 通配引用，文件 stem 在 `enabledModules` 中才包含
- `enabledModules: string[]` 在 agent.json 中配置
- 空内容跳过，`enabledModules` 为空时 `?enabled` 默认包含
- `{{file:...}}` 相对路径相对于被注入文件所在目录

## Requirements

### R1: 新增 4 个可选规则模块文件

每个规则做成一个独立 workspace 文件，放在 `agents/storyteller/modules/` 目录下（card content，跨存档共享）。文件内容从预设条目适配（去除酒馆特有宏语法，保留指导内容）：

| 模块文件 | 来源预设条目 | 内容概述 |
|---|---|---|
| `agents/storyteller/modules/反固定.md` | [170] 反固定（965c） | 剧情推进反模板化：引入低概率高趣味变量事件，不写最稳妥发展，优先"合理但意想不到"的展开 |
| `agents/storyteller/modules/User去中心化.md` | [162] User去中心化（638c） | 角色独立人格不讨好 user，世界不围绕 user 转，NPC 有幕后生活，拒绝主角光环，客观因果法则 |
| `agents/storyteller/modules/深度.md` | [212] 深度（1092c） | 思维层面（悖论/时空透视/陌生化/终极关怀）+ 语言层面（意象/凝练/矛盾修辞/节奏），没深度不硬上 |
| `agents/storyteller/modules/抗绝望.md` | [10] 抗绝望（1520c） | 情绪模型框架：情绪值范围[-5,5]，每轮最大变化≤1.0，EMA平滑(resilience 0.7)，让 LLM 在思考阶段模拟计算防性格崩坏 |

适配原则：
- 去除 `{{setvar}}`/`{{getvar}}`/`{{trim}}` 等酒馆宏语法
- 去除 `<Prism_Deep>` 等酒馆特有标签
- 将 `<user>` 替换为"玩家"或"主角"（Tsian 术语）
- 保留指导内容的完整性和原力度

### R2: agent.json contextPaths 配置

storyteller 的 `contextPaths` 新增一个 template 对象条目：

```json
{
  "template": "{{file:modules/*.md?enabled}}",
  "role": "system"
}
```

template 对象的 baseDir 是 agentDirectory（`agents/storyteller`），`{{file:modules/*.md?enabled}}` 解析为 `agents/storyteller/modules/*.md`。模块文件放在 card content（`agents/storyteller/modules/`），路径正确匹配。role 为 system（写作指导规则）。

### R3: enabledModules 默认全部启用

storyteller agent.json 新增 `enabledModules`，默认列出所有 4 个模块的文件名 stem：

```json
"enabledModules": ["反固定", "User去中心化", "深度", "抗绝望"]
```

新存档默认注入所有可选规则（opt-out 模式）。玩家后续可通过 UI 关闭不需要的。

### R4: DEFAULT_WORKSPACE_VERSION bump

`DEFAULT_WORKSPACE_VERSION` 从 14 改为 15，确保已有存档通过升级机制获得更新。

### R5: 模块文件注册

模块文件是 card content（`agents/storyteller/modules/`），不是 save-runtime。它们在 `workspace-templates.ts` 的文件列表中注册（card template 的一部分），不需要注册到 `DEFAULT_SAVE_RUNTIME_UPGRADE_FILE_PATHS` 或 `DEFAULT_SAVE_RUNTIME_FILES`（那两个是 save-runtime 文件的升级播种机制）。card content 文件随 game card 分发，新建存档时自动获得。

## Acceptance Criteria

- [ ] 新增 4 个模块文件在 `agents/storyteller/modules/` 目录下（card content）
- [ ] 模块文件内容从预设适配，无酒馆宏语法残留（`{{setvar}}`/`{{getvar}}`/`{{trim}}`/`<Prism_Deep>` 等）
- [ ] `<user>` 替换为"玩家"或"主角"（Tsian 术语）
- [ ] storyteller agent.json contextPaths 新增 template 对象条目 `{template: "{{file:modules/*.md?enabled}}", role: "system"}`
- [ ] storyteller agent.json 新增 `enabledModules: ["反固定", "User去中心化", "深度", "抗绝望"]`
- [ ] `DEFAULT_WORKSPACE_VERSION` bump 14→15
- [ ] 4 个模块文件在 workspace-templates.ts 文件列表中注册（card template）
- [ ] `apps/platform-web` build 通过
- [ ] 现有 agent.json 纯字符串 contextPaths 继续工作（向后兼容）

## Out of Scope

- 玩家可选规则模块的前端 UI（独立后续任务）
- 文风系统（独立后续任务）
- 消息序列可配置化（独立后续任务）
- 反回避色色和物理规则迁移为模块（保持 skill reference）
