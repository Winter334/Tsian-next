# 创意工坊：多资源类型分享 + Tag 分类 + 差异化安装

## Goal

把当前"应用市场"（仅整卡包上传/下载）演进为"创意工坊"：支持游戏卡包、Agent、Skill 三种资源类型的独立上传/分享/安装，配合 tag 分类检索和差异化的安装目标选择。

## Parent

- `.trellis/tasks/06-22-mvp-completion`

## Background

当前应用市场任务 `06-22-app-market` 已完成 MVP：整卡包上传/下载/搜索/安装，`resource_type` 字段已预留。本任务在此基础上扩展多资源类型、tag 分类和差异化安装。

## User Value

- 玩家可以单独分享自己做的 Agent 或 Skill，不必打包整张卡
- 安装 Agent/Skill 时可以选择安装目标（全局 / 指定游戏卡 / 指定 Agent）
- tag 分类让市场内容可检索、可过滤，不再只有"全部"一个视图

## Confirmed Facts

- `market_packages` 表已有 `resource_type` 字段（默认 `'game_card'`），`MarketResourceType = "game_card"` 在 contracts 里定义
- `BlobStore` 接口 + `FileSystemBlobStore` 已实现，文件存储层已隔离
- `internal/market/` 包已建：domain types + SQLite repo + HTTP handler，路由注册在 `/api/v1/market/*`
- 前端 `marketApi`（list/get/upload/download）已实现，`AppMarketView` 是 list/detail/upload 状态机
- Agent 是卡内工作区文件：`agents/<id>/agent.json` + `AGENT.md` + 可选 `SOUL.md`
- Skill 是卡内工作区文件：`skills/<id>/SKILL.md` + 可选 `skill.config` + 脚本
- Agent/Skill 当前没有独立打包格式（只在卡包 zip 内随 `workspace/` 前缀存在）
- 桌面助手是 level 4 Agent，位于 `.tsian/local/assistant/`；游戏卡 Agent 是 level 1，位于 `agents/`
- Skill 安装目标语义：全局（不含助手）/ 指定游戏卡 / 指定 Agent（含助手）

## Requirements（方向性，待详细规划）

- R1: 资源类型扩展：`resource_type` 新增 `agent` / `skill`，每种类型有独立的打包格式
- R2: Agent 打包格式：`agents/<id>/` 目录的 zip（agent.json + AGENT.md + SOUL.md + agent-local skills）
- R3: Skill 打包格式：`skills/<id>/` 目录的 zip（SKILL.md + skill.config + 脚本）
- R4: Tag 系统：作者上传时打 tag，市场按 tag 过滤/搜索；tag 存储和检索方案待定
- R5: 差异化安装：
  - 游戏卡包：安装到本地（复用现有 importGameCardPackage）
  - Agent：安装到指定游戏卡（写入卡包 `agents/<id>/`）或安装到助手（`.tsian/local/assistant/agents/<id>/`）
  - Skill：安装到全局（`skills/<id>/`，不含助手）/ 指定游戏卡 / 指定 Agent（agent-local）
- R6: 前端 UI：资源类型切换（卡包/Agent/Skill）、tag 筛选、安装目标选择对话框
- R7: 后端校验：Agent zip 含有效 agent.json；Skill zip 含有效 SKILL.md

## Out of Scope

- 评论/评分/社交
- 付费/交易
- 版本管理/更新推送
- 审核机制

## Open Questions

- Agent/Skill 独立打包格式的详细规范（zip 内目录结构、manifest 校验规则）
- Tag 存储：market_packages 加 tags 列（JSON 数组 + LIKE）还是独立 market_tags 关联表？
- Agent/Skill 安装到游戏卡时，目标卡如何选择（UI 交互）？是否需要目标卡已加载？
- Skill 安装到"全局"和"指定游戏卡"的存储路径区分
- Agent/Skill 上传时的元数据字段（title/summary 从哪里来？agent.json 的 title/summary？SKILL.md frontmatter 的 name/title/description？）
- 市场改名为"创意工坊"的 UI 调整范围（桌面图标标签、窗口标题、路由名是否改）
- 与现有 app-market 任务的归档关系（app-market 先归档还是合并）
