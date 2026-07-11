<template>
  <div class="flex max-h-[70vh] min-h-0 flex-col">
    <div class="grid min-h-0 flex-1 gap-3 overflow-auto p-1">
      <!-- Workspace Access section -->
      <section class="border border-neon-deep/35 bg-panel/55">
        <div class="border-b border-neon-deep/25 px-3 py-2">
          <p class="text-sm font-bold text-text-main">权限边界</p>
          <p class="mt-0.5 text-xs leading-5 text-text-dim">决定桌面助手能维护哪些 Workspace 区域。</p>
        </div>
        <div class="grid gap-3 p-3">
          <label class="grid gap-2">
            <span class="text-xs font-bold text-text-main">Workspace 权限</span>
            <Select
              :model-value="String(workspaceLevel)"
              :disabled="applying || updatingKnowledge || !agent"
              @update:model-value="(value) => updateWorkspaceAccessLevel(Number(value))"
            >
              <SelectTrigger class="h-9 w-full">
                <SelectValue placeholder="选择权限等级" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem
                  v-for="option in workspaceAccessOptions"
                  :key="option.level"
                  :value="String(option.level)"
                >
                  {{ option.label }}
                </SelectItem>
              </SelectContent>
            </Select>
          </label>
          <p class="text-xs leading-5 text-text-dim">{{ workspaceAccessDescription }}</p>
        </div>
      </section>

      <section class="border border-neon-deep/35 bg-panel/55">
        <div class="border-b border-neon-deep/25 px-3 py-2">
          <p class="text-sm font-bold text-text-main">助手知识库</p>
          <p class="mt-0.5 text-xs leading-5 text-text-dim">
            更新桌面助手理解 Tsian 所需的基础说明。
          </p>
        </div>
        <div class="grid gap-3 p-3">
          <p class="text-xs leading-5 text-text-dim">
            只会更新助手用于理解 Tsian 的内置说明；不会改变你的助手设定、风格、个人笔记、模型与权限设置、自定义能力，也不会修改当前游戏卡内容。
          </p>
          <div class="flex justify-end">
            <button
              type="button"
              class="retro-button retro-focus inline-flex h-8 items-center px-3 font-mono text-xs disabled:opacity-45"
              :disabled="applying || updatingKnowledge || hasChanges"
              :title="hasChanges ? '请先应用或取消未保存的助手配置变更' : '更新助手理解 Tsian 所需的基础说明'"
              @click="refreshKnowledge"
            >
              {{ updatingKnowledge ? "更新中..." : "更新助手知识" }}
            </button>
          </div>
        </div>
      </section>

      <!-- Skills section -->
      <section class="border border-neon-deep/35 bg-panel/55">
        <div class="flex items-center justify-between border-b border-neon-deep/25 px-3 py-2">
          <p class="font-mono text-[11px] uppercase tracking-wider text-neon">Skills</p>
          <p class="font-mono text-[11px] text-text-dim">{{ enabledSkillCount }} / {{ skills.length }} 已启用</p>
        </div>
        <div class="grid gap-2 p-3">
          <div
            v-for="skill in skills"
            :key="skill.path"
            class="border border-neon-deep/30 bg-elevated/45 hover:bg-elevated"
          >
            <div
              class="retro-focus grid gap-3 p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start"
            >
              <span class="min-w-0">
                <span class="block truncate text-sm font-bold text-text-main">{{ skill.title }}</span>
                <span class="mt-1 block line-clamp-2 text-xs leading-5 text-text-dim">{{ entrySummary(skill.description || skill.summary) }}</span>
                <span class="mt-2 block break-all font-mono text-[11px] text-neon-muted">{{ skill.path }}</span>
              </span>
              <Switch
                :model-value="skillEnabled(skill)"
                :disabled="applying || updatingKnowledge || !agent"
                :aria-label="skill.title"
                @update:model-value="(value) => toggleSkill(skill, Boolean(value))"
              />
            </div>
            <!-- Skill config (skill.config 声明的配置项):仅声明了 configItems 的 skill 渲染。
                 点输入框不触发上方 checkbox;value 走草稿,应用时统一保存。 -->
            <div
              v-if="skill.configItems && skill.configItems.length > 0"
              class="grid gap-3 border-t border-neon-deep/20 p-3"
              @click.stop
            >
              <p class="font-mono text-[11px] uppercase tracking-wider text-neon-muted">
                配置{{ skillConfigChanged(skill.path) ? " · 未保存" : "" }}
              </p>
              <label
                v-for="item in skill.configItems"
                :key="item.key"
                class="grid gap-1"
              >
                <span class="text-xs text-text-dim">
                  <span class="font-mono text-text-main">{{ item.key }}</span>
                  <span v-if="item.description" class="ml-1">{{ item.description }}</span>
                </span>
                <input
                  class="retro-focus h-8 w-full border border-neon-deep/30 bg-panel/60 px-2 font-mono text-xs text-text-main"
                  :type="isSecretKey(item.key) ? 'password' : 'text'"
                  :value="configValue(skill.path, item)"
                  :disabled="applying || updatingKnowledge"
                  :placeholder="item.defaultValue || ''"
                  spellcheck="false"
                  autocomplete="off"
                  @input="setConfigValue(skill.path, item, ($event.target as HTMLInputElement).value)"
                >
              </label>
            </div>
          </div>

          <p v-if="skills.length === 0" class="border border-neon-deep/35 bg-panel/55 p-3 text-sm text-text-dim">
            助手还没有可管理的 Skill。
          </p>
        </div>
      </section>

      <!-- Capability section -->
      <section class="border border-neon-deep/35 bg-panel/55">
        <div class="flex flex-wrap items-start justify-between gap-3 border-b border-neon-deep/25 px-3 py-2">
          <div>
            <p class="text-sm font-bold text-text-main">能力开关</p>
            <p class="mt-0.5 text-xs leading-5 text-text-dim">平台能力与助手本地 Tool 共用这一组可调用能力配置。</p>
          </div>
          <div class="flex flex-wrap items-center justify-end gap-3">
            <p class="font-mono text-[11px] text-text-dim">
              {{ enabledAssistantCapabilityCount }} / {{ assistantCapabilities.length }} 已启用
            </p>
            <ParamTip
              v-if="toolDiagnostics.length > 0"
              tone="warning"
              label="助手本地 Tool 诊断"
              :trigger-text="`${toolDiagnostics.length} 条诊断`"
            >
              <div class="grid gap-2">
                <p class="text-xs font-bold text-warning">助手本地 Tool 诊断</p>
                <div
                  v-for="(diag, index) in toolDiagnostics"
                  :key="`${diag.code}-${index}`"
                  class="border border-neon-deep/30 bg-elevated/50 p-2"
                >
                  <div class="flex flex-wrap items-center gap-2">
                    <span
                      class="border px-1 py-0.5 font-mono text-[10px] uppercase"
                      :class="diagLevelClass(diag.level)"
                    >{{ diag.level }}</span>
                    <span class="font-mono text-[11px] text-text-main">{{ diag.code }}</span>
                  </div>
                  <p v-if="diag.path" class="mt-1 truncate font-mono text-[11px] text-text-dim">{{ diag.path }}</p>
                  <p class="mt-1 text-[11px] leading-5 text-text-main">{{ diag.message }}</p>
                  <p v-if="diag.hint" class="mt-0.5 text-[11px] leading-5 text-text-dim">Hint: {{ diag.hint }}</p>
                </div>
              </div>
            </ParamTip>
          </div>
        </div>

        <div class="grid gap-2 p-3">
          <article
            v-for="capability in assistantCapabilities"
            :key="capability.key"
            class="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3 border border-neon-deep/25 bg-elevated/35 p-3 transition-colors hover:bg-elevated/55"
          >
            <div class="min-w-0">
              <div class="flex min-w-0 flex-wrap items-center gap-2">
                <p class="truncate text-sm font-bold text-text-main">{{ capability.title }}</p>
                <span class="border border-neon-deep/35 px-1.5 py-0.5 text-[10px] leading-none text-neon-muted">
                  {{ capability.badge }}
                </span>
                <ParamTip :tip="capability.description" :label="capability.title" />
              </div>
              <p class="mt-1 line-clamp-2 text-xs leading-5 text-text-dim">
                {{ capability.description }}
              </p>
              <p v-if="capability.path" class="mt-1 truncate font-mono text-[11px] text-text-dim/80">
                {{ capability.path }}
              </p>
            </div>
            <Switch
              class="mt-0.5"
              :model-value="capability.enabled"
              :disabled="capability.disabled"
              :aria-label="capability.title"
              @update:model-value="(value) => toggleAssistantCapability(capability, Boolean(value))"
            />
          </article>
        </div>

        <div
          v-if="tools.length === 0"
          class="border-t border-neon-deep/20 px-3 py-2 text-xs leading-5 text-text-dim"
        >
          还没有助手本地 Tool。放置 <code class="font-mono text-[11px]">.tsian/local/assistant/tools/&lt;id&gt;/tool.json</code> 后会出现在这里。
        </div>
      </section>

    </div>

    <!-- Footer: Windows-style 取消/应用/确定 (X in title bar also cancels) -->
    <div class="flex items-center justify-between gap-2 border-t border-neon-deep/30 px-3 py-3">
      <button
        type="button"
        class="retro-button retro-focus inline-flex h-8 items-center px-3 font-mono text-xs"
        :disabled="applying || updatingKnowledge"
        @click="cancelChanges"
      >
        取消
      </button>
      <div class="flex gap-2">
        <button
          type="button"
          class="retro-button retro-focus inline-flex h-8 items-center px-3 font-mono text-xs disabled:opacity-45"
              :disabled="!hasChanges || applying || updatingKnowledge"
          @click="applyChanges"
        >
          应用
        </button>
        <button
          type="button"
          class="retro-button retro-focus inline-flex h-8 items-center px-3 font-mono text-xs disabled:opacity-45"
          :disabled="applying || updatingKnowledge"
          @click="confirmChanges"
        >
          确定
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue"
import type {
  AgentPlatformToolName,
  AgentRegistryEntry,
  RegistryDiagnostic,
  SkillRegistryEntry,
  ToolRegistryEntry,
} from "@tsian/contracts"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { isAgentPlatformToolEnabled } from "@/agent-runtime/permissions"
import { PLATFORM_TOOL_CONTROL_GROUPS, type PlatformToolControl } from "@/agent-runtime/tool-controls"
import { isSkillEnabledForAgent, isToolEnabledForAgent } from "@/agent-runtime/registry"
import { toast } from "@/composables/useToast"
import { confirm } from "@/composables/useConfirm"
import { ParamTip } from "@/components/ui/tip"
import {
  getLocalAssistantConfig,
  refreshLocalAssistantKnowledge,
  updateLocalAssistantPlatformToolEnabled,
  updateLocalAssistantSkillConfig,
  updateLocalAssistantSkillEnabled,
  updateLocalAssistantToolEnabled,
  updateLocalAssistantWorkspaceAccess,
  type LocalAssistantConfig,
} from "@/platform-host"
import type { SkillConfigItem } from "@tsian/contracts"

