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
- Game Card 提供可复用的 Runtime Workspace 初始模板和可选前端绑定；Save Instance 持有玩家实际游玩的独立 workspace 副本。
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
- 一个通用 `agent_call` runtime tool。

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
  -> Agent 根据 SKILL.md 的链式引用，按需使用 workspace.read/workspace.list/workspace.search 读取 references、examples、schemas 或 scripts
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
- 平台受控动作。
- 通用 workspace operation 包装器。

远程 API 交互当前不作为独立 executor 暴露。需要调用外部服务时，推荐由 Skill-local `browser_script` 使用 `fetch` 与远程 API 交互。`remote_http`、远程脚本加载、WASM 和托管执行环境不属于当前 foundation phase 的实现目标，只有当具体 Skill 不能合理通过 `browser_script`、`platform_action` 或脚本调用远程 API 表达时才重新设计。

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

当前实现中，`action_call` 会先做 loaded Skill gating、输入校验和轻量 executor-class policy 检查，再通过 action executor registry 路由到具体 executor。默认 policy 代码级允许现有 `builtin`、`platform_action`、`workspace_operation` 和 `browser_script`，可由 runtime capability 注入覆盖；它只用于执行控制和诊断，不提供 Settings/localStorage 开关、运行时弹窗或 per-Skill trust 状态。action 可选声明 `outputSchema`，声明后成功 executor 输出会按轻量 type/required/properties 子集校验，不声明则保持旧行为。已支持无副作用的 `builtin/validation`、`builtin/echo`，通用 `workspace_operation` 包装器，以及受信任第三方 Skill 使用的 `browser_script`。`workspace_operation` 以 operation/scope/path 包装通用 workspace 操作，并继续通过 operation exposure 与 read/edit level 检查；`browser_script` 运行 Skill 目录下的浏览器 Worker 脚本，并通过强 Tsian SDK 暴露 workspace read/list/search/diff/patch/write/move/delete/validate、fetch、log/trace 和 timeout/abort。`interaction.sendMessage` 内的 Agent Runtime save-runtime workspace 写入/删除使用 staged transaction：同轮工具可读 staged view，成功回合与 snapshot/history/checkpoint 原子提交，失败或 abort 丢弃普通 workspace mutation；前端 bridge 的手动 `platform.runAction` 仍可即时调用 `workspace.*` 平台动作。第一版不把 raw DOM、`window`、内部 bridge、Vue 状态或 platform-host 内部对象作为受支持脚本 API，也不把独立 `remote_http`、WASM、远程脚本加载、托管执行、原生宿主文件或终端能力作为当前 foundation 目标。

默认共享 `memory-maintenance` Skill 复用这套 action/executor 机制。它不会被平台每回合自动运行；Agent 必须先 `skill_load`，再调用 `apply_maintenance_plan`。维护计划只允许显式替换 Agent notes、timeline、current summary 和 long-term summary，空 writes 代表显式 no-op。

这允许 Tsian 复用网络上的 Skill 思路，也允许把 CLI Skill 中可迁移的脚本通过浏览器脚本适配进来；远程服务则作为普通 API 由 `browser_script` 调用。

### 工具边界标准

Tsian 不应因为 Web 端没有 Bash，就把所有可能能力都做成平台内置工具。CLI Agent 可以用 Bash 覆盖大量临时能力，但 Bash 本身不提供 AIRP 语义、上下文组装、checkpoint、trace 或玩法边界。Tsian 需要的是少量稳定 runtime primitive，加上可替换 Skill 和平台受控执行器。

工具体系分四层：

1. Platform runtime primitives：平台基础能力，数量少、稳定、跨玩法通用。只有需要 runtime 内部状态、模型调用、上下文组装、trace、checkpoint、workspace 索引或 Agent registry 才能正确执行，或者 Skill 无法自行实现的能力，才进入这一层。例子：`skill_load`、`agent_call`、`workspace.read`、`workspace.list`、`workspace.search`、基础 `action_call`。
2. Platform controlled actions / executors：平台受控执行层，不一定常驻暴露给 Agent。涉及副作用、浏览器限制、脚本执行、workspace 写入、前端约定数据变更、abort / timeout / 结果归一化的能力放在这里。例子：`workspace_operation`、`browser_script`、即时 bridge `workspace.*` platform actions。远程 API 调用优先由 `browser_script` 使用 `fetch` 完成；独立 `remote_http`、WASM、托管执行只有在未来具体 Skill 证明现有路径不足时才重开设计。
3. Skill actions：可替换、可扩展、可分发的业务能力。凡是依赖具体玩法、世界设定、数据结构、规则系统、记忆策略、叙事风格或作者偏好的能力，应该用 Skill 包装平台 primitives / controlled actions。例子：世界状态维护、关系更新、记忆压缩、规则裁判、战斗结算、剧情审校、风格改写。
4. Workspace data / README / schemas：玩法数据结构和前端约定放在 workspace 文件里，让 Agent、Skill 和前端解耦。

