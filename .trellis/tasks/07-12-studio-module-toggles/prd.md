# Studio 运行配置新增规则模块开关

## Goal

在 Studio 的运行配置 tab 里新增"规则模块"开关区域，让卡作者能查看 Agent 有哪些可选规则模块、切换启用/禁用。与现有 skill/tool 开关心智一致。

## Background

### 已完成的上下文

- **规则拼接系统**（commit `6cade9e`）：contextPaths 支持 `{template, role}` + `{{file:...?enabled}}` 宏 + `enabledModules` 启用列表
- **可选规则模块**（commit `2db6a39`）：4 个模块文件在 `agents/storyteller/modules/`，storyteller agent.json 已配置 `{template: "{{file:modules/*.md?enabled}}", role: "system"}` + `enabledModules: ["反固定", "User去中心化", "深度", "抗绝望"]`

### Studio 现状

- `StudioView.vue` 有 4 个 tab：AGENT.md / SOUL.md / Skills / 运行配置
- 运行配置 tab 已有：服务商预设 Select、Workspace 权限 Select、能力开关（platform tools + user tools 的 Switch 列表）
- `studio-agents.ts` 有写入模式：`updatePlatformStudioAgentSkillEnabled` / `updatePlatformStudioAgentToolEnabled` / `updatePlatformStudioAgentPlatformToolEnabled` 等，都通过 `parseAgentConfigRecord` → 修改字段 → `writeAgentConfigRecord` 写回 card-content
- `PlatformStudioSnapshot` 包含 `agents: AgentRegistryEntry[]`（已有 `enabledModules: string[]`）、`skills`、`tools`——但不含模块文件列表
- `AgentRegistryEntry.enabledModules` 已在 contracts 和 registry 中定义和解析

### 关键约束

- Studio 能写 card-content（`writeCardContentFileForCard`），所以直接改 `agent.json.enabledModules` 即可——不需要 save-runtime 覆盖层
- 模块文件是 per-agent 的（`agents/<id>/modules/*.md`），不像 skills/tools 是全局共享的
- StudioView 目前不能直接访问 workspace 原始文件列表——需要通过 snapshot 或新 API 获取模块文件列表

## Requirements

### R1: 模块文件发现

Studio 需要知道每个 Agent 有哪些可选模块文件。在 `PlatformStudioSnapshot` 中新增模块文件列表，或在 `AgentRegistryEntry` 中新增 `availableModules` 字段。

### R2: 模块开关 UI

在运行配置 tab 的能力开关区域之后（或之前），新增"规则模块"区域：
- 列出 Agent 的所有模块文件（`agents/<id>/modules/*.md`）
- 每个模块一个 Switch，状态对应 `enabledModules` 是否包含该 stem
- 切换时调用新的 `updatePlatformStudioAgentModuleEnabled` 函数

### R3: 写入函数

新增 `updatePlatformStudioAgentModuleEnabled(input: { agentId, moduleStem, enabled })`：
- 读取 agent.json
- 修改 `enabledModules` 数组（启用=追加 stem，禁用=移除 stem）
- 写回 card-content
- 与现有 `updatePlatformStudioAgentSkillEnabled` 模式一致

### R4: 无模块时的显示

如果 Agent 没有 modules 目录或目录为空，不显示"规则模块"区域（或显示空状态提示）。

## Acceptance Criteria

- [ ] Studio 运行配置 tab 新增"规则模块"开关区域
- [ ] 列出 storyteller 的 4 个模块（反固定/User去中心化/深度/抗绝望），每个有 Switch
- [ ] Switch 状态正确反映 enabledModules（默认全开）
- [ ] 切换 Switch 后 agent.json.enabledModules 正确更新
- [ ] 没有 modules 目录的 Agent 不显示该区域
- [ ] `apps/platform-web` build 通过

## Out of Scope

- 玩家端（play-frontend-dev）的规则模块 UI（后续任务）
- 模块文件的内容编辑（只做开关，不做内容编辑器）
- contextPaths 的可视化编辑（只做 enabledModules 开关）

## Open Questions

- 模块文件列表放在 snapshot 里还是 AgentRegistryEntry 里？
- 模块开关区域放在能力开关之前还是之后？