const emit = defineEmits<{
  (event: "change"): void
  (event: "close"): void
}>()

type AssistantCapability =
  | {
      kind: "platform"
      key: string
      title: string
      description: string
      badge: string
      path?: string
      enabled: boolean
      disabled: boolean
      tool: PlatformToolControl
    }
  | {
      kind: "tool"
      key: string
      title: string
      description: string
      badge: string
      path: string
      enabled: boolean
      disabled: boolean
      tool: ToolRegistryEntry
    }

const agent = ref<AgentRegistryEntry | null>(null)
const skills = ref<SkillRegistryEntry[]>([])
const tools = ref<ToolRegistryEntry[]>([])
const toolDiagnostics = ref<RegistryDiagnostic[]>([])

/**
 * 草稿覆盖层:只记录与原始持久化状态不同的字段。toggle 只改草稿,
 * 不触发持久化;点「应用」/「确定」时 diff 草稿与原始状态,逐字段调
 * setter 保存。这样复用现有单字段 setter,避免重写全量保存逻辑。
 */
const skillOverrides = ref(new Map<string, boolean>())
const platformToolOverrides = ref(new Map<AgentPlatformToolName, boolean>())
const toolOverrides = ref(new Map<string, boolean>())
const workspaceLevelOverride = ref<number | null>(null)
const applying = ref(false)
const updatingKnowledge = ref(false)