判断一个能力是否应做成 runtime tool：

- 如果没有它，Agent 无法可靠发现、加载或联系其它能力，它倾向 runtime primitive。
- 如果它跨所有玩法都成立，且需要平台内部信息才能安全执行，它倾向 runtime primitive。
- 如果它只是把多个基础动作包装成更高层业务流程，它倾向 Skill action。
- 如果它会改变世界状态但语义由玩法决定，它倾向 Skill action 调用平台 controlled action，而不是平台直接理解玩法。
- 如果它是可替换策略，例如“怎么总结记忆”“怎么判定关系变化”，它倾向 Skill。

## 8. Runtime Workspace

Runtime Workspace 是一个存档级虚拟文件系统。

它在创建 Save Instance 时由 Game Card 的 workspace 模板复制而来。之后该 workspace 属于具体存档，玩家、Agent、Skill 和前端的写入只改变这个 Save Instance 的副本，不会回写到原 Game Card 模板。Checkpoint 保存并恢复的是该 Save Instance 当时的 snapshot、history 和 workspace 文件。

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
    studio-assistant/
      AGENT.md
      session.jsonl
      notes.md
      skills/
        framework-knowledge/
          SKILL.md

  skills/
    relationship-maintainer/
      SKILL.md
      actions/
      schemas/
      examples/
      scripts/

  history/
    turns/
      README.md
      turn-000001.json
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

  docs/
    README.md
    tsian-framework-knowledge.md

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
- `agents/` 存 Game Card 拥有的 Agent 定义。
- `agents/studio-assistant/` 可作为游戏卡声明的工作区助手入口。它仍是普通 workspace 内容，游戏卡作者可以替换、删除或改造。
- `skills/` 存共享 Skill。
- `agents/<agent>/skills/` 存 Agent-local Skill。
- `docs/` 存官方或游戏卡作者维护的说明文档。默认 `docs/tsian-framework-knowledge.md` 是临时官方知识库，供助手 Agent 通过查询型 Skill 参考。
- `save/history/` 存玩家面对的原始 AIRP 回合记录和压缩后的剧情时间线，不存所有中间过程。原始记录推荐按 `save/history/turns/turn-*.json` 一回合一文件保存，便于 workspace 搜索直接定位具体回合。
- `world/` 存 Game Card 拥有的世界 canon、规则和默认约定；`save/world/` 存本次游玩的生成世界状态。
- `save/memory/` 存本次游玩的长期记忆、摘要和可检索事实。
- `frontend/` 存前端包约定的卡内容定义；`save/frontend/` 存本次游玩的前端 view state。
- `archive/` 存退役、压缩或不再活跃的材料。
- `.tsian/` 是平台 metadata、trace、checkpoint、索引和缓存空间。普通 Agent/Skill/frontend workspace read/list/search 不暴露 `.tsian/*`，普通 workspace 写入和删除也不能修改 `.tsian/*`；平台内部需要通过 host-owned 路径写入 trace、index 或 cache。

## 10. Workspace Assistant

Game Card 可以在 manifest 中声明一个助手 Agent，例如内置空白卡默认使用 `studio-assistant`。这个助手不是平台隐藏人格，而是随 Game Card content 分发的普通 Agent 定义。未来平台助手 UI 可以把它作为入口；它的指令和本地 Skill 属于卡内容，备注和会话记录属于当前存档运行时数据。

默认 `studio-assistant` 的第一版职责是帮助玩家和作者理解、检查和维护当前 workspace：Agent/Skill 定义、状态约定、前端数据、诊断事实、游戏卡内容等。它不应获得绕过 bridge/tool/action 边界的特殊能力，也不应声称可以直接访问宿主文件系统、API key 或平台内部对象。

