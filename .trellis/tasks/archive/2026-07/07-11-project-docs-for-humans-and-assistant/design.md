# Design: 完善人类与桌面助手可读项目文档

## Overview

本任务把“项目文档”拆成两个可维护层面：

1. **人类/维护者文档**：仓库中的 README 与 `docs/active/*`，用于说明当前项目方向、文档地图、维护边界和可信入口。
2. **桌面助手运行时知识**：平台本地助手实际会读取的 `.tsian/local/assistant/skills/framework-knowledge/`，用于给助手提供平台通用概念和边界。

游戏卡随卡分发的 `docs/` 是第三层：它负责具体游戏卡的世界观、玩法 schema、前端约定和卡内 SOP。本任务不维护当前默认卡模板的随卡 `docs/`，因为后续会替换默认卡模板。

## Boundaries

### In scope

- 新增 `docs/active/documentation-map.md`，并更新 `docs/README.md`、`docs/active/README.md`、根 `README.md` 的文档入口说明。
- 清理顶层 `CLAUDE.md` 旧入口，避免它继续作为 AI-facing 旧架构文档。
- 更新 active docs 中已确认的高风险冲突：平台本地助手 vs `studio-assistant`、默认阵容 `director`、`activeSceneIds` vs `activeSceneRefs` 等。
- 更新平台内置助手知识库默认内容：一个 `framework-knowledge` Skill + 四个 reference 文件。
- 给已有用户提供“更新助手知识”按钮：刷新平台内置 `framework-knowledge` 官方文件。

### Out of scope

- 不实现新的桌面助手聊天 UI 或 runtime tool。
- 不实现 `manifest.assistant.agentId` 或卡内 `studio-assistant`。
- 不更新玩家现有游戏卡 `docs/`。
- 不维护当前默认 Game Card 模板随卡 `docs/`。
- 不写通用问题 SOP；只写平台通用概念和边界。
- 不主动治理全仓所有旧文档入口；只处理顶层 `CLAUDE.md`，其它明显误导内容发现后再处理或记录。

## Documentation model

### Human docs

新增 `docs/active/documentation-map.md`，内容聚焦：

- 新人、开发者、桌面助手知识维护者分别从哪里读起。
- `README.md` / `docs/README.md` / `docs/active/README.md` / active direction docs 的职责。
- 平台内置助手知识和游戏卡随卡 `docs/` 的边界。
- 当前默认卡模板随卡 docs 暂不维护，后续默认创作模板重做时再更新。
- 冲突优先级：当前代码说明实现，active docs 说明当前方向，Trellis tasks 说明历史。

根 `README.md` 的文档段落只做导航，不复制长知识，避免再次漂移。

### Assistant runtime knowledge

保持一个 Skill：

```text
.tsian/local/assistant/skills/framework-knowledge/
  SKILL.md
  references/
    platform-concepts.md
    documentation-boundaries.md
    workspace-and-authoring.md
    frontend-and-bridge.md
```

职责：

- `SKILL.md`：说明何时使用、阅读顺序、平台知识与卡 docs 的边界。
- `platform-concepts.md`：Tsian / Game Card / Save Instance / Runtime Workspace / Agent / Skill / Bridge / checkpoint / 桌面助手等通用概念。
- `documentation-boundaries.md`：人类文档、平台内置助手知识、游戏卡随卡 docs 的权威边界。
- `workspace-and-authoring.md`：Runtime Workspace、Agent/Skill 文件入口、助手编辑前应读取本地 README/schema/Agent/Skill 的原则。
- `frontend-and-bridge.md`：游戏前端可替换、Bridge 通用边界、`inspect_frontend` 只检查玩家当前真实 `/play` 场景的定位。

这些内容中文为主，保留英文术语、字段名和 API 名。内容不写具体游戏卡世界观、具体前端 UI 手册或问题 SOP。

## Existing-user update flow

### Storage helper

在 `apps/platform-web/src/storage/local-assistant-files.ts` 中把 `framework-knowledge` 默认文件从 `defaultLocalAssistantFileMap()` 中拆成独立 helper：

- `LOCAL_ASSISTANT_FRAMEWORK_KNOWLEDGE_DIR`
- `defaultFrameworkKnowledgeFileMap()`
- 新官方文件 path 列表
- 已废弃官方文件 path 列表（旧 `platform-architecture.md` / `frontend-development.md` / `memory-system.md` 等）
- `refreshLocalAssistantFrameworkKnowledgeFiles()`：只覆盖/清理官方 `framework-knowledge` 文件，不触碰 `AGENT.md`、`SOUL.md`、`notes.md`、`agent.json`、其它 Skill/Tool、当前游戏卡 docs。

刷新策略：

1. 读取 `assistant-local-files` Dexie meta map。
2. 删除已知官方旧路径和将被替换的新官方路径。
3. 写入新的官方 `framework-knowledge` 文件。
4. 保留其它 `.tsian/local/assistant/**` 路径，包括用户自定义 Tool/Skill、notes、agent config 和非官方 framework-knowledge 旁路文件。

无需 Dexie schema 变更。

### Platform-host API

在 `apps/platform-web/src/platform-host/local-assistant.ts` 增加薄封装：

- `refreshLocalAssistantKnowledge(): Promise<{ updatedPaths: string[]; removedPaths: string[] }>`

并从 `platform-host/index.ts` re-export，供配置面板调用。实现留在 storage / local-assistant 模块，不把逻辑塞进 barrel。

### UI

在 `apps/platform-web/src/components/assistant/AssistantConfigPanel.vue` 中新增独立“助手知识库”区块，建议放在权限边界之后、Skills 列表之前：

- 说明平台内置知识库用于桌面助手理解 Tsian 通用概念和边界。
- 明确只刷新 `.tsian/local/assistant/skills/framework-knowledge/` 官方文件。
- 明确不会修改助手身份、风格、笔记、模型配置、自定义 Tool/Skill 或当前游戏卡 docs。
- 按钮文案：`更新助手知识`。
- 点击前使用现有 `confirm()` 弹确认。
- 成功后 `toast.success`，失败后 `toast.error`。
- 有未应用配置变更时禁用刷新按钮，避免刷新后 reload 与草稿状态混淆。

## AI-facing cleanup

对助手会读取的 `framework-knowledge` 内容执行旧概念检查，确保不再诱导使用：

- `studio-assistant`
- `manifest.assistant`
- `activeSceneIds`
- `save/world`
- `save/state`
- `event card` / `event-card`
- `memory-system`
- `master-agent`
- `narrative-agent`

Human docs 可以在必要时用“历史/不再维护”的方式解释旧概念，但平台内置助手知识不应保留会诱导使用的旧路径和旧架构。

## Compatibility and rollback

- 不改 contracts，不改 Dexie schema，不需要 `build:contracts`。
- 刷新按钮只改 local assistant meta map 中的官方 knowledge 文件；误改可通过 git revert 恢复代码。用户点击后的本地数据变化是主动操作，UI 会提前提示覆盖官方知识库。
- 删除顶层 `CLAUDE.md` 是清理旧入口；若后续需要其它 AI 客户端入口，应通过 `AGENTS.md` / Trellis / active docs 重新设计，而不是恢复旧内容。

## Validation

- `npm run build:web`
- `git diff --check`
- grep changed assistant-visible knowledge for stale concepts listed in “AI-facing cleanup”。
- 手动/代码检查刷新函数只写官方 `framework-knowledge` paths，不改 `AGENT.md`、`SOUL.md`、`notes.md`、`agent.json`、用户 Tool/Skill 或 card docs。