/**
 * Skill config 初始值(玩家已存值 ?? 默认值),reload 时填充。
 * key = skill.path,value = Record<configKey, initialValue>。
 */
const skillConfigInitial = ref(new Map<string, Record<string, string>>())
/**
 * Skill config 草稿覆盖:只记与初始值不同的 key。编辑只改草稿,
 * 应用时逐 skill 调 updateLocalAssistantSkillConfig 保存全量。
 */
const skillConfigDraft = ref(new Map<string, Record<string, string>>())

const workspaceAccessOptions = [
  {
    level: 0,
    label: "只读",
    description: "只能读取普通游戏卡和存档内容。",
  },
  {
    level: 1,
    label: "可维护存档",
    description: "可以维护当前存档的运行时文件。",
  },
  {
    level: 2,
    label: "可编辑游戏卡",
    description: "可以编辑游戏卡内容；当前运行时仍会优先限制普通写入到存档。",
  },
  {
    level: 4,
    label: "平台维护",
    description: "允许访问平台元数据能力，仅适合受信任的维护 Agent。",
  },
]

// --- 草稿读法(override 优先,回退原始状态) ---
function skillEnabled(skill: SkillRegistryEntry): boolean {
  if (skillOverrides.value.has(skill.path)) {
    return skillOverrides.value.get(skill.path) ?? false
  }
  return agent.value ? isSkillEnabledForAgent(skill, agent.value) : false
}

