# 自定义 Tools 创意工坊分发

## Goal

让自定义 Tool 像现有 Skill 一样进入创意工坊分发链路：作者可以把卡共享 Tool、Agent-local Tool、桌面助手本地 Tool 打包上传；玩家可以从创意工坊下载并安装到卡共享、指定 Agent 或桌面助手本地目录。完整桌面助手 Agent 包也应携带助手本地 `tools/`，保持与 `skills/` 对称。

## Background / Confirmed Facts

- 当前创意工坊资源类型只有 `game_card | agent | skill`，没有 `tool`：`packages/contracts/src/market.ts:1`、`apps/platform-server/internal/market/market.go:7-13`。
- 创意工坊 UI 上传入口只列出游戏卡、Agent、Skill：`apps/platform-web/src/views/AppMarketView.vue:241-244`。
- 现有非游戏卡资源包使用 `tsian.resource.package.v1` + `resource-package.json`，前端 `ResourcePackageManifest.resourceType` 当前承载 Agent / Skill：`apps/platform-web/src/platform-host/resource-packages.ts:24-33`。
- Skill 分发已有三类来源 / 目标：卡共享 `skills/<id>`、卡内 `agents/<agent>/skills/<id>`、桌面助手 `.tsian/local/assistant/skills/<id>`：`apps/platform-web/src/platform-host/resource-packages.ts:39-51`、`apps/platform-web/src/platform-host/resource-packages.ts:145-156`。
- Market 上传页已经为 Skill 构建卡内与桌面助手本地 Skill 选项：`apps/platform-web/src/views/AppMarketView.vue:318-339`。
- Tool 机制已经定义共享、Agent-local、User-local 三种路径：`packages/contracts/src/runtime.ts:560-562`，并有 `ToolRegistryEntry` 注册表条目：`packages/contracts/src/runtime.ts:578-607`。
- 完整游戏卡包导出会包含全部 card content files，所以卡内容里的 `tools/<id>/...`、`agents/<agent>/tools/<id>/...` 已能随完整卡包分发：`apps/platform-web/src/storage/game-card-packages.ts:643-691`。
- 卡内 Agent 资源包从 `agents/<agentId>/` 整目录导出，因此卡内 Agent-local Tools 会跟卡内 Agent 包一起走：`apps/platform-web/src/platform-host/resource-packages.ts:72-76`。
- 桌面助手 Agent 资源包当前只包含 `agent.json`、`AGENT.md`、`SOUL.md`、`skills/`，没有包含 `tools/`：`apps/platform-web/src/platform-host/resource-packages.ts:174-180`、`apps/platform-web/src/platform-host/resource-packages.ts:227-245`。
- 文档当前写明 `.tsian/local/<agent>/tools/<id>/...` 是机器私有，不随卡包分发；同时写明非 `.tsian/local/**` Tool 目录内容可以进入创意工坊分发：`docs/reference/tool-vs-skill.md:30`、`docs/reference/tool-vs-skill.md:105`。
- 用户已确认：桌面助手 Agent 包也应携带助手本地 `tools/`。

## Requirements

### R1: 增加 Tool 创意工坊资源类型

- `tool` 成为创意工坊的一等资源类型，与 `agent` / `skill` 并列。
- 列表、计数、上传、下载、更新、删除都接受 `tool` 资源类型。
- 下载 / 安装目标沿用现有 Agent / Skill 行为：卡内安装目标为当前加载的非内置游戏卡，另提供桌面助手目标。
- UI 资源类型栏展示 Tool，文案与视觉风格跟现有 Agent / Skill 入口一致。

### R2: Tool 资源包复用现有 resource-package 形态

- Tool 包沿用 `tsian.resource.package.v1` + `resource-package.json`，与 Skill 包形态相同。
- `resourceType` 为 `tool`。
- `resourceId` 默认来自 Tool registry id / 目录 id，显示标题默认来自 `tool.json.title` 或 `tool.json.name`。
- `summary` 默认来自 `tool.json.description`。
- 包内文件是 Tool 目录内的文本文件，至少包含 `tool.json`。
- v1 不支持二进制 Tool 包；遇到二进制文件应与现有资源包一致 fail-loud。