为了减少幻觉，默认助手带有 Agent-local `framework-knowledge` Skill。该 Skill 不声明 action，而是要求助手先读取或搜索 `docs/tsian-framework-knowledge.md`，再根据当前 workspace 的 README、schema、Agent 和 Skill 文件回答框架问题。如果官方知识库尚未覆盖某个问题，助手应该明确区分当前事实与建议。

完整的首次启动世界创建流程属于后续内容层设计。它更可能是收集世界观、主题和初始设定，然后复用官方默认 Agent、Skill、状态契约和前端内容，并把结果写入普通 workspace 文件；不应在基础设施阶段硬编码成平台流程。

## 11. 回合与 Trace

不要默认为每个回合在普通工作区里生成大量文件。

详细 trace 进入 `.tsian/traces/` 平台调试区。Trace 是平台拥有、工作区承载、普通 workspace read/list/search 都不暴露的 JSONL 文件；需要面向 Agent 或管理界面消费时，应通过 `runtime-diagnostics` 或未来专用 debug/management resource，而不是普通 workspace 查询。

Trace 跟随 workspace checkpoint / restore。成功回合会在创建回合后 checkpoint 前写入 `.tsian/traces/turns/turn-000001.jsonl` 这类文件；如果玩家回滚到旧 checkpoint，后续分支的 trace 也会一起消失。这符合 AIRP 分支调试材料的定位，而不是 OpenClaw 式 append-only 安全审计日志。

Agent-facing diagnostics 是 trace 的按需查询视图，不是新的持久化日志。`runtime-diagnostics` bridge query 会从 `.tsian/traces/turns/*.jsonl` 现算 bounded summary，默认聚焦失败/异常回合，只有显式请求时返回成功回合的极简 health summary。诊断 summary 只包含事实：`source`、`eventType`、raw `code/message`、相关 Agent/Skill/action/tool/executor 和直接相关 workspace path；不包含平台写死的修复建议、可能原因、`nextChecks`、完整 prompt、完整模型输出、文件内容、script source、provider/bridge/storage 内部细节或 `.tsian/*` 路径。未来管理 Agent、诊断 Skill 或 UI 可以消费这些事实并自行解释，不应让普通 master/narrative 回合默认看到诊断工具。

普通工作区只保存长期有用的内容，例如：

- 对话历史；
- 时间线摘要；
- 世界状态更新；
- 长期记忆；
- Agent notes；
- 前端数据。

这样 workspace 像可维护的项目，而不是不可检索的中间产物堆。

## 12. Agent 创建和编辑 Skill

长期方向上，Agent 可以帮助创建、改进和沉淀 Skill。

推荐阶段：

1. Agent 先提出对 `AGENT.md`、`SKILL.md` 或相关文件的 patch。
2. 玩家 / 作者确认后应用。
3. 可信或受限范围内的 Agent 后续可以自动编辑自己的 local Skill。
4. 成熟的 local Skill 可以提升为共享 Skill。

这不是重安全需求，而是可调试性需求。Agent 修改自身能力定义后，如果行为异常，用户应能看到改了什么、何时改的、为什么改。

## 13. 平台边界

Tsian 不需要 OpenClaw 式个人助手主机安全模型。

但平台仍应掌控：

- 模型 key 与 provider 调用。
- 工作区提交、checkpoint、rollback。
- 脚本和远程 API 调用的 timeout / abort。
- action 输入校验与必要的结果校验。
- 被加载 Skill、action 调用、文件读写、Agent 调用的 trace。
- 平台内部能力只通过公开 action/tool 暴露。

这是 AIRP runtime 的稳定性边界，不是个人服务器安全沙箱。

## 14. 当前实现含义

当前代码已经落地了 Agent Framework 的基础存储与索引层：

当前 MVP 中：