function platformToolEnabled(tool: AgentPlatformToolName): boolean {
  if (platformToolOverrides.value.has(tool)) {
    return platformToolOverrides.value.get(tool) ?? false
  }
  return agent.value ? isAgentPlatformToolEnabled(agent.value, tool) : false
}

function toolEnabled(tool: ToolRegistryEntry): boolean {
  if (toolOverrides.value.has(tool.name)) {
    return toolOverrides.value.get(tool.name) ?? false
  }
  return agent.value ? isToolEnabledForAgent(tool, agent.value) : false
}

const assistantCapabilities = computed<AssistantCapability[]>(() => {
  const platformCapabilities = PLATFORM_TOOL_CONTROL_GROUPS.flatMap((group) =>
    group.tools.map<AssistantCapability>((tool) => ({
      kind: "platform",
      key: `platform:${tool.id}`,
      title: tool.label,
      description: tool.description,
      badge: `平台能力 · ${group.title}`,
      enabled: platformToolEnabled(tool.id),
      disabled: applying.value || updatingKnowledge.value || !agent.value,
      tool,
    })),
  )
  const localToolCapabilities = tools.value.map<AssistantCapability>((tool) => ({
    kind: "tool",
    key: `tool:${tool.path}`,
    title: tool.name,
    description: tool.description,
    badge: "助手本地 Tool",
    path: tool.path,
    enabled: toolEnabled(tool),
    disabled: applying.value || updatingKnowledge.value || !agent.value,
    tool,
  }))
  return [...platformCapabilities, ...localToolCapabilities]
})

const enabledAssistantCapabilityCount = computed(() =>
  assistantCapabilities.value.filter((capability) => capability.enabled).length
)

const workspaceLevel = computed(() => workspaceLevelOverride.value ?? agent.value?.workspaceAccess.level ?? 1)

const enabledSkillCount = computed(() => skills.value.filter((s) => skillEnabled(s)).length)

const workspaceAccessDescription = computed(() =>
  workspaceAccessOptions.find((option) => option.level === workspaceLevel.value)?.description ?? "",
)

/** key 名含 KEY/SECRET/TOKEN/PASSWORD 时输入框用 password 遮蔽(无需声明类型)。 */
function isSecretKey(key: string): boolean {
  const upper = key.toUpperCase()
  return ["KEY", "SECRET", "TOKEN", "PASSWORD"].some((s) => upper.includes(s))
}