### R3: 支持与 Skill 对称的导出来源

- 卡共享 Tool：`tools/<toolId>/...`。
- 卡内 Agent-local Tool：`agents/<agentId>/tools/<toolId>/...`。
- 桌面助手本地 Tool：`.tsian/local/assistant/tools/<toolId>/...`。
- 上传页应能列出当前加载卡的共享 / Agent-local Tools，以及桌面助手本地 Tools。

### R4: 支持与 Skill 对称的安装目标

- 安装到卡共享：写入 `tools/<resourceId>/...`。
- 安装到指定卡内 Agent：写入 `agents/<agentId>/tools/<resourceId>/...`。
- 安装到桌面助手：写入 `.tsian/local/assistant/tools/<resourceId>/...`。
- 目标已存在同名 Tool 时，沿用 Skill 的替换确认交互。

### R5: 服务器端接受并校验 Tool 包

- Go 端 `ResourceType`、解析、计数响应、上传校验、下载文件名等路径支持 `tool`。
- `validateResourcePackageZip` 对 Tool 包要求 `tool.json` 存在，并保持现有 UTF-8 文本、manifest 文件清单完整性、安全相对路径等约束。
- 不在本任务新增更深层的 Tool schema / JS 安全审计；Tool registry 的现有诊断负责安装后本地校验反馈。

### R6: 桌面助手自定义 Tool 能独立发布 / 安装

- `.tsian/local/assistant/tools/<id>/...` 的 Tool 可以像 `.tsian/local/assistant/skills/<id>/...` 一样独立上传到创意工坊。
- 从创意工坊安装 Tool 到桌面助手时，只替换目标 Tool 目录，不影响助手的 sessions / traces / notes / skills / agent identity。

### R7: 桌面助手 Agent 包携带本地 `tools/`

- 桌面助手 Agent 包应包含 `agent.json`、`AGENT.md`、`SOUL.md`、`skills/`、`tools/`。
- 安装 / 覆盖桌面助手 Agent 包时，替换助手定义与 `skills/`、`tools/`，但保留 sessions / traces / notes 等本地运行数据。
- 覆盖确认文案需要明确会替换 `skills` 与 `tools`。

### R8: 文档同步

- 更新 Tool vs Skill 文档，说明 Tool 可作为独立创意工坊资源分发。
- 明确 `.tsian/local/**` 不随完整卡包 / checkpoint 分发，但可以通过显式 Tool 资源包上传。
- 更新创意工坊资源类型说明（如存在）。

## Acceptance Criteria

- [ ] 创意工坊合同类型、前端上传 / 列表 / 安装 UI、后端 ResourceType 都支持 `tool`。
- [ ] 作者能选择一个卡共享 Tool 上传，下载后能安装到另一张卡的 `tools/<id>/`。
- [ ] 作者能选择一个卡内 Agent-local Tool 上传，下载后能安装到指定 Agent 的 `agents/<agentId>/tools/<id>/`。
- [ ] 作者能选择一个桌面助手本地 Tool 上传，下载后能安装到 `.tsian/local/assistant/tools/<id>/`。
- [ ] Tool 包缺少 `tool.json` 时，前端安装或后端上传校验给出明确错误。
- [ ] 已存在同名目标 Tool 时，安装前出现替换确认；取消不会写入。
- [ ] 桌面助手 Agent 包导出包含本地 `tools/`，安装 / 覆盖助手 Agent 包时替换 `tools/` 且保留 sessions / traces / notes。
- [ ] 完整游戏卡包导出行为不被破坏，现有 Agent / Skill 资源包分发不回归。
- [ ] 文档说明 Tool 独立分发与 `.tsian/local/**` 的边界。
- [ ] 必要构建 / 测试通过：至少 `npm run build:contracts`、`npm run build:web`、后端 Go 测试（具体命令在 `implement.md` 固化）。

## Out of Scope

- 新增 Tool 运行时能力、Tool registry 规则、Tool schema 解析规则；本任务只做分发链路。
- 创意工坊安全沙箱、代码审计、权限模型升级。
- 外部 MCP server 集成。
- 二进制 Tool 包支持。
- 自动把 `.tsian/local/**` 纳入完整游戏卡包或 checkpoint。
