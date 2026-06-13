# Tsian Agent Framework And Runtime Workspace Direction

## 1. 文档目的

本文档记录 Tsian Agent Framework 与 Runtime Workspace 的当前方向。

当前答案是：

`Tsian 的 Agent Framework 应围绕 AIRP 运行时、可替换 Agent、按需加载 Skill 和存档级虚拟工作区构建。`

这不是 OpenClaw 式个人服务器助手框架。Tsian Agent 不需要默认访问宿主文件、终端、浏览器、消息渠道或个人服务器数据。它们的主要工作是组织 AIRP 回合、协作生成叙事、维护世界状态、管理记忆、执行规则、产出前端可读取数据，并让存档随游玩演进。

## 2. 核心原则

- Agent 可配置、可替换、可扩展。
- Skill 是按需加载的能力包，不是常驻工具列表。
- Agent 协作通过联系人声明和 `agent_call` 自然形成，不使用显式团队配置作为主模型。
- 普通 Agent 输出是软协议，由 `AGENT.md` 和 Skill 指导；平台不强制校验每段文本或 brief。
- 硬校验只发生在工具 / action 调用、结构化写入、远程执行结果和平台提交边界。
- Runtime Workspace 是存档的数据容器；上下文、记忆、结构化状态、Agent 定义、Skill 定义、前端数据都可以是工作区文件。
- 平台提供模型调用、工作区文件 API、checkpoint、trace、执行器和提交边界，不理解玩法字段语义。

## 3. Agent

Agent 是 Runtime Workspace 中的参与者。

每个 Agent 以 `AGENT.md` 作为入口，例如：

```text
agents/
  master/
    AGENT.md
    session.jsonl
    notes.md
    skills/
  narrative/
    AGENT.md
    session.jsonl
    notes.md
```

`AGENT.md` 应描述：

- 这个 Agent 的职责。
- 什么时候应该行动。
- 输出风格或输出习惯。
- 默认或可选 Skill。
- 可以联系哪些 Agent，以及什么情况下联系。
- 默认加载或维护哪些工作区文件。

平台不应把 `master-agent/v1`、`narrative-agent/v1` 这类输入输出契约设计成强制 schema。AIRP Agent 的普通输出可能是计划、判断、叙事 brief、审校意见或自然语言任务说明，变化空间很大。更适合的做法是把输出要求写在 `AGENT.md` 或输出规范 Skill 中。

## 4. Agent 协作

不要把显式 `team.json` 作为主要协作模型。

运行时只需要：

- 一个入口 Agent，通常是 `agents/master/AGENT.md`。
- 从工作区文件扫描出的 Agent registry。
- `AGENT.md` 中声明的联系人。
- 一个通用 `agent_call` Skill / action。

团队由 Agent 联系关系自然形成。每个 Agent 只需要知道与自己业务有承接关系的其它 Agent。

例如，master 可以知道 narrative、state、memory；narrative 可以只知道 style 或 critic；某个战斗 runtime 可以额外提供 rule-referee。只要相关 Agent 被声明为联系人，并能被 `agent_call` 调用，就不需要额外维护一份全局团队装配表。

Agent 之间的即时交接应走 `agent_call`。工作区文件只用于记录值得长期保留或后续复用的内容，不应强迫每次协作都绕一圈写入 handoff 文件。

## 5. Skill

Skill 是可复用能力包。

每个 Skill 以 `SKILL.md` 作为入口。Skill 可以是共享的，也可以是某个 Agent 私有的：

```text
skills/
  relationship-maintainer/
    SKILL.md
    actions/
    schemas/
    examples/
    scripts/

agents/
  narrative/
    skills/
      prose-style/
        SKILL.md
```

共享 Skill 放在 `skills/` 下。Agent-local Skill 放在 `agents/<agent>/skills/` 下，默认只对该 Agent 索引和加载。

Agent 生成的新 Skill 默认应放入自己的 `skills/` 目录。以后如果这个 Skill 对多个 Agent 有价值，可以通过产品动作提升为共享 Skill。

## 6. Skill 按需加载

Skill 必须支持渐进披露。

常驻上下文只放 Skill Index，且只包含：

- name；
- description；
- triggers；
- appliesTo / applicability。

常驻 Skill Index 不暴露 action 列表，也不默认暴露 `SKILL.md` 的虚拟文件路径。Agent 先根据 name / description / triggers 判断是否需要加载某个 Skill；加载后才看到详细 instructions，以及在什么情况下读取 examples、schemas、actions、scripts 或 references。

推荐流程：

