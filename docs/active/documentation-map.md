# Tsian Documentation Map

本文档说明 Tsian 当前文档分层、可信入口和维护边界。目标是让人类维护者和桌面助手都能知道：该读哪里、该改哪里、哪些内容不应混在一起。

## 1. 文档分层

### 1.1 仓库人类文档

位置：`README.md`、`docs/`、`docs/active/`、`docs/reference/`、`docs/sdk/`。

用途：

- 解释 Tsian 是什么、当前方向是什么、现在实现到了哪里。
- 记录平台、Agent Runtime、Runtime Workspace、游戏前端 Bridge 等长期方向。
- 为开发者和维护者提供阅读顺序与维护规则。

权威入口：

1. `README.md` — 项目快速介绍、运行方式和顶层导航。
2. `docs/README.md` — 文档目录口径和 active 文档入口。
3. `docs/active/current-state-handoff.md` — 当前实现状态。
4. `docs/active/airp-workflow-platform-direction.md` — 平台产品与架构方向。
5. `docs/active/agent-framework-runtime-workspace-direction.md` — Agent Framework、Skill、Runtime Workspace 方向。

### 1.2 平台内置助手知识

位置：`.tsian/local/assistant/skills/framework-knowledge/`。

源码来源：`apps/platform-web/src/storage/local-assistant-files.ts` 中的默认本地助手文件。

用途：

- 给桌面助手提供 Tsian 平台通用概念和边界。
- 帮助手区分平台知识、当前游戏卡 `docs/`、本地 workspace 文件分别代表什么。
- 引导助手在卡相关问题上读取当前游戏卡的 `docs/`、README、schema、Agent 和 Skill 文件，而不是只凭平台知识回答。

维护原则：

- 中文为主，保留必要英文术语、字段名和 API 名。
- 只写平台通用概念和边界，不写具体游戏卡世界观、具体游戏卡前端 UI 手册或问题处理 SOP。
- 不复制整套仓库文档；只保留助手回答问题前最需要的稳定知识入口和阅读顺序。

### 1.3 游戏卡随卡 `docs/`

位置：每张 Game Card 的 `docs/` 目录。

用途：

- 记录该游戏卡自己的世界观、玩法 schema、前端约定、卡内 SOP、作者说明。
- 随 Game Card 分发给其它玩家。
- 被桌面助手通过当前卡 workspace / knowledge mount 按需读取。

维护原则：

- 游戏卡特定知识不要写进平台内置助手知识。
- 平台通用知识不要在每张卡里复制一份；卡文档可以链接或简述平台概念，但不应成为平台事实的第二权威副本。
- 当前默认 Game Card 模板的随卡 `docs/` 暂不在本任务中维护；后续默认卡模板会替换为更通用、适合创作的模板，届时再统一更新。

## 2. 冲突时相信谁

当文档、代码和历史记录冲突时：

1. **当前代码**说明“现在实现是什么”。
2. **active docs**说明“当前方向和维护口径是什么”。
3. **Trellis tasks / git history**说明“过去为什么那样做”。
4. **archive / 旧 reference / 旧 AI 入口**只作为历史材料，不作为当前实现或规划依据。

如果 active 文档与当前代码冲突，应更新 active 文档或在任务中明确记录偏差；不要把旧事实复制到新的助手知识里。

## 3. 更新某类事实应该改哪里

| 事实类型 | 维护位置 |
|---|---|
| 项目一句话定位、快速开始、顶层导航 | `README.md` |
| 文档阅读顺序和文档分层 | `docs/README.md`、`docs/active/README.md`、本文档 |
| 当前实现状态 | `docs/active/current-state-handoff.md` |
| 平台产品与架构方向 | `docs/active/airp-workflow-platform-direction.md` |
| Agent / Skill / Runtime Workspace 方向 | `docs/active/agent-framework-runtime-workspace-direction.md` |
| 游戏前端 Bridge / SDK 方向 | `docs/active/play-frontend-sdk-direction.md`、`docs/sdk/play-frontend-api.md` |
| 助手前端自检方向 | `docs/active/assistant-frontend-inspection-direction.md` |
| 桌面助手平台通用概念知识 | `.tsian/local/assistant/skills/framework-knowledge/` 的默认源码 |
| 某张游戏卡的世界观、玩法、schema、前端约定 | 该 Game Card 的 `docs/` |
| 已退役或暂缓方向 | `docs/active/deferred-work.md` |

## 4. 桌面助手阅读边界

桌面助手回答问题时应遵循：

- 问 Tsian 平台通用概念：先使用平台内置 `framework-knowledge`。
- 问当前游戏卡内容、玩法、角色、schema、前端行为：读取当前 Game Card 的 `docs/` 和 workspace 文件。
- 问某个 Agent / Skill 怎么工作：读取对应 `agent.json`、`AGENT.md`、`SOUL.md`、`SKILL.md` 和附近 README。
- 问当前存档状态：读取 `save/...` 下的运行时文件和可用诊断资源。
- 不要把当前默认模板的旧内容当成平台通用事实；默认模板后续会重做。

## 5. 不再维护的旧入口

顶层 `CLAUDE.md` 不再作为项目 AI 入口维护。当前 AI/开发入口以 `AGENTS.md`、Trellis spec、Trellis task 和 active docs 为准。