/**
 * 取某 skill 某 key 的当前显示值:草稿优先,回退初始值,再回退默认值。
 */
function configValue(skillPath: string, item: SkillConfigItem): string {
  const draft = skillConfigDraft.value.get(skillPath)
  if (draft && item.key in draft) {
    return draft[item.key]
  }
  const initial = skillConfigInitial.value.get(skillPath)
  if (initial && item.key in initial) {
    return initial[item.key]
  }
  return item.defaultValue
}

/**
 * 编辑某 key:写入草稿。若新值等于初始值则从草稿移除(保持草稿只记差异)。
 */
function setConfigValue(skillPath: string, item: SkillConfigItem, value: string): void {
  if (applying.value) {
    return
  }
  const initial = skillConfigInitial.value.get(skillPath) ?? {}
  const next = { ...(skillConfigDraft.value.get(skillPath) ?? {}) }
  if (value === (initial[item.key] ?? item.defaultValue)) {
    delete next[item.key]
  } else {
    next[item.key] = value
  }
  const nextDraft = new Map(skillConfigDraft.value)
  if (Object.keys(next).length === 0) {
    nextDraft.delete(skillPath)
  } else {
    nextDraft.set(skillPath, next)
  }
  skillConfigDraft.value = nextDraft
}

/** 某 skill 是否有未保存的 config 变更。 */
function skillConfigChanged(skillPath: string): boolean {
  return skillConfigDraft.value.has(skillPath)
}

const hasChanges = computed(() =>
  skillOverrides.value.size > 0
  || platformToolOverrides.value.size > 0
  || toolOverrides.value.size > 0
  || workspaceLevelOverride.value !== null
  || skillConfigDraft.value.size > 0,
)

function entrySummary(value: string | undefined): string {
  return value?.trim() || "暂无简介。"
}

function diagLevelClass(level: RegistryDiagnostic["level"]): string {
  if (level === "error") return "border-red-500/50 text-red-300"
  if (level === "warn") return "border-yellow-500/50 text-yellow-200"
  return "border-neon-deep/50 text-neon-muted"
}

// --- 草稿写入(只改 override,不持久化) ---
function toggleSkill(skill: SkillRegistryEntry, enabled: boolean): void {
  if (applying.value) {
    return
  }
  const original = agent.value ? isSkillEnabledForAgent(skill, agent.value) : false
  const next = new Map(skillOverrides.value)
  if (enabled === original) {
    next.delete(skill.path)
  } else {
    next.set(skill.path, enabled)
  }
  skillOverrides.value = next
}

function togglePlatformTool(tool: AgentPlatformToolName, enabled: boolean): void {
  if (applying.value) {
    return
  }
  const original = agent.value ? isAgentPlatformToolEnabled(agent.value, tool) : false
  const next = new Map(platformToolOverrides.value)
  if (enabled === original) {
    next.delete(tool)
  } else {
    next.set(tool, enabled)
  }
  platformToolOverrides.value = next
}

function toggleTool(tool: ToolRegistryEntry, enabled: boolean): void {
  if (applying.value) {
    return
  }
  const original = agent.value ? isToolEnabledForAgent(tool, agent.value) : false
  const next = new Map(toolOverrides.value)
  if (enabled === original) {
    next.delete(tool.name)
  } else {
    next.set(tool.name, enabled)
  }
  toolOverrides.value = next
}

function toggleAssistantCapability(capability: AssistantCapability, enabled: boolean): void {
  if (capability.kind === "platform") {
    togglePlatformTool(capability.tool.id, enabled)
    return
  }
  toggleTool(capability.tool, enabled)
}

function updateWorkspaceAccessLevel(level: number): void {
  if (applying.value) {
    return
  }
  workspaceLevelOverride.value = level
}