```text
回合开始
  -> Orchestrator 注入相关 Agent 可见的 Skill Index
  -> Agent 判断需要加载哪些 Skill
  -> Agent 通过 skill_load(name) 加载 Skill 的 SKILL.md 入口正文
  -> Runtime 在当前 Agent 可见 Skill 中解析 name，并将入口正文作为 observation 回灌给同一 Agent
  -> Agent 根据 SKILL.md 的链式引用，按需使用 workspace_read/workspace_list/workspace_search 读取 references、examples、schemas 或 scripts
  -> Agent 获得该 Skill 的详细指导与 action 说明，且只读取当前步骤真正需要的资源
  -> Agent 通过 action_call 调用已加载 Skill 声明的 action
```

在 live Agent Runtime 中，Skill 详情加载应使用专用 `skill_load` 工具。Agent 使用 Skill 的 `name`，不需要理解 path、id、scope 或 ref。`skill_load` 只加载 `SKILL.md` 入口正文和最小加载元信息，不默认返回 resource index。第三层资源读取才使用 Runtime Workspace 文件工具。

`skill-detail` 这类 path-based 查询可以作为 UI、调试或外部 bridge 能力保留，但不应成为 live Agent Runtime 的主路径。

这能避免 prompt 常驻内容膨胀，也能避免 Agent 被未加载 Skill 的 action 名称诱导乱调用。

## 7. Action 与执行器

Agent 看到的是统一的可调用 action，而不是执行细节。

一个 action 可以由不同执行器承载：

- 平台内置函数。
- 浏览器 JavaScript。
- 远程加载后在平台执行的脚本。
- 远程 HTTP 执行并返回结果。
- WASM。
- 后续托管执行环境。

这些差异只属于平台执行层。Agent 只需要知道 action 名称、说明、输入结构、输出说明和何时使用。

统一调用路径：

```text
Agent 发起 action_call
  -> 平台校验输入
  -> 选择 executor 执行
  -> 按声明校验或归一化结果
  -> 将结果作为 observation / context 返回
  -> 记录 trace
```

当前 MVP 中，`action_call` 会先做 loaded Skill gating 和输入校验，再通过 action executor registry 路由到具体 executor。已支持无副作用的 `builtin/validation`、`builtin/echo`，以及通过 capability 注入并由 platform-host allow-list 控制的 `platform_action`。当前 `platform_action` 允许接入 `workspace-write` / `workspace-delete` 这类平台受控能力，用于 Skill 封装 AIRP 业务状态维护；真实脚本、远程调用和 `agent_call` 仍是后续任务。

这允许 Tsian 复用网络上的 Skill 思路，也允许把 CLI Skill 中的脚本通过浏览器脚本或远程执行适配进来。

## 8. Runtime Workspace

Runtime Workspace 是一个存档级虚拟文件系统。

它统一承载：

- Agent 定义；
- Agent 会话与备注；
- 共享 Skill 与 Agent-local Skill；
- 对话历史；
- 世界数据；
- 结构化游戏状态；
- 长期记忆；
- 前端包读取的数据；
- 归档内容；
- 平台 metadata、trace、checkpoint、索引和缓存。

结构化游戏状态不应作为独立于工作区的产品概念存在。它可以是工作区中的 JSON、JSONL、Markdown、schema 文件或 README 描述的目录。

目录级 `README.md` 是解耦数据结构、Agent 和 Skill 的关键。Agent 或 Skill 在维护某个目录前，可以先读取该目录 README 或 schema，理解当前世界如何定义角色、地点、关系、规则、前端数据等。

## 9. 推荐目录结构

默认 Runtime Workspace 可以采用：

```text
/
  README.md

  agents/
    master/
      AGENT.md
      session.jsonl
      notes.md
      skills/
    narrative/
      AGENT.md
      session.jsonl
      notes.md

  skills/
    relationship-maintainer/
      SKILL.md
      actions/
      schemas/
      examples/
      scripts/

  history/
    conversation.jsonl
    timeline.md

  world/
    README.md
    canon.md
    characters.json
    locations.json
    relationships.json
    rules.md

  memory/
    README.md
    summaries/
      current.md
      long-term.md
    facts.jsonl

  frontend/
    README.md
    view-state.json

  archive/

  .tsian/
    manifest.json
    traces/
    checkpoints/
    indexes/
    cache/
```

目录约定：

- 根 `README.md` 说明工作区用途和重要入口。
- `agents/` 存 Agent 定义和 Agent 自己的工作状态。
- `skills/` 存共享 Skill。
- `agents/<agent>/skills/` 存 Agent-local Skill。
- `history/` 存对话和压缩后的剧情时间线，不存所有中间过程。
- `world/` 存当前世界事实、规则和结构化状态。
- `memory/` 存长期记忆、摘要和可检索事实。
- `frontend/` 存前端包约定读取的数据。
- `archive/` 存退役、压缩或不再活跃的材料。
- `.tsian/` 是平台 metadata、trace、checkpoint、索引和缓存空间。