- Agent Runtime 仍在 `apps/platform-web/src/agent-runtime/index.ts`。
- 默认流程仍是固定 `master-agent` -> `narrative-agent`。
- 存储包含 snapshot、history、checkpoint、Game Card content files，以及 save runtime workspace files；结构化状态不再使用独立平台表。
- 新 Game Card 默认写入 `agents/master/AGENT.md`、`agents/narrative/AGENT.md`、`agents/memory/AGENT.md`、`agents/studio-assistant/AGENT.md`、官方共享 `memory-maintenance` Skill、助手本地 `framework-knowledge` Skill、`docs/tsian-framework-knowledge.md`、state/world/frontend/archive 等卡内容；新存档默认写入 `save/agents/*` notes/session、`save/history/*`、`save/world/*`、`save/state/*`、`save/memory/*`、`save/frontend/*` 和 `.tsian` 入口文件。
- `agent-registry` 与 `skill-registry` 已能扫描 workspace 中的 `AGENT.md` / `SKILL.md` 并返回轻量索引。
- `skill-detail` 已能按选中 `SKILL.md` path 加载 Skill 正文和资源索引。
- `agent-context` 已能按 Agent 组装 `AGENT.md`、notes/session、轻量 Skill Index 和声明的 context files。
- 默认 master -> narrative 回合已消费 Runtime Workspace Agent 定义和 Agent context；空 workspace 会在回合前初始化默认文件，非空 workspace 缺关键 Agent 会明确失败。
- 默认 AIRP 回合已支持 `skill_load` 后解锁 `SKILL.md` 中 `tsian-actions` 声明的 action，并通过 `action_call` 路由到 action executor registry；action 调用会经过 loaded Skill gating、输入校验、轻量 executor-class policy 检查，并可按可选 `outputSchema` 校验成功输出。当前支持 `builtin/validation`、`builtin/echo`、`workspace_operation` 和 strong-SDK `browser_script`。`workspace_operation` 通过 capability 注入通用 workspace 操作，受 operation exposure 与 read/edit level 约束；`browser_script` 执行 Skill-local Worker 脚本，可通过 Tsian SDK 访问 workspace、fetch、log/trace，并受 timeout/abort 约束。Agent Runtime turn 内的 save-runtime workspace 写删走 staged transaction，成功回合原子提交，失败/abort 丢弃普通 workspace mutation。
- 默认 AIRP 回合已支持 contacts-gated `agent_call` runtime tool。当前 Agent 只看到自己的可见 contacts；目标 Agent 使用自己的 `AGENT.md`、context、Skill Index 和工具循环；协作策略为代码级默认值，当前 `maxCallsPerTurn=4`、`maxDepth=2`、语义 history window 为 `minimal/recent/scene`，并按 root turn 共享调用预算。有限嵌套已启用：root depth `0` 可调用 depth `1` Agent，depth `1` Agent 可调用自己的 contacts 到 depth `2`，depth `2` 再调用会返回带深度/预算事实的结构化 observation。
- Runtime Trace Persistence MVP 已落地：回合、Agent step、模型调用摘要、Skill 加载、Agent 调用、workspace 工具、action executor policy 检查、action 调用和 workspace mutation 会写入 `.tsian/traces/turns/*.jsonl`，普通 workspace operation 不暴露 `.tsian/*`，除非调用方拥有 platform-meta read level。`runtime-diagnostics` query 已提供面向 Agent/未来管理 UI 的 facts-only 诊断摘要视图；它按需从 raw trace 生成，不写派生文件、不做 pruning、不默认暴露给普通 live-turn Agent。
- Agent Session Transcript MVP 已落地：成功回合会把参与 Agent 的 Agent-facing 模型消息、输出、工具调用和 observation 追加到对应 `save/agents/<agent>/session.jsonl`；失败或 abort 不留下普通 session transcript 写入。
- Skill-triggered Memory Maintenance MVP 已落地：默认 `memory-maintenance` Skill 的 `apply_maintenance_plan` 使用 `browser_script` 和 Tsian SDK staged 写入 `save/agents/<agent>/notes.md`、`save/history/timeline.md`、`save/memory/summaries/current.md` 或 `save/memory/summaries/long-term.md`。没有显式 Skill action 就不会维护增强记忆，空 writes 仅表示显式 no-op。

后续实现应逐步：

1. 按具体 Skill 需求增强现有 `browser_script` / Tsian SDK / 受控平台动作；不要把独立 `remote_http`、WASM 或托管执行作为默认 foundation 后续项。
2. 在现有 `agent_call` 策略之上继续完善协作体验，例如管理 Agent、协作 Skill、调试 UI、可观察性或未来 host-owned 配置；不要恢复固定团队 DAG。
3. 在 Agent-facing diagnostics 基础上完善未来管理 Agent / Skill / UI 体验；若未来出现新 executor，再按事实补充对应诊断字段。
4. 继续完善记忆策略与体验：维护 Skill 提示质量、diff/review UI、summary 压缩、检索索引和 session transcript 归档。
5. 围绕 workspace-native state 继续完善默认约定、Skill 维护策略和前端可读取数据文件；不要恢复独立平台状态表。
6. 为 workspace、Agent 和 Skill 提供浏览与编辑 UI。