async function reload(): Promise<void> {
  const result: LocalAssistantConfig = await getLocalAssistantConfig()
  agent.value = result.agent
  skills.value = result.skills
  tools.value = result.tools
  toolDiagnostics.value = result.toolDiagnostics
  // Build initial config values per skill: player-saved value ?? default.
  const initial = new Map<string, Record<string, string>>()
  for (const skill of result.skills) {
    if (!skill.configItems || skill.configItems.length === 0) {
      continue
    }
    const saved = result.skillConfigValues[skill.path] ?? {}
    const values: Record<string, string> = {}
    for (const item of skill.configItems) {
      values[item.key] = item.key in saved ? saved[item.key] : item.defaultValue
    }
    initial.set(skill.path, values)
  }
  skillConfigInitial.value = initial
}

async function refreshKnowledge(): Promise<void> {
  if (applying.value || updatingKnowledge.value || hasChanges.value) {
    return
  }
  const confirmed = await confirm({
    title: "更新助手知识",
    message: "将更新桌面助手理解 Tsian 所需的基础说明。此操作不会改变你的助手设定、风格、个人笔记、模型与权限设置、自定义能力，也不会修改当前游戏卡内容。是否继续？",
    confirmText: "更新",
    cancelText: "取消",
  })
  if (!confirmed) {
    return
  }
  updatingKnowledge.value = true
  try {
    const result = await refreshLocalAssistantKnowledge()
    await reload()
    emit("change")
    toast.success(`助手知识已更新（${result.updatedPaths.length} 个文件）。`)
  } catch (error) {
    toast.error(error instanceof Error ? error.message : "更新助手知识失败。")
  } finally {
    updatingKnowledge.value = false
  }
}

function resetOverrides(): void {
  skillOverrides.value = new Map()
  platformToolOverrides.value = new Map()
  toolOverrides.value = new Map()
  workspaceLevelOverride.value = null
  skillConfigDraft.value = new Map()
}

/**
 * 把草稿差异持久化到 agent.json。逐字段 diff 调现有单字段 setter,
 * 只保存真正改变的字段。返回是否全部成功。
 */
async function applyChanges(): Promise<boolean> {
  if (!agent.value || !hasChanges.value || applying.value) {
    return true
  }
  applying.value = true
  try {
    for (const [path, enabled] of skillOverrides.value) {
      await updateLocalAssistantSkillEnabled({ skillPath: path, enabled })
    }
    for (const [tool, enabled] of platformToolOverrides.value) {
      await updateLocalAssistantPlatformToolEnabled({ tool, enabled })
    }
    for (const [toolName, enabled] of toolOverrides.value) {
      await updateLocalAssistantToolEnabled({ toolName, enabled })
    }
    if (workspaceLevelOverride.value !== null) {
      await updateLocalAssistantWorkspaceAccess(workspaceLevelOverride.value)
    }
    // Skill config: persist the full merged set (initial + draft overrides)
    // per skill — the storage layer replaces the record for each skill dir.
    for (const [skillPath, draftValues] of skillConfigDraft.value) {
      const initial = skillConfigInitial.value.get(skillPath) ?? {}
      const merged = { ...initial, ...draftValues }
      await updateLocalAssistantSkillConfig(skillPath, merged)
    }
    await reload()
    resetOverrides()
    emit("change")
    toast.success("助手配置已应用")
    return true
  } catch (error) {
    toast.error(error instanceof Error ? error.message : "应用配置失败。")
    // 失败时 reload 拿到当前真实状态(可能部分字段已保存成功),
    // 清空 override 让用户看到真实状态再决定是否重新调整。
    await reload()
    resetOverrides()
    return false
  } finally {
    applying.value = false
  }
}

/** 确定 = 应用 + 关闭;应用失败则不关闭。 */
async function confirmChanges(): Promise<void> {
  if (applying.value) {
    return
  }
  const ok = await applyChanges()
  if (ok) {
    emit("close")
  }
}

/** 取消 = 丢弃草稿 + 关闭(与标题栏 X 行为一致)。 */
function cancelChanges(): void {
  if (applying.value) {
    return
  }
  resetOverrides()
  emit("close")
}

onMounted(() => {
  reload().catch((error) => {
    toast.error(error instanceof Error ? error.message : "无法加载助手配置。")
  })
})

defineExpose({ reload })
</script>