## 10. 回合与 Trace

不要默认为每个回合在普通工作区里生成大量文件。

详细 trace 进入 `.tsian/traces/` 平台调试区。Trace 是平台拥有、工作区承载、默认隐藏的 JSONL 文件；普通 `workspace_list` / `workspace_search` 不暴露 trace，精确路径读取可作为 MVP 调试入口保留。

Trace 跟随 workspace checkpoint / restore。成功回合会在创建回合后 checkpoint 前写入 `.tsian/traces/turns/turn-000001.jsonl` 这类文件；如果玩家回滚到旧 checkpoint，后续分支的 trace 也会一起消失。这符合 AIRP 分支调试材料的定位，而不是 OpenClaw 式 append-only 安全审计日志。

普通工作区只保存长期有用的内容，例如：

- 对话历史；
- 时间线摘要；
- 世界状态更新；
- 长期记忆；
- Agent notes；
- 前端数据。

这样 workspace 像可维护的项目，而不是不可检索的中间产物堆。

## 11. Agent 创建和编辑 Skill

长期方向上，Agent 可以帮助创建、改进和沉淀 Skill。

推荐阶段：

1. Agent 先提出对 `AGENT.md`、`SKILL.md` 或相关文件的 patch。
2. 玩家 / 作者确认后应用。
3. 可信或受限范围内的 Agent 后续可以自动编辑自己的 local Skill。
4. 成熟的 local Skill 可以提升为共享 Skill。

这不是重安全需求，而是可调试性需求。Agent 修改自身能力定义后，如果行为异常，用户应能看到改了什么、何时改的、为什么改。

## 12. 平台边界

Tsian 不需要 OpenClaw 式个人助手主机安全模型。

但平台仍应掌控：

- 模型 key 与 provider 调用。
- 工作区提交、checkpoint、rollback。
- 脚本和远程执行的 timeout / abort。
- action 输入校验与必要的结果校验。
- 被加载 Skill、action 调用、文件读写、Agent 调用的 trace。
- 平台内部能力只通过公开 action/tool 暴露。

这是 AIRP runtime 的稳定性边界，不是个人服务器安全沙箱。

## 13. 当前实现含义

当前代码已经落地了 Agent Framework 的基础存储与索引层：

当前 MVP 中：

- Agent Runtime 仍在 `apps/platform-web/src/agent-runtime/index.ts`。
- 默认流程仍是固定 `master-agent` -> `narrative-agent`。
- 存储包含 snapshot、history、checkpoint、stateRecords，以及 save-scoped Runtime Workspace files。
- 新存档默认写入 Runtime Workspace 目录入口、`agents/master/AGENT.md`、`agents/narrative/AGENT.md`、agent notes/session、world/memory/frontend/archive 和 `.tsian` 入口文件。
- `agent-registry` 与 `skill-registry` 已能扫描 workspace 中的 `AGENT.md` / `SKILL.md` 并返回轻量索引。
- `skill-detail` 已能按选中 `SKILL.md` path 加载 Skill 正文和资源索引。
- `agent-context` 已能按 Agent 组装 `AGENT.md`、notes/session、轻量 Skill Index 和声明的 context files。
- 默认 master -> narrative 回合已消费 Runtime Workspace Agent 定义和 Agent context；空 workspace 会在回合前初始化默认文件，非空 workspace 缺关键 Agent 会明确失败。
- 默认 AIRP 回合已支持 `skill_load` 后解锁 `SKILL.md` 中 `tsian-actions` 声明的 action，并通过 `action_call` 路由到 action executor registry；当前支持 `builtin/validation`、`builtin/echo` 和 allow-listed `platform_action`。`platform_action` 通过 capability 注入平台受控动作，当前可用于 `workspace-write` / `workspace-delete`，不会执行脚本或远程调用。
- Runtime Trace Persistence MVP 已落地：回合、Agent step、模型调用摘要、Skill 加载、workspace 工具、action 调用和 workspace mutation 会写入 `.tsian/traces/turns/*.jsonl`，普通 list/search 默认隐藏 `.tsian/traces/`。

后续实现应逐步：

1. 为 action executor registry 接入浏览器脚本、远程执行、`agent_call` 和更丰富的受控平台动作。
2. 实现通用 `agent_call` Skill / action。
3. 扩展 trace 覆盖 `agent_call`、脚本/远程 executor、保留策略和调试 UI。
4. 写回 Agent session/notes、history timeline、memory summaries 等 Runtime Workspace 文件。
5. 将当前 `stateRecords` 语义迁入 workspace 文件/目录，或作为过渡兼容层。
6. 为 workspace、Agent 和 Skill 提供浏览与编辑 UI。
