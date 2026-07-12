# Design: Studio 运行配置新增规则模块开关

## Overview

在 Studio 运行配置 tab 新增"规则模块"开关区域。改动涉及 `studio-agents.ts`（snapshot 增强 + 写入函数）、`StudioView.vue`（UI 区域）、`index.ts`（RPC 注册）。

## 改动地图

```
apps/platform-web/src/platform-host/studio-agents.ts  — snapshot 新增 modules + 写入函数
apps/platform-web/src/views/StudioView.vue             — 运行配置 tab 新增规则模块区域
apps/platform-web/src/platform-host/index.ts           — 注册新 RPC（如需要）
```

## 1. Snapshot 增强

### 1.1 模块发现

在 `getPlatformStudioSnapshot` 中，扫描 workspace files 发现模块文件：

```ts
export interface PlatformStudioModuleInfo {
  /** Agent id that owns this module. */
  agentId: string
  /** File stem (用于 enabledModules 匹配). */
  stem: string
  /** 显示名（从文件第一行 `# 标题` 提取，fallback to stem). */
  title: string
  /** Workspace 文件路径. */
  path: string
}

// PlatformStudioSnapshot 新增:
modules: PlatformStudioModuleInfo[]
```

发现逻辑：遍历 `context.files`，匹配路径 `agents/<agentId>/modules/*.md`，提取 stem 和 title。

### 1.2 StudioView 消费

```ts
const modulesForSelectedAgent = computed(() => {
  if (!snapshot.value || !selectedAgent.value) return []
  return snapshot.value.modules.filter((m) => m.agentId === selectedAgent.value!.id)
})
```

## 2. 写入函数

### 2.1 updatePlatformStudioAgentModuleEnabled

```ts
export interface PlatformStudioAgentModuleToggleInput {
  agentId: string
  moduleStem: string
  enabled: boolean
}

export async function updatePlatformStudioAgentModuleEnabled(
  input: PlatformStudioAgentModuleToggleInput,
): Promise<WorkspaceFile> {
  // 与 updatePlatformStudioAgentSkillEnabled 模式一致：
  // 1. getPlatformActiveGameCard
  // 2. activeStudioWorkspaceFiles
  // 3. findStudioAgent
  // 4. parseAgentConfigRecord
  // 5. 修改 enabledModules 数组
  //    - enabled=true: 如果 stem 不在列表中，追加
  //    - enabled=false: 从列表中移除 stem
  // 6. writeAgentConfigRecord
}
```

### 2.2 RPC 注册

在 `platform-host/index.ts` 的 `studio` 命名空间注册新方法。检查现有 studio RPC 注册模式（如 `updatePlatformStudioAgentSkillEnabled` 是怎么暴露给前端的）。

## 3. StudioView UI

### 3.1 运行配置 tab 新增区域

在现有能力开关区域之后，新增"规则模块"区域：

```vue
<!-- 规则模块 -->
<div v-if="modulesForSelectedAgent.length > 0" class="...">
  <h4>规则模块</h4>
  <div v-for="module in modulesForSelectedAgent" :key="module.path">
    <Switch
      :modelValue="isModuleEnabled(selectedAgent, module.stem)"
      @update:modelValue="toggleModule(module.stem, $event)"
    />
    <span>{{ module.title }}</span>
  </div>
</div>
```

### 3.2 辅助函数

```ts
function isModuleEnabled(agent: AgentRegistryEntry, stem: string): boolean {
  return agent.enabledModules.includes(stem)
}

async function toggleModule(stem: string, enabled: boolean) {
  if (!selectedAgent.value) return
  await studio.updateAgentModuleEnabled({
    agentId: selectedAgent.value.id,
    moduleStem: stem,
    enabled,
  })
  await refreshSnapshot()
}
```

### 3.3 无模块时

`modulesForSelectedAgent.length === 0` 时不显示该区域（`v-if`）。

## 4. title 提取

从模块文件内容第一行提取 title：

```ts
function extractModuleTitle(content: string, stem: string): string {
  const firstLine = content.split("\n").find((line) => line.trim())
  if (firstLine && firstLine.startsWith("# ")) {
    return firstLine.slice(2).trim()
  }
  return stem
}
```

`# 反固定：剧情推进反模板化` → `反固定：剧情推进反模板化`

## 5. 不做的事

- 不改 contracts（`enabledModules` 已在 AgentRegistryEntry 中）
- 不改 registry（解析逻辑已实现）
- 不做模块内容编辑器
- 不做 contextPaths 可视化编辑
- 不做玩家端 UI
